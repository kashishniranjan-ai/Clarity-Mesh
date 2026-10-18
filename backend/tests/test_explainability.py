"""
Clarity Mesh — Explainability service tests.

Model/face interactions are exercised through monkeypatched seams
(``_load_model`` and ``face_processor.analyse_frames``) with a deterministic
fake model, so these tests are fast, offline and verify the honest state
machine plus the real occlusion batching math.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
import pytest
import torch

from services import explainability
from services import visual_detector as vd


class FakeModel:
    """Deterministic stand-in: logit scales with the remaining input mass."""

    def __call__(self, x):
        return x.reshape(x.shape[0], -1).sum(dim=1, keepdim=True) * 0.001


def _write_solid_jpeg(path: Path, size: int = 64) -> None:
    image = np.full((size, size, 3), 200, dtype=np.uint8)
    assert cv2.imwrite(str(path), image)


def _patch_faces(monkeypatch, frame_shape=(64, 64)):
    h, w = frame_shape

    def fake_analyse_frames(frames):
        return {
            "frames_checked": len(frames),
            "frames_with_faces": 1,
            "faces_detected": 1,
            "boxes": {0: [{"x": 8, "y": 8, "width": w - 16, "height": h - 16}]},
        }

    monkeypatch.setattr("services.face_processor.analyse_frames", fake_analyse_frames)


# ---------------------------------------------------------------------------
# Honest failure states (no model run needed)
# ---------------------------------------------------------------------------
def test_invalid_stored_name_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(explainability, "UPLOAD_DIR", tmp_path)
    result = explainability.generate_explanation("../../etc/passwd.jpg")
    assert result["status"] == "invalid_stored_name"
    result = explainability.generate_explanation("")
    assert result["status"] == "invalid_stored_name"


def test_missing_file_reports_file_not_found(tmp_path, monkeypatch):
    monkeypatch.setattr(explainability, "UPLOAD_DIR", tmp_path)
    result = explainability.generate_explanation("missing.jpg")
    assert result["status"] == "file_not_found"
    assert "heatmap_b64" not in result


def test_audio_is_not_applicable(tmp_path, monkeypatch):
    monkeypatch.setattr(explainability, "UPLOAD_DIR", tmp_path)
    wav = tmp_path / "track.wav"
    wav.write_bytes(b"RIFF\x24\x00\x00\x00WAVEfmt " + b"\x00" * 40)
    result = explainability.generate_explanation("track.wav")
    assert result["status"] == "not_applicable"
    assert "heatmap_b64" not in result


def test_no_face_never_produces_heatmap(tmp_path, monkeypatch):
    monkeypatch.setattr(explainability, "UPLOAD_DIR", tmp_path)
    _write_solid_jpeg(tmp_path / "noface.jpg")  # real haar finds no face here
    result = explainability.generate_explanation("noface.jpg")
    assert result["status"] == "no_face_detected"
    assert "heatmap_b64" not in result
    assert "NOT a real/deepfake verdict" in result["message"]


def test_model_unavailable_is_honest(tmp_path, monkeypatch):
    monkeypatch.setattr(explainability, "UPLOAD_DIR", tmp_path)
    _write_solid_jpeg(tmp_path / "face.jpg")
    _patch_faces(monkeypatch)
    monkeypatch.setattr(vd, "_load_model", lambda: (None, "weights missing"))
    result = explainability.generate_explanation("face.jpg")
    assert result["status"] == "model_unavailable"
    assert "weights missing" in result["message"]
    assert "heatmap_b64" not in result


# ---------------------------------------------------------------------------
# Completed occlusion path with the fake model
# ---------------------------------------------------------------------------
def test_occlusion_completes_with_batched_passes(tmp_path, monkeypatch):
    monkeypatch.setattr(explainability, "UPLOAD_DIR", tmp_path)
    monkeypatch.setenv("CLARITY_EXPLAIN_GRID", "4")
    monkeypatch.setenv("CLARITY_EXPLAIN_BATCH", "8")
    _write_solid_jpeg(tmp_path / "face.jpg")
    _patch_faces(monkeypatch)
    monkeypatch.setattr(vd, "_load_model", lambda: (FakeModel(), None))

    result = explainability.generate_explanation("face.jpg", method="occlusion")
    assert result["status"] == "completed"
    assert result["method"] == "occlusion"
    assert result["heatmap_b64"].startswith("data:image/png;base64,")
    assert result["original_crop_b64"].startswith("data:image/png;base64,")
    assert result["heatmap_crop_b64"].startswith("data:image/png;base64,")
    assert result["overlay_b64"].startswith("data:image/png;base64,")
    assert result["overlay_opacity"] == 0.5
    assert isinstance(result["peak_regions"], list)
    assert result["grid"] == 4
    assert result["passes"] == 16
    assert result["batch_size"] == 8
    assert 0.0 <= result["baseline_score"] <= 1.0
    assert result["face_box"]["x"] == 8
    # The heatmap maps back onto the full frame.
    assert result["frame_size"] == [64, 64]

    # Baseline must match an independent recomputation through the same model.
    frame = np.full((64, 64, 3), 200, dtype=np.uint8)
    tensor = vd.preprocess_face(np.ascontiguousarray(frame))
    with torch.no_grad():
        expected = float(torch.sigmoid(FakeModel()(tensor)[0]).item())
    assert abs(result["baseline_score"] - round(expected, 4)) < 1e-3


def test_gradcam_unavailable_is_honest_not_fabricated(tmp_path, monkeypatch):
    monkeypatch.setattr(explainability, "UPLOAD_DIR", tmp_path)
    _write_solid_jpeg(tmp_path / "face.jpg")
    _patch_faces(monkeypatch)
    monkeypatch.setattr(vd, "_load_model", lambda: (FakeModel(), None))

    result = explainability.generate_explanation("face.jpg", method="gradcam")
    assert result["status"] == "gradcam_unavailable"
    assert result["error"]
    assert "occlusion" in result["suggestion"]
    assert "heatmap_b64" not in result


def test_invalid_method_is_rejected(tmp_path, monkeypatch):
    monkeypatch.setattr(explainability, "UPLOAD_DIR", tmp_path)
    result = explainability.generate_explanation("x.jpg", method="saliency")
    assert result["status"] == "invalid_method"


def test_explain_visual_endpoint(client, tmp_path, monkeypatch):
    monkeypatch.setattr(explainability, "UPLOAD_DIR", tmp_path)
    _write_solid_jpeg(tmp_path / "test_visual.jpg")
    _patch_faces(monkeypatch)
    monkeypatch.setattr(vd, "_load_model", lambda: (FakeModel(), None))

    # Test JSON with stored_name
    res = client.post("/api/explain/visual", json={"stored_name": "test_visual.jpg", "method": "occlusion"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "completed"
    assert data["original_crop_b64"].startswith("data:image/png;base64,")
    assert data["overlay_b64"].startswith("data:image/png;base64,")
    assert "peak_regions" in data
