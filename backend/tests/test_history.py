"""
Tests for the SQLite analysis-history feature.

Covers:
  * store round-trip (save -> list, newest-first ordering, limit clamp),
  * NULL scores for failed blocks - no fabricated numbers,
  * save_analysis never raises on broken storage,
  * GET /api/history and DELETE /api/history over the API,
  * auto-save after a real /api/analyze call,
  * persistence across "restarts" (new connections read old rows),
  * history failures never break the analysis endpoint.

Every test uses the per-test temp DB installed by conftest's autouse
``history_db`` fixture - the developer's real database is never touched.
"""

from __future__ import annotations

import sqlite3

from services.history_store import (
    HistoryStoreError,
    build_record,
    delete_all_analyses,
    list_analyses,
    save_analysis,
)


# ---------------------------------------------------------------------------
# Synthetic API-shaped payloads (clearly synthetic - not model outputs)
# ---------------------------------------------------------------------------
def _fake_completed_response() -> dict:
    """A hand-built response dict shaped exactly like POST /api/analyze."""
    return {
        "status": "processed",
        "media_type": "image",
        "faces_detected": 1,
        "file": {
            "original_name": "synthetic_photo.jpg",
            "saved_as": "synthetic_photo.jpg",
            "media_type": "image",
            "content_type": "image/jpeg",
            "size_bytes": 12345,
            "size_human": "12.1 KB",
        },
        "visual_analysis": {
            "status": "completed",
            "faces_analyzed": 1,
            "score": 0.123,             # synthetic test value, not a model output
            "classification": "real",
            "threshold": 0.7,
        },
        "audio_analysis": {"status": "no_audio"},
        "ai_image_analysis": {
            "status": "completed",
            "score": 0.456,             # synthetic test value
            "classification": "likely_human",
            "threshold": 0.5,
        },
        "multimodal_analysis": {"status": "unavailable"},
    }


def _fake_failed_visual_response() -> dict:
    """Response where the visual block failed - score must be stored as NULL."""
    response = _fake_completed_response()
    response["visual_analysis"] = {
        "status": "inference_failed",
        "message": "synthetic failure for testing",
        # Deliberate bogus score that must NOT be persisted:
        "score": 0.999,
    }
    return response


# ---------------------------------------------------------------------------
# Store unit tests
# ---------------------------------------------------------------------------
def test_build_record_extracts_genuine_fields():
    record = build_record(_fake_completed_response())
    assert record["media_type"] == "image"
    assert record["status"] == "processed"
    assert record["original_name"] == "synthetic_photo.jpg"
    assert record["visual_status"] == "completed"
    assert record["visual_score"] == 0.123
    assert record["visual_classification"] == "real"
    assert record["audio_status"] == "no_audio"
    assert record["audio_score"] is None       # no score when not completed
    assert record["ai_image_score"] == 0.456
    assert record["fused_score"] is None


def test_build_record_failed_block_stores_null_score():
    record = build_record(_fake_failed_visual_response())
    assert record["visual_status"] == "inference_failed"
    # The bogus 0.999 in the failed block must NOT survive:
    assert record["visual_score"] is None


def test_save_and_list_roundtrip(history_db):
    row_id = save_analysis(_fake_completed_response())
    assert isinstance(row_id, int) and row_id >= 1
    items = list_analyses()
    assert len(items) == 1
    item = items[0]
    assert item["id"] == row_id
    assert item["media_type"] == "image"
    assert item["visual_score"] == 0.123
    assert item["ai_image_score"] == 0.456
    assert item["audio_score"] is None
    # created_at is a real ISO timestamp string.
    assert isinstance(item["created_at"], str) and "T" in item["created_at"]


def test_list_newest_first_and_limit(history_db):
    for _ in range(3):
        save_analysis(_fake_completed_response())
    items = list_analyses(limit=2)
    assert len(items) == 2
    assert items[0]["id"] > items[1]["id"]


def test_list_limit_is_clamped(history_db):
    save_analysis(_fake_completed_response())
    # absurd limits fall back to the safe range instead of erroring
    assert len(list_analyses(limit=0)) >= 1
    assert len(list_analyses(limit=10**6)) == 1


def test_persistence_across_connections(history_db):
    """Rows survive closing/reopening - same guarantee as a server restart."""
    save_analysis(_fake_completed_response())
    # Open a raw independent connection, as a fresh process would.
    conn = sqlite3.connect(str(history_db))
    try:
        count = conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
    finally:
        conn.close()
    assert count == 1


def test_delete_all_analyses(history_db):
    save_analysis(_fake_completed_response())
    save_analysis(_fake_completed_response())
    deleted = delete_all_analyses()
    assert deleted == 2
    assert list_analyses() == []
    assert delete_all_analyses() == 0


