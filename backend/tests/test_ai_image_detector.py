"""
AI-image detector tests — UniversalFakeDetect, real scores only.

Checks delivered:
  1.  Model loads (singleton, eval mode) with SHA-256-verified head weights.
  2.  Preprocessing output shape/dtype: (1, 3, 224, 224), finite float32.
  3.  Preprocessing math: BGR→RGB channel order + CLIP normalisation match an
      independent manual computation exactly; constant images stay constant
      through resize+crop for both landscape and portrait inputs.
  4.  Centre-crop offsets mirror the reference transform (landscape and
      portrait origins land on the expected source pixel).
  5.  Invalid input handled safely (returns None, never raises).
  6.  Real inference: score in (0, 1), finite, model genuinely loaded.
  7.  Determinism: the same input produces the identical score twice.
  8.  Input-dependence: different images → different scores (not hardcoded).
  9.  Higher = AI-generated mapping (classify/threshold rule).
 10.  build_head rejects incompatible / malformed weights loudly.
 11.  Honest failure states: model_unavailable / invalid_input /
      not_applicable — each with NO score key.
 12.  End-to-end analyse_ai_image → completed with honest metadata.
 13.  /api/analyze returns the independent ai_image_analysis block and the
      pre-existing blocks remain present and untouched.
"""

from __future__ import annotations

import io
import json
import math

import cv2
import numpy as np
import pytest

from services import ai_image_detector as aid


def _solid_bgr(b: int, g: int, r: int, shape=(256, 512)) -> np.ndarray:
    image = np.zeros((shape[0], shape[1], 3), dtype=np.uint8)
    image[:, :] = (b, g, r)
    return image


def _expected_normalized(rgb_0_1: tuple[float, float, float]) -> tuple[float, float, float]:
    """Manual reference: (value - mean) / std per channel."""
    return tuple(
        (v - m) / s for v, m, s in zip(rgb_0_1, aid.CLIP_MEAN, aid.CLIP_STD)
    )


# ---------------------------------------------------------------------------
# 1 — Model loading (singleton, eval mode, verified weights)
# ---------------------------------------------------------------------------
def test_model_loads_in_eval_mode_with_verified_head():
    model, head, error = aid._load_models()
    assert error is None, f"model failed to load: {error}"
    assert model is not None and head is not None
    assert getattr(model, "training", False) is False
    assert getattr(head, "training", False) is False
    # the probe is exactly nn.Linear(768, 1)
    assert tuple(head.weight.shape) == (1, 768)
    assert tuple(head.bias.shape) == (1,)

    status = aid.model_status()
    assert status["available"] is True
    assert status["error"] is None
    assert status["source"] == aid.MODEL_SOURCE_URL
    assert status["backbone"] == aid.BACKBONE_REPO_ID
    assert status["backbone"] == "openai/clip-vit-large-patch14"
    # published artifact integrity is verifiable from the module constants
    assert aid._sha256(aid._weights_dir() / aid.HEAD_FILENAME) == aid.HEAD_SHA256


# ---------------------------------------------------------------------------
# 2 — Preprocessing shape / dtype
# ---------------------------------------------------------------------------
def test_preprocess_output_shape_and_dtype():
    rng = np.random.default_rng(3)
    image = rng.integers(0, 255, (480, 640, 3), dtype=np.uint8)

    tensor = aid.preprocess_image(image)
    assert tensor is not None
    assert tuple(tensor.shape) == (1, 3, aid.CROP_SIZE, aid.CROP_SIZE)
    assert tensor.dtype == __import__("torch").float32
    assert bool(tensor.isfinite().all())


# ---------------------------------------------------------------------------
# 3 — Preprocessing math: channel order + CLIP normalisation (manual check)
# ---------------------------------------------------------------------------
def test_preprocess_matches_manual_channel_and_normalisation_math():
    # solid BGR colour: resize and crop cannot change a constant image, so the
    # only possible output is (channel/255 - mean)/std in RGB order.
    image = _solid_bgr(b=10, g=100, r=200, shape=(300, 480))
    tensor = aid.preprocess_image(image)
    assert tensor is not None

    expected = _expected_normalized((200 / 255, 100 / 255, 10 / 255))
    flat = tensor[0].reshape(3, -1)
    for channel in range(3):
        column = flat[channel]
        assert float(column.min()) == pytest.approx(expected[channel], abs=1e-5)
        assert float(column.max()) == pytest.approx(expected[channel], abs=1e-5)

    # a pure-white image must equal (1 - mean)/std everywhere
    white = aid.preprocess_image(_solid_bgr(255, 255, 255, shape=(224, 224)))
    white_expected = _expected_normalized((1.0, 1.0, 1.0))


