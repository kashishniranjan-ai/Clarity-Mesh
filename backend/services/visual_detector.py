"""
Clarity Mesh — Visual Deepfake Detector (STEP 6)
=================================================
Runs ONE genuine pretrained deepfake-detection model on face crops produced
by the existing face-processing pipeline. Every score returned by this module
comes from an actual forward pass of the model — nothing is hardcoded.

MODEL
  Name         : DeepfakeDetector — EfficientNet-B7 "Noisy Student"
  Architecture : EfficientNet-B7 binary classifier (one logit per face crop),
                 exported as TorchScript (compatible with torch >=2.6,<2.12).
  Trained by   : Selim Seferbekov — 1st place, Facebook/Meta Deepfake
                 Detection Challenge (DFDC), 2020.
  Weights      : checkpoint "final_777_DeepFakeClassifier_tf_efficientnet_b7_ns
                 _0_31" from the original DFDC-winning solution, republished
                 for facetorch with a verified tensor-level mapping (all 1,202
                 tensors match the author checkpoint exactly).
  Source       : https://huggingface.co/tomas-gajarsky/facetorch-deepfake-efficientnet-b7
                 artifact "model.pt", revision 4acc494f37eb63d7457166eff2acb45c5b04b9a6
                 SHA-256 e36197ae83fa7c050e8ceba267a1f028f2d74d8ad805bf5d5037a26e8ca96c13
  Reference    : https://github.com/selimsef/dfdc_deepfake_challenge (MIT)
  License      : MIT (original code + weights)

INPUT PREPROCESSING (matches the facetorch configuration exactly)
  BGR face crop → RGB → /255 → bilinear resize to 380x380 (antialiased) →
  ImageNet normalization (mean [0.485,0.456,0.406], std [0.229,0.224,0.225])
  → tensor (1,3,380,380).

OUTPUT
  One logit per face crop → sigmoid → "score" in (0,1).
  The score is an UNCALIBRATED MODEL OUTPUT — NOT a guaranteed probability.
  HIGHER SCORE = MORE LIKELY FAKE (confirmed from the original DFDC
  solution's ``confident_strategy`` which treats ``pred > 0.8`` as fake).

DECISION THRESHOLD
  0.7 — the facetorch default for this model
  (PostSigmoidBinary, labels ["Real","Fake"], threshold 0.7).
  score >= 0.7 → "deepfake", score < 0.7 → "real".

AGGREGATION
  Arithmetic mean of the per-face scores across the sampled frames
  (the original DFDC solution's default strategy is np.mean over faces).

HONEST-FAILURE CONTRACT
  * weights unavailable / torch missing      → status="model_unavailable",
                                                NO score, NO classification.
  * no face detected                         → status="no_face_detected",
                                                NO score, NO classification.
                                                (never guessed as "real")
  * every crop's inference raised            → status="inference_failed",
                                                NO score.
  * face detection is NEVER deepfake
    detection; "score" only appears after a successful forward pass.

LIMITATIONS (documented, not hidden)
  * Trained on DFDC (2019-era face-swap/GAN) fakes; newer diffusion-era
    fakes and strong domain shift reduce accuracy.
  * Sigmoid output is uncalibrated — do not quote it as a probability.
  * Haar-cascade crops are frontal-face biased; undetected faces are
    never analyzed.
  * CPU inference ≈ 1.35 s per crop → bounded by CLARITY_VISUAL_MAX_FACES.
  * Not forensic evidence; a research/assistance signal only.

ENVIRONMENT
  CLARITY_VISUAL_MAX_FACES  max face crops analyzed per upload (default 12).
  CLARITY_WEIGHTS_DIR       override directory holding model.pt.
"""

from __future__ import annotations

import hashlib
import math
import os
import threading
import time
from pathlib import Path
from typing import Any, Iterable

import cv2
import numpy as np

from services.face_processor import crop_faces

# ---------------------------------------------------------------------------
# Model identity / provenance (surfaced in API responses for transparency)
# ---------------------------------------------------------------------------
MODEL_NAME = (
    "EfficientNet-B7 DeepfakeDetector "
    "(DFDC winner Selim Seferbekov, facetorch TorchScript export)"
)
MODEL_REPO_ID = "tomas-gajarsky/facetorch-deepfake-efficientnet-b7"
MODEL_REVISION = "4acc494f37eb63d7457166eff2acb45c5b04b9a6"
MODEL_SOURCE_URL = f"https://huggingface.co/{MODEL_REPO_ID}"
MODEL_REFERENCE_URL = "https://github.com/selimsef/dfdc_deepfake_challenge"
MODEL_LICENSE = "MIT"

