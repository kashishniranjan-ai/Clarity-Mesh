"""
STEP 7 test suite — audio deepfake detector (services/audio_detector.py) and
its independent wiring into ``POST /api/analyze``.

Required checks covered here:
 1. the audio model loads
 2. the model is in eval mode
 3. official weight hash is verified before inference
 4. real audio inference returns a finite, model-derived score
 5. deterministic output for identical input
 6. different audio inputs can produce different outputs
 7. valid standalone audio analysable through the API
 8. video with audio -> completed audio analysis
 9. video without audio -> no_audio, no score
10. corrupt audio -> honest failure state, no score
11. corrupt video -> safe failure (visual path unchanged), no audio score
12. audio extraction failure -> extraction_failed, no score
13. model/weights unavailable -> honest state, no score
14. inference failure -> no fabricated score
15. aggregation is exactly the documented aggregation
16. images -> audio_analysis not_applicable (visual analysis unaffected)

Requirement 16 (existing 18 tests still pass) and 17/18 (visual image/video
analysis) are verified by running the whole suite — this file must leave
``test_api.py`` and ``test_visual_detector.py`` untouched and green.
"""

from __future__ import annotations

import hashlib
import math
import subprocess
import wave
from pathlib import Path

import numpy as np
import pytest

import services.audio_detector as ad

SAMPLE_RATE = 16000


# ---------------------------------------------------------------------------
# Audio fixture helpers (stdlib WAV writers — no system FFmpeg needed)
# ---------------------------------------------------------------------------
def _write_wav(path: Path, samples: np.ndarray) -> Path:
    """Write float32 samples in [-1, 1] as 16-bit mono PCM WAV."""
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


def _noise(seconds: float, seed: int = 7) -> np.ndarray:
    rng = np.random.default_rng(seed)
    return (rng.standard_normal(int(seconds * SAMPLE_RATE)) * 0.1).astype(np.float32)


def _silence(seconds: float) -> np.ndarray:
    return np.zeros(int(seconds * SAMPLE_RATE), dtype=np.float32)


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _ffmpeg_exe() -> str:
    exe = ad._ffmpeg_exe()
    if not exe:
        pytest.skip("FFmpeg binary unavailable (imageio-ffmpeg)")
    return exe


def _ffmpeg(args: list[str]) -> None:
    subprocess.run(
        [_ffmpeg_exe(), "-hide_banner", "-loglevel", "error", *args],
        check=True,
        capture_output=True,
        timeout=120,
    )


@pytest.fixture
def sine_wav(tmp_path) -> Path:
    """1.5 s 440 Hz tone — short enough for fast single-chunk inference."""
    return _write_wav(tmp_path / "sine440.wav", _sine(1.5))


@pytest.fixture
def sine_wav_12s(tmp_path) -> Path:
    """12 s tone -> exactly two documented chunk windows."""
    return _write_wav(tmp_path / "sine440_12s.wav", _sine(12.0))


@pytest.fixture
def mp3_path(tmp_path, sine_wav) -> Path:
    out = tmp_path / "tone.mp3"
    _ffmpeg(
        ["-y", "-i", str(sine_wav), "-codec:a", "libmp3lame",
         "-qscale:a", "4", str(out)]
    )
    return out


@pytest.fixture
def plain_video(tmp_path) -> Path:
    """Small cv2-written MP4 WITHOUT an audio track."""
    import cv2

    out = tmp_path / "silent.mp4"
    writer = cv2.VideoWriter(str(out), cv2.VideoWriter_fourcc(*"mp4v"), 12.0, (64, 48))
    assert writer.isOpened(), "cv2.VideoWriter failed to open"
    frame = np.full((48, 64, 3), 96, dtype=np.uint8)
    for _ in range(12):
        writer.write(frame)
    writer.release()
    assert out.exists() and out.stat().st_size > 0
    return out


@pytest.fixture
def video_with_audio(tmp_path, plain_video, sine_wav) -> Path:
    """Same video with the sine tone muxed in as AAC audio."""
    out = tmp_path / "with_audio.mp4"
    _ffmpeg(
        ["-y", "-i", str(plain_video), "-i", str(sine_wav),
         "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
         "-c:a", "aac", "-shortest", str(out)]
    )
    return out


@pytest.fixture
def fresh_audio_cache():
    """Reset the model singleton before AND after tests that alter load state."""
    ad._reset_audio_model_cache()
    yield
    ad._reset_audio_model_cache()