# ---------------------------------------------------------------------------
# 4 — Centre-crop offsets mirror the reference transform
# ---------------------------------------------------------------------------
def test_centre_crop_offsets_match_reference_for_landscape_and_portrait():
    # Reference: resize shorter edge → 256 (aspect kept), centre crop 224.
    # Landscape 256(h) × 512(w): shorter edge is height, so no scaling occurs
    # (256 → 256) and the crop origin is top=16, left=144.
    landscape = np.zeros((256, 512, 3), dtype=np.uint8)
    landscape[16, 144] = (0, 0, 255)  # BGR red at the expected origin
    tensor = aid.preprocess_image(landscape)
    assert tensor is not None
    origin = tensor[0, :, 0, 0].tolist()
    expected = _expected_normalized((1.0, 0.0, 0.0))  # RGB red
    assert origin == pytest.approx(expected, abs=1e-4)
    # the pixel one step right came from source column 145 (still black)
    assert float(tensor[0, 0, 0, 1]) == pytest.approx(
        _expected_normalized((0.0, 0.0, 0.0))[0], abs=1e-4
    )

    # Portrait 512(h) × 256(w): shorter edge is width, crop origin top=144,
    # left=16 — the transpose of the landscape case.
    portrait = np.zeros((512, 256, 3), dtype=np.uint8)
    portrait[144, 16] = (255, 255, 255)  # white marker at the expected origin
    tensor = aid.preprocess_image(portrait)
    assert tensor is not None
    expected_white = _expected_normalized((1.0, 1.0, 1.0))
    assert tensor[0, :, 0, 0].tolist() == pytest.approx(expected_white, abs=1e-4)


# ---------------------------------------------------------------------------
# 5 — Invalid input handled safely (never raises, never guesses)
# ---------------------------------------------------------------------------
def test_invalid_inputs_are_handled_safely():
    assert aid.preprocess_image(None) is None
    assert aid.preprocess_image("not-an-array") is None
    assert aid.preprocess_image(np.zeros((0, 0, 3), dtype=np.uint8)) is None
    assert aid.preprocess_image(np.zeros((10, 10, 5), dtype=np.uint8)) is None
    assert aid.preprocess_image(np.zeros((10, 10), dtype=np.uint8).tolist()) is None

    assert aid.score_image(None) is None
    assert aid.score_image(object()) is None
    assert aid.score_image(np.zeros((0, 0, 3), dtype=np.uint8)) is None

    # grey and 4-channel inputs are converted, not rejected
    grey = aid.preprocess_image(np.full((300, 400), 128, dtype=np.uint8))
    assert grey is not None and tuple(grey.shape) == (1, 3, 224, 224)
    bgra = aid.preprocess_image(
        np.full((300, 400, 4), 128, dtype=np.uint8)
    )
    assert bgra is not None and tuple(bgra.shape) == (1, 3, 224, 224)


# ---------------------------------------------------------------------------
# 6 — Real inference: a genuine score in (0, 1)
# ---------------------------------------------------------------------------
def test_score_image_returns_genuine_sigmoid_score():
    image = _solid_bgr(b=40, g=120, r=200, shape=(480, 640))
    score = aid.score_image(image)
    assert score is not None, "model returned no score for a valid image"
    assert math.isfinite(score)
    assert 0.0 < score < 1.0


# ---------------------------------------------------------------------------
# 7 — Determinism: same input → identical score
# ---------------------------------------------------------------------------
def test_score_is_deterministic_for_same_input():
    image = _solid_bgr(b=40, g=120, r=200, shape=(480, 640))
    first = aid.score_image(image)
    second = aid.score_image(image)
    assert first is not None and second is not None
    assert first == pytest.approx(second, abs=0.0)


# ---------------------------------------------------------------------------
# 8 — Input-dependence: scores differ across genuinely different images
# ---------------------------------------------------------------------------
def test_scores_are_input_dependent_not_hardcoded():
    rng_a = np.random.default_rng(1)
    noise_a = rng_a.integers(0, 255, (480, 640, 3), dtype=np.uint8)
    solid = _solid_bgr(b=0, g=0, r=255, shape=(480, 640))  # flat red

    score_noise = aid.score_image(noise_a)
    score_solid = aid.score_image(solid)
    assert score_noise is not None and score_solid is not None
    # a hardcoded / degenerate detector would return the same value twice
    assert score_noise != pytest.approx(score_solid, abs=1e-6)


# ---------------------------------------------------------------------------
# 9 — Higher = AI-generated mapping (threshold rule)
# ---------------------------------------------------------------------------
def test_classify_maps_higher_scores_to_ai_generated():
    assert aid.classify(0.99) == "ai_generated"
    assert aid.classify(0.5) == "ai_generated"          # boundary is inclusive
    assert aid.classify(0.4999) == "likely_human"
    assert aid.classify(0.01) == "likely_human"
    # monotone: raising the score can never flip towards "human"
    scores = sorted(np.linspace(0.0, 1.0, 11))
    labels = [aid.classify(float(s)) for s in scores]
    assert labels == sorted(
        labels, key=lambda value: {"likely_human": 0, "ai_generated": 1}[value]
    )


