"""
Clarity Mesh — Media Processor
==============================

Validates and inspects uploaded media with OpenCV so a real visual deepfake
model can be plugged in later.

WHAT THIS MODULE DOES
  * detects whether a file is an image or a video
  * safely decodes images (rejecting corrupt / truncated files)
  * reads video metadata: width, height, FPS, frame count, duration
  * samples a bounded, evenly spaced set of frames for processing

WHAT THIS MODULE DOES NOT DO
  * it does NOT run any neural network
  * it does NOT output "real" or "deepfake" verdicts
  * it does NOT invent prediction scores

NEXT-STAGE INPUT
  The decoded image and the sampled frames returned here are exactly the
  input consumed by the visual detector (``services/visual_detector.py``),
  wired into ``backend/routes/analysis.py`` in STEP 6.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Configurable limits — keep a huge upload from causing uncontrolled processing
# ---------------------------------------------------------------------------
def _env_int(name: str, default: int) -> int:
    """Read an integer limit from the environment, falling back to a default."""
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


# Maximum frames sampled per video (spread evenly across the clip).
MAX_VIDEO_SAMPLE_FRAMES = _env_int("CLARITY_MAX_VIDEO_SAMPLE_FRAMES", 16)
# Longest video accepted for processing, in seconds.
MAX_VIDEO_DURATION_SECONDS = _env_int("CLARITY_MAX_VIDEO_DURATION_SECONDS", 3600)
# Largest image accepted, in megapixels.
MAX_IMAGE_MEGAPIXELS = _env_int("CLARITY_MAX_IMAGE_MEGAPIXELS", 40)
# Hard cap on frames read from disk when video metadata is missing/unreliable.
MAX_FRAMES_SCANNED = _env_int("CLARITY_MAX_FRAMES_SCANNED", 600)

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm", ".mpeg", ".mpg"}


class MediaProcessingError(Exception):
    """
    Raised when a file cannot be inspected or decoded.

    Carries an HTTP status so the route can convert it into a proper
    FastAPI error response (422 for undecodable media, 413 for limits).
    """

    def __init__(self, message: str, status_code: int = 422):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def detect_media_kind(path: str | Path, fallback: str = "unknown") -> str:
    """
    Return ``"image"`` or ``"video"`` for a stored file.

    Extension is checked first; if it is missing or ambiguous the caller's
    classification of the upload Content-Type is used as a fallback.
    """
    suffix = Path(path).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    if fallback in ("image", "video"):
        return fallback
    return "unknown"


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------
def process_image(path: str | Path) -> dict[str, Any]:
    """
    Safely decode an image and return its properties.

    Returns a dict with ``kind``, ``width``, ``height`` and ``image``
    (the decoded BGR ndarray, ready for face detection / model inference).

    Raises :class:`MediaProcessingError` if the file cannot be decoded or
    exceeds the configured size limit.
    """
    # cv2.imread returns None instead of raising on undecodable input.
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None or image.size == 0 or image.shape[0] == 0 or image.shape[1] == 0:
        raise MediaProcessingError(
            "The image could not be decoded. The file may be corrupt or truncated."
        )

    height, width = int(image.shape[0]), int(image.shape[1])
    megapixels = (width * height) / 1_000_000
    if megapixels > MAX_IMAGE_MEGAPIXELS:
        raise MediaProcessingError(
            f"Image too large to process ({megapixels:.1f} MP). "
            f"Maximum allowed size is {MAX_IMAGE_MEGAPIXELS} MP.",
            status_code=413,
        )

    return {
        "kind": "image",
        "width": width,
        "height": height,
        "image": image,
    }


# ---------------------------------------------------------------------------
# Videos
# ---------------------------------------------------------------------------
def _evenly_spaced_indices(total: int, count: int) -> list[int]:
    """Pick ``count`` distinct indices spread evenly across ``total`` frames."""
    if total <= 0 or count <= 0:
        return []
    count = min(count, total)
    if count == 1:
        return [total // 2]
    return sorted({round(i * (total - 1) / (count - 1)) for i in range(count)})


def _sample_frames_sequential(
    capture: "cv2.VideoCapture",
    frame_count: int,
    target: int,
) -> tuple[list[tuple[int, np.ndarray]], int]:
    """
    Fallback sampler: read frames from the start with a stride.

    Returns ``(samples, frames_scanned)`` where samples is a list of
    ``(frame_index, frame)`` pairs. Reading is bounded by
    :data:`MAX_FRAMES_SCANNED` so a broken/huge video cannot spin forever.
    """
    stride = max(1, frame_count // target) if frame_count > 0 else 1
    samples: list[tuple[int, np.ndarray]] = []
    scanned = 0
    index = 0

    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
    while scanned < MAX_FRAMES_SCANNED:
        ok, frame = capture.read()
        if not ok:
            break
        if index % stride == 0:
            samples.append((index, frame))
            if len(samples) >= target:
                break
        index += 1
        scanned += 1

    return samples, scanned


def _sample_frames(
    capture: "cv2.VideoCapture",
    frame_count: int,
) -> tuple[list[tuple[int, np.ndarray]], int]:
    """
    Controlled frame sampling.

    Strategy: seek to ``MAX_VIDEO_SAMPLE_FRAMES`` evenly spaced frame indices
    (never every frame). If seeking fails — some containers/codecs do not
    support accurate seeking — fall back to sequential reading with a stride.

    Returns ``(samples, frames_scanned)``.
    """
    target = min(MAX_VIDEO_SAMPLE_FRAMES, frame_count) if frame_count > 0 else MAX_VIDEO_SAMPLE_FRAMES

    if frame_count > 0:
        indices = _evenly_spaced_indices(frame_count, target)
        samples: list[tuple[int, np.ndarray]] = []
        for index in indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, int(index))
            ok, frame = capture.read()
            if not ok:
                samples = []
                break  # seek unreliable → sequential fallback
            samples.append((int(index), frame))
        if len(samples) == len(indices) > 0:
            return samples, len(samples)

    return _sample_frames_sequential(capture, frame_count, target)


def process_video(path: str | Path) -> dict[str, Any]:
    """
    Safely open a video and extract metadata plus a bounded frame sample.

    Returns a dict with ``kind``, ``width``, ``height``, ``fps``,
    ``frame_count``, ``duration_seconds``, ``frames`` (list of
    ``(index, frame)``), ``frames_sampled`` and ``frames_scanned``.

    Raises :class:`MediaProcessingError` if the video cannot be opened,
    contains no decodable frames, or exceeds the configured limits.
    """
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        capture.release()
        raise MediaProcessingError(
            "The video could not be opened. The file may be corrupt or use an unsupported codec."
        )

    try:
        width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)

        if width <= 0 or height <= 0:
            raise MediaProcessingError(
                "The video reported invalid dimensions and may be corrupt."
            )

        duration_seconds = (frame_count / fps) if fps > 0 and frame_count > 0 else 0.0
        if duration_seconds > MAX_VIDEO_DURATION_SECONDS:
            raise MediaProcessingError(
                f"Video too long to process ({duration_seconds / 60:.1f} min). "
                f"Maximum allowed duration is {MAX_VIDEO_DURATION_SECONDS // 60} min.",
                status_code=413,
            )

        # First frame must decode — a cheap, reliable corrupt-file check.
        capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
        first_ok, _ = capture.read()
        if not first_ok:
            raise MediaProcessingError(
                "No frames could be decoded from the video. The file may be corrupt."
            )

        frames, frames_scanned = _sample_frames(capture, frame_count)
        if not frames:
            raise MediaProcessingError(
                "No frames could be decoded from the video. The file may be corrupt."
            )
    finally:
        capture.release()

    return {
        "kind": "video",
        "width": width,
        "height": height,
        "fps": round(fps, 3),
        "frame_count": frame_count,
        "duration_seconds": round(duration_seconds, 3),
        "frames": frames,
        "frames_sampled": len(frames),
        "frames_scanned": frames_scanned,
    }