def test_save_analysis_never_raises_on_broken_storage(history_db, monkeypatch):
    """A history write failure returns None - it must not propagate."""
    monkeypatch.setenv(
        "CLARITY_HISTORY_DB", str(history_db.parent)  # a DIRECTORY, not a file
    )
    assert save_analysis(_fake_completed_response()) is None


def test_list_analyses_raises_honest_error_on_broken_storage(history_db, monkeypatch):
    monkeypatch.setenv("CLARITY_HISTORY_DB", str(history_db.parent))
    try:
        list_analyses()
    except HistoryStoreError:
        pass  # expected honest failure
    else:
        raise AssertionError("expected HistoryStoreError for broken storage")


# ---------------------------------------------------------------------------
# API-level tests (temp DB via the autouse history_db fixture)
# ---------------------------------------------------------------------------
def _tiny_jpeg_bytes() -> bytes:
    """An 8x8 solid-colour JPEG - too small to contain a face."""
    import cv2
    import numpy as np

    image = np.full((8, 8, 3), 128, dtype=np.uint8)
    ok, buffer = cv2.imencode(".jpg", image)
    assert ok
    return buffer.tobytes()


def test_history_starts_empty(client, history_db):
    response = client.get("/api/history")
    assert response.status_code == 200
    body = response.json()
    assert body == {"count": 0, "items": []}


def test_analyze_auto_saves_to_history(client, history_db):
    payload = _tiny_jpeg_bytes()
    response = client.post(
        "/api/analyze",
        files={"file": ("history_probe.jpg", payload, "image/jpeg")},
    )
    assert response.status_code == 200, response.text

    listing = client.get("/api/history")
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert len(items) == 1
    item = items[0]
    assert item["original_name"] == "history_probe.jpg"
    assert item["media_type"] == "image"
    # Honest mirrors of the actual analysis outcome (no-face image):
    assert item["visual_status"] == "no_face_detected"
    assert item["visual_score"] is None
    # AI-image analysis ran on the full still image:
    assert item["ai_image_status"] in ("completed", "model_unavailable")
    if item["ai_image_status"] == "completed":
        assert isinstance(item["ai_image_score"], float)
    else:
        assert item["ai_image_score"] is None


def test_history_survives_app_restart(client, history_db):
    """Rows persist because they live on disk - restart-safe by design."""
    payload = _tiny_jpeg_bytes()
    client.post(
        "/api/analyze",
        files={"file": ("restart_probe.jpg", payload, "image/jpeg")},
    )
    # Simulate a restart: drop the schema cache by opening a raw connection
    # (the API app object is unchanged, but the DB file is what persists).
    conn = sqlite3.connect(str(history_db))
    try:
        count = conn.execute("SELECT COUNT(*) FROM analyses").fetchone()[0]
    finally:
        conn.close()
    assert count == 1
    # And the API still lists it afterwards.
    assert client.get("/api/history").json()["count"] == 1


def test_history_failure_does_not_break_analysis(client, history_db, monkeypatch):
    """Analysis must still succeed when the DB is unwritable."""
    monkeypatch.setenv("CLARITY_HISTORY_DB", str(history_db.parent))
    payload = _tiny_jpeg_bytes()
    response = client.post(
        "/api/analyze",
        files={"file": ("broken_db.jpg", payload, "image/jpeg")},
    )
    assert response.status_code == 200, response.text
    # And the history endpoint answers with an honest 503, not fake data.
    listing = client.get("/api/history")
    assert listing.status_code == 503
    detail = listing.json()["detail"].lower()
    assert "unavailable" in detail


def test_delete_history_via_api(client, history_db):
    payload = _tiny_jpeg_bytes()
    client.post(
        "/api/analyze",
        files={"file": ("clearable.jpg", payload, "image/jpeg")},
    )
    assert client.get("/api/history").json()["count"] == 1

    cleared = client.delete("/api/history")
    assert cleared.status_code == 200
    assert cleared.json()["deleted"] == 1
    assert client.get("/api/history").json()["count"] == 0


def test_history_limit_query_param(client, history_db):
    payload = _tiny_jpeg_bytes()
    for index in range(3):
        client.post(
            "/api/analyze",
            files={"file": (f"multi_{index}.jpg", payload, "image/jpeg")},
        )
    response = client.get("/api/history?limit=2")
    assert response.status_code == 200
    assert response.json()["count"] == 2
    # Invalid limits are rejected honestly by FastAPI's validation.
    assert client.get("/api/history?limit=0").status_code == 422
    assert client.get("/api/history?limit=9999").status_code == 422