# ---------------------------------------------------------------------------
# 1–3. Model loads, eval mode, verified weight hash
# ---------------------------------------------------------------------------
def test_01_audio_model_loads():
    """(E-1) The genuine pretrained model loads once and reports no error."""
    model, error = ad._load_audio_model()
    assert error is None, error
    assert model is not None


def test_02_audio_model_in_eval_mode():
    """(E-2) Loaded model is in eval mode (deterministic, no dropout/BN updates)."""
    model, error = ad._load_audio_model()
    assert error is None, error
    assert model.training is False
    assert model.wav2vec2.training is False
    assert model.proj_fc.training is False


def test_03_official_weight_hash_is_verified(tmp_path, monkeypatch):
    """(E-3) Local weights hash to the pinned SHA-256 AND a mismatch is refused."""
    weights = ad._weights_dir() / ad.WEIGHTS_FILENAME
    assert weights.exists(), "official weights missing"
    assert _file_sha256(weights) == ad.WEIGHTS_SHA256

    # Tamper simulation: local file has wrong bytes and the "download" also
    # returns the wrong bytes -> verification must refuse with WeightsUnavailable.
    tampered_dir = tmp_path / "tampered"
    tampered_dir.mkdir()
    fake = tampered_dir / ad.WEIGHTS_FILENAME
    fake.write_bytes(b"not the official checkpoint")
    monkeypatch.setattr(ad, "_weights_dir", lambda: tampered_dir)

    import huggingface_hub

    monkeypatch.setattr(
        huggingface_hub, "hf_hub_download", lambda **_kwargs: str(fake)
    )
    with pytest.raises(ad.WeightsUnavailable, match="SHA-256 mismatch"):
        ad._resolve_weights()


# ---------------------------------------------------------------------------
# 4–6. Real inference: finite score, determinism, input-dependence
# ---------------------------------------------------------------------------
def test_04_real_audio_returns_finite_model_score(sine_wav):
    """(E-4) Genuine forward passes produce a finite score in [0, 1] with full
    provenance — and the analysed file is never modified."""
    digest_before = _file_sha256(sine_wav)
    result = ad.analyse_audio_media(sine_wav, media_type="audio")

    assert result["status"] == "completed", result
    score = result["score"]
    assert isinstance(score, float)
    assert math.isfinite(score) and 0.0 <= score <= 1.0
    assert result["classification"] in {"real", "deepfake"}
    assert result["audio_present"] is True
    assert result["chunks_analyzed"] >= 1

    # Provenance (requirement A): model, source, revision, weight hash, license
    assert result["model"] == ad.MODEL_NAME
    assert result["model_source"] == ad.MODEL_SOURCE
    assert result["model_revision"] == ad.MODEL_REVISION
    assert result["model_weights_sha256"] == ad.WEIGHTS_SHA256
    assert result["model_license"] == ad.MODEL_LICENSE

    # The score is explicitly NOT presented as a calibrated probability
    assert "not an established calibrated probability" in result["score_type"]

    # Extraction never mutated the analysed file
    assert _file_sha256(sine_wav) == digest_before


def test_05_deterministic_on_identical_input(sine_wav):
    """(E-5) Same input -> byte-identical scores across runs."""
    first = ad.analyse_audio_media(sine_wav, media_type="audio")
    second = ad.analyse_audio_media(sine_wav, media_type="audio")
    assert first["status"] == "completed" and second["status"] == "completed"
    assert first["score"] == second["score"]
    assert first["per_chunk_scores"] == second["per_chunk_scores"]
    assert first["classification"] == second["classification"]


def test_06_distinct_inputs_produce_distinct_outputs(tmp_path):
    """(E-6) Different audio inputs CAN produce different model outputs."""
    inputs = {
        "sine": _write_wav(tmp_path / "sine.wav", _sine(1.5)),
        "noise": _write_wav(tmp_path / "noise.wav", _noise(1.5)),
        "silence": _write_wav(tmp_path / "silence.wav", _silence(1.5)),
    }
    scores: dict[str, float] = {}
    for name, path in inputs.items():
        result = ad.analyse_audio_media(path, media_type="audio")
        assert result["status"] == "completed", result
        scores[name] = result["score"]
    assert len(set(scores.values())) >= 2, (
        f"model returned identical scores for different inputs: {scores}"
    )


