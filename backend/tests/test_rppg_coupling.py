"""
Tests for Physio-Acoustic Coupling (rPPG & Speech Synchronization):
  POST /api/v2/rppg
"""

from __future__ import annotations

import numpy as np
import pytest
from starlette.testclient import TestClient

from main import app
import services.rppg_coupling as rppg_mod
from services.auth_deps import get_current_user


def _mock_user():
    return {"user_id": 1, "username": "analyst", "role": "analyst"}


def test_rppg_bandpass_filter():
    fps = 30.0
    t = np.linspace(0, 5, int(5 * fps), endpoint=False)
    # 1.2 Hz pulse (72 BPM) + 0.1 Hz baseline wander + 10 Hz high-frequency noise
    sig = np.sin(2 * np.pi * 1.2 * t) + 2.0 * np.sin(2 * np.pi * 0.1 * t) + 0.5 * np.sin(2 * np.pi * 10.0 * t)

    filtered = rppg_mod._bandpass_filter(sig, fps, low_hz=0.7, high_hz=3.5)
    assert len(filtered) == len(sig)
    # High frequency and DC baseline wander should be attenuated relative to 1.2 Hz signal
    assert np.abs(np.mean(filtered)) < 0.1


def test_rppg_chrom_extraction_synthetic():
    fps = 30.0
    n = 150  # 5 seconds
    t = np.linspace(0, 5, n, endpoint=False)
    # 1.2 Hz pulse (72 BPM)
    pulse = 0.05 * np.sin(2 * np.pi * 1.2 * t)

    r = 120.0 + 10.0 * pulse
    g = 90.0 + 15.0 * pulse  # Green channel carries strongest PPG
    b = 80.0 + 5.0 * pulse

    signal, bpm = rppg_mod._extract_chrom_rppg(r, g, b, fps)
    assert len(signal) == n
    assert bpm is not None
    # Estimated BPM should be close to 72 BPM (+- 5 BPM)
    assert 65.0 <= bpm <= 80.0


def test_rppg_disabled_by_default(monkeypatch):
    monkeypatch.delenv("CLARITY_ENABLE_RPPG", raising=False)
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = _mock_user

    try:
        # Create a non-existent or dummy file test
        res = client.post("/api/v2/rppg", json={"stored_name": "test_missing.mp4"})
        assert res.status_code == 404
    finally:
        app.dependency_overrides.pop(get_current_user, None)


def test_rppg_disclaimer_present():
    result = rppg_mod.extract_rppg_coupling("non_existent_file.mp4", force_enable=True)
    assert "disclaimer" in result
    assert "EXPERIMENTAL" in result["disclaimer"]
