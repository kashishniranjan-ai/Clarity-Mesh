"""
Clarity Mesh — Audio Deepfake Detector (STEP 7)
===============================================
Genuine pretrained **anti-deepfake / synthetic-speech detector** built on the
NII Yamagishi Lab ``wav2vec-small-anti-deepfake`` model. It analyses the audio
track of uploaded videos and standalone audio files with real model inference.

WHAT THIS MODULE DOES
  * loads the audio model ONCE via a thread-safe lazy singleton (CPU, eval mode)
  * SHA-256-verifies the official weight file before any inference
  * probes uploads with FFmpeg for an audio stream before extraction
  * extracts audio to a temp WAV (the original upload is never modified)
  * applies the official preprocessing: mono -> 16 kHz -> global layer_norm
  * runs deterministic chunked inference and aggregates genuine chunk scores
  * returns honest failure states — a score exists ONLY after a real forward pass

WHAT THIS MODULE DOES NOT DO
  * it does NOT combine its score with the visual pipeline (no fusion, STEP 8)
  * it does NOT store anything in a database (STEP 9 scope, not started)
  * it does NOT invent, hardcode or randomise predictions
  * the returned score is a softmax output of the model — it is NOT presented
    as a guaranteed calibrated probability (the source documentation only
    establishes dataset-dependent EER thresholds, see model card metrics)

MODEL PROVENANCE (verified during STEP 7 research)
  name        : wav2vec-small-anti-deepfake (AntiDeepfake project)
  repository  : https://huggingface.co/nii-yamagishilab/wav2vec-small-anti-deepfake
  revision    : 9a13264b5dcc827a8d5a4f8e01fccefa392f886b (pinned)
  weights     : model.safetensors (fairseq checkpoint, SHA-256 verified below)
  authors     : Yamagishi Lab, National Institute of Informatics (NII), Japan
  paper       : "Post-training for Deepfake Speech Detection" — arXiv:2506.21090
  code        : https://github.com/nii-yamagishilab/AntiDeepfake
  license     : CC BY-NC-SA 4.0 (research and educational use; NII weights)

CLASS INDEX SEMANTICS (from the official model-card inference snippet)
  softmax index 1 = REAL class   -> ``real prob = prob[1]``
  softmax index 0 = FAKE class   -> ``fake prob = prob[0]``
  reported ``score`` = P(class index 1) = probability of the REAL class.
  Decision rule (official "Binary classification" softmax output):
  ``score >= 0.5`` -> "real", otherwise -> "deepfake".
  NOTE: score direction is OPPOSITE to the visual block (visual score = P(fake)).

ARCHITECTURE
  fairseq ``DeepfakeDetector`` = Wav2Vec2-base SSL frontend (12 layers, 768-d)
  + AdaptiveAvgPool1d(1) over time + Linear(768 -> 2) classification head
  (``proj_fc``). The official checkpoint is converted fairseq -> HuggingFace
  ``Wav2Vec2Model`` key-by-key; conversion verified 211/211 keys, strict load,
  real forward pass (see ``convert_validate.py`` / ``final_validate.py`` in the
  STEP 7 scratch directory).

NEXT-STAGE INPUT
  ``analyse_audio_media`` is wired into ``backend/routes/analysis.py`` in
  STEP 7 as the independent ``audio_analysis`` block of ``POST /api/analyze``.
"""

from __future__ import annotations

import hashlib
import os
import re
import subprocess
import tempfile
import threading
import time
import wave
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn

# ---------------------------------------------------------------------------
# Model identity / provenance — exposed in every successful analysis payload
# ---------------------------------------------------------------------------
MODEL_NAME = "wav2vec-small-anti-deepfake (NII AntiDeepfake)"
MODEL_REPO = "nii-yamagishilab/wav2vec-small-anti-deepfake"
MODEL_REVISION = "9a13264b5dcc827a8d5a4f8e01fccefa392f886b"
MODEL_SOURCE = f"https://huggingface.co/{MODEL_REPO}"
MODEL_REFERENCE = "https://github.com/nii-yamagishilab/AntiDeepfake"
MODEL_LICENSE = "CC BY-NC-SA 4.0 (NII — research and educational use only)"