# ---------------------------------------------------------------------------
# 7–11. API behaviour: standalone audio, video ± audio, corrupt media
# ---------------------------------------------------------------------------
_NO_FUSION_KEYS = {
    "combined_score", "fusion", "final_score", "overall_score", "is_fake",
    "verdict",
}


def test_07_standalone_audio_through_api(client, mp3_path):
    """(E-7) Valid standalone audio (mp3) analysable via POST /api/analyze,
    with the visual blocks honestly not_applicable and no fusion keys."""
    sent_bytes = mp3_path.read_bytes()
    with open(mp3_path, "rb") as handle:
        response = client.post(
            "/api/analyze", files={"file": ("tone.mp3", handle, "audio/mpeg")}
        )
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["status"] == "processed"
    assert data["media_type"] == "audio"
    audio = data["audio_analysis"]
    assert audio["status"] == "completed", audio
    assert 0.0 <= audio["score"] <= 1.0
    assert audio["classification"] in {"real", "deepfake"}
    assert audio["audio_present"] is True

    # Visual pipeline explicitly not applicable for audio — and never fused
    assert data["visual_analysis"]["status"] == "not_applicable"
    assert data["face_detection"]["status"] == "not_applicable"
    assert "width" not in data and "height" not in data
    assert _NO_FUSION_KEYS.isdisjoint(data.keys())

    # The stored upload was not mutated by audio extraction
    from routes.analysis import UPLOAD_DIR

    saved = UPLOAD_DIR / data["file"]["saved_as"]
    assert saved.read_bytes() == sent_bytes


def test_08_video_with_audio_through_api(client, video_with_audio):
    """(E-8) Video containing an audio stream -> completed audio analysis,
    visual block running independently (no fusion either way)."""
    with open(video_with_audio, "rb") as handle:
        response = client.post(
            "/api/analyze", files={"file": ("with_audio.mp4", handle, "video/mp4")}
        )
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["media_type"] == "video"
    audio = data["audio_analysis"]
    assert audio["status"] == "completed", audio
    assert audio["audio_present"] is True
    assert 0.0 <= audio["score"] <= 1.0
    assert audio["model_revision"] == ad.MODEL_REVISION

    # Visual path still behaves as before: the colour clip has no faces, so
    # the visual block carries NO score while the audio block carries one —
    # proving the blocks are independent (no fusion).
    visual = data["visual_analysis"]
    assert visual["status"] != "not_applicable"
    assert "score" not in visual
    assert _NO_FUSION_KEYS.isdisjoint(data.keys())
    assert data["width"] is not None and data["height"] is not None


def test_09_video_without_audio_through_api(client, plain_video):
    """(E-9) Video with no audio stream -> no_audio, audio_present False, no score."""
    with open(plain_video, "rb") as handle:
        response = client.post(
            "/api/analyze", files={"file": ("silent.mp4", handle, "video/mp4")}
        )
    assert response.status_code == 200, response.text
    data = response.json()

    audio = data["audio_analysis"]
    assert audio["status"] == "no_audio", audio
    assert audio["audio_present"] is False
    assert "score" not in audio
    assert "classification" not in audio
    assert data["media_type"] == "video"


def test_10_corrupt_audio_through_api(client):
    """(E-10) Garbage bytes as audio/mpeg -> honest corrupt_audio, no score."""
    garbage = b"\x00\x01\xffgarbage-not-really-an-mp3" * 64
    response = client.post(
        "/api/analyze", files={"file": ("broken.mp3", garbage, "audio/mpeg")}
    )
    assert response.status_code == 200, response.text
    data = response.json()

    audio = data["audio_analysis"]
    assert audio["status"] == "corrupt_audio", audio
    assert "score" not in audio
    assert "classification" not in audio
    # visual blocks stay honest for audio uploads even when audio is broken
    assert data["visual_analysis"]["status"] == "not_applicable"


def test_11_corrupt_video_through_api(client):
    """(E-11) Garbage bytes as video/mp4 -> safe 422 from the unchanged visual
    preprocessing; no audio score is fabricated anywhere."""
    garbage = b"\x00\x01\x02ftyp-is-not-actually-valid" * 64
    response = client.post(
        "/api/analyze", files={"file": ("broken.mp4", garbage, "video/mp4")}
    )
    assert response.status_code == 422, response.text
    body = response.json()
    assert "detail" in body
    assert "audio_analysis" not in body  # request failed before any analysis
    assert "score" not in body


