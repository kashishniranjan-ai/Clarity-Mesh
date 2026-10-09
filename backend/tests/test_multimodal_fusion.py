"""
STEP 8 test suite — multimodal fusion service
(services/multimodal_fusion.py) and its wiring into ``POST /api/analyze``.

Requirement coverage (numbered as in the STEP 8 brief):
  1–2  both genuine scores fuse; audio direction inverted (fake = 1 − REAL)
  3    exact weighted arithmetic: 0.6 * visual_fake + 0.4 * audio_fake
  4–5  fusion threshold 0.5 (below → real; ≥ → deepfake; 0.5 boundary)
  6–8  visual-only / audio-only / neither → NO fused score
  9–12 no_audio, no_face_detected, model failure, inference failure
       → NO fused score
  13–18 invalid / non-numeric / NaN / inf / <0 / >1 scores rejected
  19–22 determinism, no input mutation, weights sum to 1.0, worked example
  23–27 real-pipeline API: video±audio, standalone audio, image, failure
  28    no invented default values (0, 0.5, …) for missing modalities
  29    visual/audio payloads remain intact beside multimodal_analysis
  30    every response exposes the three independent blocks; the complete
       suite (pre-existing STEP 6 + STEP 7 tests included) must pass

Pure-fusion tests use controlled detector-result dictionaries (no model
runs); the API tests exercise the real detector pipeline end-to-end and
therefore use the real fixtures from conftest.py.
"""

from __future__ import annotations

import copy
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest

import services.audio_detector as ad
import services.multimodal_fusion as mf

SAMPLE_RATE = 16000
_FUSION_SCORE_KEYS = ("fused_fake_score", "visual_fake_score", "audio_fake_score")


# ---------------------------------------------------------------------------
# Controlled detector-result builders (mirror the real payload contracts:
# score + threshold + classification only exist when status == "completed")
# ---------------------------------------------------------------------------
def _visual(score, status="completed") -> dict:
    block = {
        "status": status,
        "threshold": 0.7,
        "model": "EfficientNet-B7 DeepfakeDetector",
        "message": "controlled visual block",
    }
    if status == "completed":
        block["score"] = score
        if isinstance(score, (int, float)) and not isinstance(score, bool):
            block["classification"] = "deepfake" if score >= 0.7 else "real"
    return block


def _audio(real_score, status="completed") -> dict:
    block = {
        "status": status,
        "threshold": 0.5,
        "model": "wav2vec-small-anti-deepfake",
        "audio_present": True,
        "message": "controlled audio block",
    }
    if status == "completed":
        block["score"] = real_score
        if isinstance(real_score, (int, float)) and not isinstance(
            real_score, bool
        ):
            block["classification"] = "real" if real_score >= 0.5 else "deepfake"
    return block


def _assert_no_fusion_values(result: dict) -> None:
    """A non-completed fusion must contain NO score of ANY kind."""
    for key in _FUSION_SCORE_KEYS:
        assert key not in result, f"{key} must not exist: {result}"
    assert "classification" not in result
    assert "threshold" not in result or result.get("threshold") is None
    for key, value in result.items():
        assert not isinstance(value, float), (
            f"float value {value!r} under {key!r} looks like an invented score"
        )
        if isinstance(value, list):
            assert all(not isinstance(item, float) for item in value)


