"""
Clarity Mesh — Security & RBAC Test Suite
=========================================
Tests Argon2id password verification, lockout protection, signed JWT token
issuance, role-based access control (RBAC), and immutable audit trails.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import app
from services.auth_store import init_auth_db
from services.audit_store import init_audit_db


@pytest.mark.no_auth_override
def test_unauthenticated_request_to_protected_route_rejected(client):
    """Endpoints requiring authentication return 401 when token is missing."""
    response = client.get("/api/history")
    assert response.status_code == 401
    assert "Bearer token required" in response.json()["detail"]


@pytest.mark.no_auth_override
def test_invalid_token_rejected(client):
    """Forged or malformed Bearer tokens are rejected with 401."""
    response = client.get(
        "/api/history",
        headers={"Authorization": "Bearer forged.invalid.token"},
    )
    assert response.status_code == 401


@pytest.mark.no_auth_override
def test_registration_always_creates_analyst_role(client):
    """Self-registration cannot grant admin privileges."""
    reg_payload = {
        "email": "infiltrator@test.ai",
        "name": "Intruder",
        "password": "SecurePassword123!",
        "role": "admin",  # Attempts to escalate to admin
    }
    response = client.post("/api/auth/register", json=reg_payload)
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "analyst"  # Forced to analyst
    assert "Tier 2" in body["user"]["clearance"]
    assert "access_token" in body
    assert "refresh_token" in body


@pytest.mark.no_auth_override
def test_login_success_and_refresh_cycle(client):
    """Valid credentials return JWT tokens, and refresh token issues new access token."""
    # Register a new user
    client.post(
        "/api/auth/register",
        json={
            "email": "investigator.jones@claritymesh.ai",
            "name": "Investigator Jones",
            "password": "ValidForensicPass#2026",
        },
    )

    # Login
    login_res = client.post(
        "/api/auth/login",
        json={
            "email": "investigator.jones@claritymesh.ai",
            "password": "ValidForensicPass#2026",
        },
    )
    assert login_res.status_code == 200
    data = login_res.json()
    access_token = data["access_token"]
    refresh_token = data["refresh_token"]

    # Use access token on protected route
    history_res = client.get(
        "/api/history",
        headers={"Authorization": f"Bearer {access_token}"},
    )
    assert history_res.status_code == 200

    # Refresh token exchange
    refresh_res = client.post(
        "/api/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert refresh_res.status_code == 200
    new_access_token = refresh_res.json()["access_token"]
    assert new_access_token != ""

    # New token works
    history_res2 = client.get(
        "/api/history",
        headers={"Authorization": f"Bearer {new_access_token}"},
    )
    assert history_res2.status_code == 200


@pytest.mark.no_auth_override
def test_analyst_forbidden_on_admin_routes(client):
    """Analyst accounts receive 403 Forbidden on administrative endpoints."""
    # Register an analyst
    reg = client.post(
        "/api/auth/register",
        json={
            "email": "junior.analyst@claritymesh.ai",
            "name": "Junior Analyst",
            "password": "AnalystPassword#2026",
        },
    ).json()
    token = reg["access_token"]

    # Try admin telemetry
    telem_res = client.get(
        "/api/admin/telemetry",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert telem_res.status_code == 403
    assert "Administrator clearance required" in telem_res.json()["detail"]

    # Try DELETE history
    del_res = client.delete(
        "/api/history",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert del_res.status_code == 403


@pytest.mark.no_auth_override
def test_admin_access_and_audit_log(client):
    """Admin account can access admin routes, inspect telemetry and view audit logs."""
    init_auth_db()
    init_audit_db()

    # Seed admin account from env vars (no committed defaults)
    from services.auth_store import seed_admin
    import os
    os.environ["ADMIN_EMAIL"] = "admin@claritymesh.ai"
    os.environ["ADMIN_PASSWORD"] = "RootMeshSecure#2026"
    seed_admin("RootMeshSecure#2026")

    admin_login = client.post(
        "/api/auth/login",
        json={
            "email": "admin@claritymesh.ai",
            "password": "RootMeshSecure#2026",
            "role_requested": "admin",
        },
    )
    assert admin_login.status_code == 200
    admin_token = admin_login.json()["access_token"]
    headers = {"Authorization": f"Bearer {admin_token}"}

    # Telemetry
    telem_res = client.get("/api/admin/telemetry", headers=headers)
    assert telem_res.status_code == 200
    telem = telem_res.json()
    assert "cpu_utilization_pct" in telem["system"]
    assert "process_memory_allocated_mb" in telem["system"]
    assert len(telem["models"]) >= 4

    # Audit Trail
    audit_res = client.get("/api/admin/audit", headers=headers)
    assert audit_res.status_code == 200
    logs = audit_res.json()["audit_logs"]
    assert len(logs) >= 1
    actions = [log["action"] for log in logs]
    assert "LOGIN_SUCCESS" in actions


@pytest.mark.no_auth_override
def test_account_lockout_after_repeated_failures(client):
    """5 consecutive bad passwords triggers account lockout."""
    client.post(
        "/api/auth/register",
        json={
            "email": "lockout.target@claritymesh.ai",
            "name": "Lockout Target",
            "password": "ValidPassword#2026",
        },
    )

    # 4 bad attempts
    for _ in range(4):
        res = client.post(
            "/api/auth/login",
            json={"email": "lockout.target@claritymesh.ai", "password": "WrongPassword"},
        )
        assert res.status_code == 401

    # 5th bad attempt triggers lockout
    res5 = client.post(
        "/api/auth/login",
        json={"email": "lockout.target@claritymesh.ai", "password": "WrongPassword"},
    )
    assert res5.status_code == 423
    assert "locked" in res5.json()["detail"].lower()

    # Even correct password is now locked
    res_locked = client.post(
        "/api/auth/login",
        json={"email": "lockout.target@claritymesh.ai", "password": "ValidPassword#2026"},
    )
    assert res_locked.status_code == 423


def test_require_role_helper():
    """require_role enforces matching role or admin clearance, rejecting others."""
    import asyncio
    from services.auth_deps import require_role
    from fastapi import HTTPException

    async def _test():
        analyst_checker = require_role("analyst")
        admin_checker = require_role("admin")
        reviewer_checker = require_role("reviewer")

        analyst_user = {"id": "1", "email": "analyst@test.ai", "role": "analyst"}
        admin_user = {"id": "2", "email": "admin@test.ai", "role": "admin"}

        # Analyst allowed on analyst checker
        assert (await analyst_checker(analyst_user)) == analyst_user
        # Admin allowed everywhere
        assert (await analyst_checker(admin_user)) == admin_user
        assert (await reviewer_checker(admin_user)) == admin_user

        # Analyst forbidden on admin or reviewer checker
        with pytest.raises(HTTPException) as exc_info:
            await admin_checker(analyst_user)
        assert exc_info.value.status_code == 403

        with pytest.raises(HTTPException) as exc_info2:
            await reviewer_checker(analyst_user)
        assert exc_info2.value.status_code == 403

    asyncio.run(_test())