# ---------------------------------------------------------------------------
# 15–16. Documented aggregation; images are not_applicable
# ---------------------------------------------------------------------------
def test_15_aggregation_is_exactly_the_documented_aggregation(sine_wav_12s):
    """(E-15) Window formula and mean aggregation match the documentation."""
    # Documented window starts: single window ≤10 s; 8 s hop; realigned tail.
    assert ad._chunk_starts(5.0) == [0.0]
    assert ad._chunk_starts(10.0) == [0.0]
    assert ad._chunk_starts(12.0) == [0.0, 2.0]
    assert ad._chunk_starts(25.0) == [0.0, 8.0, 15.0]

    result = ad.analyse_audio_media(sine_wav_12s, media_type="audio")
    assert result["status"] == "completed", result
    assert result["chunks_analyzed"] == len(ad._chunk_starts(12.0)) == 2
    # score == arithmetic mean of the reported per-chunk scores (documented)
    expected = sum(result["per_chunk_scores"]) / len(result["per_chunk_scores"])
    assert result["score"] == pytest.approx(expected, abs=5e-5)
    assert "mean of per-chunk REAL-class scores" in result["aggregation"]
    assert result["chunk_seconds"] == 10.0
    assert result["overlap_seconds"] == 2.0


def test_16_image_reports_audio_not_applicable(client, tmp_path):
    """(E-16) Image uploads: audio block is not_applicable, visual shape intact."""
    import cv2

    image_path = tmp_path / "plain.png"
    cv2.imwrite(str(image_path), np.full((32, 32, 3), 120, dtype=np.uint8))
    with open(image_path, "rb") as handle:
        response = client.post(
            "/api/analyze", files={"file": ("plain.png", handle, "image/png")}
        )
    assert response.status_code == 200, response.text
    data = response.json()

    assert data["media_type"] == "image"
    audio = data["audio_analysis"]
    assert audio["status"] == "not_applicable", audio
    assert audio["audio_present"] is False
    assert "score" not in audio
    # visual image analysis unchanged (width/height still present)
    assert data["width"] == 32 and data["height"] == 32
    assert "score" not in data["visual_analysis"]  # plain image has no face


# ---------------------------------------------------------------------------
# 12–14. Failure states — honest status, NEVER a fabricated score
# (placed last: they reset the model singleton, forcing a clean reload after)
# ---------------------------------------------------------------------------
def test_12_extraction_failure_reports_state(sine_wav, monkeypatch):
    """(E-12) FFmpeg unavailable -> extraction_failed, no score."""
    monkeypatch.setattr(ad, "_ffmpeg_exe", lambda: None)
    result = ad.analyse_audio_media(sine_wav, media_type="audio")
    assert result["status"] == "extraction_failed", result
    assert "score" not in result
    assert "classification" not in result
    assert result["audio_present"] is False


def test_13_weights_unavailable_reports_state(
    sine_wav, tmp_path, monkeypatch, fresh_audio_cache
):
    """(E-13a) Weights cannot be verified/fetched -> weights_unavailable, no score."""
    empty = tmp_path / "empty_weights"
    empty.mkdir()
    monkeypatch.setattr(ad, "_weights_dir", lambda: empty)

    import huggingface_hub

    def _no_network(**_kwargs):
        raise RuntimeError("network disabled in tests")

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", _no_network)

    result = ad.analyse_audio_media(sine_wav, media_type="audio")
    assert result["status"] == "weights_unavailable", result
    assert "score" not in result
    assert result["audio_present"] is True  # audio extracted fine; model blocked


def test_13b_model_unavailable_reports_state(
    sine_wav, monkeypatch, fresh_audio_cache
):
    """(E-13b) Model build failure -> model_unavailable, no score."""
    monkeypatch.setattr(
        ad, "_build_model", lambda: (_ for _ in ()).throw(RuntimeError("build broke"))
    )
    result = ad.analyse_audio_media(sine_wav, media_type="audio")
    assert result["status"] == "model_unavailable", result
    assert "score" not in result
    assert "classification" not in result


def test_14_inference_failure_never_fabricates_score(sine_wav, monkeypatch):
    """(E-14) Forward passes failing -> inference_failed, no fabricated score."""
    def _boom(_model, _chunk):
        raise RuntimeError("forward pass exploded")

    monkeypatch.setattr(ad, "_score_chunk", _boom)
    result = ad.analyse_audio_media(sine_wav, media_type="audio")
    assert result["status"] == "inference_failed", result
    assert "score" not in result
    assert "classification" not in result
    assert "No score was produced" in result["message"]
