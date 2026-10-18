"""
Tests for Adversarial Robustness Stress-Testing Harness (FGSM / PGD):
  POST /api/v2/robustness
"""

from __future__ import annotations

import base64
import cv2
import numpy as np
import pytest
from starlette.testclient import TestClient

from main import app
import services.adversarial_robustness as adv_mod
from services.auth_deps import get_current_user


def _mock_user():
    return {"user_id": 1, "username": "analyst", "role": "analyst"}


def _make_dummy_image_b64() -> str:
    img = np.zeros((100, 100, 3), dtype=np.uint8)
    _, buf = cv2.imencode(".jpg", img)
    return base64.b64encode(buf.tobytes()).decode("utf-8")


def test_robustness_disabled_by_default(monkeypatch):
    monkeypatch.delenv("CLARITY_ENABLE_ROBUSTNESS", raising=False)
    dummy_b64 = _make_dummy_image_b64()
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = _mock_user

    try:
        res = client.post("/api/v2/robustness", json={"image_b64": dummy_b64})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "disabled"
        assert "disclaimer" in data
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_robustness_no_face_detected(monkeypatch):
    monkeypatch.setenv("CLARITY_ENABLE_ROBUSTNESS", "true")
    dummy_b64 = _make_dummy_image_b64()
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = _mock_user

    try:
        res = client.post("/api/v2/robustness", json={"image_b64": dummy_b64})
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "no_face_detected"
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_robustness_fgsm_and_pgd_mocked(monkeypatch):
    monkeypatch.setenv("CLARITY_ENABLE_ROBUSTNESS", "true")
    # Mock face detection so a face is found on dummy image
    monkeypatch.setattr(adv_mod, "detect_faces", lambda img: [{"x": 10, "y": 10, "width": 50, "height": 50}])

    dummy_b64 = _make_dummy_image_b64()
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = _mock_user

    try:
        # 1. Test FGSM
        res = client.post(
            "/api/v2/robustness",
            json={
                "image_b64": dummy_b64,
                "attack": "fgsm",
                "epsilons": [0.01, 0.05],
            },
        )
        assert res.status_code == 200
        data = res.json()
        assert data["status"] == "ok"
        assert data["attack"] == "fgsm"
        assert "baseline_score" in data
        assert len(data["results"]) == 2
        assert data["results"][0]["epsilon"] == 0.01
        assert "perturbed_score" in data["results"][0]
        assert "delta" in data["results"][0]
        assert "disclaimer" in data

        # 2. Test PGD
        res_pgd = client.post(
            "/api/v2/robustness",
            json={
                "image_b64": dummy_b64,
                "attack": "pgd",
                "epsilons": [0.02],
                "pgd_steps": 2,
                "pgd_alpha": 0.01,
            },
        )
        assert res_pgd.status_code == 200
        data_pgd = res_pgd.json()
        assert data_pgd["status"] == "ok"
        assert data_pgd["attack"] == "pgd"
        assert len(data_pgd["results"]) == 1
    finally:
        app.dependency_overrides.pop(get_current_user, None)
