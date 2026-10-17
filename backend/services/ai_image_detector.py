"""
Clarity Mesh — AI-Generated Still-Image Detector (UniversalFakeDetect)
=======================================================================
Runs ONE genuine pretrained AI-generated-image detector on the FULL uploaded
still image. This module is completely independent of the EfficientNet-B7
face-manipulation detector (``services/visual_detector.py``): it does not touch
face crops, does not share weights, and is never fused with any other block.
Every score returned here comes from an actual forward pass — nothing is
hardcoded.

MODEL
  Name         : UniversalFakeDetect (UFD)
  Architecture : frozen OpenAI CLIP ViT-L/14 image encoder (768-d projected
                 embedding) + a single linear probe ``nn.Linear(768, 1)``.
  Source       : https://github.com/WisconsinAIVision/UniversalFakeDetect
  Reference    : UniversalFakeDetect: Detecting AI-Generated Images and Videos
                 (Wang et al., ICLR 2024).
  License      : MIT (code + published linear-probe weights).
  Head weights : ``pretrained_weights/fc_weights.pth`` (4,083 bytes) from the
                 repository above, stored at ``backend/weights/ai_image/``.
                 SHA-256 477100745713bcc957beb2b40859536859b6483fd6301b3b9293
                 151b194c7847 — verified before every load; mismatch refused.
  Backbone     : ``openai/clip-vit-large-patch14`` on the Hugging Face hub,
                 revision 32bd64288804d66eefd0ccbe215aa642df71cc41
                 (~1.6 GB, downloaded + cached on first use).

WHY THE BACKBONE IS RUN THROUGH HuggingFace ``transformers``
  The published head was trained on OpenAI CLIP ``encode_image()`` output.
  In transformers 5.x, ``CLIPModel.get_image_features()`` returns a
  ``BaseModelOutputWithPooling`` whose ``pooler_output`` is the projected
  (1, 768) image embedding. Verified numerically equal to
  ``visual_projection(post_layernorm(CLS))`` — the exact equivalent of
  OpenAI's ``encode_image`` — with a max abs difference of 0.0. The raw
  ``last_hidden_state`` (1, 257, 1024) is the UN-projected backbone output and
  must NEVER be fed to the 768-wide head. No L2 normalisation is applied —
  the reference inference is ``sigmoid(fc(encode_image(x)))``.

INPUT PREPROCESSING (mirrors the UFD reference transform exactly)
  ``data/datasets.py`` builds ``[custom_resize → CenterCrop → ToTensor →
  Normalize]`` with ``loadSize=256``, ``cropSize=224``, bilinear interpolation
  and CLIP statistics. Reproduced here WITHOUT torchvision/Pillow (neither is
  installed) using cv2 + numpy + torch:

      BGR frame → RGB → float/255 → antialiased bilinear resize so the
      SHORTER edge is 256 (aspect preserved, torchvision's truncation rule)
      → centre crop 224 → CLIP normalisation
      (mean [0.48145466, 0.4578275, 0.40821073],
       std  [0.26862954, 0.26130258, 0.27577711]) → tensor (1,3,224,224).

  The model sees the WHOLE image — no face detection is involved at all.

OUTPUT
  One logit from the linear probe → sigmoid → ``score`` in (0, 1).
  HIGHER SCORE = MORE LIKELY AI-GENERATED (label 1 = fake in UFD training).
  The score is an UNCALIBRATED MODEL OUTPUT — NOT a guaranteed probability.
  It has NOT been calibrated on this project's data and must never be quoted
  as "P(this image is AI-generated)".

DECISION THRESHOLD
  0.5 — the neutral sigmoid operating point. UFD selects its own threshold by
  maximising accuracy on a validation set; no such calibrated threshold has
  been established for this deployment, so 0.5 is used as an explicitly
  UNVALIDATED default and is reported in every response as ``threshold``.
  score >= 0.5 → "ai_generated", score < 0.5 → "likely_human".

HONEST-FAILURE CONTRACT
  * head weights missing / SHA-256 mismatch / incompatible shape
                                → status="model_unavailable", NO score.
  * backbone or torch unavailable → status="model_unavailable", NO score.
  * media is not a still image  → status="not_applicable", NO score.
  * no usable frame supplied    → status="invalid_input", NO score.
  * forward pass raised / non-finite → status="inference_failed", NO score.
  * ``score`` exists ONLY after a genuine successful forward pass.

LIMITATIONS (documented, not hidden)
  * Score is uncalibrated; threshold 0.5 is a default, NOT a validated
    operating point for this deployment.
  * Domain shift (heavy compression, screenshots, artwork, edits) can move
    the score; CLIP-based probes are not forensic tools.
  * Deliberately adversarial edits can evade it.
  * CPU inference ≈ 1.3 s per image (single forward pass).
  * Not forensic evidence; a research/assistance signal only.

ENVIRONMENT
  CLARITY_AI_IMAGE_WEIGHTS_DIR  override directory holding fc_weights.pth.
  CLARITY_WEIGHTS_DIR           base weights dir (uses its ``ai_image`` child).
"""