# ---------------------------------------------------------------------------
# 10 — Incompatible / malformed head weights are rejected loudly
# ---------------------------------------------------------------------------
def test_build_head_rejects_incompatible_weights():
    torch = __import__("torch")

    # wrong shapes (e.g. a head trained for a different embedding width)
    with pytest.raises(aid.AiImageDetectorError, match="Incompatible"):
        aid.build_head({"weight": torch.zeros(1, 1024), "bias": torch.zeros(1)})
    # missing bias
    with pytest.raises(aid.AiImageDetectorError, match="missing"):
        aid.build_head({"weight": torch.zeros(1, 768)})
    # not a state dict at all
    with pytest.raises(aid.AiImageDetectorError, match="state dict"):
        aid.build_head([1, 2, 3])

    # the real published checkpoint is accepted
    real = torch.load(aid._weights_dir() / aid.HEAD_FILENAME, map_location="cpu")
    head = aid.build_head(real)
    assert tuple(head.weight.shape) == (1, 768)


# ---------------------------------------------------------------------------
# 11 — Honest failure states (each carries NO score)
# ---------------------------------------------------------------------------
def test_not_applicable_for_non_image_media():
    for kind in ("video", "audio"):
        result = aid.analyse_ai_image([(0, _solid_bgr(1, 2, 3))], media_type=kind)
        assert result["status"] == "not_applicable"
        assert "score" not in result
        assert "classification" not in result
        assert result["images_analyzed"] == 0
        assert result["calibrated"] is False


def test_invalid_input_state_when_no_frames():
    for frames in (None, []):
        result = aid.analyse_ai_image(frames, media_type="image")
        assert result["status"] == "invalid_input"
        assert "score" not in result
        assert "classification" not in result
        assert result["images_analyzed"] == 0


def test_model_unavailable_state_carries_no_score(monkeypatch):
    monkeypatch.setattr(
        aid, "_load_models", lambda: (None, None, "head weights missing")
    )
    result = aid.analyse_ai_image([(0, _solid_bgr(1, 2, 3))], media_type="image")
    assert result["status"] == "model_unavailable"
    assert "score" not in result
    assert "classification" not in result
    assert "head weights missing" in result["message"]
    # model_status surfaces the same honest failure
    status = aid.model_status()
    assert status["available"] is False
    assert "head weights missing" in (status["error"] or "")


def test_inference_failed_state_when_forward_pass_yields_no_score(monkeypatch):
    monkeypatch.setattr(aid, "_load_models", lambda: (object(), object(), None))
    monkeypatch.setattr(aid, "score_image", lambda _frame: None)
    result = aid.analyse_ai_image([(0, _solid_bgr(1, 2, 3))], media_type="image")
    assert result["status"] == "inference_failed"
    assert "score" not in result
    assert "No score or verdict was produced" in result["message"]


# ---------------------------------------------------------------------------
# 12 — End-to-end analyse_ai_image → completed with honest metadata
# ---------------------------------------------------------------------------
def test_analyse_ai_image_completes_with_honest_metadata():
    image = _solid_bgr(b=40, g=120, r=200, shape=(480, 640))
    result = aid.analyse_ai_image([(0, image)], media_type="image")

    assert result["status"] == "completed"
    assert result["images_analyzed"] == 1
    score = result["score"]
    assert isinstance(score, float) and math.isfinite(score)
    assert 0.0 < score < 1.0
    assert score == round(score, 4)
    assert result["classification"] == (
        "ai_generated" if score >= result["threshold"] else "likely_human"
    )
    # honest labelling — never presented as a calibrated probability
    assert result["calibrated"] is False
    assert result["threshold"] == 0.5
    assert "uncalibrated" in result["score_type"].lower()
    assert "higher = more likely AI-generated" in result["score_direction"]
    assert result["model_source"] == aid.MODEL_SOURCE_URL
    assert result["backbone"] == aid.BACKBONE_REPO_ID
    assert result["media_type"] == "image"
    # independent of the face-based detector — no faces were involved
    assert "no face detection involved" in result["message"]


# ---------------------------------------------------------------------------
# 13 — /api/analyze exposes the independent ai_image_analysis block
# ---------------------------------------------------------------------------
def test_api_returns_ai_image_block_alongside_existing_blocks(client):
    image = _solid_bgr(b=40, g=120, r=200, shape=(480, 640))
    ok, buffer = cv2.imencode(".png", image)
    assert ok

    response = client.post(
        "/api/analyze",
        files={"file": ("sample.png", io.BytesIO(buffer.tobytes()), "image/png")},
    )
    assert response.status_code == 200, response.text
    payload = response.json()

    # the new block is present, completed and independent
    block = payload.get("ai_image_analysis")
    assert block is not None, "ai_image_analysis block missing from response"
    assert block["status"] == "completed"
    assert 0.0 < block["score"] < 1.0
    assert block["calibrated"] is False
    assert block["classification"] in ("ai_generated", "likely_human")

    # pre-existing blocks are untouched and still present
    assert "visual_analysis" in payload
    assert "audio_analysis" in payload
    assert "multimodal_analysis" in payload

    # the AI-image score is NEVER fused into multimodal_analysis
    fusion = payload.get("multimodal_analysis") or {}
    assert "ai_image" not in json.dumps(fusion)
    # and the two detectors report their own independent scores
    visual = payload.get("visual_analysis") or {}
    if visual.get("status") == "completed":
        assert visual.get("model") != block.get("model")