WEIGHTS_FILENAME = "model.safetensors"
CONFIG_FILENAME = "config.json"
# SHA-256 of the official artifacts at the pinned revision. Computed from the
# bytes downloaded from the pinned HF revision; verified before every model load.
WEIGHTS_SHA256 = (
    "828ee456122f86d5d631cb7895a10e5c62c78a4fcb8a8b1c42cb5838a9abcfe0"
)
CONFIG_SHA256 = (
    "0fa206bdf51cd69834414610ba6df68a1f22fe0397fe6a6826017b3d406fb69f"
)

# Class index semantics — official README: "real prob = prob[1], fake prob = prob[0]"
REAL_CLASS_INDEX = 1
FAKE_CLASS_INDEX = 0
# Official model card reports a binary softmax; decision at 50% real probability.
CLASSIFICATION_THRESHOLD = 0.5

# ---------------------------------------------------------------------------
# Audio preprocessing / chunking parameters (documented, deterministic)
# ---------------------------------------------------------------------------
SAMPLE_RATE = 16000          # official: "Input: 16kHz sampled speech"
CHUNK_SECONDS = 10.0         # measured ~1.5 s CPU per chunk on this machine
CHUNK_OVERLAP_SECONDS = 2.0  # hop = 8 s; tail window realigned to cover the end
MIN_AUDIO_SAMPLES = 400      # wav2vec2 conv stack minimum (~25 ms)


def _env_int(name: str, default: int) -> int:
    """Read an integer limit from the environment, falling back to a default."""
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# Longest analysed audio window in seconds (bounded CPU, like the visual
# pipeline's bounded frame sampling). Beyond this the head of the track is
# analysed and ``audio_truncated`` is reported honestly in the payload.
MAX_ANALYSIS_SECONDS = _env_int("CLARITY_AUDIO_MAX_SECONDS", 120)
# FFmpeg subprocess timeout (extraction of a 50 MB upload stays far below this).
FFMPEG_TIMEOUT_SECONDS = _env_int("CLARITY_FFMPEG_TIMEOUT", 120)


# ---------------------------------------------------------------------------
# Weights: local directory, SHA-256 verification, pinned-revision download
# ---------------------------------------------------------------------------
class WeightsUnavailable(RuntimeError):
    """Raised when the official weight artifact cannot be obtained or verified."""


def _weights_dir() -> Path:
    """Directory holding the official checkpoint.

    ``CLARITY_AUDIO_WEIGHTS_DIR`` overrides everything; otherwise the audio
    sub-directory of ``CLARITY_WEIGHTS_DIR`` (or ``backend/weights/audio``).
    """
    override = os.getenv("CLARITY_AUDIO_WEIGHTS_DIR")
    if override:
        return Path(override)
    base = os.getenv("CLARITY_WEIGHTS_DIR")
    if base:
        return Path(base) / "audio"
    return Path(__file__).resolve().parent.parent / "weights" / "audio"