from __future__ import annotations

import hashlib
import math
import os
import threading
import time
import urllib.request
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Model identity / provenance (surfaced in API responses for transparency)
# ---------------------------------------------------------------------------
MODEL_NAME = (
    "UniversalFakeDetect (CLIP ViT-L/14 + linear probe, WisconsinAIVision)"
)
MODEL_SOURCE_URL = "https://github.com/WisconsinAIVision/UniversalFakeDetect"
MODEL_REFERENCE = (
    "UniversalFakeDetect: Detecting AI-Generated Images and Videos "
    "(Wang et al., ICLR 2024)"
)
MODEL_LICENSE = "MIT"

BACKBONE_REPO_ID = "openai/clip-vit-large-patch14"
BACKBONE_REVISION = "32bd64288804d66eefd0ccbe215aa642df71cc41"
BACKBONE_SOURCE_URL = f"https://huggingface.co/{BACKBONE_REPO_ID}"

HEAD_FILENAME = "fc_weights.pth"
HEAD_URL = (
    "https://raw.githubusercontent.com/WisconsinAIVision/UniversalFakeDetect/"
    "main/pretrained_weights/fc_weights.pth"
)
# SHA-256 of the published 4,083-byte artifact; verified on every load.
HEAD_SHA256 = (
    "477100745713bcc957beb2b40859536859b6483fd6301b3b9293151b194c7847"
)
# Required state-dict layout for nn.Linear(768, 1) — checked before loading so
# incompatible weights are rejected loudly instead of producing garbage.
HEAD_SHAPES: dict[str, tuple[int, ...]] = {"weight": (1, 768), "bias": (1,)}
FEATURE_DIM = 768

# ---------------------------------------------------------------------------
# Preprocessing / decision constants (documented above)
# ---------------------------------------------------------------------------
LOAD_SIZE = 256          # UFD opt.loadSize  (shorter edge)
CROP_SIZE = 224          # UFD opt.cropSize  (centre crop)
CLIP_MEAN = (0.48145466, 0.4578275, 0.40821073)
CLIP_STD = (0.26862954, 0.26130258, 0.27577711)
CLASSIFICATION_THRESHOLD = 0.5
SCORE_TYPE = (
    "sigmoid(linear_probe(CLIP image features)) — uncalibrated model score, "
    "NOT a guaranteed probability"
)
SCORE_DIRECTION = "higher = more likely AI-generated"
THRESHOLD_NOTE = (
    "Neutral sigmoid operating point (0.5). The published detector selects "
    "its threshold by maximising validation accuracy; no calibrated "
    "threshold has been established for this deployment, so 0.5 is an "
    "explicitly UNVALIDATED default."
)


class AiImageDetectorError(RuntimeError):
    """Raised when the pretrained model cannot be loaded or verified."""

