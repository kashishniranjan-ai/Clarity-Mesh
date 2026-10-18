"""
Clarity Mesh — PDF report & chain-of-custody tests.
Verifies the reportlab PDF endpoint (magic bytes, headers), 404 for unknown
records, and the custody builder (source-file SHA-256 recompute, honest
unavailable state, deterministic record-integrity hash).
"""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from services.history_store import save_analysis
from services import report_service


def _sample_response(stored_name: str | None = "stored_demo.jpg") -> dict:
    return {
        "status": "processed",
        "media_type": "image",
        "file": {
            "original_name": "demo.jpg",
            "saved_as": stored_name,
            "media_type": "image",
            "content_type": "image/jpeg",
            "size_bytes": 1024,
        },
        "faces_detected": 1,
        "visual_analysis": {
            "status": "completed", "score": 0.8123, "classification": "deepfake",
        },
        "audio_analysis": {"status": "not_applicable"},
        "ai_image_analysis": {"status": "model_unavailable"},
        "multimodal_analysis": {"status": "insufficient_modalities"},
        "calibrated_ensemble": {"status": "completed", "calibrated_score": 0.77},
    }


def _saved_record(client) -> int:
    analysis_id = save_analysis(_sample_response())
    assert analysis_id is not None
    return analysis_id


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------
def test_pdf_endpoint_returns_pdf_with_custody_headers(client):
    analysis_id = _saved_record(client)
    response = client.get(f"/api/reports/{analysis_id}/pdf")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers["content-disposition"]
    assert f"clarity-mesh-report-{analysis_id}.pdf" in response.headers["content-disposition"]
    integrity = response.headers.get("x-clarity-record-integrity-sha256", "")
    assert re.fullmatch(r"[0-9a-f]{64}", integrity)
    body = response.content
    assert body.startswith(b"%PDF")
    assert len(body) > 1000


def test_pdf_endpoint_unknown_id_is_404(client):
    response = client.get("/api/reports/999999/pdf")
    assert response.status_code == 404


def test_pdf_unauthenticated_is_401():
    from fastapi.testclient import TestClient
    from main import app

    with TestClient(app) as anon:
        # The autouse conftest override applies to test functions, but the
        # override still injects a user; clear it to emulate an anonymous call.
        saved = dict(app.dependency_overrides)
        try:
            from services.auth_deps import get_current_user

            app.dependency_overrides.pop(get_current_user, None)
            response = anon.get("/api/reports/1/pdf")
        finally:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(saved)
    # With no override the real dependency requires a Bearer token → 401/403.
    assert response.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Chain-of-custody builder
# ---------------------------------------------------------------------------
def test_custody_source_file_hash_recomputed(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(report_service, "UPLOADS_DIR", uploads)

    payload = b"clarity-source-bytes-0123456789"
    (uploads / "stored.jpg").write_bytes(payload)

    record = {"id": 7, "stored_name": "stored.jpg", "visual_score": 0.5}
    operator = {"id": "usr_1", "email": "analyst@claritymesh.ai", "name": "A", "role": "analyst"}
    custody = report_service.compute_chain_of_custody(record, operator)

    source = custody["source_file"]
    assert source["available"] is True
    assert source["sha256"] == hashlib.sha256(payload).hexdigest()
    assert custody["hash_algorithm"] == "sha256"
    assert re.fullmatch(r"[0-9a-f]{64}", custody["record_integrity_sha256"])
    assert custody["operator"]["email"] == "analyst@claritymesh.ai"
    assert custody["generated_at_utc"].endswith("Z") or "+" in custody["generated_at_utc"]

    # Removing the file flips to an honest unavailable state — never a guess.
    (uploads / "stored.jpg").unlink()
    custody2 = report_service.compute_chain_of_custody(record, operator)
    assert custody2["source_file"]["available"] is False
    assert "reason" in custody2["source_file"]
    # Record-integrity hash is independent of the source file.
    assert custody2["record_integrity_sha256"] == custody["record_integrity_sha256"]


def test_custody_rejects_traversal_stored_names(monkeypatch):
    record = {"id": 8, "stored_name": "../../etc/passwd"}
    custody = report_service.compute_chain_of_custody(record, {"email": "x@y.z"})
    assert custody["source_file"]["available"] is False


def test_build_pdf_is_plain_bytes_with_magic():
    record = {
        "id": 42,
        "created_at": "2026-01-01T00:00:00+00:00",
        "original_name": "x.jpg",
        "stored_name": "x.jpg",
        "media_type": "image",
        "status": "processed",
        "faces_detected": 1,
        "visual_status": "failed",
        "visual_score": None,
        "visual_classification": None,
        "audio_status": "not_applicable",
        "audio_score": None,
        "audio_classification": None,
        "ai_image_status": "not_applicable",
        "ai_image_score": None,
        "ai_image_classification": None,
        "multimodal_status": "not_applicable",
        "fused_score": None,
        "multimodal_classification": None,
    }
    custody = report_service.compute_chain_of_custody(record, {"email": "op@claritymesh.ai"})
    pdf = report_service.build_report_pdf(record, custody)
    assert isinstance(pdf, bytes)
    assert pdf.startswith(b"%PDF")
    assert len(pdf) > 1000