MODEL_FILENAME = "model.pt"
# SHA-256 published on the model card; verified on every (re)download.
MODEL_SHA256 = (
    "e36197ae83fa7c050e8ceba267a1f028f2d74d8ad805bf5d5037a26e8ca96c13"
)

# ---------------------------------------------------------------------------
# Preprocessing / decision constants (documented above)
# ---------------------------------------------------------------------------
INPUT_SIZE = 380
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
CLASSIFICATION_THRESHOLD = 0.7
SCORE_TYPE = (
    "sigmoid(model_logit) — uncalibrated model score, "
    "NOT a guaranteed probability"
)
THRESHOLD_NOTE = (
    "facetorch default decision threshold for this model "
    "(PostSigmoidBinary, labels ['Real','Fake']); "
    "score >= threshold → 'deepfake'"
)
AGGREGATION_METHOD = (
    "arithmetic mean of per-face sigmoid scores across sampled frames"
)
DEFAULT_MAX_FACES = 12


# ---------------------------------------------------------------------------
# Model loading — lazy, thread-safe singleton with verified weights
# ---------------------------------------------------------------------------
class VisualDetectorError(RuntimeError):
    """Raised when the pretrained model cannot be loaded or verified."""


def _weights_dir() -> Path:
    override = os.getenv("CLARITY_WEIGHTS_DIR")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "weights"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _resolve_weights() -> Path:
    """Return a verified path to ``model.pt``, downloading it if needed.

    The file's SHA-256 must equal :data:`MODEL_SHA256` (published on the
    model card). A corrupt local file triggers exactly one re-download; a
    persistent mismatch raises :class:`VisualDetectorError` — we never run
    weights we could not verify.
    """
    target = _weights_dir() / MODEL_FILENAME

    if target.exists() and _sha256(target) == MODEL_SHA256:
        return target

    try:
        from huggingface_hub import hf_hub_download
    except Exception as exc:  # pragma: no cover - dependency is pinned
        raise VisualDetectorError(
            f"huggingface_hub is not installed ({exc}). "
            "Install backend requirements to enable model download."
        ) from exc

    if target.exists():
        target.unlink()  # corrupt/mismatched local copy → re-download once

    try:
        downloaded = hf_hub_download(
            repo_id=MODEL_REPO_ID,
            revision=MODEL_REVISION,
            filename=MODEL_FILENAME,
            local_dir=str(_weights_dir()),
        )
    except Exception as exc:
        raise VisualDetectorError(
            f"Could not download model weights from {MODEL_SOURCE_URL} "
            f"(repo revision {MODEL_REVISION}): {exc}"
        ) from exc

    path = Path(downloaded)
    if not path.exists() or _sha256(path) != MODEL_SHA256:
        raise VisualDetectorError(
            f"Downloaded weights failed SHA-256 verification "
            f"(expected {MODEL_SHA256[:16]}…). Refusing to run unverified weights."
        )
    return path


# Singleton state (guarded by _LOCK).
_MODEL_LOCK = threading.Lock()
_MODEL: Any = None
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


def _load_model() -> tuple[Any, str | None]:
    """Return ``(model, None)`` on success or ``(None, error)`` on failure.

    The model is loaded exactly once per process, mapped to CPU and put in
    eval mode. A failed attempt is remembered for 60 s so a missing network
    connection cannot hammer the Hugging Face hub on every request.
    """
    global _MODEL, _LOAD_ERROR, _LOAD_ERROR_AT

    if _MODEL is not None:
        return _MODEL, None

    with _MODEL_LOCK:
        if _MODEL is not None:  # double-check after acquiring the lock
            return _MODEL, None

        now = time.time()
        if _LOAD_ERROR is not None and (now - _LOAD_ERROR_AT) < _ERROR_RETRY_SECONDS:
            return None, _LOAD_ERROR

        try:
            torch = _import_torch()
            weights = _resolve_weights()
            model = torch.jit.load(str(weights), map_location="cpu")
            model.eval()  # inference only — no dropout/BN updates
        except VisualDetectorError as exc:
            _LOAD_ERROR = str(exc)
            _LOAD_ERROR_AT = time.time()
            return None, _LOAD_ERROR
        except Exception as exc:
            _LOAD_ERROR = (
                f"Failed to initialise the deepfake model "
                f"({type(exc).__name__}: {exc})."
            )
            _LOAD_ERROR_AT = time.time()
            return None, _LOAD_ERROR

        _MODEL = model
        _LOAD_ERROR = None
        return _MODEL, None


def model_status() -> dict[str, Any]:
    """Lightweight health probe used by tests/diagnostics."""
    model, error = _load_model()
    return {
        "model": MODEL_NAME,
        "available": model is not None,
        "error": error,
        "source": MODEL_SOURCE_URL,
        "license": MODEL_LICENSE,
    }