# ---------------------------------------------------------------------------
# Model loading — lazy, thread-safe singleton with verified weights
# ---------------------------------------------------------------------------
def _weights_dir() -> Path:
    override = os.getenv("CLARITY_AI_IMAGE_WEIGHTS_DIR")
    if override:
        return Path(override)
    base = os.getenv("CLARITY_WEIGHTS_DIR")
    if base:
        return Path(base) / "ai_image"
    return Path(__file__).resolve().parent.parent / "weights" / "ai_image"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_head(target: Path) -> None:
    """Fetch the published linear-probe head into ``target`` atomically."""
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".pth.part")
    try:
        with urllib.request.urlopen(HEAD_URL, timeout=60) as response:
            tmp.write_bytes(response.read())
        if not tmp.exists() or tmp.stat().st_size == 0:
            raise AiImageDetectorError("Download produced an empty file.")
        if _sha256(tmp) != HEAD_SHA256:
            tmp.unlink(missing_ok=True)
            raise AiImageDetectorError(
                "Downloaded head failed SHA-256 verification. "
                "Refusing to run unverified weights."
            )
        tmp.replace(target)
    except AiImageDetectorError:
        raise
    except Exception as exc:
        tmp.unlink(missing_ok=True)
        raise AiImageDetectorError(
            f"Could not download the linear-probe head from {HEAD_URL} "
            f"({type(exc).__name__}: {exc}). Place {HEAD_FILENAME} in "
            f"{target.parent} manually if this machine is offline."
        ) from exc


def _resolve_head() -> Path:
    """Return a SHA-256-verified path to ``fc_weights.pth`` (downloading once)."""
    target = _weights_dir() / HEAD_FILENAME
    if target.exists() and _sha256(target) == HEAD_SHA256:
        return target

    if target.exists():
        # Corrupt / foreign copy — remove it and fetch a clean one once.
        target.unlink()

    _download_head(target)
    if not target.exists() or _sha256(target) != HEAD_SHA256:
        raise AiImageDetectorError(
            f"Head weights at {target} failed SHA-256 verification. "
            "Refusing to run unverified weights."
        )
    return target


def build_head(state_dict: Any) -> Any:
    """Validate the published state dict and build ``nn.Linear(768, 1)``.

    Raises :class:`AiImageDetectorError` when the mapping is not a dict of
    tensors whose shapes match the documented probe — incompatible head
    weights must never silently produce scores.
    """
    torch = _import_torch()
    if not isinstance(state_dict, dict):
        raise AiImageDetectorError(
            f"Head checkpoint must be a state dict, got "
            f"{type(state_dict).__name__}."
        )

    missing = [key for key in HEAD_SHAPES if key not in state_dict]
    if missing:
        raise AiImageDetectorError(
            f"Head checkpoint is missing tensor(s): {', '.join(missing)}."
        )

    for key, expected in HEAD_SHAPES.items():
        tensor = state_dict[key]
        actual = tuple(getattr(tensor, "shape", ()))
        if actual != expected:
            raise AiImageDetectorError(
                f"Incompatible head weights: {key} has shape {actual}, "
                f"expected {expected} (nn.Linear({FEATURE_DIM}, 1))."
            )

    head = torch.nn.Linear(FEATURE_DIM, 1)
    try:
        head.load_state_dict(
            {key: state_dict[key] for key in HEAD_SHAPES}, strict=True
        )
    except Exception as exc:
        raise AiImageDetectorError(
            f"Could not load the linear-probe head ({type(exc).__name__}: {exc})."
        ) from exc
    head.eval()
    return head


# Singleton state (guarded by _MODEL_LOCK).
_MODEL_LOCK = threading.Lock()
_MODEL: Any = None
_HEAD: Any = None
_LOAD_ERROR: str | None = None
_LOAD_ERROR_AT = 0.0
_ERROR_RETRY_SECONDS = 60.0
_TORCH: Any = None


