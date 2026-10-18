"""
Clarity Mesh — Real-Time WebSocket Media Stream Analysis
=========================================================
Endpoint:
  WS /ws/analyze/stream

Accepts raw JPEG byte frames (or JSON with base64 image data) over a persistent
WebSocket connection. Enforces:
- Hard cap on concurrent active streams (CLARITY_MAX_STREAMS, default 2)
- Session timeout duration (CLARITY_STREAM_MAX_DURATION_S, default 120s)
- Max frames per session (CLARITY_STREAM_MAX_FRAMES, default 200)
- Configurable sampling interval (CLARITY_STREAM_SAMPLE_INTERVAL, default 5)

Emits real-time JSON events with honest detection scores, running aggregates,
and face counts.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import time
from typing import Any

import cv2
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, status

from services.face_processor import crop_face, detect_faces
from services import visual_detector as vd

router = APIRouter()

_active_streams_count = 0
_streams_lock = asyncio.Lock()


def _env_int(name: str, default: int, low: int = 1, high: int = 1000) -> int:
    try:
        val = int(os.getenv(name, str(default)))
        return max(low, min(high, val))
    except (TypeError, ValueError):
        return default


@router.websocket("/ws/analyze/stream")
async def websocket_stream_endpoint(websocket: WebSocket):
    global _active_streams_count

    max_streams = _env_int("CLARITY_MAX_STREAMS", 2, 1, 10)
    sample_interval = _env_int("CLARITY_STREAM_SAMPLE_INTERVAL", 5, 1, 60)
    max_duration_s = _env_int("CLARITY_STREAM_MAX_DURATION_S", 120, 5, 600)
    max_frames = _env_int("CLARITY_STREAM_MAX_FRAMES", 200, 10, 2000)

    # 1. Enforce concurrent stream cap before accepting
    async with _streams_lock:
        if _active_streams_count >= max_streams:
            await websocket.accept()
            await websocket.send_json({
                "type": "error",
                "status": "stream_capacity_exceeded",
                "message": (
                    f"Max concurrent real-time analysis streams ({max_streams}) reached. "
                    "Try again later."
                ),
            })
            await websocket.close(code=1013)  # 1013 = Try Again Later
            return
        _active_streams_count += 1

    session_start = time.perf_counter()
    frame_index = 0
    scores_accum: list[float] = []

    try:
        await websocket.accept()
        await websocket.send_json({
            "type": "session_init",
            "status": "ok",
            "message": "Stream analysis session initialized.",
            "sample_interval": sample_interval,
            "max_duration_s": max_duration_s,
            "max_frames": max_frames,
        })

        while True:
            # Check session duration cap
            elapsed = time.perf_counter() - session_start
            if elapsed > max_duration_s:
                await websocket.send_json({
                    "type": "session_timeout",
                    "status": "timeout",
                    "message": f"Session duration cap of {max_duration_s}s exceeded.",
                    "total_frames": frame_index,
                    "final_mean": round(sum(scores_accum) / len(scores_accum), 4) if scores_accum else None,
                })
                await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)
                break

            # Check max frame cap
            if frame_index >= max_frames:
                await websocket.send_json({
                    "type": "frame_cap_exceeded",
                    "status": "completed",
                    "message": f"Maximum allowed frames ({max_frames}) reached.",
                    "total_frames": frame_index,
                    "final_mean": round(sum(scores_accum) / len(scores_accum), 4) if scores_accum else None,
                })
                await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)
                break

            # Receive next frame
            try:
                message = await websocket.receive()
            except WebSocketDisconnect:
                break

            if message.get("type") == "websocket.disconnect":
                break

            raw_bytes: bytes | None = None
            if "bytes" in message and message["bytes"]:
                raw_bytes = message["bytes"]
            elif "text" in message and message["text"]:
                text_payload = message["text"].strip()
                # Could be a control JSON or base64 image
                if text_payload.startswith("{"):
                    try:
                        parsed = json.loads(text_payload)
                        if parsed.get("action") == "ping":
                            await websocket.send_json({"type": "pong", "time": time.time()})
                            continue
                        if parsed.get("action") == "stop":
                            await websocket.send_json({
                                "type": "session_stopped",
                                "status": "ok",
                                "total_frames": frame_index,
                                "final_mean": round(sum(scores_accum) / len(scores_accum), 4) if scores_accum else None,
                            })
                            await websocket.close(code=status.WS_1000_NORMAL_CLOSURE)
                            break
                        if "image_b64" in parsed:
                            b64 = parsed["image_b64"]
                            if "," in b64:
                                b64 = b64.split(",", 1)[1]
                            raw_bytes = base64.b64decode(b64)
                    except Exception:
                        await websocket.send_json({
                            "type": "error",
                            "status": "invalid_payload",
                            "message": "Failed parsing JSON frame payload.",
                        })
                        continue
                else:
                    # Raw base64 string
                    try:
                        b64 = text_payload
                        if "," in b64:
                            b64 = b64.split(",", 1)[1]
                        raw_bytes = base64.b64decode(b64)
                    except Exception:
                        pass

            if not raw_bytes:
                continue

            frame_index += 1

            # Check if this frame should be sampled
            if frame_index % sample_interval != 0:
                await websocket.send_json({
                    "type": "frame_skipped",
                    "frame_index": frame_index,
                    "status": "skipped",
                    "running_mean": round(sum(scores_accum) / len(scores_accum), 4) if scores_accum else None,
                    "running_count": len(scores_accum),
                })
                continue

            # Process sampled frame
            t0 = time.perf_counter()
            arr = np.frombuffer(raw_bytes, np.uint8)
            img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)

            if img_bgr is None:
                await websocket.send_json({
                    "type": "frame_result",
                    "frame_index": frame_index,
                    "status": "decode_failed",
                    "score": None,
                    "face_count": 0,
                    "running_mean": round(sum(scores_accum) / len(scores_accum), 4) if scores_accum else None,
                    "running_count": len(scores_accum),
                    "latency_ms": int((time.perf_counter() - t0) * 1000),
                })
                continue

            boxes = detect_faces(img_bgr)
            if not boxes:
                await websocket.send_json({
                    "type": "frame_result",
                    "frame_index": frame_index,
                    "status": "no_face_detected",
                    "score": None,
                    "face_count": 0,
                    "running_mean": round(sum(scores_accum) / len(scores_accum), 4) if scores_accum else None,
                    "running_count": len(scores_accum),
                    "latency_ms": int((time.perf_counter() - t0) * 1000),
                })
                continue

            # Crop top face
            crop = crop_face(img_bgr, boxes[0])
            if crop is None or crop.size == 0:
                await websocket.send_json({
                    "type": "frame_result",
                    "frame_index": frame_index,
                    "status": "crop_failed",
                    "score": None,
                    "face_count": len(boxes),
                    "running_mean": round(sum(scores_accum) / len(scores_accum), 4) if scores_accum else None,
                    "running_count": len(scores_accum),
                    "latency_ms": int((time.perf_counter() - t0) * 1000),
                })
                continue

            score = vd.score_face_crop(crop)
            latency_ms = int((time.perf_counter() - t0) * 1000)

            if score is not None:
                scores_accum.append(score)
                running_mean = round(sum(scores_accum) / len(scores_accum), 4)
                await websocket.send_json({
                    "type": "frame_result",
                    "frame_index": frame_index,
                    "score": round(score, 4),
                    "classification": vd.classify(score),
                    "face_count": len(boxes),
                    "face_box": boxes[0],
                    "status": "ok",
                    "running_mean": running_mean,
                    "running_count": len(scores_accum),
                    "latency_ms": latency_ms,
                })
            else:
                await websocket.send_json({
                    "type": "frame_result",
                    "frame_index": frame_index,
                    "score": None,
                    "status": "inference_failed",
                    "face_count": len(boxes),
                    "running_mean": round(sum(scores_accum) / len(scores_accum), 4) if scores_accum else None,
                    "running_count": len(scores_accum),
                    "latency_ms": latency_ms,
                })

    finally:
        async with _streams_lock:
            _active_streams_count = max(0, _active_streams_count - 1)