# ---------------------------------------------------------------------------
# Preprocessing + single-crop inference
# ---------------------------------------------------------------------------
def preprocess_face(crop: Any):
    """Convert a BGR face crop into the model input tensor (1,3,380,380).

    Mirrors the facetorch configuration exactly: RGB conversion, /255,
    bilinear resize with antialiasing, ImageNet normalization.

    Returns ``None`` for any input that is not a usable image array —
    invalid input is handled safely and never raises.
    """
    if crop is None or not isinstance(crop, np.ndarray):
        return None
    if crop.size == 0 or crop.ndim not in (2, 3):
        return None
    try:
        if crop.ndim == 2:
            rgb = cv2.cvtColor(crop, cv2.COLOR_GRAY2RGB)
        elif crop.shape[2] == 4:
            rgb = cv2.cvtColor(crop, cv2.COLOR_BGRA2RGB)
        elif crop.shape[2] == 3:
            rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
        else:
            return None

        torch = _import_torch()
        tensor = (
            torch.from_numpy(np.ascontiguousarray(rgb))
            .permute(2, 0, 1)
            .unsqueeze(0)
            .float()
            / 255.0
        )
        # bilinear + antialias == torchvision Resize(380, antialias=True)
        tensor = torch.nn.functional.interpolate(
            tensor, size=(INPUT_SIZE, INPUT_SIZE),
            mode="bilinear", antialias=True,
        )
        mean = torch.tensor(IMAGENET_MEAN).view(1, 3, 1, 1)
        std = torch.tensor(IMAGENET_STD).view(1, 3, 1, 1)
        return (tensor - mean) / std
    except Exception:
        return None


def score_face_crop(crop: Any) -> float | None:
    """Run the model on ONE face crop → sigmoid score in (0,1), else ``None``.

    ``None`` means "no score could be produced" (missing model, invalid
    crop, or an inference exception). Callers must never treat ``None``
    as 0.0 — there simply is no result in that case.
    """
    model, _error = _load_model()
    if model is None:
        return None
    tensor = preprocess_face(crop)
    if tensor is None:
        return None
    try:
        torch = _import_torch()
        with torch.inference_mode():  # no autograd graph — memory/speed
            logits = model(tensor).reshape(-1)
            score = float(torch.sigmoid(logits[0]).item())
    except Exception:
        return None
    if not math.isfinite(score):
        return None
    return score


def classify(score: float) -> str:
    """Map a model score to a label using the documented threshold."""
    return "deepfake" if score >= CLASSIFICATION_THRESHOLD else "real"


def _per_frame_means(
    scored: list[tuple[int, float] | tuple[int, float, dict[str, int]]],
    fps: float = 0.0,
) -> list[dict[str, Any]]:
    """Group per-crop pairs by frame (mean within frame).

    Powers the frontend video timeline: every entry is genuine model output
    aggregated per sampled frame — never interpolated or invented.
    Includes timestamp_s (calculated from frame / fps) and top_face_box.
    """
    buckets: dict[int, list[tuple[float, dict[str, int] | None]]] = {}
    for item in scored:
        if len(item) >= 3:
            index, score, box = item[0], item[1], item[2]
        else:
            index, score = item[0], item[1]
            box = None
        buckets.setdefault(int(index), []).append((float(score), box))

    result: list[dict[str, Any]] = []
    for frame, pairs in sorted(buckets.items()):
        scores = [p[0] for p in pairs]
        mean_score = round(sum(scores) / len(scores), 4)
        best_pair = max(pairs, key=lambda p: p[0])
        top_box = best_pair[1]
        timestamp_s = round(float(frame) / float(fps), 3) if fps > 0 else 0.0
        result.append({
            "frame": frame,
            "score": mean_score,
            "timestamp_s": timestamp_s,
            "top_face_box": top_box,
        })
    return result


# ---------------------------------------------------------------------------
# End-to-end analysis over the sampled frames
# ---------------------------------------------------------------------------
def _env_int(name: str, default: int) -> int:
    """Read an integer configuration value from the environment."""
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _evenly_spaced(count: int, limit: int) -> list[int]:
    """Indices of ``count`` items to keep, spread evenly when over ``limit``."""
    if count <= limit:
        return list(range(count))
    if limit <= 1:
        return [0]
    return sorted({round(i * (count - 1) / (limit - 1)) for i in range(limit)})