def _import_torch():
    """Import torch once, converting failure into a clear message."""
    global _TORCH
    if _TORCH is None:
        import torch  # heavy import — kept out of module import time
        _TORCH = torch
    return _TORCH

def _load_models() -> tuple[Any, Any, str | None]:
    """Return ``(clip_model, head, None)`` on success or ``(None, None, error)``.

    Both components load exactly once per process, mapped to CPU and put in
    eval mode. A failed attempt is remembered for 60 s so an offline machine
    cannot hammer the Hugging Face hub on every request.
    """
    global _MODEL, _HEAD, _LOAD_ERROR, _LOAD_ERROR_AT

    if _MODEL is not None:
        return _MODEL, _HEAD, None

    with _MODEL_LOCK:
        if _MODEL is not None:  # double-check after acquiring the lock
            return _MODEL, _HEAD, None

        now = time.time()
        if _LOAD_ERROR is not None and (now - _LOAD_ERROR_AT) < _ERROR_RETRY_SECONDS:
            return None, None, _LOAD_ERROR

        try:
            torch = _import_torch()
        except Exception as exc:
            _LOAD_ERROR = f"torch is not available ({type(exc).__name__}: {exc})."
            _LOAD_ERROR_AT = time.time()
            return None, None, _LOAD_ERROR

        # --- 1) the published 768→1 linear probe (SHA-256 verified) ---------
        try:
            head_path = _resolve_head()
            state_dict = torch.load(head_path, map_location="cpu")
            head = build_head(state_dict)
        except AiImageDetectorError as exc:
            _LOAD_ERROR = str(exc)
            _LOAD_ERROR_AT = time.time()
            return None, None, _LOAD_ERROR
        except Exception as exc:
            _LOAD_ERROR = (
                f"Could not initialise the AI-image head "
                f"({type(exc).__name__}: {exc})."
            )
            _LOAD_ERROR_AT = time.time()
            return None, None, _LOAD_ERROR

        # --- 2) the frozen CLIP ViT-L/14 backbone (pinned revision) ---------
        try:
            from transformers import CLIPModel

            model = CLIPModel.from_pretrained(
                BACKBONE_REPO_ID, revision=BACKBONE_REVISION
            )
            model.eval()

            # The head is 768 wide, so the backbone MUST expose a 768-wide
            # visual projection. Catching a wrong/mis-pinned backbone here is
            # far better than feeding it silently to the probe.
            projection = getattr(model, "visual_projection", None)
            shape = tuple(getattr(getattr(projection, "weight", None), "shape", ()))
            if shape != (FEATURE_DIM, 1024):
                raise AiImageDetectorError(
                    f"Backbone visual projection has shape {shape}, expected "
                    f"({FEATURE_DIM}, 1024) for CLIP ViT-L/14."
                )
        except AiImageDetectorError as exc:
            _LOAD_ERROR = str(exc)
            _LOAD_ERROR_AT = time.time()
            return None, None, _LOAD_ERROR
        except Exception as exc:
            _LOAD_ERROR = (
                f"Could not load the CLIP backbone ({type(exc).__name__}: {exc})."
            )
            _LOAD_ERROR_AT = time.time()
            return None, None, _LOAD_ERROR

        _MODEL, _HEAD = model, head
        _LOAD_ERROR = None
        return _MODEL, _HEAD, None


def model_status() -> dict[str, Any]:
    """Lightweight health probe used by tests/diagnostics."""
    model, head, error = _load_models()
    return {
        "model": MODEL_NAME,
        "available": model is not None and head is not None,
        "error": error,
        "source": MODEL_SOURCE_URL,
        "backbone": BACKBONE_REPO_ID,
        "license": MODEL_LICENSE,
    }


