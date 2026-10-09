"""
Clarity Mesh — Face Processor
=============================

Detects faces in decoded images/video frames with OpenCV and crops them.

WHAT THIS MODULE DOES
  * runs Haar-cascade face detection on an image or frame
  * returns face bounding boxes
  * crops detected faces for downstream processing
  * reports clearly when a frame contains no face

WHAT THIS MODULE DOES NOT DO
  * it does NOT decide whether a face/frames is real or fake
  * it does NOT produce prediction scores

MODEL INPUT
  The crops returned by :func:`crop_faces` are exactly what the visual
  detector consumes (``services/visual_detector.py``, wired in STEP 6),
  e.g.::

      crops = crop_faces(frame, detect_faces(frame))
      score = vd.score_face_crop(crops[0])   # real model inference
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

# Haar cascade bundled with opencv-python (cv2.data.haarcascades).
CASCADE_FILENAME = "haarcascade_frontalface_default.xml"

# Detection tuning — shared by every call so results stay consistent.
DETECT_SCALE_FACTOR = 1.1
DETECT_MIN_NEIGHBOURS = 5
DETECT_MIN_SIZE_PX = 30

# Cache the loaded classifier: loading the XML on every call is wasteful.
_CASCADE: cv2.CascadeClassifier | None = None
_CASCADE_LOADED = False


def _load_cascade() -> cv2.CascadeClassifier | None:
    """Load (once) and return the Haar cascade, or None if unavailable."""
    global _CASCADE, _CASCADE_LOADED
    if _CASCADE_LOADED:
        return _CASCADE

    _CASCADE_LOADED = True
    try:
        path = f"{cv2.data.haarcascades}{CASCADE_FILENAME}"
        cascade = cv2.CascadeClassifier(path)
        _CASCADE = None if cascade.empty() else cascade
    except Exception:  # pragma: no cover - defensive: never crash the API
        _CASCADE = None
    return _CASCADE


def is_available() -> bool:
    """True when the face detector could be loaded."""
    return _load_cascade() is not None


def detect_faces(image: np.ndarray | None) -> list[dict[str, int]]:
    """
    Detect faces in a BGR image/frame.

    Returns a list of bounding boxes as dicts::

        [{"x": 12, "y": 34, "width": 90, "height": 90}, ...]

    An empty list means "no face detected" — this is purely informational
    and says nothing about whether the media is real or AI-generated.
    """
    if image is None or image.size == 0 or image.shape[0] == 0 or image.shape[1] == 0:
        return []

    cascade = _load_cascade()
    if cascade is None:
        return []

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)

    rectangles = cascade.detectMultiScale(
        gray,
        scaleFactor=DETECT_SCALE_FACTOR,
        minNeighbors=DETECT_MIN_NEIGHBOURS,
        minSize=(DETECT_MIN_SIZE_PX, DETECT_MIN_SIZE_PX),
    )

    boxes = []
    for (x, y, w, h) in rectangles:
        boxes.append({"x": int(x), "y": int(y), "width": int(w), "height": int(h)})
    return boxes


def crop_face(
    image: np.ndarray,
    box: dict[str, int],
    padding_ratio: float = 0.15,
) -> np.ndarray | None:
    """
    Crop one face from ``image`` using ``box``, with a little padding.

    Returns ``None`` when the crop would be empty (e.g. the box lies
    outside the image).
    """
    if image is None or image.size == 0:
        return None

    image_height, image_width = image.shape[:2]
    pad_x = int(box["width"] * padding_ratio)
    pad_y = int(box["height"] * padding_ratio)

    x1 = max(0, box["x"] - pad_x)
    y1 = max(0, box["y"] - pad_y)
    x2 = min(image_width, box["x"] + box["width"] + pad_x)
    y2 = min(image_height, box["y"] + box["height"] + pad_y)

    if x2 <= x1 or y2 <= y1:
        return None
    return image[y1:y2, x1:x2].copy()


def crop_faces(
    image: np.ndarray,
    boxes: list[dict[str, int]],
    padding_ratio: float = 0.15,
) -> list[np.ndarray]:
    """Crop every face in ``boxes``; empty boxes are skipped."""
    crops = []
    for box in boxes:
        crop = crop_face(image, box, padding_ratio=padding_ratio)
        if crop is not None and crop.size > 0:
            crops.append(crop)
    return crops


def analyse_frames(frames: list[tuple[int, np.ndarray]]) -> dict[str, Any]:
    """
    Run face detection over sampled frames and summarise the results.

    Parameters
    ----------
    frames : list of ``(frame_index, frame)`` pairs.

    Returns
    -------
    dict with ``frames_checked``, ``faces_detected`` (total across frames),
    ``frames_with_faces`` and ``boxes`` (per-frame bounding boxes, keyed by
    frame index) — the boxes/crops feed the visual detector (STEP 6).

    A result of ``faces_detected == 0`` is informational only: it never
    implies "real" or "fake".
    """
    frames_checked = 0
    frames_with_faces = 0
    faces_detected = 0
    boxes: dict[int, list[dict[str, int]]] = {}

    for index, frame in frames:
        frame_boxes = detect_faces(frame)
        frames_checked += 1
        faces_detected += len(frame_boxes)
        if frame_boxes:
            frames_with_faces += 1
        boxes[index] = frame_boxes

    return {
        "frames_checked": frames_checked,
        "faces_detected": faces_detected,
        "frames_with_faces": frames_with_faces,
        "boxes": boxes,
    }