def analyse_media(
    frames: Iterable[tuple[int, np.ndarray]] | None,
    boxes_by_frame: dict[int, list[dict[str, int]]] | None,
    media_type: str = "image",
    fps: float = 0.0,
) -> dict[str, Any]:
    """Run the visual deepfake model over detected faces in sampled frames.

    Parameters
    ----------
    frames :
        ``(frame_index, BGR frame)`` pairs — one frame per image, the
        sampled frames for videos (media_processor output).
    boxes_by_frame :
        per-frame face boxes keyed by frame index (face_processor output).
    media_type :
        ``"image"`` or ``"video"`` (recorded in the response).
    fps :
        Video frames per second (for computing accurate timestamps).

    Returns
    -------
    dict with ``status`` — exactly one of:
      * ``completed``         → includes ``score`` + ``classification``
      * ``no_face_detected``  → model NOT run; no score key at all
      * ``model_unavailable`` → weights/torch missing; no score key
      * ``inference_failed``  → every crop raised; no score key

    This function does not raise for model/per-crop problems; it reports
    them honestly instead. A ``score`` exists only after at least one
    successful forward pass.
    """
    frame_list = list(frames or [])
    boxes_by_frame = boxes_by_frame or {}

    faces_detected = sum(len(boxes or []) for boxes in boxes_by_frame.values())
    payload: dict[str, Any] = {
        "model": MODEL_NAME,
        "model_source": MODEL_SOURCE_URL,
        "model_reference": MODEL_REFERENCE_URL,
        "model_license": MODEL_LICENSE,
        "score_type": SCORE_TYPE,
        "threshold": CLASSIFICATION_THRESHOLD,
        "threshold_note": THRESHOLD_NOTE,
        "aggregation": AGGREGATION_METHOD,
        "media_type": media_type,
        "frames_sampled": len(frame_list),
        "faces_detected": faces_detected,
        "faces_analyzed": 0,
        "frames_analyzed": 0,
    }

    # 1) Crop every detected face (padded crops from face_processor).
    candidates: list[tuple[int, np.ndarray, dict[str, int]]] = []
    for index, frame in frame_list:
        boxes = boxes_by_frame.get(index, []) or []
        crops = crop_faces(frame, boxes)
        for crop, box in zip(crops, boxes):
            candidates.append((index, crop, box))

    if not candidates:
        return {
            **payload,
            "status": "no_face_detected",
            "message": (
                "No face available for visual AI analysis: no face was "
                "detected in the processed samples, so the deepfake model "
                "was not run. This is NOT a real/deepfake verdict."
            ),
        }

    # 2) The model itself must load (SHA-256-verified weights).
    model, error = _load_model()
    if model is None:
        return {
            **payload,
            "status": "model_unavailable",
            "message": (
                f"Visual deepfake model unavailable: {error} "
                "No score or verdict was produced."
            ),
        }

    # 3) Bound CPU work (≈1.35 s/crop) — evenly spaced, deterministic.
    limit = max(1, _env_int("CLARITY_VISUAL_MAX_FACES", DEFAULT_MAX_FACES))
    keep = _evenly_spaced(len(candidates), limit)
    selected = [candidates[i] for i in keep]
    skipped_by_cap = len(candidates) - len(selected)

    # 4) Per-crop inference — one failing crop never breaks the rest.
    scored: list[tuple[int, float, dict[str, int]]] = []
    failed = 0
    last_error = ""
    for index, crop, box in selected:
        try:
            score = score_face_crop(crop)
        except Exception as exc:  # pragma: no cover — score_face_crop guards
            score = None
            last_error = f"{type(exc).__name__}: {exc}"
        if score is None:
            failed += 1
        else:
            scored.append((index, score, box))

    if not scored:
        return {
            **payload,
            "faces_skipped_by_cap": skipped_by_cap,
            "faces_failed": failed,
            "status": "inference_failed",
            "message": (
                "Model inference failed for every face crop"
                + (f": {last_error}" if last_error else ".")
                + " No score or verdict was produced."
            ),
        }

    scores = [score for _, score, _ in scored]
    frames_used = len({index for index, _, _ in scored})
    mean_score = sum(scores) / len(scores)
    return {
        **payload,
        "status": "completed",
        "faces_analyzed": len(scored),
        "faces_skipped_by_cap": skipped_by_cap,
        "faces_failed": failed,
        "frames_analyzed": frames_used,
        "score": round(mean_score, 4),
        "classification": classify(mean_score),
        "per_face_scores": [round(value, 4) for value in scores],
        "per_frame_scores": _per_frame_means(scored, fps=fps),
        "per_frame_note": (
            "mean of per-face scores within each sampled frame; "
            "frame time = frame_index / video fps"
        ),
        "message": (
            f"Ran {MODEL_NAME} on {len(scored)} face crop(s) across "
            f"{frames_used} frame(s); aggregated by mean of per-face scores."
        ),
    }
