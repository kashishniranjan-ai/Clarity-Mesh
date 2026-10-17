"""
Clarity Mesh — Analysis Routes
===============================
Endpoints for uploading and analysing media files. The pipeline validates
and decodes the upload, samples frames, detects faces (STEP 5), runs the
pretrained visual deepfake model (STEP 6, services/visual_detector.py) and,
fully independently, the pretrained audio deepfake model (STEP 7,
services/audio_detector.py) on the audio track or standalone audio files.
When BOTH of those blocks produce genuine scores, services/multimodal_fusion.py
(STEP 8) fuses them into a separate ``multimodal_analysis`` block — without
running any inference and without ever inventing a value for a missing modality.
"""

import os
import uuid
import time
from pathlib import Path

from fastapi import APIRouter, File, UploadFile, HTTPException

from services.audio_detector import analyse_audio_media
from services.face_processor import analyse_frames
from services.media_processor import (
    MediaProcessingError,
    detect_media_kind,
    process_image,
    process_video,
)
from services.multimodal_fusion import fuse_multimodal_results
from services.visual_detector import analyse_media
from services.ai_image_detector import analyse_ai_image
from services.history_store import save_analysis
from services.forensic_engine import (
    compute_calibrated_ensemble,
    inspect_metadata_signatures,
    perform_ela,
    perform_fft_spectral_analysis,
    perform_noise_and_texture_analysis,
)

router = APIRouter()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# Directory where uploaded files are stored
UPLOAD_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

# Maximum upload size: 50 MB
MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024  # 50 MB

# Supported MIME types for images and videos
SUPPORTED_IMAGE_TYPES = {
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
}

SUPPORTED_VIDEO_TYPES = {
    "video/mp4",
    "video/mpeg",
    "video/quicktime",
    "video/x-msvideo",
    "video/webm",
    "video/x-matroska",
}

# Standalone audio formats intended by the official audio model card
# (".mp3", ".wav", ".flac", ".m4a") plus their common MIME spellings.
SUPPORTED_AUDIO_TYPES = {
    "audio/mpeg",
    "audio/mp3",
    "audio/wav",
    "audio/x-wav",
    "audio/flac",
    "audio/x-flac",
    "audio/mp4",
    "audio/x-m4a",
    "audio/m4a",
}

SUPPORTED_TYPES = (
    SUPPORTED_IMAGE_TYPES | SUPPORTED_VIDEO_TYPES | SUPPORTED_AUDIO_TYPES
)


def _classify_media(content_type: str) -> str:
    """Return 'image', 'video' or 'audio' based on MIME type."""
    if content_type in SUPPORTED_IMAGE_TYPES:
        return "image"
    if content_type in SUPPORTED_VIDEO_TYPES:
        return "video"
    if content_type in SUPPORTED_AUDIO_TYPES:
        return "audio"
    return "unknown"


def _safe_filename(original: str) -> str:
    """
    Generate a collision-free filename that cannot escape the uploads dir.

    We strip the original path components (preventing path traversal),
    keep only the extension, and prepend a UUID + timestamp.
    """
    # Extract just the basename — removes any directory component an
    # attacker might embed (e.g. "../../etc/passwd").
    basename = os.path.basename(original)

    # Keep only the extension
    _, ext = os.path.splitext(basename)
    ext = ext.lower()

    # Build a safe, unique name
    unique_id = uuid.uuid4().hex[:12]
    timestamp = int(time.time())
    return f"{timestamp}_{unique_id}{ext}"


