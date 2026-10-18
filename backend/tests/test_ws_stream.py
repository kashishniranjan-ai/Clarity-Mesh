"""
Tests for WebSocket Real-Time Stream Analysis endpoint:
  WS /ws/analyze/stream
"""

from __future__ import annotations

import base64
import cv2
import numpy as np
import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from main import app
import routes.ws_stream as ws_stream_mod


def _make_dummy_jpeg() -> bytes:
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    return buf.tobytes()


def test_ws_stream_init_and_ping():
    client = TestClient(app)
    with client.websocket_connect("/ws/analyze/stream") as ws:
        init_msg = ws.receive_json()
        assert init_msg["type"] == "session_init"
        assert init_msg["status"] == "ok"
        assert "sample_interval" in init_msg
        assert "max_duration_s" in init_msg

        # Test ping-pong
        ws.send_json({"action": "ping"})
        pong_msg = ws.receive_json()
        assert pong_msg["type"] == "pong"
        assert "time" in pong_msg


def test_ws_stream_stop_action():
    client = TestClient(app)
    with client.websocket_connect("/ws/analyze/stream") as ws:
        init_msg = ws.receive_json()
        assert init_msg["type"] == "session_init"

        ws.send_json({"action": "stop"})
        stop_msg = ws.receive_json()
        assert stop_msg["type"] == "session_stopped"
        assert stop_msg["status"] == "ok"


def test_ws_stream_skipping_and_no_face(monkeypatch):
    monkeypatch.setenv("CLARITY_STREAM_SAMPLE_INTERVAL", "2")
    client = TestClient(app)
    dummy_bytes = _make_dummy_jpeg()

    with client.websocket_connect("/ws/analyze/stream") as ws:
        init_msg = ws.receive_json()
        assert init_msg["sample_interval"] == 2

        # Frame 1: index 1 % 2 != 0 -> skipped
        ws.send_bytes(dummy_bytes)
        f1_msg = ws.receive_json()
        assert f1_msg["type"] == "frame_skipped"
        assert f1_msg["frame_index"] == 1

        # Frame 2: index 2 % 2 == 0 -> sampled
        ws.send_bytes(dummy_bytes)
        f2_msg = ws.receive_json()
        assert f2_msg["type"] == "frame_result"
        assert f2_msg["frame_index"] == 2
        assert f2_msg["status"] == "no_face_detected"
        assert f2_msg["score"] is None


def test_ws_stream_mocked_face_score(monkeypatch):
    monkeypatch.setenv("CLARITY_STREAM_SAMPLE_INTERVAL", "1")
    monkeypatch.setattr(ws_stream_mod, "detect_faces", lambda img: [{"x": 10, "y": 10, "width": 50, "height": 50}])
    monkeypatch.setattr(ws_stream_mod.vd, "score_face_crop", lambda crop: 0.88)

    client = TestClient(app)
    dummy_bytes = _make_dummy_jpeg()
    b64_str = base64.b64encode(dummy_bytes).decode("utf-8")

    with client.websocket_connect("/ws/analyze/stream") as ws:
        _ = ws.receive_json()  # init

        # Send via json text
        ws.send_json({"image_b64": b64_str})
        msg = ws.receive_json()

        assert msg["type"] == "frame_result"
        assert msg["status"] == "ok"
        assert msg["score"] == 0.88
        assert msg["face_count"] == 1
        assert msg["running_mean"] == 0.88
        assert msg["classification"] == "deepfake"


def test_ws_stream_concurrency_limit(monkeypatch):
    monkeypatch.setenv("CLARITY_MAX_STREAMS", "1")
    client = TestClient(app)

    with client.websocket_connect("/ws/analyze/stream") as ws1:
        _ = ws1.receive_json()

        # Try a second simultaneous connection
        with client.websocket_connect("/ws/analyze/stream") as ws2:
            err_msg = ws2.receive_json()
            assert err_msg["type"] == "error"
            assert err_msg["status"] == "stream_capacity_exceeded"
            with pytest.raises(WebSocketDisconnect) as exc_info:
                ws2.receive_json()
            assert exc_info.value.code == 1013