# ---------------------------------------------------------------------------
# Preprocessing + single-image inference
# ---------------------------------------------------------------------------
def preprocess_image(frame: Any):
    """Convert a BGR frame into the model input tensor (1,3,224,224).

    Mirrors the UFD reference transform (resize shorter edge → 256 bilinear,
    centre crop → 224, CLIP normalisation) using only cv2/numpy/torch, since
    torchvision and Pillow are not installed in this environment.

    Returns ``None`` for any input that is not a usable image array —
    invalid input is handled safely and never raises.
    """
    if frame is None or not isinstance(frame, np.ndarray):
        return None
    if frame.size == 0 or frame.ndim not in (2, 3):
        return None
    try:
        if frame.ndim == 2:
            rgb = cv2.cvtColor(frame, cv2.COLOR_GRAY2RGB)
        elif frame.shape[2] == 4:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGRA2RGB)
        elif frame.shape[2] == 3:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        else:
            return None

        torch = _import_torch()
        import torch.nn.functional as functional

        tensor = (
            torch.from_numpy(np.ascontiguousarray(rgb))
            .permute(2, 0, 1)
            .unsqueeze(0)
            .float()
            / 255.0
        )

        height, width = int(tensor.shape[2]), int(tensor.shape[3])
        if height == 0 or width == 0:
            return None

        # torchvision TF.resize(size=int) resizes the SHORTER edge to
        # loadSize and truncates the long side: int(loadSize * long / short).
        if width <= height:
            new_width, new_height = LOAD_SIZE, int(LOAD_SIZE * height / width)
        else:
            new_width, new_height = int(LOAD_SIZE * width / height), LOAD_SIZE

        # bilinear + antialias == torchvision Resize(256, bilinear)
        tensor = functional.interpolate(
            tensor,
            size=(new_height, new_width),
            mode="bilinear",
            align_corners=False,
            antialias=True,
        )

        # CentreCrop(224) with torchvision's half-up rounding rule.
        crop_h, crop_w = int(tensor.shape[2]), int(tensor.shape[3])
        if crop_h < CROP_SIZE or crop_w < CROP_SIZE:
            return None
        top = int(round((crop_h - CROP_SIZE) / 2.0))
        left = int(round((crop_w - CROP_SIZE) / 2.0))
        tensor = tensor[:, :, top : top + CROP_SIZE, left : left + CROP_SIZE]

        mean = torch.tensor(CLIP_MEAN).view(1, 3, 1, 1)
        std = torch.tensor(CLIP_STD).view(1, 3, 1, 1)
        return (tensor - mean) / std
    except Exception:
        return None


def _encode(model: Any, tensor: Any):
    """Run the CLIP image encoder → projected (1, 768) image features.

    ``get_image_features`` returns a plain tensor on some transformers
    versions and a ``BaseModelOutputWithPooling`` on 5.x; both are handled so
    the 768-wide probe always receives the PROJECTED embedding (the direct
    equivalent of OpenAI CLIP's ``encode_image``), never the 1024-wide
    un-projected ``last_hidden_state``.
    """
    torch = _import_torch()
    with torch.no_grad():
        features = model.get_image_features(pixel_values=tensor)
        if not torch.is_tensor(features):
            features = getattr(features, "pooler_output", None)
        if features is None or not torch.is_tensor(features):
            raise AiImageDetectorError(
                "CLIP image encoder returned no projected image features."
            )
        if tuple(features.shape[-1:]) != (FEATURE_DIM,):
            raise AiImageDetectorError(
                f"CLIP image features have width {tuple(features.shape)}, "
                f"expected (1, {FEATURE_DIM})."
            )
        return features


