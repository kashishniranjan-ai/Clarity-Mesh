"""
Clarity Mesh — Visual Explainability (Grad-CAM / Occlusion Sensitivity)
========================================================================
Generates honest, model-grounded saliency heatmaps for the stored upload
that was scored by the EfficientNet-B7 visual deepfake detector:

* ``occlusion`` — model-agnostic occlusion sensitivity.  A grid of patches
  is masked (filled with the ImageNet mean in normalised space) and the
  change in the model's fake-oriented score is measured per patch.  Only
  forward passes are used.
* ``gradcam`` — gradient-weighted class activation mapping over the last
  convolutional layer, when (and only when) the TorchScript export supports
  autograd.  When it does not, the service reports
  ``status: gradcam_unavailable`` with the concrete reason — it NEVER
  fabricates a heatmap.

Failure philosophy (mirrors the detectors)
------------------------------------------
A payload only carries ``heatmap_b64`` when a genuine computation
completed.  No face, a missing model, an unusable file or an unsupported
autograd graph are all first-class honest states — never a guessed image.
"""

from __future__ import annotations

import base64
import math
import os
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from services.face_processor import crop_face
from services.media_processor import (
    MediaProcessingError,
    detect_media_kind,
    process_image,
    process_video,
)
from services import visual_detector as vd

UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"

_VALID_METHODS = ("occlusion", "gradcam")


class ExplainabilityError(RuntimeError):
    """Internal error raised only for programmer mistakes."""


