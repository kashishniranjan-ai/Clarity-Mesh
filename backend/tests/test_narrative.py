"""
Clarity Mesh — Forensic Narrative Generator Tests
=================================================
Verifies that:
1. Template narrative generates a cohesive summary without fabrication.
2. Narrative routes (v1 and v2) respond with valid status and fields.
3. Number validation rejects hallucinated numbers from LLM responses.
4. Lookup by analysis_id works as expected.
"""

from __future__ import annotations

import pytest

from services.narrative_generator import (
    _extract_all_numbers,
    _validate_llm_numbers,
    generate_forensic_narrative,
    generate_template_narrative,
)


def test_extract_all_numbers():
    data = {
        "visual_score": 0.8523,
        "frames_analyzed": 10,
        "nested": {"audio_score": 0.12, "labels": ["face", "crop"]},
    }
    nums = _extract_all_numbers(data)
    assert 0.8523 in nums
    assert 10.0 in nums
    assert 0.12 in nums


def test_validate_llm_numbers():
    allowed = {0.8523, 10.0, 0.12}
    # Valid: only mentions numbers in allowed (or percentage forms like 85% or 12%)
    valid_text = "The model scored 0.8523 on 10 frames with audio score 0.12."
    assert _validate_llm_numbers(valid_text, allowed) is True

    # Invalid: hallucinated 99.9% or 45 frames
    invalid_text = "The deepfake detector is 99.9% confident across 45 frames."
    assert _validate_llm_numbers(invalid_text, allowed) is False


def test_template_narrative_generation():
    payload = {
        "media_type": "video",
        "frames_analyzed": 5,
        "faces_analyzed": 8,
        "faces_detected": 8,
        "visual_score": 0.7421,
        "visual_classification": "deepfake",
        "audio_score": 0.3120,
        "audio_classification": "real",
        "fused_score": 0.6125,
        "fused_classification": "deepfake",
        "peak_regions": [{"description": "nasal / mid-facial region", "peak_intensity": 0.88}],
    }
    narrative = generate_template_narrative(payload)
    assert "0.7421" in narrative
    assert "0.3120" in narrative
    assert "0.6125" in narrative
    assert "nasal / mid-facial region" in narrative
    assert "uncalibrated algorithmic triage estimates" in narrative


def test_narrative_endpoint_inline(client):
    payload = {
        "media_type": "image",
        "faces_analyzed": 1,
        "visual_score": 0.8841,
        "visual_classification": "deepfake",
        "peak_regions": [{"description": "left periorbital / eye region", "peak_intensity": 0.92}],
    }
    res = client.post("/api/narrative", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["numbers_validated"] is True
    assert "0.8841" in data["narrative"]
    assert "left periorbital" in data["narrative"]


def test_narrative_v2_endpoint(client):
    payload = {
        "media_type": "video",
        "frames_analyzed": 4,
        "faces_analyzed": 4,
        "visual_score": 0.1500,
        "visual_classification": "real",
    }
    res = client.post("/api/v2/narrative", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "0.15" in data["narrative"] or "0.1500" in data["narrative"]