# ---------------------------------------------------------------------------
# Audio fixture helpers (stdlib WAV writer + FFmpeg mux — no system FFmpeg)
# ---------------------------------------------------------------------------
def _write_wav(path: Path, samples: np.ndarray) -> Path:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767.0).astype(np.int16)
    with wave.open(str(path), "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(SAMPLE_RATE)
        writer.writeframes(pcm.tobytes())
    assert path.exists() and path.stat().st_size > 0
    return path


def _sine(seconds: float, freq: float = 440.0) -> np.ndarray:
    t = np.arange(int(seconds * SAMPLE_RATE)) / SAMPLE_RATE
    return (0.5 * np.sin(2 * np.pi * freq * t)).astype(np.float32)


def _ffmpeg_exe() -> str:
    exe = ad._ffmpeg_exe()
    if not exe:
        pytest.skip("FFmpeg binary unavailable (imageio-ffmpeg)")
    return exe


@pytest.fixture
def sine_wav(tmp_path) -> Path:
    """1.5 s 440 Hz tone — analysed by the real audio pipeline."""
    return _write_wav(tmp_path / "fusion_tone.wav", _sine(1.5))


@pytest.fixture
def video_with_audio(tmp_path, face_video_path) -> Path:
    """Real face clip (conftest) with a genuine 16 kHz sine track muxed in."""
    tone = _write_wav(tmp_path / "mux_tone.wav", _sine(1.5))
    out = tmp_path / "face_with_tone.mp4"
    subprocess.run(
        [
            _ffmpeg_exe(), "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(face_video_path), "-i", str(tone),
            "-c:v", "copy", "-c:a", "aac", "-shortest", str(out),
        ],
        check=True,
        capture_output=True,
        timeout=120,
    )
    assert out.exists() and out.stat().st_size > 0
    return out


def _post(client, path: Path, mime: str):
    with open(path, "rb") as handle:
        return client.post(
            "/api/analyze", files={"file": (path.name, handle, mime)}
        )


# ---------------------------------------------------------------------------
# 1–5. Fusion arithmetic, score direction, threshold
# ---------------------------------------------------------------------------
def test_01_both_genuine_scores_produce_completed_fusion():
    result = mf.fuse_multimodal_results(_visual(0.72), _audio(0.18))
    assert result["status"] == "completed"
    assert isinstance(result["fused_fake_score"], float)
    assert 0.0 <= result["fused_fake_score"] <= 1.0
    assert result["classification"] in ("real", "deepfake")
    assert result["score_type"] == mf.SCORE_TYPE
    assert "uncalibrated" in result["score_type"]


def test_02_audio_score_direction_is_converted_to_fake():
    result = mf.fuse_multimodal_results(_visual(0.72), _audio(0.18))
    # audio_analysis.score is REAL-oriented (softmax index 1 = REAL)
    assert result["audio_fake_score"] == pytest.approx(1 - 0.18, abs=1e-9)
    # visual score is already FAKE-oriented and passes through unchanged
    assert result["visual_fake_score"] == pytest.approx(0.72, abs=1e-12)
    # low REAL probability must become a high FAKE probability
    assert result["audio_fake_score"] > 0.5
    # and the conversion must be exactly 1 − score (never another mapping)
    real_score = 0.18
    assert abs(result["audio_fake_score"] - (1.0 - real_score)) < 1e-9
    # identity check: audio_fake + audio_real == 1 (direction inverted only)
    assert abs(result["audio_fake_score"] + real_score - 1.0) < 1e-9


def test_03_weighted_arithmetic_is_exact():
    visual_score, audio_real_score = 0.9, 0.7
    result = mf.fuse_multimodal_results(
        _visual(visual_score), _audio(audio_real_score)
    )
    expected = 0.6 * visual_score + 0.4 * (1.0 - audio_real_score)
    assert mf.VISUAL_WEIGHT == 0.6
    assert mf.AUDIO_WEIGHT == 0.4
    assert result["visual_weight"] == 0.6
    assert result["audio_weight"] == 0.4
    assert result["aggregation"] == "weighted arithmetic mean"
    assert abs(result["fused_fake_score"] - expected) < 1e-4
    assert result["fused_fake_score"] == round(expected, 4)


def test_04_fused_score_below_threshold_is_real():
    result = mf.fuse_multimodal_results(_visual(0.4), _audio(0.9))
    # 0.6 * 0.4 + 0.4 * (1 − 0.9) = 0.24 + 0.04 = 0.28 < 0.5
    assert result["fused_fake_score"] == pytest.approx(0.28, abs=1e-9)
    assert result["classification"] == "real"
    assert mf.FUSION_THRESHOLD == 0.5
    assert result["threshold"] == 0.5


def test_05_boundary_exactly_half_is_deepfake():
    result = mf.fuse_multimodal_results(_visual(0.5), _audio(0.5))
    # 0.6 * 0.5 + 0.4 * 0.5 = 0.5 → boundary rule: >= 0.5 → deepfake
    assert result["fused_fake_score"] == pytest.approx(0.5, abs=1e-12)
    assert result["classification"] == "deepfake"


# ---------------------------------------------------------------------------
# 6–12. Missing modalities and failure states → NO fused score ever
# ---------------------------------------------------------------------------
def test_06_visual_only_no_fused_score():
    result = mf.fuse_multimodal_results(_visual(0.6), None)
    assert result["status"] == "partial"
    assert result["available_modalities"] == ["visual"]
    assert result["missing_modalities"] == ["audio"]
    _assert_no_fusion_values(result)


def test_07_audio_only_no_fused_score():
    result = mf.fuse_multimodal_results(None, _audio(0.9))
    assert result["status"] == "partial"
    assert result["available_modalities"] == ["audio"]
    assert result["missing_modalities"] == ["visual"]
    _assert_no_fusion_values(result)


def test_08_neither_modality_no_fused_score():
    result = mf.fuse_multimodal_results(None, None)
    assert result["status"] == "unavailable"
    assert result["available_modalities"] == []
    assert result["missing_modalities"] == ["visual", "audio"]
    _assert_no_fusion_values(result)


def test_09_no_audio_state_never_fuses():
    result = mf.fuse_multimodal_results(_visual(0.7), _audio(None, status="no_audio"))
    assert result["status"] == "partial"
    assert result["missing_modalities"] == ["audio"]
    assert "no_audio" in result["missing_reasons"]["audio"]
    _assert_no_fusion_values(result)


def test_10_no_face_state_never_fuses():
    result = mf.fuse_multimodal_results(
        _visual(None, status="no_face_detected"), _audio(0.2)
    )
    assert result["status"] == "partial"
    assert result["missing_modalities"] == ["visual"]
    assert "no_face_detected" in result["missing_reasons"]["visual"]
    _assert_no_fusion_values(result)


def test_11_model_failure_never_fuses():
    result = mf.fuse_multimodal_results(
        _visual(None, status="model_unavailable"), _audio(0.4)
    )
    assert result["status"] == "partial"
    assert result["missing_modalities"] == ["visual"]
    assert "model_unavailable" in result["missing_reasons"]["visual"]
    _assert_no_fusion_values(result)

    both_failed = mf.fuse_multimodal_results(
        _visual(None, status="model_unavailable"),
        _audio(None, status="weights_unavailable"),
    )
    assert both_failed["status"] == "unavailable"
    _assert_no_fusion_values(both_failed)


def test_12_inference_failure_never_fuses():
    visual_failed = mf.fuse_multimodal_results(
        _visual(None, status="inference_failed"), _audio(0.6)
    )
    assert visual_failed["status"] == "partial"
    assert "inference_failed" in visual_failed["missing_reasons"]["visual"]
    _assert_no_fusion_values(visual_failed)

    audio_failed = mf.fuse_multimodal_results(
        _visual(0.6), _audio(None, status="inference_failed")
    )
    assert audio_failed["status"] == "partial"
    assert "inference_failed" in audio_failed["missing_reasons"]["audio"]
    _assert_no_fusion_values(audio_failed)


# ---------------------------------------------------------------------------
# 13–18. Invalid scores → explicit invalid_input (never clamped, never fused)
# ---------------------------------------------------------------------------
def test_13_non_numeric_visual_score_rejected():
    result = mf.fuse_multimodal_results(_visual("high"), _audio(0.5))
    assert result["status"] == "invalid_input"
    assert any("not numeric" in issue for issue in result["issues"])
    _assert_no_fusion_values(result)


def test_13b_completed_without_score_key_rejected():
    result = mf.fuse_multimodal_results(
        {"status": "completed"}, _audio(0.5)
    )
    assert result["status"] == "invalid_input"
    assert any("no 'score' key" in issue for issue in result["issues"])
    _assert_no_fusion_values(result)


def test_14_non_numeric_audio_score_rejected():
    result = mf.fuse_multimodal_results(_visual(0.5), _audio("low"))
    assert result["status"] == "invalid_input"
    assert any("audio" in issue for issue in result["issues"])
    _assert_no_fusion_values(result)


def test_15_nan_score_rejected():
    result = mf.fuse_multimodal_results(
        _visual(float("nan")), _audio(0.5)
    )
    assert result["status"] == "invalid_input"
    assert any("not finite" in issue for issue in result["issues"])
    _assert_no_fusion_values(result)

    audio_nan = mf.fuse_multimodal_results(_visual(0.5), _audio(float("nan")))
    assert audio_nan["status"] == "invalid_input"
    _assert_no_fusion_values(audio_nan)


def test_16_infinite_score_rejected():
    result = mf.fuse_multimodal_results(
        _visual(float("inf")), _audio(0.5)
    )
    assert result["status"] == "invalid_input"
    assert any("not finite" in issue for issue in result["issues"])
    _assert_no_fusion_values(result)


def test_17_score_below_zero_rejected():
    result = mf.fuse_multimodal_results(_visual(-0.01), _audio(0.5))
    assert result["status"] == "invalid_input"
    assert any("outside [0, 1]" in issue for issue in result["issues"])
    _assert_no_fusion_values(result)

    audio_low = mf.fuse_multimodal_results(_visual(0.5), _audio(-0.01))
    assert audio_low["status"] == "invalid_input"
    _assert_no_fusion_values(audio_low)


def test_18_score_above_one_rejected():
    result = mf.fuse_multimodal_results(_visual(0.5), _audio(1.0001))
    assert result["status"] == "invalid_input"
    assert any("outside [0, 1]" in issue for issue in result["issues"])
    _assert_no_fusion_values(result)


# ---------------------------------------------------------------------------
# 19–22. Determinism, immutability, weights, worked example
# ---------------------------------------------------------------------------
def test_19_identical_inputs_give_identical_output():
    first = mf.fuse_multimodal_results(_visual(0.65), _audio(0.35))
    second = mf.fuse_multimodal_results(_visual(0.65), _audio(0.35))
    assert first == second


def test_20_fusion_never_mutates_input_blocks():
    visual = _visual(0.72)
    audio = _audio(0.18)
    visual_before = copy.deepcopy(visual)
    audio_before = copy.deepcopy(audio)
    mf.fuse_multimodal_results(visual, audio)
    assert visual == visual_before
    assert audio == audio_before

    # also for failure-path inputs
    visual_f = _visual(None, status="no_face_detected")
    audio_f = _audio(None, status="no_audio")
    visual_f_before = copy.deepcopy(visual_f)
    audio_f_before = copy.deepcopy(audio_f)
    mf.fuse_multimodal_results(visual_f, audio_f)
    assert visual_f == visual_f_before
    assert audio_f == audio_f_before


def test_21_weights_sum_to_one(monkeypatch):
    assert mf.VISUAL_WEIGHT == 0.6
    assert mf.AUDIO_WEIGHT == 0.4
    assert mf.VISUAL_WEIGHT + mf.AUDIO_WEIGHT == pytest.approx(1.0)

    # defensive guard: a broken weight configuration must refuse to fuse
    monkeypatch.setattr(mf, "VISUAL_WEIGHT", 0.7)
    result = mf.fuse_multimodal_results(_visual(0.6), _audio(0.6))
    assert result["status"] == "invalid_input"
    assert any("weights" in issue for issue in result["issues"])
    _assert_no_fusion_values(result)


def test_22_worked_example_from_the_brief():
    """visual 0.80 + audio REAL 0.20 → fused 0.80 (doc example arithmetic)."""
    result = mf.fuse_multimodal_results(_visual(0.80), _audio(0.20))
    assert result["audio_fake_score"] == pytest.approx(0.80, abs=1e-9)
    expected = 0.6 * 0.80 + 0.4 * 0.80
    assert result["fused_fake_score"] == round(expected, 4) == 0.80
    assert result["classification"] == "deepfake"
    # and the brief's other worked example: 0.72 / 0.18 → 0.76
    other = mf.fuse_multimodal_results(_visual(0.72), _audio(0.18))
    assert other["fused_fake_score"] == 0.76
    assert other["audio_fake_score"] == pytest.approx(0.82, abs=1e-9)


def test_28_no_invented_values_for_missing_modalities():
    """(unit part of 28) No 0 / 0.5 / any float default ever appears."""
    cases = [
        mf.fuse_multimodal_results(_visual(0.9), _audio(None, status="no_audio")),
        mf.fuse_multimodal_results(_visual(None, status="no_face_detected"), None),
        mf.fuse_multimodal_results(None, None),
        mf.fuse_multimodal_results(
            _visual(None, status="inference_failed"), _audio(0.1)
        ),
        mf.fuse_multimodal_results(
            _visual(0.1), _audio(None, status="model_unavailable")
        ),
    ]
    for result in cases:
        assert result["status"] in ("partial", "unavailable")
        _assert_no_fusion_values(result)
        # the missing modality must be named, not scored
        assert set(result["missing_modalities"]) <= {"visual", "audio"}
        if result["status"] == "partial":
            assert len(result["available_modalities"]) == 1
            assert len(result["missing_modalities"]) == 1
        else:
            assert result["available_modalities"] == []


# ---------------------------------------------------------------------------
# 23–27, 29–30. Real-pipeline API integration (genuine detector outputs)
# ---------------------------------------------------------------------------
def test_23_api_video_with_audio_runs_full_fusion(
    client, video_with_audio, monkeypatch
):
    monkeypatch.setenv("CLARITY_VISUAL_MAX_FACES", "2")
    response = _post(client, video_with_audio, "video/mp4")
    assert response.status_code == 200, response.text
    body = response.json()
    visual, audio, mm = (
        body["visual_analysis"],
        body["audio_analysis"],
        body["multimodal_analysis"],
    )

    # genuine model results on both sides — nothing mocked
    assert visual["status"] == "completed", visual
    assert audio["status"] == "completed", audio
    assert isinstance(visual["score"], float) and 0.0 < visual["score"] < 1.0
    assert isinstance(audio["score"], float) and 0.0 < audio["score"] < 1.0

    assert mm["status"] == "completed", mm
    v, a = visual["score"], audio["score"]
    # documented conversions and formula, computed from the live scores
    assert mm["visual_fake_score"] == round(v, 4)
    assert mm["audio_fake_score"] == round(1.0 - a, 4)
    expected_fused = round(0.6 * v + 0.4 * (1.0 - a), 4)
    assert mm["fused_fake_score"] == expected_fused
    assert (
        abs(
            mm["fused_fake_score"]
            - (0.6 * mm["visual_fake_score"] + 0.4 * mm["audio_fake_score"])
        )
        <= 1e-4
    )
    assert mm["classification"] == (
        "deepfake" if mm["fused_fake_score"] >= 0.5 else "real"
    )
    assert mm["threshold"] == 0.5
    assert mm["visual_weight"] == 0.6
    assert mm["audio_weight"] == 0.4
    assert mm["aggregation"] == "weighted arithmetic mean"
    assert "uncalibrated" in mm["score_type"].lower()


def test_24_api_video_without_audio_has_no_fused_score(
    client, face_video_path, monkeypatch
):
    monkeypatch.setenv("CLARITY_VISUAL_MAX_FACES", "2")
    response = _post(client, face_video_path, "video/mp4")
    assert response.status_code == 200, response.text
    body = response.json()
    visual, audio, mm = (
        body["visual_analysis"],
        body["audio_analysis"],
        body["multimodal_analysis"],
    )

    assert visual["status"] == "completed", visual
    assert audio["status"] == "no_audio", audio
    assert mm["status"] == "partial", mm
    assert mm["available_modalities"] == ["visual"]
    assert mm["missing_modalities"] == ["audio"]
    assert "no_audio" in mm["missing_reasons"]["audio"]
    _assert_no_fusion_values(mm)
    assert "did not produce a genuine score" in mm["message"]


def test_25_api_standalone_audio_has_no_visual_score_or_fusion(
    client, sine_wav
):
    response = _post(client, sine_wav, "audio/wav")
    assert response.status_code == 200, response.text
    body = response.json()
    visual, audio, mm = (
        body["visual_analysis"],
        body["audio_analysis"],
        body["multimodal_analysis"],
    )

    assert audio["status"] == "completed", audio
    assert isinstance(audio["score"], float) and 0.0 < audio["score"] < 1.0
    assert visual["status"] == "not_applicable", visual
    assert "score" not in visual
    assert mm["status"] == "partial", mm
    assert mm["available_modalities"] == ["audio"]
    assert mm["missing_modalities"] == ["visual"]
    _assert_no_fusion_values(mm)


def test_26_api_image_fuses_nothing(client, face_image_path):
    response = _post(client, face_image_path, "image/jpeg")
    assert response.status_code == 200, response.text
    body = response.json()
    visual, audio, mm = (
        body["visual_analysis"],
        body["audio_analysis"],
        body["multimodal_analysis"],
    )

    assert visual["status"] == "completed", visual
    assert isinstance(visual["score"], float) and 0.0 < visual["score"] < 1.0
    assert audio["status"] == "not_applicable", audio
    assert "score" not in audio
    assert mm["status"] == "partial", mm
    assert mm["available_modalities"] == ["visual"]
    assert mm["missing_modalities"] == ["audio"]
    _assert_no_fusion_values(mm)


# ---------------------------------------------------------------------------
# 27, 29–30. Failure injection, independence, response schema
# ---------------------------------------------------------------------------
def test_27_api_detector_failure_never_invents_a_score(
    client, face_video_path, monkeypatch
):
    monkeypatch.setenv("CLARITY_VISUAL_MAX_FACES", "2")

    def _failing_audio(*_args, **_kwargs):
        return {
            "status": "inference_failed",
            "audio_present": True,
            "message": "simulated audio model failure (test injection)",
        }

    monkeypatch.setattr("routes.analysis.analyse_audio_media", _failing_audio)
    response = _post(client, face_video_path, "video/mp4")
    assert response.status_code == 200, response.text
    body = response.json()
    visual, audio, mm = (
        body["visual_analysis"],
        body["audio_analysis"],
        body["multimodal_analysis"],
    )

    # the successful modality remains available and untouched
    assert visual["status"] == "completed", visual
    assert isinstance(visual["score"], float)
    assert audio["status"] == "inference_failed", audio
    assert "score" not in audio
    # fusion does not invent the missing score
    assert mm["status"] == "partial", mm
    assert mm["missing_modalities"] == ["audio"]
    assert "inference_failed" in mm["missing_reasons"]["audio"]
    _assert_no_fusion_values(mm)
    assert "was not performed" in mm["message"]


def test_29_visual_and_audio_payloads_remain_independent(
    client, video_with_audio, monkeypatch
):
    monkeypatch.setenv("CLARITY_VISUAL_MAX_FACES", "2")
    response = _post(client, video_with_audio, "video/mp4")
    assert response.status_code == 200, response.text
    body = response.json()
    visual, audio, mm = (
        body["visual_analysis"],
        body["audio_analysis"],
        body["multimodal_analysis"],
    )

    # three separate top-level blocks for explainability/debugging
    for key in ("visual_analysis", "audio_analysis", "multimodal_analysis"):
        assert key in body

    # visual block unchanged: FAKE-oriented, threshold 0.7 rule intact
    assert visual["threshold"] == 0.7
    assert visual["classification"] == (
        "deepfake" if visual["score"] >= 0.7 else "real"
    )
    assert "per_face_scores" in visual
    assert "EfficientNet-B7" in visual["model"]

    # audio block unchanged: REAL-oriented, threshold 0.5 rule intact
    assert audio["threshold"] == 0.5
    assert audio["classification"] == (
        "real" if audio["score"] >= 0.5 else "deepfake"
    )
    assert "per_chunk_scores" in audio
    assert "wav2vec-small-anti-deepfake" in audio["model"]

    # fusion thresholds never leaked into the detector blocks
    assert mm["threshold"] == 0.5
    assert visual["threshold"] == 0.7 and audio["threshold"] == 0.5


def test_30_plain_image_exposes_three_blocks_without_any_score(client):
    """No face + no audio → three blocks, and NOTHING is guessed."""
    import io as _io

    import cv2

    gradient = np.tile(np.linspace(0, 255, 640, dtype=np.uint8), (480, 1))
    image = cv2.cvtColor(gradient, cv2.COLOR_GRAY2BGR)
    ok, buffer = cv2.imencode(".png", image)
    assert ok
    response = client.post(
        "/api/analyze",
        files={
            "file": ("noface.png", _io.BytesIO(buffer.tobytes()), "image/png")
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()

    for key in ("visual_analysis", "audio_analysis", "multimodal_analysis"):
        assert key in body
    assert body["visual_analysis"]["status"] == "no_face_detected"
    assert "score" not in body["visual_analysis"]
    assert body["audio_analysis"]["status"] == "not_applicable"
    assert "score" not in body["audio_analysis"]
    # neither modality produced a score → CASE D, no fused score at all
    mm = body["multimodal_analysis"]
    assert mm["status"] == "unavailable", mm
    _assert_no_fusion_values(mm)