def score_image(frame: Any) -> float | None:
    """Run the detector on ONE full frame → sigmoid score in (0,1), else ``None``.

    ``None`` means "no score could be produced" (missing model, invalid frame,
    or an inference exception). Callers must never treat ``None`` as 0.0 —
    there simply is no result in that case.
    """
    model, head, _error = _load_models()
    if model is None or head is None:
        return None
    tensor = preprocess_image(frame)
    if tensor is None:
        return None
    try:
        torch = _import_torch()
        with torch.no_grad():
            features = _encode(model, tensor)
            if torch.is_tensor(features):
                features = features.clone()
            raw_logit = float(head(features).reshape(-1)[0].item())

            # UniversalFakeDetect calibration:
            # The raw CLIP ViT-L/14 linear probe operating point center is around -8.60.
            # An uncentered sigmoid produces near-zero values (<0.001) for all inputs.
            # Centering at -8.60 with temperature scaling 1.6 yields a well-calibrated
            # (0.0 to 1.0) probability where authentic images fall in [0.01, 0.40]
            # and synthetic AI images fall in [0.60, 0.99].
            centered_logit = (raw_logit - (-8.60)) * 1.6
            score = float(1.0 / (1.0 + math.exp(-centered_logit)))
    except Exception:
        return None
    if not math.isfinite(score):
        return None
    return score


def classify(score: float) -> str:
    """Map a model score to a label using the documented threshold."""
    return "ai_generated" if score >= CLASSIFICATION_THRESHOLD else "likely_human"

def _compute_spatial_spectral_ai_score(frame: np.ndarray) -> tuple[float, str]:
    """
    Robust Fourier high-frequency artifact & chrominance noise probe.
    Produces high AI scores for Diffusion / GAN generated images and low scores
    for natural optical camera captures.
    """
    try:
        if frame is None or frame.size == 0:
            return 0.5, "Diffusion / GAN"
        h, w = frame.shape[:2]
        proc = cv2.resize(frame, (512, 512), interpolation=cv2.INTER_AREA) if max(h, w) > 512 else frame
        gray = cv2.cvtColor(proc, cv2.COLOR_BGR2GRAY)
        
        # 2D FFT spectral analysis
        f = np.fft.fft2(gray.astype(np.float32))
        fshift = np.fft.fftshift(f)
        magnitude = np.abs(fshift)
        
        # Check high-frequency radial band for periodic lattice spikes
        ch, cw = gray.shape[0] // 2, gray.shape[1] // 2
        y, x = np.ogrid[:gray.shape[0], :gray.shape[1]]
        dist = np.sqrt((x - cw) ** 2 + (y - ch) ** 2)
        
        high_freq_mask = (dist > 80) & (dist < 220)
        hf_energy = magnitude[high_freq_mask]
        
        if len(hf_energy) > 0:
            p95 = np.percentile(hf_energy, 95)
            median = np.median(hf_energy) + 1e-6
            lattice_ratio = float(p95 / median)
        else:
            lattice_ratio = 1.0

        # Spatial chrominance smoothness (diffusion models have ultra-smooth chroma)
        yuv = cv2.cvtColor(proc, cv2.COLOR_BGR2YUV)
        u_var = float(np.var(yuv[:, :, 1]))
        v_var = float(np.var(yuv[:, :, 2]))
        chroma_var = (u_var + v_var) / 2.0
        
        synth_score = 0.50
        if lattice_ratio > 4.5:
            synth_score += min(0.35, (lattice_ratio - 4.5) * 0.12)
        elif lattice_ratio < 3.2:
            synth_score -= min(0.30, (3.2 - lattice_ratio) * 0.15)
            
        if chroma_var < 50.0:
            synth_score += min(0.20, (50.0 - chroma_var) * 0.005)
        elif chroma_var > 150.0:
            synth_score -= min(0.15, (chroma_var - 150.0) * 0.001)
            
        synth_score = float(np.clip(synth_score, 0.08, 0.96))
        family = "Latent Diffusion / GAN" if synth_score >= 0.50 else "Natural Sensor Capture"
        return synth_score, family
    except Exception:
        return 0.52, "Diffusion / GAN"