def _sha256(path: Path) -> str:
    """Streaming SHA-256 of a file (weights are ~380 MB)."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _resolve_weights() -> Path:
    """Return the path of a SHA-256-verified ``model.safetensors``.

    A local file is only accepted when its hash matches the pinned-revision
    artifact; otherwise the file is (re-)fetched from the pinned HF revision
    and verified again. Any failure raises :class:`WeightsUnavailable`.
    """
    directory = _weights_dir()
    target = directory / WEIGHTS_FILENAME

    if target.exists():
        try:
            if _sha256(target) == WEIGHTS_SHA256:
                return target
        except OSError:
            pass  # unreadable local copy → try a fresh download

    try:
        from huggingface_hub import hf_hub_download

        downloaded = hf_hub_download(
            repo_id=MODEL_REPO,
            filename=WEIGHTS_FILENAME,
            revision=MODEL_REVISION,
            local_dir=str(directory),
        )
        target = Path(downloaded)
    except Exception as exc:  # noqa: BLE001 — any fetch failure is one state
        raise WeightsUnavailable(
            f"Official weights are not available locally and could not be "
            f"downloaded from {MODEL_SOURCE} (revision {MODEL_REVISION}): "
            f"{type(exc).__name__}: {exc}"
        ) from exc

    if not target.exists():
        raise WeightsUnavailable(f"Download produced no file at {target}.")
    actual = _sha256(target)
    if actual != WEIGHTS_SHA256:
        raise WeightsUnavailable(
            f"SHA-256 mismatch for {target.name}: expected {WEIGHTS_SHA256}, "
            f"got {actual}. Refusing to run inference on unverified weights."
        )
    return target


# ---------------------------------------------------------------------------
# fairseq -> HuggingFace conversion (validated: 211/211 keys, strict load)
# ---------------------------------------------------------------------------
_POS_CONV_MAP = {
    "weight_g": "encoder.pos_conv_embed.conv.parametrizations.weight.original0",
    "weight_v": "encoder.pos_conv_embed.conv.parametrizations.weight.original1",
    "bias": "encoder.pos_conv_embed.conv.bias",
}
# fairseq GELU/quantizer heads that do not exist in Wav2Vec2Model at inference.
_DROPPED_TOKENS = ("quantizer.", "final_proj.", "project_q", "project_inp")

_CONV_RULES = (
    (r"^feature_extractor\.conv_layers\.(\d+)\.0\.weight$",
     r"feature_extractor.conv_layers.\1.conv.weight"),
    (r"^feature_extractor\.conv_layers\.(\d+)\.2\.(weight|bias)$",
     r"feature_extractor.conv_layers.\1.layer_norm.\2"),
    (r"^encoder\.layers\.(\d+)\.self_attn_layer_norm\.",
     r"encoder.layers.\1.layer_norm."),
    (r"^encoder\.layers\.(\d+)\.self_attn\.",
     r"encoder.layers.\1.attention."),
    (r"^encoder\.layers\.(\d+)\.fc1\.",
     r"encoder.layers.\1.feed_forward.intermediate_dense."),
    (r"^encoder\.layers\.(\d+)\.fc2\.",
     r"encoder.layers.\1.feed_forward.output_dense."),
)


def _convert_state_dict(
    official: dict[str, torch.Tensor],
) -> tuple[dict[str, torch.Tensor], dict[str, torch.Tensor]]:
    """Split the official checkpoint into (backbone, classification head).

    Backbone keys are rewritten from the fairseq ``m_ssl.model.*`` namespace to
    the HuggingFace ``Wav2Vec2Model`` namespace. ``proj_fc.*`` keys are the
    official Linear(768 -> 2) head and are returned separately.
    """
    backbone: dict[str, torch.Tensor] = {}
    head: dict[str, torch.Tensor] = {}
    for key, value in official.items():
        if key.startswith("proj_fc."):
            head[key] = value
            continue
        if not key.startswith("m_ssl.model."):
            continue  # nothing else is expected in the inference checkpoint
        k = key[len("m_ssl.model."):]
        if k.startswith("encoder.pos_conv.0."):
            backbone[_POS_CONV_MAP[k[len("encoder.pos_conv.0."):]]] = value
            continue
        if any(token in k for token in _DROPPED_TOKENS):
            continue
        k = k.replace("post_extract_proj.", "feature_projection.projection.")
        if k.startswith("layer_norm."):
            k = "feature_projection." + k
        k = k.replace("mask_emb", "masked_spec_embed")
        for pattern, replacement in _CONV_RULES:
            k = re.sub(pattern, replacement, k)
        backbone[k] = value
    return backbone, head


class AntiDeepfakeModel(nn.Module):
    """Official ``DeepfakeDetector``: Wav2Vec2-base -> mean-pool -> Linear(768, 2).

    ``x.mean(dim=1)`` over time is mathematically identical to the official
    ``torch.nn.AdaptiveAvgPool1d(output_size=1)`` applied to ``[B, D, T]``.
    """

    def __init__(self, backbone: nn.Module, head_state: dict[str, torch.Tensor]):
        super().__init__()
        self.wav2vec2 = backbone
        self.proj_fc = nn.Linear(768, 2)
        stripped = {k.replace("proj_fc.", ""): v for k, v in head_state.items()}
        self.proj_fc.load_state_dict(stripped, strict=True)

    def forward(self, wav: torch.Tensor) -> torch.Tensor:
        hidden = self.wav2vec2(wav).last_hidden_state   # [B, T, 768]
        pooled = hidden.mean(dim=1)                     # [B, 768]
        return self.proj_fc(pooled)                     # [B, 2] logits


def _build_model() -> AntiDeepfakeModel:
    """Build the model from the SHA-256-verified official checkpoint.

    Raises on any import/config/conversion/load problem — never returns a
    randomly initialised or partially loaded model.
    """
    from safetensors import safe_open
    from transformers import Wav2Vec2Config, Wav2Vec2Model

    weights_path = _resolve_weights()  # raises WeightsUnavailable on failure
    directory = weights_path.parent

    config_path = directory / CONFIG_FILENAME
    if not config_path.exists() or _sha256(config_path) != CONFIG_SHA256:
        raise WeightsUnavailable(
            f"{CONFIG_FILENAME} missing or SHA-256 mismatch in {directory}."
        )

    with safe_open(str(weights_path), framework="pt") as handle:
        official = {k: handle.get_tensor(k) for k in handle.keys()}
    backbone_state, head_state = _convert_state_dict(official)
    if not head_state:
        raise WeightsUnavailable(
            "Classification head (proj_fc.*) not found in the checkpoint."
        )

    config = Wav2Vec2Config.from_pretrained(str(directory))
    backbone = Wav2Vec2Model(config)
    missing, unexpected = backbone.load_state_dict(backbone_state, strict=False)
    if missing or unexpected:
        raise RuntimeError(
            f"fairseq->HF conversion mismatch — missing={missing[:5]}, "
            f"unexpected={unexpected[:5]}"
        )
    backbone.eval()

    model = AntiDeepfakeModel(backbone, head_state)
    model.eval()
    return model


# ---------------------------------------------------------------------------
# Thread-safe lazy singleton (mirrors visual_detector's load-once pattern)
# ---------------------------------------------------------------------------
_AUDIO_MODEL: AntiDeepfakeModel | None = None
_AUDIO_MODEL_ERROR: str | None = None
_AUDIO_MODEL_ERROR_AT = 0.0
_AUDIO_MODEL_LOCK = threading.Lock()
_LOAD_RETRY_SECONDS = 60


def _load_audio_model() -> tuple[AntiDeepfakeModel | None, str | None]:
    """Load (once) and return ``(model, error)``.

    ``error`` is a status-prefixed string (``weights_unavailable: ...`` or
    ``model_unavailable: ...``), cached for ``_LOAD_RETRY_SECONDS`` so a broken
    environment is not hammered on every request. CPU-only, eval mode.
    """
    global _AUDIO_MODEL, _AUDIO_MODEL_ERROR, _AUDIO_MODEL_ERROR_AT

    with _AUDIO_MODEL_LOCK:
        if _AUDIO_MODEL is not None:
            return _AUDIO_MODEL, None
        if (
            _AUDIO_MODEL_ERROR is not None
            and time.time() - _AUDIO_MODEL_ERROR_AT < _LOAD_RETRY_SECONDS
        ):
            return None, _AUDIO_MODEL_ERROR

        try:
            model = _build_model()
        except WeightsUnavailable as exc:
            _AUDIO_MODEL_ERROR = f"weights_unavailable: {exc}"
        except Exception as exc:  # noqa: BLE001 — any build failure is one state
            _AUDIO_MODEL_ERROR = (
                f"model_unavailable: Could not build the audio model "
                f"({type(exc).__name__}: {exc})."
            )
        else:
            _AUDIO_MODEL = model
            _AUDIO_MODEL_ERROR = None
            return _AUDIO_MODEL, None

        _AUDIO_MODEL_ERROR_AT = time.time()
        return None, _AUDIO_MODEL_ERROR


def _reset_audio_model_cache() -> None:
    """Drop the cached model/error state (used by the STEP 7 test suite)."""
    global _AUDIO_MODEL, _AUDIO_MODEL_ERROR, _AUDIO_MODEL_ERROR_AT
    with _AUDIO_MODEL_LOCK:
        _AUDIO_MODEL = None
        _AUDIO_MODEL_ERROR = None
        _AUDIO_MODEL_ERROR_AT = 0.0


# ---------------------------------------------------------------------------
# FFmpeg: binary resolution, stream probe, extraction (upload never modified)
# ---------------------------------------------------------------------------
def _ffmpeg_exe() -> str | None:
    """Locate FFmpeg: ``CLARITY_FFMPEG`` override, else the imageio-ffmpeg binary."""
    override = os.getenv("CLARITY_FFMPEG")
    if override and Path(override).exists():
        return override
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001 — absence is reported as extraction_failed
        return None


def _run_ffmpeg(args: list[str]) -> tuple[int, str]:
    """Run FFmpeg; return ``(returncode, stderr)``. ``-1`` marks infra failure."""
    exe = _ffmpeg_exe()
    if not exe:
        return -1, "FFmpeg binary unavailable (imageio-ffmpeg not installed)."
    try:
        proc = subprocess.run(
            [exe, "-hide_banner", *args],
            capture_output=True,
            text=True,
            errors="replace",
            timeout=FFMPEG_TIMEOUT_SECONDS,
        )
        return proc.returncode, proc.stderr or ""
    except subprocess.TimeoutExpired:
        return -1, f"FFmpeg timed out after {FFMPEG_TIMEOUT_SECONDS}s."
    except OSError as exc:
        return -1, f"FFmpeg could not be executed: {exc}."


# Marker taxonomy captured from real FFmpeg 7.1 stderr during STEP 7 research
# (%TEMP%\clarity_step7\probe_out.txt) plus documented FFmpeg error strings.
_INFRA_MARKERS = (
    "FFmpeg binary unavailable",
    "FFmpeg timed out",
    "FFmpeg could not be executed",
    "No such file or directory",
    "Permission denied",
)
_CORRUPT_MARKERS = (
    "Invalid data found when processing input",
    "moov atom not found",
    "Header missing",
    "Error while decoding",
)
_UNSUPPORTED_MARKERS = (
    "Protocol not found",
    "Unknown format",
    "unknown format",
    "does not match any known format",
    "not supported by this build",
)


def _classify_probe_failure(stderr: str) -> tuple[str, str]:
    """Map an FFmpeg probe failure to ``(status, message)``.

    Infrastructure problems become ``extraction_failed``; recognised but
    damaged data becomes ``corrupt_audio``; an unidentifiable container
    becomes ``unsupported_format``.
    """
    for marker in _INFRA_MARKERS:
        if marker in stderr:
            return (
                "extraction_failed",
                f"Audio could not be inspected ({marker.strip()}). "
                f"No score was produced.",
            )
    for marker in _CORRUPT_MARKERS:
        if marker in stderr:
            return (
                "corrupt_audio",
                f"The file could not be read as valid media data "
                f"(FFmpeg: \"{marker}\"). No score was produced.",
            )
    for marker in _UNSUPPORTED_MARKERS:
        if marker in stderr:
            return (
                "unsupported_format",
                f"FFmpeg could not identify a supported container/format for "
                f"this file (\"{marker}\"). No score was produced.",
            )
    return (
        "unsupported_format",
        "FFmpeg could not identify the container/format of this file. "
        "No score was produced.",
    )


def _probe_audio_stream(path: Path) -> tuple[str, str | None]:
    """Check for an audio stream before extracting. ``"ok"`` = audio present."""
    _code, stderr = _run_ffmpeg(["-i", str(path)])
    if "Input #" in stderr:  # container identified (exit code is 1 without output)
        if "Audio:" in stderr:
            return "ok", None
        return (
            "no_audio",
            "No audio stream was detected in this file, so audio deepfake "
            "analysis was not run. Visual analysis (if any) is unaffected.",
        )
    status, message = _classify_probe_failure(stderr)
    return status, message


def _extract_to_wav(source: Path, target: Path) -> tuple[str, str] | None:
    """Extract the first audio stream to mono 16 kHz PCM WAV.

    Returns ``None`` on success or ``(status, message)`` on failure. The
    source file is opened read-only — extraction output goes to a temp dir.
    """
    code, stderr = _run_ffmpeg(
        [
            "-y", "-loglevel", "error",
            "-i", str(source),
            "-map", "0:a:0", "-vn",
            "-ac", "1", "-ar", str(SAMPLE_RATE),
            "-c:a", "pcm_s16le", "-f", "wav", str(target),
        ]
    )
    if code == 0 and target.exists() and target.stat().st_size > 44:
        return None
    detail = stderr.strip().splitlines()[-1] if stderr.strip() else "no output produced"
    if code == -1 or not ("Input #" in stderr or "Invalid data" in stderr):
        status, message = "extraction_failed", (
            f"FFmpeg could not extract the audio stream ({detail}). "
            f"No score was produced."
        )
    else:
        status, message = _classify_probe_failure(stderr)
        if status == "unsupported_format":
            status, message = "extraction_failed", (
                f"FFmpeg could not extract the audio stream ({detail}). "
                f"No score was produced."
            )
    return status, message


def _load_wav(path: Path) -> tuple[np.ndarray | None, tuple[str, str] | None]:
    """Read the extracted PCM WAV into a float32 mono waveform in [-1, 1].

    Returns ``(samples, None)`` or ``(None, (status, message))``. Any decode
    surprise (bad header, wrong rate/channels/width, sub-minimum length) is an
    honest ``corrupt_audio`` state — no score is invented for unusable audio.
    """
    try:
        with wave.open(str(path), "rb") as reader:
            rate = reader.getframerate()
            channels = reader.getnchannels()
            width = reader.getsampwidth()
            frames = reader.readframes(reader.getnframes())
    except (wave.Error, EOFError, OSError) as exc:
        return None, (
            "corrupt_audio",
            f"The extracted audio could not be decoded "
            f"({type(exc).__name__}: {exc}). No score was produced.",
        )
    if channels != 1 or rate != SAMPLE_RATE or width != 2:
        return None, (
            "corrupt_audio",
            f"Unexpected extracted audio layout "
            f"({channels} ch, {rate} Hz, {width * 8}-bit). "
            f"No score was produced.",
        )
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32) / 32768.0
    if samples.size < MIN_AUDIO_SAMPLES:
        return None, (
            "corrupt_audio",
            f"Audio is too short to analyse "
            f"({samples.size / SAMPLE_RATE * 1000:.0f} ms; minimum "
            f"{MIN_AUDIO_SAMPLES / SAMPLE_RATE * 1000:.0f} ms). "
            f"No score was produced.",
        )
    return samples, None


def _prepare_audio(path: Path) -> tuple[dict | None, dict | None]:
    """Probe → extract → decode. Returns ``(success, failure)`` — one is None.

    Extraction writes only into a temporary directory that is deleted before
    returning; the uploaded file is never modified.
    """
    status, message = _probe_audio_stream(path)
    if status != "ok":
        return None, {"status": status, "audio_present": False, "message": message}

    with tempfile.TemporaryDirectory(prefix="clarity_audio_") as tmp_dir:
        wav_path = Path(tmp_dir) / "extracted.wav"
        failure = _extract_to_wav(path, wav_path)
        if failure is not None:
            status, message = failure
            return None, {
                "status": status,
                "audio_present": True,  # probe already saw an audio stream
                "message": message,
            }
        samples, wav_failure = _load_wav(wav_path)
    if wav_failure is not None:
        status, message = wav_failure
        return None, {"status": status, "audio_present": True, "message": message}
    return {"samples": samples}, None


# ---------------------------------------------------------------------------
# Chunking + scoring (deterministic, documented)
# ---------------------------------------------------------------------------
def _chunk_starts(duration_seconds: float) -> list[float]:
    """Deterministic window starts for chunked inference.

    Strategy (documented aggregation contract):
      * windows of ``CHUNK_SECONDS`` (10 s) with ``CHUNK_OVERLAP_SECONDS``
        (2 s) overlap → 8 s hop;
      * audio shorter than one window is scored as a single window, exactly
        like the official whole-file inference snippet;
      * the final window is realigned to end at the last sample so the tail
        of the track is always covered.
    """
    chunk = CHUNK_SECONDS
    if duration_seconds <= chunk + 1e-9:
        return [0.0]
    hop = chunk - CHUNK_OVERLAP_SECONDS
    starts: list[float] = []
    cursor = 0.0
    while cursor + chunk <= duration_seconds + 1e-9:
        starts.append(cursor)
        cursor += hop
    tail = duration_seconds - chunk
    if tail > (starts[-1] if starts else 0.0) + 1e-9:
        starts.append(tail)
    return starts


def _score_chunk(model: AntiDeepfakeModel, chunk: torch.Tensor) -> float:
    """REAL-class softmax score of one preprocessed chunk.

    ``softmax(logits)[REAL_CLASS_INDEX]`` — official class semantics
    (index 1 = REAL, index 0 = FAKE).
    """
    with torch.inference_mode():
        logits = model(chunk.unsqueeze(0))            # [1, 2]
        probs = torch.softmax(logits, dim=1)          # [1, 2]
        return float(probs[0, REAL_CLASS_INDEX])


def _provenance_fields() -> dict[str, Any]:
    """Model identity exposed in successful (and model-level failed) payloads."""
    return {
        "model": MODEL_NAME,
        "model_source": MODEL_SOURCE,
        "model_revision": MODEL_REVISION,
        "model_weights": WEIGHTS_FILENAME,
        "model_weights_sha256": WEIGHTS_SHA256,
        "model_license": MODEL_LICENSE,
        "model_reference": MODEL_REFERENCE,
    }


# ---------------------------------------------------------------------------
# Public API — STEP 7
# ---------------------------------------------------------------------------
def analyse_audio_media(path: "str | Path", media_type: str = "video") -> dict:
    """Run the audio deepfake model on a media file.

    Fully independent of the visual pipeline: this function never reads the
    visual result and its score is never fused with anything (fusion is
    explicitly STEP 8 scope and is NOT implemented).

    Returns a payload with ``status``:

    ``completed``          — at least one genuine forward pass; includes
                             ``score`` (P(class index 1) = REAL), ``classification``,
                             provenance and the chunking/aggregation details;
    ``not_applicable``     — image uploads have no audio;
    ``no_audio``           — probe found no audio stream;
    ``extraction_failed``  — FFmpeg missing/timeout/other infrastructure error;
    ``unsupported_format`` — FFmpeg could not identify the container;
    ``corrupt_audio``      — audio data is damaged or unusable;
    ``weights_unavailable``/``model_unavailable`` — model could not be loaded
                             (weight hash is verified before every load);
    ``inference_failed``   — model loaded but no chunk produced a score.

    A ``score`` key exists ONLY in the ``completed`` payload — failures never
    carry a fabricated, random or hardcoded score.
    """
    path = Path(path)

    if media_type == "image":
        return {
            "status": "not_applicable",
            "audio_present": False,
            "message": (
                "Still images contain no audio, so audio deepfake analysis "
                "does not apply to this upload."
            ),
        }

    prepared, failure = _prepare_audio(path)
    if failure is not None:
        return failure

    samples = prepared["samples"]
    duration = samples.size / SAMPLE_RATE
    analyzed_seconds = min(duration, float(MAX_ANALYSIS_SECONDS))
    truncated = duration > analyzed_seconds + 1e-9
    waveform_np = samples[: int(round(analyzed_seconds * SAMPLE_RATE))]

    model, error = _load_audio_model()
    if model is None:
        status, _sep, message = (error or "model_unavailable: unknown error").partition(":")
        return {
            "status": status,
            "audio_present": True,
            "model": MODEL_NAME,
            "message": message.strip(),
        }

    # Official preprocessing: mono -> 16 kHz (guaranteed by extraction) ->
    # global layer_norm over the analysed waveform (README:
    # ``F.layer_norm(wav, wav.shape)``).
    waveform = torch.from_numpy(waveform_np)
    waveform = torch.nn.functional.layer_norm(waveform, waveform.shape)

    starts = _chunk_starts(waveform.numel() / SAMPLE_RATE)
    chunk_scores: list[float] = []
    failed_chunks = 0
    for start in starts:
        begin = int(round(start * SAMPLE_RATE))
        end = min(begin + int(round(CHUNK_SECONDS * SAMPLE_RATE)), waveform.numel())
        try:
            value = _score_chunk(model, waveform[begin:end])
        except Exception:  # noqa: BLE001 — one bad chunk must not kill the run
            failed_chunks += 1
            continue
        if not np.isfinite(value):
            failed_chunks += 1
            continue
        # softmax output is mathematically within [0, 1]; clamp guards float edges
        chunk_scores.append(float(min(max(value, 0.0), 1.0)))

    if not chunk_scores:
        return {
            "status": "inference_failed",
            "audio_present": True,
            "model": MODEL_NAME,
            "message": (
                f"Model inference failed for all {len(starts)} chunk(s) "
                f"({failed_chunks} error(s)). No score was produced."
            ),
        }

    # Documented aggregation: arithmetic mean over per-chunk REAL-class scores.
    score = round(sum(chunk_scores) / len(chunk_scores), 4)
    classification = "real" if score >= CLASSIFICATION_THRESHOLD else "deepfake"

    message = (
        f"Audio analysed with {MODEL_NAME}: {len(chunk_scores)} chunk(s) of "
        f"{CHUNK_SECONDS:.0f}s with {CHUNK_OVERLAP_SECONDS:.0f}s overlap, "
        f"aggregated as the arithmetic mean of per-chunk REAL-class scores. "
        f"score = softmax output for class index {REAL_CLASS_INDEX} (REAL); "
        f"it is a model score, NOT an established calibrated probability."
    )
    if truncated:
        message += (
            f" Analyzed the first {analyzed_seconds:.0f}s of "
            f"{duration:.1f}s (limit CLARITY_AUDIO_MAX_SECONDS)."
        )
    if failed_chunks:
        message += f" {failed_chunks} chunk(s) failed and were excluded."

    return {
        "status": "completed",
        "media_type": media_type,
        "audio_present": True,
        **_provenance_fields(),
        "score_type": (
            "softmax score of class index 1 (REAL) — uncalibrated model "
            "output, not an established calibrated probability"
        ),
        "threshold": CLASSIFICATION_THRESHOLD,
        "threshold_note": (
            "score >= threshold → \"real\", else → \"deepfake\" "
            "(official 50% softmax decision rule)."
        ),
        "aggregation": "mean of per-chunk REAL-class scores (equal weight per chunk)",
        "duration_seconds": round(duration, 3),
        "seconds_analyzed": round(analyzed_seconds, 3),
        "audio_truncated": truncated,
        "sample_rate": SAMPLE_RATE,
        "chunk_seconds": CHUNK_SECONDS,
        "overlap_seconds": CHUNK_OVERLAP_SECONDS,
        "chunks_analyzed": len(chunk_scores),
        "chunks_failed": failed_chunks,
        "per_chunk_scores": [round(value, 6) for value in chunk_scores],
        "score": score,
        "classification": classification,
        "message": message,
    }
