"""
Clarity Mesh — Section 5 Hardening Regression Tests
====================================================
JWT ephemeral fallback, security headers, strict CORS, trusted-proxy IP
handling, auth input validation, and fail-closed production boot.
"""

from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient


@pytest.mark.no_auth_override
def test_security_headers_present_on_health(client):
    """Every response carries the hardening headers (nosniff/DENY/HSTS/etc)."""
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert "strict-origin" in res.headers.get("Referrer-Policy", "")
    assert "camera=()" in res.headers.get("Permissions-Policy", "")
    assert "max-age=" in res.headers.get("Strict-Transport-Security", "")


@pytest.mark.no_auth_override
def test_refresh_rejects_garbage_token_shape(client):
    """Oversized / undersized refresh tokens fail validation (422/401)."""
    res = client.post("/api/auth/refresh", json={"refresh_token": "x"})
    assert res.status_code in (401, 422)
    res2 = client.post("/api/auth/refresh", json={"refresh_token": "x" * 5000})
    assert res2.status_code in (401, 422)


@pytest.mark.no_auth_override
def test_refresh_rejects_wrong_token_type(client):
    """An access token cannot be replayed as a refresh token."""
    client.post(
        "/api/auth/register",
        json={
            "email": "refresh.type@claritymesh.ai",
            "name": "Refresh Type",
            "password": "ValidPassword#2026",
        },
    )
    login = client.post(
        "/api/auth/login",
        json={
            "email": "refresh.type@claritymesh.ai",
            "password": "ValidPassword#2026",
        },
    ).json()
    access = login["access_token"]
    res = client.post("/api/auth/refresh", json={"refresh_token": access})
    assert res.status_code == 401
    assert "refresh token expected" in res.json()["detail"].lower()


def test_production_boot_requires_strong_secret(monkeypatch):
    """CLARITY_ENV=production refuses to boot on ephemeral/weak secrets."""
    from main import _warn_on_insecure_startup

    monkeypatch.setenv("CLARITY_ENV", "production")
    monkeypatch.delenv("CLARITY_JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError, match="CLARITY_JWT_SECRET"):
        _warn_on_insecure_startup()

    monkeypatch.setenv("CLARITY_JWT_SECRET", "short-secret")
    with pytest.raises(RuntimeError, match="CLARITY_JWT_SECRET"):
        _warn_on_insecure_startup()


def test_proxy_headers_ignored_unless_trusted(monkeypatch):
    """Audit IPs cannot be spoofed unless CLARITY_TRUST_PROXY=true."""
    from fastapi import Request
    from services.auth_deps import get_client_ip

    scope = {
        "type": "http",
        "headers": [(b"x-forwarded-for", b"9.9.9.9")],
        "client": ("10.1.2.3", 1234),
    }
    req = Request(scope)

    monkeypatch.setenv("CLARITY_TRUST_PROXY", "false")
    assert get_client_ip(req) == "10.1.2.3"

    monkeypatch.setenv("CLARITY_TRUST_PROXY", "true")
    assert get_client_ip(req) == "9.9.9.9"


def test_ephemeral_jwt_secret_is_per_process():
    """Unset secret falls back to a random per-process value (>=32 chars)."""
    from services.jwt_service import get_jwt_secret, is_using_default_secret

    old = os.environ.pop("CLARITY_JWT_SECRET", None)
    try:
        assert is_using_default_secret() is True
        assert len(get_jwt_secret()) >= 32
    finally:
        if old is not None:
            os.environ["CLARITY_JWT_SECRET"] = old


def test_compose_requires_jwt_secret():
    """docker-compose must fail closed when CLARITY_JWT_SECRET is missing."""
    from pathlib import Path

    compose = (
        Path(__file__).resolve().parents[2] / "docker-compose.yml"
    ).read_text()
    assert "CLARITY_JWT_SECRET:?" in compose or "CLARITY_JWT_SECRET: ?" in compose