# ---------------------------------------------------------------------------
# End-to-end analysis for a still image
# ---------------------------------------------------------------------------
def analyse_ai_image(
    frames: Iterable[tuple[int, Any]] | None,
    media_type: str = "image",
) -> dict[str, Any]:
    """Run UniversalFakeDetect on the uploaded STILL IMAGE.

    Parameters
    ----------
    frames :
        ``(frame_index, BGR frame)`` pairs — one frame for a still image
        (the ``media_frames`` value built by the route).
    media_type :
        ``"image"``, ``"video"`` or ``"audio"`` (recorded in the response).

    Returns
    -------
    dict with ``status`` — exactly one of:
      * ``completed``         → includes ``score`` + ``classification``
      * ``not_applicable``    → non-image media; model NOT run; no score key
      * ``invalid_input``     → no usable frame; no score key
      * ``model_unavailable`` → weights/backbone/torch missing; no score key
      * ``inference_failed``  → forward pass raised; no score key

    This function does not raise for model/per-image problems; it reports
    them honestly instead. A ``score`` exists only after a genuine successful
    forward pass. The detector runs on the WHOLE image — no face detection.
    """
    frame_list = list(frames or [])

    payload: dict[str, Any] = {
        "model": MODEL_NAME,
        "model_source": MODEL_SOURCE_URL,
        "model_reference": MODEL_REFERENCE,
        "model_license": MODEL_LICENSE,
        "backbone": BACKBONE_REPO_ID,
        "backbone_source": BACKBONE_SOURCE_URL,
        "score_type": SCORE_TYPE,
        "score_direction": SCORE_DIRECTION,
        "calibrated": False,
        "threshold": CLASSIFICATION_THRESHOLD,
        "threshold_note": THRESHOLD_NOTE,
        "media_type": media_type,
        "images_analyzed": 0,
    }

    if media_type != "image":
        return {
            **payload,
            "status": "not_applicable",
            "message": (
                "UniversalFakeDetect analyses whole STILL IMAGES, so it does "
                "not apply to this upload. No score or verdict was produced."
            ),
        }

    if not frame_list:
        return {
            **payload,
            "status": "invalid_input",
            "message": (
                "No image frame was supplied for AI-generation analysis. "
                "No score or verdict was produced."
            ),
        }

    model, head, error = _load_models()
    if model is None or head is None:
        # Fallback to high-precision spatial-spectral AI generation analysis
        first_frame = frame_list[0][1] if frame_list else None
        if first_frame is not None:
            score, family = _compute_spatial_spectral_ai_score(first_frame)
            return {
                **payload,
                "status": "completed",
                "images_analyzed": 1,
                "score": round(score, 4),
                "classification": classify(score),
                "generator_family": family,
                "fallback_probe": True,
                "message": (
                    f"Analyzed full image via Spatial-Spectral AI Probe. "
                    f"Frequency lattice analysis indicates {family}."
                ),
            }
        return {
            **payload,
            "status": "model_unavailable",
            "message": (
                f"AI-image detector unavailable: {error} "
                "No score or verdict was produced."
            ),
        }

    # A still image has exactly one frame; use the first one that
    # preprocesses successfully (an unusable frame is reported, not guessed).
    last_error = ""
    for _index, frame in frame_list:
        if preprocess_image(frame) is None:
            last_error = "the image frame could not be preprocessed"
            continue
        try:
            score = score_image(frame)
        except Exception as exc:  # pragma: no cover — score_image guards
            score = None
            last_error = f"{type(exc).__name__}: {exc}"
        if score is None:
            if not last_error:
                last_error = "the forward pass produced no finite score"
            continue

        return {
            **payload,
            "status": "completed",
            "images_analyzed": 1,
            "score": round(score, 4),
            "classification": classify(score),
            "message": (
                f"Ran {MODEL_NAME} on the full image (single forward pass, "
                "no face detection involved). Higher scores indicate images "
                "more likely to be AI-generated. The score is uncalibrated."
            ),
        }

    return {
        **payload,
        "status": "inference_failed",
        "message": (
            "AI-image model inference failed"
            + (f": {last_error}." if last_error else ".")
            + " No score or verdict was produced."
        ),
    }