# ---------------------------------------------------------------------------
# POST /api/analyze — Upload media for analysis
# ---------------------------------------------------------------------------
@router.post("/analyze")
async def analyze_upload(file: UploadFile = File(...)):
    """
    Accept an uploaded image or video file, validate it, save it to the
    uploads directory, inspect/preprocess it, and return metadata.

    **This endpoint now runs a real pretrained visual deepfake model.** It
    decodes the media, samples frames, detects faces and feeds the face
    crops to the EfficientNet-B7 model in ``services/visual_detector.py``.

    Pipeline status (STEP 8):
      [done] 1) Pre-processing — decode, frame sampling, face detection
              (services/media_processor.py + face_processor.py, STEP 5)
      [done] 2) Visual deepfake model on the detected face crops
              (services/visual_detector.py, STEP 6 — real model scores,
              honest failure states, never a hardcoded prediction)
      [done] 3) Audio deepfake model on the audio track / audio file
              (services/audio_detector.py, STEP 7 — REAL-class score,
              honest failure states, never a hardcoded prediction)
      [done] 4) Multimodal fusion of the two genuine scores
              (services/multimodal_fusion.py, STEP 8 — runs only when
              BOTH modalities scored; never invents a missing value)
      [done] 5) Persist the detector outputs to the SQLite audit history
              (backend/services/history_store.py)
    """

    # --- 1. Validate content type ----------------------------------------
    content_type = file.content_type or ""
    if content_type not in SUPPORTED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"Unsupported file type: '{content_type}'. "
                f"Accepted image types: {sorted(SUPPORTED_IMAGE_TYPES)}. "
                f"Accepted video types: {sorted(SUPPORTED_VIDEO_TYPES)}. "
                f"Accepted audio types: {sorted(SUPPORTED_AUDIO_TYPES)}."
            ),
        )

    # --- 2. Read file content & enforce size limit -----------------------
    contents = await file.read()
    file_size = len(contents)

    if file_size == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if file_size > MAX_FILE_SIZE_BYTES:
        max_mb = MAX_FILE_SIZE_BYTES / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File too large ({file_size / (1024 * 1024):.1f} MB). Maximum allowed size is {max_mb:.0f} MB.",
        )

    # --- 3. Generate a safe filename & save to disk ----------------------
    safe_name = _safe_filename(file.filename or "upload")
    save_path = UPLOAD_DIR / safe_name

    # Final safety check: resolved path must be inside UPLOAD_DIR
    if not save_path.resolve().is_relative_to(UPLOAD_DIR.resolve()):
        raise HTTPException(status_code=400, detail="Invalid filename.")

    with open(save_path, "wb") as f:
        f.write(contents)

    # --- 4. Build file metadata -------------------------------------------
    media_type = _classify_media(content_type)

    file_info = {
        "original_name": file.filename,
        "saved_as": safe_name,
        "media_type": media_type,          # "image" or "video"
        "content_type": content_type,       # e.g. "image/jpeg"
        "size_bytes": file_size,
        "size_human": (
            f"{file_size / 1024:.1f} KB"
            if file_size < 1024 * 1024
            else f"{file_size / (1024 * 1024):.2f} MB"
        ),
    }

    # --- 5. Visual preprocessing (STEP 5) ---------------------------------
    # Decode the media safely, read its properties, sample frames (video)
    # and detect faces. Corrupt/oversized files raise MediaProcessingError
    # which is converted into a proper HTTP error below.
    # The MIME type is authoritative for audio uploads: an audio/mp4 file must
    # never reach the visual pipeline just because ".mp4" suggests video.
    if media_type == "audio":
        media_kind = "audio"
    else:
        media_kind = detect_media_kind(save_path, fallback=media_type)

    try:
        if media_kind == "image":
            processed = process_image(save_path)
            # An image counts as one processed visual sample.
            media_frames = [(0, processed["image"])]
            face_summary = analyse_frames(media_frames)
            width = processed["width"]
            height = processed["height"]
            video_info = {}

        elif media_kind == "video":
            processed = process_video(save_path)
            media_frames = processed["frames"]
            face_summary = analyse_frames(media_frames)
            width = processed["width"]
            height = processed["height"]
            video_info = {
                "fps": processed["fps"],
                "frame_count": processed["frame_count"],
                "duration_seconds": processed["duration_seconds"],
                "frames_sampled": processed["frames_sampled"],
            }

        elif media_kind == "audio":
            # ─── STEP 7: standalone audio — no visual samples exist here. ──
            # Face/visual state stays explicitly empty; the audio model runs
            # on the file itself further below.
            media_frames = []
            face_summary = {
                "frames_checked": 0,
                "frames_with_faces": 0,
                "faces_detected": 0,
                "boxes": {},
            }
            width = None
            height = None
            video_info = {}

        else:
            raise MediaProcessingError(
                "This file could not be recognised as a supported image or video.",
                status_code=415,
            )
    except MediaProcessingError as exc:
        # The stored file is unusable — remove it so uploads/ stays clean.
        try:
            save_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=exc.status_code, detail=exc.message)

    # Number of visual samples actually processed (image = 1).
    frames_processed = face_summary["frames_checked"]

    # Face-detection result is INFORMATIONAL ONLY. Zero faces is never
    # interpreted as "real" or "fake" — verdicts come solely from the
    # model run below (visual_analysis), never from Haar detection.
    faces_detected = face_summary["faces_detected"]
    if faces_detected > 0:
        face_status = "faces_detected"
        face_message = (
            f"Detected {faces_detected} face(s) across "
            f"{face_summary['frames_with_faces']} of {frames_processed} processed sample(s)."
        )
    else:
        face_status = "no_face_detected"
        face_message = (
            "No face was detected in the processed sample(s). "
            "This is informational only and is NOT a real/deepfake verdict."
        )

    # ─── STEP 6: REAL visual deepfake model inference ─────────────────────
    # The pretrained model runs on the detected face crops. The block
    # reports honest states — completed / no_face_detected /
    # model_unavailable / inference_failed — and a "score" exists ONLY
    # when at least one forward pass genuinely succeeded. This call must
    # never crash the API: any unexpected error becomes a status instead.
    try:
        visual_analysis = analyse_media(
            media_frames, face_summary["boxes"], media_type=media_kind
        )
    except Exception as exc:  # defence in depth
        visual_analysis = {
            "status": "inference_failed",
            "faces_detected": faces_detected,
            "faces_analyzed": 0,
            "frames_analyzed": 0,
            "message": (
                f"Unexpected visual analysis error ({type(exc).__name__}: "
                f"{exc}). No score or verdict was produced."
            ),
        }

    # Standalone audio has no visual content — report an honest
    # not-applicable state instead of "no face found".
    if media_kind == "audio":
        face_status = "not_applicable"
        face_message = (
            "This upload is a standalone audio file, so face detection does "
            "not apply. This is informational only and NOT a real/deepfake "
            "verdict."
        )
        visual_analysis = {
            "status": "not_applicable",
            "faces_detected": 0,
            "faces_analyzed": 0,
            "frames_analyzed": 0,
            "message": (
                "Audio files contain no visual frames; visual deepfake "
                "analysis does not apply to this upload."
            ),
        }

    # ─── STEP 7: REAL audio deepfake model (INDEPENDENT — no fusion) ────────
    # services/audio_detector.py probes the upload for an audio stream with
    # FFmpeg, extracts it to a temp WAV (never modifying the upload) and runs
    # the NII wav2vec-small-anti-deepfake model. Honest states only —
    # completed / not_applicable / no_audio / extraction_failed /
    # unsupported_format / corrupt_audio / weights_unavailable /
    # model_unavailable / inference_failed — and "score" exists ONLY after
    # genuine forward passes. This raw block is kept untouched; the STEP 8
    # fusion below reads it but never modifies or hides it.
    try:
        audio_analysis = analyse_audio_media(save_path, media_type=media_kind)
    except Exception as exc:  # defence in depth
        audio_analysis = {
            "status": "inference_failed",
            "audio_present": False,
            "message": (
                f"Unexpected audio analysis error ({type(exc).__name__}: "
                f"{exc}). No score or verdict was produced."
            ),
        }

    # ─── STEP 7b: AI-generated STILL-IMAGE detector (INDEPENDENT) ───────────
    # services/ai_image_detector.py runs UniversalFakeDetect (CLIP ViT-L/14 +
    # published 768→1 linear probe) over the FULL still image — no face
    # detection, no fusion, completely separate from the EfficientNet-B7
    # face-manipulation block above. Only still images are analysed; videos
    # and audio return an honest "not_applicable" state instead of a score.
    # Honest states: completed / not_applicable / invalid_input /
    # model_unavailable / inference_failed — "score" exists ONLY after a
    # genuine forward pass, and it is UNCALIBRATED (higher = more likely
    # AI-generated), never a guaranteed probability.
    try:
        ai_image_analysis = analyse_ai_image(media_frames, media_type=media_kind)
    except Exception as exc:  # defence in depth
        ai_image_analysis = {
            "status": "inference_failed",
            "media_type": media_kind,
            "images_analyzed": 0,
            "message": (
                f"Unexpected AI-image analysis error ({type(exc).__name__}: "
                f"{exc}). No score or verdict was produced."
            ),
        }

    # ─── STEP 8: multimodal fusion over the two genuine blocks ────────────
    # services/multimodal_fusion.py performs NO model inference — it only
    # combines already-computed results. The visual score is FAKE-oriented
    # and the audio score is REAL-oriented, so the conversion
    # audio_fake_score = 1 - audio_analysis.score happens INSIDE the fusion
    # layer. Fusion runs only when BOTH blocks are "completed" with genuine
    # finite scores in [0, 1]; a missing/failed modality is never replaced
    # by 0, 0.5 or any other invented value (explicit partial / unavailable
    # state instead).
    try:
        multimodal_analysis = fuse_multimodal_results(
            visual_analysis, audio_analysis
        )
    except Exception as exc:  # defence in depth
        multimodal_analysis = {
            "status": "invalid_input",
            "issues": [f"fusion raised {type(exc).__name__}: {exc}."],
            "message": (
                "Multimodal fusion was not performed because the fusion "
                "service raised an unexpected error. No fused score was "
                "produced and both detector blocks remain unchanged."
            ),
        }

    # ─── STEP 9: Multi-Signal Forensic Engine & Calibrated Ensemble ────────
    ela_result = None
    fft_result = None
    noise_result = None
    try:
        if media_frames and len(media_frames) > 0 and media_frames[0][1] is not None:
            first_frame = media_frames[0][1]
            ela_result = perform_ela(first_frame)
            fft_result = perform_fft_spectral_analysis(first_frame)
            noise_result = perform_noise_and_texture_analysis(first_frame)
    except Exception as exc:
        pass

    try:
        metadata_result = inspect_metadata_signatures(save_path)
    except Exception:
        metadata_result = {"status": "failed", "detected_signatures": []}

    try:
        calibrated_ensemble = compute_calibrated_ensemble(
            visual_analysis=visual_analysis,
            audio_analysis=audio_analysis,
            ai_image_analysis=ai_image_analysis,
            ela_result=ela_result,
            fft_result=fft_result,
            noise_result=noise_result,
            metadata_result=metadata_result,
            media_type=media_kind,
        )
    except Exception as exc:
        calibrated_ensemble = {
            "status": "failed",
            "error": str(exc),
            "calibrated_score": None,
            "verdict": "inconclusive",
            "confidence_percent": 0,
        }

    forensic_signals = {
        "ela": ela_result,
        "fft": fft_result,
        "noise": noise_result,
        "metadata": metadata_result,
    }

    response = {
        "status": "processed",
        "message": (
            "Media processed and the deepfake models were run where "
            "applicable. visual_analysis.score exists only when visual "
            "model inference genuinely succeeded; audio_analysis.score "
            "exists only when audio model inference genuinely succeeded. "
            "multimodal_analysis.fused_fake_score exists only when BOTH "
            "modality blocks are completed with genuine scores — a missing "
            "or failed modality is never replaced by an invented value."
        ),
        "file": file_info,
        "media_type": media_kind,          # "image", "video" or "audio"
        **(
            {"width": width, "height": height}
            if media_kind in ("image", "video")
            else {}
        ),
        "frames_processed": frames_processed,
        "faces_detected": faces_detected,
        "face_detection": {
            "status": face_status,         # "faces_detected" | "no_face_detected"
            "frames_with_faces": face_summary["frames_with_faces"],
            "message": face_message,
        },
        **video_info,                      # fps/frame_count/... for videos only

        # ─── STEP 6: visual model result (real inference) ──────────────────
        "visual_analysis": visual_analysis,

        # ─── STEP 7: audio model result (real inference, independent) ──────
        "audio_analysis": audio_analysis,

        # ─── STEP 7b: AI-generated still-image result (real inference) ─────
        "ai_image_analysis": ai_image_analysis,

        # ─── STEP 8: multimodal fusion (pure post-processing) ──────────────
        "multimodal_analysis": multimodal_analysis,

        # ─── STEP 9: Advanced Forensic Signals & Calibrated Ensemble ──────
        "forensic_signals": forensic_signals,
        "calibrated_ensemble": calibrated_ensemble,
    }

    # ─── Analysis history (SQLite, best-effort) ────────────────────────────
    # The complete, honest response is persisted to the local history DB so
    # the frontend History page survives refreshes and backend restarts.
    # save_analysis never raises and returns None on failure — a history
    # problem must never break or delay the analysis response contract.
    save_analysis(response)

    return response
