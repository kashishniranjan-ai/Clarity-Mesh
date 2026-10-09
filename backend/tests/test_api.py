"""
STEP 6 API tests — POST /api/analyze with the real model wired in,
plus regressions for the existing validation contract.

  * health endpoint still responds
  * valid image  → 200 with visual_analysis completed + genuine score
  * valid video  → 200 with visual_analysis completed (bounded faces)
  * no-face image→ 200 with honest no_face_detected state and NO score
  * corrupt image → 422, unsupported type → 415, empty → 400,
    oversized image → 413
"""

from __future__ import annotations

import io

import cv2
import numpy as np


def test_health_endpoint(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert "Clarity Mesh" in body["service"]


def test_analyze_image_returns_real_model_score(client, face_image_path):
    with open(face_image_path, "rb") as handle:
        response = client.post(
            "/api/analyze",
            files={"file": (face_image_path.name, handle, "image/jpeg")},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "processed"
    assert body["media_type"] == "image"
    assert body["faces_detected"] >= 1

    visual = body["visual_analysis"]
    assert visual["status"] == "completed"
    assert visual["faces_analyzed"] >= 1
    assert isinstance(visual["score"], float) and 0.0 < visual["score"] < 1.0
    assert visual["classification"] in ("real", "deepfake")
    assert visual["classification"] == (
        "deepfake" if visual["score"] >= visual["threshold"] else "real"
    )
    assert "EfficientNet-B7" in visual["model"]
    assert visual["model_source"].startswith("https://huggingface.co/")
    assert "uncalibrated" in visual["score_type"].lower()
    assert visual["aggregation"]
    assert visual["model_license"] == "MIT"


def test_analyze_video_returns_real_model_score(client, face_video_path, monkeypatch):
    monkeypatch.setenv("CLARITY_VISUAL_MAX_FACES", "2")  # keep CPU time low
    with open(face_video_path, "rb") as handle:
        response = client.post(
            "/api/analyze",
            files={"file": (face_video_path.name, handle, "video/mp4")},
        )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["media_type"] == "video"
    visual = body["visual_analysis"]
    assert visual["status"] == "completed"
    assert 1 <= visual["faces_analyzed"] <= 2
    assert visual["frames_analyzed"] >= 1
    assert 0.0 < visual["score"] < 1.0
    assert visual["classification"] in ("real", "deepfake")


def test_no_face_returns_honest_state_without_score(client):
    # Smooth gradient — structurally no face, so Haar must find nothing.
    gradient = np.tile(np.linspace(0, 255, 640, dtype=np.uint8), (480, 1))
    image = cv2.cvtColor(gradient, cv2.COLOR_GRAY2BGR)
    ok, buffer = cv2.imencode(".png", image)
    assert ok
    response = client.post(
        "/api/analyze",
        files={"file": ("noface.png", io.BytesIO(buffer.tobytes()), "image/png")},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["faces_detected"] == 0
    visual = body["visual_analysis"]
    assert visual["status"] == "no_face_detected"
    assert "score" not in visual
    assert "classification" not in visual
    assert "NOT a real/deepfake verdict" in visual["message"]


def test_corrupt_image_returns_422(client):
    response = client.post(
        "/api/analyze",
        files={"file": ("broken.png", io.BytesIO(b"this is not a png"), "image/png")},
    )
    assert response.status_code == 422


def test_unsupported_content_type_returns_415(client):
    response = client.post(
        "/api/analyze",
        files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
    )
    assert response.status_code == 415


def test_empty_file_returns_400(client):
    response = client.post(
        "/api/analyze",
        files={"file": ("empty.png", io.BytesIO(b""), "image/png")},
    )
    assert response.status_code == 400


def test_oversized_image_returns_413(client, monkeypatch):
    # Lower the megapixel limit instead of building a 40 MP image.
    from services import media_processor

    monkeypatch.setattr(media_processor, "MAX_IMAGE_MEGAPIXELS", 1)
    image = np.zeros((1500, 2000, 3), dtype=np.uint8)  # 3 MP
    ok, buffer = cv2.imencode(".png", image)
    assert ok
    response = client.post(
        "/api/analyze",
        files={"file": ("big.png", io.BytesIO(buffer.tobytes()), "image/png")},
    )
    assert response.status_code == 413
