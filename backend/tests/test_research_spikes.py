"""Tests for research spike endpoints (Source Attribution, Invisible Watermarks / SynthID)."""


def test_source_attribution_endpoint_honest_unavailable(client):
    """POST /api/v2/attribution honestly returns unavailable status and disclaimer."""
    response = client.post("/api/v2/attribution", json={"stored_name": "sample.jpg"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "unavailable"
    assert "requires a specialized classifier" in data["reason"].lower()
    assert "disclaimer" in data


def test_invisible_watermark_synthid_endpoint_honest_unavailable(client):
    """POST /api/v2/watermark honestly returns unavailable status and disclaimer."""
    response = client.post("/api/v2/watermark", json={"stored_name": "sample.jpg"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "unavailable"
    assert "synthid" in data["reason"].lower()
    assert "disclaimer" in data