def _env_int(name: str, default: int, low: int, high: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default
    return max(low, min(high, value))


def _data_url_from_bgr(image_bgr: np.ndarray) -> str:
    ok, buf = cv2.imencode(".png", image_bgr)
    if not ok:
        raise ExplainabilityError("Heatmap PNG encoding failed.")
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def _place_crop_heatmap_into_frame(
    heat_crop: Any, frame_shape: tuple[int, ...], crop_rect: tuple[int, int, int, int]
) -> np.ndarray:
    """Map a 380x380 normalised heat grid back into full-frame coordinates."""
    frame_h, frame_w = frame_shape[:2]
    x1, y1, x2, y2 = crop_rect
    crop_h = max(1, y2 - y1)
    crop_w = max(1, x2 - x1)
    heat = np.asarray(heat_crop, dtype=np.float32)
    heat = cv2.resize(heat, (crop_w, crop_h), interpolation=cv2.INTER_CUBIC)
    canvas = np.zeros((frame_h, frame_w), dtype=np.float32)
    canvas[y1:y2, x1:x2] = np.clip(heat, 0.0, 1.0)
    return canvas


# ---------------------------------------------------------------------------
# Occlusion sensitivity — batched masked forwards
# ---------------------------------------------------------------------------
def _occlusion_heatmap(
    model: Any, tensor: Any, baseline_score: float, grid: int, batch_size: int
) -> tuple[np.ndarray, dict[str, Any]]:
    """
    Run grid x grid masked forwards and return (heat_380, meta).

    Patch cells are filled with 0.0 in *normalised* space, which equals the
    ImageNet mean colour — a neutral, documented masking value.
    """
    torch = vd._import_torch()
    size = vd.INPUT_SIZE
    patch = max(1, size // grid)

    occluded: list[Any] = []
    for row in range(grid):
        for col in range(grid):
            variant = tensor.clone()
            r0, c0 = row * patch, col * patch
            r1 = size if row == grid - 1 else r0 + patch
            c1 = size if col == grid - 1 else c0 + patch
            variant[:, :, r0:r1, c0:c1] = 0.0
            occluded.append(variant)
    batch = torch.cat(occluded, dim=0)  # (grid*grid, 3, 380, 380)

    scores: list[float] = []
    with torch.inference_mode():
        for start in range(0, batch.shape[0], batch_size):
            chunk = batch[start:start + batch_size]
            logits = model(chunk).reshape(-1)
            scores.extend(torch.sigmoid(logits).tolist())

    deltas = np.abs(np.asarray(scores, dtype=np.float32) - float(baseline_score))
    grid_map = deltas.reshape(grid, grid)
    peak = float(grid_map.max()) if grid_map.size else 0.0
    normalised = grid_map / peak if peak > 0 else grid_map
    heat = cv2.resize(
        normalised.astype(np.float32), (size, size), interpolation=cv2.INTER_CUBIC
    )
    meta = {
        "grid": grid,
        "patch_size_px": patch,
        "passes": len(scores),
        "batch_size": batch_size,
        "mask_value": "0.0 in normalised space (ImageNet mean colour)",
        "importance": "abs(baseline_score - occluded_score) per patch",
        "delta_max": peak,
    }
    return heat, meta


# ---------------------------------------------------------------------------
# Grad-CAM — last Conv2d layer, graceful degradation
# ---------------------------------------------------------------------------
class _GradCamUnavailable(Exception):
    """Raised when Grad-CAM genuinely cannot be produced (honest state)."""


def _gradcam_heatmap(model: Any, tensor: Any) -> tuple[np.ndarray, dict[str, Any]]:
    """
    Grad-CAM over the last Conv2d layer.

    ANY failure (no conv layer, TorchScript without autograd support,
    degenerate activations) raises ``_GradCamUnavailable`` with the concrete
    reason — the caller converts that into an honest ``gradcam_unavailable``
    payload.  A heatmap is only returned after a real backward pass.
    """
    torch = vd._import_torch()

    target_name = None
    target_layer = None
    try:
        for name, module in model.named_modules():
            # TorchScript children are RecursiveScriptModule instances, so an
            # isinstance() check against torch.nn.Conv2d is not reliable —
            # fall back to the exposed convolution attribute.
            if isinstance(module, torch.nn.Conv2d) or getattr(module, "out_channels", None) is not None:
                target_name, target_layer = name, module
    except Exception as exc:  # pragma: no cover — exotic module trees
        raise _GradCamUnavailable(f"Layer enumeration failed: {exc}") from exc
    if target_layer is None:
        raise _GradCamUnavailable(
            "No Conv2d layer exposed by this model export."
        )

    captured: dict[str, Any] = {}
    try:
        def _forward_hook(_module, _inputs, output):
            try:
                output.retain_grad()
            except Exception:
                pass
            captured["activation"] = output

        handle = target_layer.register_forward_hook(_forward_hook)
    except Exception as exc:
        raise _GradCamUnavailable(f"Forward hook unsupported: {exc}") from exc

    try:
        x = tensor.clone().requires_grad_(True)
        with torch.enable_grad():
            logits = model(x)
            score = logits.reshape(-1)[0]
            model.zero_grad(set_to_none=True)
            score.backward()
    except Exception as exc:
        raise _GradCamUnavailable(
            "Backward pass failed — this TorchScript export does not support "
            f"autograd ({type(exc).__name__}: {exc})."
        ) from exc
    finally:
        try:
            handle.remove()
        except Exception:  # pragma: no cover
            pass

    activation = captured.get("activation")
    gradients = getattr(activation, "grad", None) if activation is not None else None
    if activation is None or gradients is None:
        raise _GradCamUnavailable("No activation gradient captured during backward pass.")

    try:
        weights = gradients.float().mean(dim=(2, 3), keepdim=True)
        cam = torch.relu((weights * activation.float()).sum(dim=1, keepdim=True))
        cam = cam[0, 0]
        peak = float(cam.max())
        if not math.isfinite(peak) or peak <= 0.0:
            raise _GradCamUnavailable("Degenerate activation map (all-zero / non-finite).")
        cam = cam / peak
    except _GradCamUnavailable:
        raise
    except Exception as exc:
        raise _GradCamUnavailable(f"CAM assembly failed: {type(exc).__name__}: {exc}") from exc

    heat = cv2.resize(cam.detach().cpu().numpy(), (vd.INPUT_SIZE, vd.INPUT_SIZE),
                      interpolation=cv2.INTER_CUBIC)
    meta = {
        "layer": str(target_name),
        "importance": "ReLU(sum(channel_mean(grad) * activation)) of the last conv layer",
    }
    return np.clip(heat, 0.0, 1.0).astype(np.float32), meta


# ---------------------------------------------------------------------------
def _label_face_region(cx: float, cy: float) -> str:
    """Deterministic anatomical region label based on normalized face crop coordinates (0..1)."""
    if cy < 0.28:
        return "forehead / upper hairline"
    elif cy < 0.48:
        side = "left" if cx < 0.5 else "right"
        return f"{side} periorbital / eye region"
    elif cy < 0.65:
        return "nasal / mid-facial region"
    elif cy < 0.82:
        return "perioral / mouth & lips region"
    else:
        return "chin / jawline margin"


def _extract_peak_regions(heat: np.ndarray, top_k: int = 4) -> list[dict[str, Any]]:
    """
    Extract bounding boxes (normalized 0..1) of peak activation regions.
    Uses thresholding + contour analysis on the normalized saliency map.
    """
    if heat is None or heat.size == 0:
        return []

    max_val = float(heat.max())
    if max_val < 0.15:
        return []

    # Threshold at 65% of max activation (minimum 0.35)
    thresh_val = max(0.35, max_val * 0.65)
    heat_u8 = ((heat >= thresh_val).astype(np.uint8)) * 255
    contours, _ = cv2.findContours(heat_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    h_map, w_map = heat.shape[:2]
    regions: list[dict[str, Any]] = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < 25:  # filter tiny noise specks
            continue
        rx, ry, rw, rh = cv2.boundingRect(cnt)
        sub_heat = heat[ry:ry + rh, rx:rx + rw]
        peak_intensity = float(sub_heat.max()) if sub_heat.size > 0 else max_val

        norm_x = round(float(rx) / w_map, 3)
        norm_y = round(float(ry) / h_map, 3)
        norm_w = round(float(rw) / w_map, 3)
        norm_h = round(float(rh) / h_map, 3)

        cx = norm_x + norm_w / 2.0
        cy = norm_y + norm_h / 2.0

        description = _label_face_region(cx, cy)
        regions.append({
            "x": norm_x,
            "y": norm_y,
            "w": norm_w,
            "h": norm_h,
            "peak_intensity": round(peak_intensity, 4),
            "description": description,
        })

    regions.sort(key=lambda r: (r["peak_intensity"], r["w"] * r["h"]), reverse=True)

    # Fallback to single peak region if contours were too small
    if not regions and max_val >= 0.25:
        max_idx = np.unravel_index(np.argmax(heat), heat.shape)
        my, mx = int(max_idx[0]), int(max_idx[1])
        box_size = 45
        rx = max(0, mx - box_size // 2)
        ry = max(0, my - box_size // 2)
        rw = min(w_map - rx, box_size)
        rh = min(h_map - ry, box_size)
        norm_x = round(float(rx) / w_map, 3)
        norm_y = round(float(ry) / h_map, 3)
        norm_w = round(float(rw) / w_map, 3)
        norm_h = round(float(rh) / h_map, 3)
        cx = norm_x + norm_w / 2.0
        cy = norm_y + norm_h / 2.0
        regions.append({
            "x": norm_x,
            "y": norm_y,
            "w": norm_w,
            "h": norm_h,
            "peak_intensity": round(max_val, 4),
            "description": _label_face_region(cx, cy),
        })

    return regions[:top_k]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def _find_first_face(
    frames: list[tuple[int, Any]],
    boxes_by_frame: dict[int, list[dict[str, int]]],
    target_frame: int | None = None,
) -> tuple[int, Any, dict[str, int], tuple[int, int, int, int], Any] | None:
    """
    First face crop, prioritizing target_frame if specified, else ascending frame index.

    Returns ``(frame_index, frame, box, crop_rect_xyxy, crop)`` or ``None``.
    ``crop_rect_xyxy`` replicates face_processor.crop_face's 15% padding so
    the heat can be mapped back onto the full frame exactly.
    """
    sorted_frames = sorted(frames, key=lambda pair: pair[0])
    if target_frame is not None:
        target_frames = [pair for pair in sorted_frames if pair[0] == target_frame]
        other_frames = [pair for pair in sorted_frames if pair[0] != target_frame]
        ordered_frames = target_frames + other_frames
    else:
        ordered_frames = sorted_frames

    for index, frame in ordered_frames:
        boxes = boxes_by_frame.get(index, []) or []
        if frame is None or getattr(frame, "size", 0) == 0:
            continue
        frame_h, frame_w = frame.shape[:2]
        for box in boxes:
            crop = crop_face(frame, box)
            if crop is None or crop.size == 0:
                continue
            pad_x = int(box["width"] * 0.15)
            pad_y = int(box["height"] * 0.15)
            x1 = max(0, box["x"] - pad_x)
            y1 = max(0, box["y"] - pad_y)
            x2 = min(frame_w, box["x"] + box["width"] + pad_x)
            y2 = min(frame_h, box["y"] + box["height"] + pad_y)
            return index, frame, box, (x1, y1, x2, y2), crop
    return None


def generate_explanation(
    stored_name: str,
    method: str = "occlusion",
    frame_index: int | None = None,
) -> dict[str, Any]:
    """
    Produce an explainability payload for one stored upload.

    Honest states: ``invalid_stored_name``, ``file_not_found``,

    ``not_applicable`` (audio), ``media_processing_failed``,
    ``no_face_detected``, ``model_unavailable``, ``inference_failed``,
    ``gradcam_unavailable`` and ``completed``.  ``heatmap_b64`` exists ONLY
    in the ``completed`` state.
    """
    started = time.perf_counter()

    if not stored_name or Path(stored_name).name != stored_name:
        return {
            "status": "invalid_stored_name",
            "error": "stored_name must be a plain basename inside the uploads directory.",
        }
    if method not in _VALID_METHODS:
        return {
            "status": "invalid_method",
            "error": f"method must be one of {_VALID_METHODS}.",
        }

    path = UPLOAD_DIR / stored_name
    if not path.is_file() or path.stat().st_size == 0:
        return {
            "status": "file_not_found",
            "error": "The stored upload is no longer available for explanation.",
        }

    kind = detect_media_kind(path, fallback="unknown")
    if kind not in ("image", "video"):
        return {
            "status": "not_applicable",
            "message": (
                "Explainability heatmaps apply to images and videos with a "
                f"detected face; this file was recognised as '{kind}'."
            ),
        }

    try:
        if kind == "image":
            processed = process_image(path)
            frames: list[tuple[int, Any]] = [(0, processed["image"])]
        else:
            processed = process_video(path)
            frames = processed["frames"]
    except MediaProcessingError as exc:
        return {
            "status": "media_processing_failed",
            "error": f"Media could not be decoded for explanation: {exc}",
        }

    from services.face_processor import analyse_frames

    face_summary = analyse_frames(frames)
    boxes_by_frame = face_summary.get("boxes", {}) or {}
    found = _find_first_face(frames, boxes_by_frame, target_frame=frame_index)
    if found is None:
        return {
            "status": "no_face_detected",
            "message": (
                "No face was available for the visual model, so no heatmap "
                "can be produced. This is NOT a real/deepfake verdict."
            ),
        }
    frame_index_found, frame, box, crop_rect, crop = found

    model, error = vd._load_model()
    if model is None:
        return {
            "status": "model_unavailable",
            "message": (
                f"Visual deepfake model unavailable: {error}. "
                "No heatmap can be produced."
            ),
        }

    torch = vd._import_torch()
    tensor = vd.preprocess_face(crop)
    if tensor is None:
        return {
            "status": "inference_failed",
            "error": "The selected face crop could not be preprocessed for the model.",
        }

    try:
        with torch.no_grad():
            logits = model(tensor).reshape(-1)
            baseline = float(torch.sigmoid(logits[0]).item())
    except Exception as exc:
        return {
            "status": "inference_failed",
            "error": f"Baseline forward pass failed: {type(exc).__name__}: {exc}",
        }
    if not math.isfinite(baseline):
        return {
            "status": "inference_failed",
            "error": "Baseline forward pass produced a non-finite score.",
        }

    method_meta: dict[str, Any]
    if method == "occlusion":
        grid = _env_int("CLARITY_EXPLAIN_GRID", 6, 3, 8)
        batch_size = _env_int("CLARITY_EXPLAIN_BATCH", 12, 1, 32)
        try:
            heat, method_meta = _occlusion_heatmap(
                model, tensor, baseline, grid, batch_size
            )
        except Exception as exc:
            return {
                "status": "inference_failed",
                "error": f"Occlusion forwards failed: {type(exc).__name__}: {exc}",
            }
    else:  # gradcam
        try:
            heat, method_meta = _gradcam_heatmap(model, tensor)
        except _GradCamUnavailable as exc:
            return {
                "status": "gradcam_unavailable",
                "method": "gradcam",
                "error": str(exc),
                "suggestion": (
                    "Use the occlusion sensitivity method — it relies only on "
                    "forward passes and works with every model export."
                ),
                "model": vd.MODEL_NAME,
            }

    # Full frame heatmap
    frame_heat = _place_crop_heatmap_into_frame(heat, frame.shape, crop_rect)
    heat_u8 = (np.clip(frame_heat, 0.0, 1.0) * 255).astype(np.uint8)
    colored = cv2.applyColorMap(heat_u8, cv2.COLORMAP_INFERNO)
    heatmap_b64 = _data_url_from_bgr(colored)

    # Face crop visual assets
    crop_resized = cv2.resize(crop, (vd.INPUT_SIZE, vd.INPUT_SIZE), interpolation=cv2.INTER_AREA)
    original_crop_b64 = _data_url_from_bgr(crop_resized)

    crop_heat_u8 = (np.clip(heat, 0.0, 1.0) * 255).astype(np.uint8)
    colored_crop = cv2.applyColorMap(crop_heat_u8, cv2.COLORMAP_INFERNO)
    heatmap_crop_b64 = _data_url_from_bgr(colored_crop)

    # Blended overlay (50% original face crop, 50% heatmap)
    blended_crop = cv2.addWeighted(crop_resized, 0.5, colored_crop, 0.5, 0.0)
    overlay_b64 = _data_url_from_bgr(blended_crop)

    # Peak activation regions
    peak_regions = _extract_peak_regions(heat)

    latency_ms = int((time.perf_counter() - started) * 1000)
    return {
        "status": "completed",
        "method": method,
        "heatmap_b64": heatmap_b64,
        "original_crop_b64": original_crop_b64,
        "heatmap_crop_b64": heatmap_crop_b64,
        "overlay_b64": overlay_b64,
        "overlay_opacity": 0.5,
        "peak_regions": peak_regions,
        "model": vd.MODEL_NAME,
        "model_source": vd.MODEL_SOURCE_URL,
        "baseline_score": round(baseline, 4),
        "baseline_classification": vd.classify(baseline),
        "threshold": vd.CLASSIFICATION_THRESHOLD,
        "frame_index": int(frame_index_found),
        "face_box": {k: int(v) for k, v in box.items()},
        "frame_size": [int(frame.shape[1]), int(frame.shape[0])],
        "latency_ms": latency_ms,
        "note": (
            "The heatmap marks regions whose occlusion (or whose last-conv "
            "activations for Grad-CAM) changed the model's score. It explains "
            "WHAT the model reacted to — it is NOT proof of manipulation and "
            "does not calibrate the score."
        ),
        **method_meta,
    }


def explain_image_bgr(image_bgr: np.ndarray, method: str = "occlusion") -> dict[str, Any]:
    """
    Run explainability directly on a decoded BGR image array.
    """
    started = time.perf_counter()
    if image_bgr is None or getattr(image_bgr, "size", 0) == 0:
        return {
            "status": "media_processing_failed",
            "error": "Provided image array is empty or invalid.",
        }

    from services.face_processor import analyse_frames
    frames: list[tuple[int, Any]] = [(0, image_bgr)]
    face_summary = analyse_frames(frames)
    boxes_by_frame = face_summary.get("boxes", {}) or {}
    found = _find_first_face(frames, boxes_by_frame)
    if found is None:
        return {
            "status": "no_face_detected",
            "message": (
                "No face was available for the visual model, so no heatmap "
                "can be produced. This is NOT a real/deepfake verdict."
            ),
        }
    frame_index, frame, box, crop_rect, crop = found

    model, error = vd._load_model()
    if model is None:
        return {
            "status": "model_unavailable",
            "message": f"Visual deepfake model unavailable: {error}. No heatmap can be produced.",
        }

    torch = vd._import_torch()
    tensor = vd.preprocess_face(crop)
    if tensor is None:
        return {
            "status": "inference_failed",
            "error": "The selected face crop could not be preprocessed for the model.",
        }

    try:
        with torch.no_grad():
            logits = model(tensor).reshape(-1)
            baseline = float(torch.sigmoid(logits[0]).item())
    except Exception as exc:
        return {
            "status": "inference_failed",
            "error": f"Baseline forward pass failed: {type(exc).__name__}: {exc}",
        }
    if not math.isfinite(baseline):
        return {
            "status": "inference_failed",
            "error": "Baseline forward pass produced a non-finite score.",
        }

    method_meta: dict[str, Any]
    if method == "occlusion":
        grid = _env_int("CLARITY_EXPLAIN_GRID", 6, 3, 8)
        batch_size = _env_int("CLARITY_EXPLAIN_BATCH", 12, 1, 32)
        try:
            heat, method_meta = _occlusion_heatmap(model, tensor, baseline, grid, batch_size)
        except Exception as exc:
            return {
                "status": "inference_failed",
                "error": f"Occlusion forwards failed: {type(exc).__name__}: {exc}",
            }
    else:  # gradcam
        try:
            heat, method_meta = _gradcam_heatmap(model, tensor)
        except _GradCamUnavailable as exc:
            return {
                "status": "gradcam_unavailable",
                "method": "gradcam",
                "error": str(exc),
                "suggestion": "Use the occlusion sensitivity method.",
                "model": vd.MODEL_NAME,
            }

    frame_heat = _place_crop_heatmap_into_frame(heat, frame.shape, crop_rect)
    heat_u8 = (np.clip(frame_heat, 0.0, 1.0) * 255).astype(np.uint8)
    colored = cv2.applyColorMap(heat_u8, cv2.COLORMAP_INFERNO)
    heatmap_b64 = _data_url_from_bgr(colored)

    crop_resized = cv2.resize(crop, (vd.INPUT_SIZE, vd.INPUT_SIZE), interpolation=cv2.INTER_AREA)
    original_crop_b64 = _data_url_from_bgr(crop_resized)

    crop_heat_u8 = (np.clip(heat, 0.0, 1.0) * 255).astype(np.uint8)
    colored_crop = cv2.applyColorMap(crop_heat_u8, cv2.COLORMAP_INFERNO)
    heatmap_crop_b64 = _data_url_from_bgr(colored_crop)

    blended_crop = cv2.addWeighted(crop_resized, 0.5, colored_crop, 0.5, 0.0)
    overlay_b64 = _data_url_from_bgr(blended_crop)
    peak_regions = _extract_peak_regions(heat)

    latency_ms = int((time.perf_counter() - started) * 1000)
    return {
        "status": "completed",
        "method": method,
        "heatmap_b64": heatmap_b64,
        "original_crop_b64": original_crop_b64,
        "heatmap_crop_b64": heatmap_crop_b64,
        "overlay_b64": overlay_b64,
        "overlay_opacity": 0.5,
        "peak_regions": peak_regions,
        "model": vd.MODEL_NAME,
        "model_source": vd.MODEL_SOURCE_URL,
        "baseline_score": round(baseline, 4),
        "baseline_classification": vd.classify(baseline),
        "threshold": vd.CLASSIFICATION_THRESHOLD,
        "frame_index": 0,
        "face_box": {k: int(v) for k, v in box.items()},
        "frame_size": [int(frame.shape[1]), int(frame.shape[0])],
        "latency_ms": latency_ms,
        "note": "Grad-CAM/Occlusion explainability on direct image input.",
        **method_meta,
    }



