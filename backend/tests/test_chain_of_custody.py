"""Tests for cryptographic chain-of-custody service and verification."""

import sqlite3
import pytest
from services.chain_of_custody import (
    _connect,
    append_custody_event,
    compute_entry_hash,
    list_custody_events,
    verify_chain,
)


def test_chain_hash_deterministic():
    """Identical canonical fields must yield identical SHA-256 hashes."""
    h1 = compute_entry_hash("2026-10-18T12:00:00Z", "CASE_CREATED", "case:1", '{"x": 1}', "prev123")
    h2 = compute_entry_hash("2026-10-18T12:00:00Z", "CASE_CREATED", "case:1", '{"x": 1}', "prev123")
    assert h1 == h2
    assert len(h1) == 64

    # Any field change alters hash
    h3 = compute_entry_hash("2026-10-18T12:00:01Z", "CASE_CREATED", "case:1", '{"x": 1}', "prev123")
    assert h1 != h3


def test_chain_creation_and_integrity():
    """Verify sequential events link properly and verify_chain reports intact."""
    e1 = append_custody_event(
        action="CASE_CREATED",
        actor={"email": "alice@forensics.org", "role": "analyst"},
        target="case:101",
        details={"title": "Deepfake Video"},
    )
    assert e1["prev_hash"] == ""  # Genesis has no predecessor
    assert e1["entry_hash"]

    e2 = append_custody_event(
        action="EVIDENCE_LINKED",
        actor={"email": "alice@forensics.org", "role": "analyst"},
        target="case:101",
        details={"analysis_id": 42},
    )
    assert e2["prev_hash"] == e1["entry_hash"]

    e3 = append_custody_event(
        action="CASE_ASSIGNED",
        actor={"email": "admin@clarity.mesh", "role": "admin"},
        target="case:101",
        details={"assigned_to": "bob@forensics.org"},
    )
    assert e3["prev_hash"] == e2["entry_hash"]

    # Verify chain
    report = verify_chain()
    assert report["intact"] is True
    assert report["total_entries"] == 3
    assert report["verified_entries"] == 3
    assert report["first_broken_id"] is None


def test_chain_verification_detects_tamper():
    """Tampering with an existing entry breaks the cryptographic chain."""
    e1 = append_custody_event(action="A1", target="case:1")
    e2 = append_custody_event(action="A2", target="case:1")
    e3 = append_custody_event(action="A3", target="case:1")

    # Manually tamper with entry #2 in the database
    conn = _connect()
    try:
        conn.execute("UPDATE custody_chain SET details = '{\"tampered\": true}' WHERE id = ?", (e2["id"],))
        conn.commit()
    finally:
        conn.close()

    report = verify_chain()
    assert report["intact"] is False
    assert report["first_broken_id"] == e2["id"]
    assert "tampered" in report["first_broken_reason"].lower() or "mismatch" in report["first_broken_reason"].lower()


def test_chain_empty_returns_intact():
    """An empty chain is vacuously intact."""
    report = verify_chain()
    assert report["intact"] is True
    assert report["total_entries"] == 0


def test_list_custody_events_filtering():
    """list_custody_events supports filtering by target and limits."""
    append_custody_event(action="A1", target="case:1")
    append_custody_event(action="A2", target="case:2")
    append_custody_event(action="A3", target="case:1")

    case1_events = list_custody_events(target="case:1")
    assert len(case1_events) == 2
    assert all(e["target"] == "case:1" for e in case1_events)

    all_events = list_custody_events()
    assert len(all_events) == 3


def test_admin_custody_api_endpoints(client):
    """Admin custody endpoints return events and verification report."""
    append_custody_event(action="TEST_ACTION", target="test:1")

    res = client.get("/api/admin/custody")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["total"] >= 1

    res_verify = client.get("/api/admin/custody/verify")
    assert res_verify.status_code == 200
    verify_data = res_verify.json()
    assert verify_data["status"] == "success"
    assert verify_data["verification"]["intact"] is True
