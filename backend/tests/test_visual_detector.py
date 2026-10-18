"""
STEP 6 service tests — one genuine pretrained model, real scores only.

Checks delivered:
  1. The model loads (singleton, eval mode) from SHA-256-verified weights.
  2. A single face crop yields a valid sigmoid score in (0, 1).
  3. Multiple crops → aggregation is exactly the mean of per-crop scores.
  4. No face → NO score and NO classification (never guessed as "real").
  5. Invalid input is handled safely (returns None, never raises).
  6. Image pipeline end-to-end → status "completed" with model metadata.
  7. Video pipeline end-to-end → status "completed", frames analyzed.
  8. Scores are input-dependent (not a constant / hardcoded value).
  9. The score matches an independent torch recomputation of the same crop.
 10. Determinism: the same input produces the identical score twice.
"""

from __future__ import annotations

import math

import cv2
import numpy as np
import pytest

from services import visual_detector as vd
from services.face_processor import analyse_frames, crop_faces, detect_faces
from services.media_processor import process_image, process_video


# ---------------------------------------------------------------------------
# 1 — Model loading
# ---------------------------------------------------------------------------
def test_model_loads_in_eval_mode():
    model, error = vd._load_model()
    assert error is None, f"model failed to load: {error}"
    assert model is not None
    status = vd.model_status()
    assert status["available"] is True
    assert status["error"] is None
    assert "huggingface.co" in status["source"]
    # eval() was applied: no dropout/BN training behaviour during inference
    assert getattr(model, "training", False) is False


# ---------------------------------------------------------------------------
# 2 — Single face crop → valid score
# ---------------------------------------------------------------------------
def test_single_face_crop_score(face_image_path):
    image = cv2.imread(str(face_image_path))
    boxes = detect_faces(image)
    assert boxes, "face fixture must contain a detectable face"
    crop = crop_faces(image, boxes)[0]

    score = vd.score_face_crop(crop)
    assert score is not None, "model returned no score for a valid face crop"
    assert math.isfinite(score)
    assert 0.0 < score < 1.0


# ---------------------------------------------------------------------------
# 3 — Aggregation = mean of per-crop scores
# ---------------------------------------------------------------------------
def test_multi_frame_aggregation_is_mean(face_image_path):
    image = cv2.imread(str(face_image_path))
    # second sample: same face, slightly brightened → (usually) a
    # different model output, which makes the mean check meaningful
    bright = cv2.convertScaleAbs(image, alpha=1.0, beta=25)
    frames = [(0, image), (1, bright)]
    boxes = {index: detect_faces(frame) for index, frame in frames}
    assert boxes[0], "face fixture must contain a detectable face"

    result = vd.analyse_media(frames, boxes, media_type="image")

    assert result["status"] == "completed"
    per_face = result["per_face_scores"]
    assert result["faces_analyzed"] == len(per_face) >= 1
    assert result["frames_analyzed"] >= 1
    expected = sum(per_face) / len(per_face)
    # response score is the mean of the per-face scores (rounded to 4 dp)
    assert result["score"] == pytest.approx(expected, abs=0.0001)
    assert result["classification"] == (
        "deepfake" if result["score"] >= result["threshold"] else "real"
    )


# ---------------------------------------------------------------------------
# 4 — No face → no score (honest failure, never guessed)
# ---------------------------------------------------------------------------
def test_no_face_returns_no_score():
    rng = np.random.default_rng(0)
    noise = rng.integers(0, 255, (480, 640, 3), dtype=np.uint8)
    summary = analyse_frames([(0, noise)])
    assert summary["faces_detected"] == 0

    result = vd.analyse_media([(0, noise)], summary["boxes"], media_type="image")

    assert result["status"] == "no_face_detected"
    assert "score" not in result
    assert "classification" not in result
    assert result["faces_analyzed"] == 0
    assert "No face available for visual AI analysis" in result["message"]


# ---------------------------------------------------------------------------
# 5 — Invalid input handled safely
# ---------------------------------------------------------------------------
def test_invalid_inputs_are_handled_safely():
    assert vd.preprocess_face(None) is None
    assert vd.preprocess_face("not-an-array") is None
    assert vd.preprocess_face(np.zeros((0, 0, 3), dtype=np.uint8)) is None

    assert vd.score_face_crop(None) is None
    assert vd.score_face_crop(np.zeros((0, 0, 3), dtype=np.uint8)) is None
    assert vd.score_face_crop(object()) is None

    # empty / missing frames must not raise either
    for frames, boxes in ((None, None), ([], {})):
        result = vd.analyse_media(frames, boxes, media_type="image")
        assert result["status"] in ("no_face_detected", "model_unavailable")
        assert "score" not in result


# ---------------------------------------------------------------------------
# 6 — Image pipeline end-to-end (decode → detect → model)
# ---------------------------------------------------------------------------
def test_image_pipeline_completes(face_image_path):
    processed = process_image(face_image_path)
    summary = analyse_frames([(0, processed["image"])])
    assert summary["faces_detected"] >= 1

    result = vd.analyse_media(
        [(0, processed["image"])], summary["boxes"], media_type="image"
    )

    assert result["status"] == "completed"
    assert result["faces_analyzed"] >= 1
    assert isinstance(result["score"], float)
    assert 0.0 < result["score"] < 1.0
    assert result["classification"] in ("real", "deepfake")
    assert result["threshold"] == vd.CLASSIFICATION_THRESHOLD == 0.7
    assert "EfficientNet-B7" in result["model"]
    assert result["model_source"].startswith("https://huggingface.co/")
    assert "uncalibrated" in result["score_type"].lower()


# ---------------------------------------------------------------------------
# 7 — Video pipeline end-to-end
# ---------------------------------------------------------------------------
def test_video_pipeline_completes(face_video_path, monkeypatch):
    monkeypatch.setenv("CLARITY_VISUAL_MAX_FACES", "2")  # keep CPU time low
    processed = process_video(face_video_path)
    assert processed["frames_sampled"] >= 1
    summary = analyse_frames(processed["frames"])
    assert summary["faces_detected"] >= 1

    result = vd.analyse_media(
        processed["frames"], summary["boxes"], media_type="video"
    )

    assert result["status"] == "completed"
    assert 1 <= result["faces_analyzed"] <= 2
    assert result["frames_analyzed"] >= 1
    assert 0.0 < result["score"] < 1.0
    assert result["classification"] in ("real", "deepfake")


# ---------------------------------------------------------------------------
# 8 — Scores are input-dependent (nothing hardcoded)
# ---------------------------------------------------------------------------
def test_scores_are_input_dependent(face_image_path):
    image = cv2.imread(str(face_image_path))
    face_crop = crop_faces(image, detect_faces(image))[0]

    rng = np.random.default_rng(42)
    noise_crop = rng.integers(0, 255, face_crop.shape, dtype=np.uint8)

    face_score = vd.score_face_crop(face_crop)
    noise_score = vd.score_face_crop(noise_crop)

    assert face_score is not None and noise_score is not None
    assert abs(face_score - noise_score) > 0.001, (
        "identical scores for very different inputs — looks hardcoded"
    )


# ---------------------------------------------------------------------------
# 9 — Score equals an independent recomputation with torch
# ---------------------------------------------------------------------------
def test_score_matches_independent_torch_recomputation(face_image_path):
    import torch

    image = cv2.imread(str(face_image_path))
    crop = crop_faces(image, detect_faces(image))[0]
    service_score = vd.score_face_crop(crop)
    assert service_score is not None

    # Independent path: fresh TorchScript load + cv2-based preprocessing.
    weights = vd._weights_dir() / vd.MODEL_FILENAME
    model = torch.jit.load(str(weights), map_location="cpu")
    model.eval()

    rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    resized = cv2.resize(rgb, (vd.INPUT_SIZE, vd.INPUT_SIZE), interpolation=cv2.INTER_LINEAR)
    x = resized.astype(np.float32) / 255.0
    x = (x - np.array(vd.IMAGENET_MEAN, np.float32)) / np.array(vd.IMAGENET_STD, np.float32)
    tensor = torch.from_numpy(x).permute(2, 0, 1).unsqueeze(0)

    with torch.inference_mode():
        reference = float(torch.sigmoid(model(tensor).reshape(-1)[0]).item())

    # tolerance covers cv2 vs antialiased-torch interpolation differences
    assert service_score == pytest.approx(reference, abs=0.02), (
        f"service score {service_score} diverges from recomputed {reference}"
    )


# ---------------------------------------------------------------------------
# 10 — Determinism
# ---------------------------------------------------------------------------
def test_same_input_gives_identical_score(face_image_path):
    image = cv2.imread(str(face_image_path))
    crop = crop_faces(image, detect_faces(image))[0]

    first = vd.score_face_crop(crop)
    second = vd.score_face_crop(crop)

    assert first is not None and second is not None
    assert first == second, "model output must be deterministic in eval mode"


# ---------------------------------------------------------------------------
# 11 — Per-frame timeline scores with timestamp and bounding box
# ---------------------------------------------------------------------------
def test_per_frame_scores_have_timestamp_and_box():
    scored = [
        (0, 0.42, {"x": 10, "y": 20, "width": 80, "height": 80}),
        (0, 0.88, {"x": 100, "y": 20, "width": 85, "height": 85}),
        (10, 0.35, {"x": 12, "y": 22, "width": 78, "height": 78}),
    ]
    frames = vd._per_frame_means(scored, fps=25.0)
    assert len(frames) == 2
    f0 = frames[0]
    assert f0["frame"] == 0
    assert f0["score"] == 0.65
    assert f0["timestamp_s"] == 0.0
    assert f0["top_face_box"] == {"x": 100, "y": 20, "width": 85, "height": 85}

    f1 = frames[1]
    assert f1["frame"] == 10
    assert f1["score"] == 0.35
    assert f1["timestamp_s"] == 0.4
    assert f1["top_face_box"] == {"x": 12, "y": 22, "width": 78, "height": 78}

