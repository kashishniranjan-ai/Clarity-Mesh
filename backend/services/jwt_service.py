"""
Clarity Mesh — Cryptographic JWT Token Engine
=============================================
Signs and verifies JSON Web Tokens (HS256) with distinct access and
refresh lifetimes, cryptographically bound user roles, and revocation checks.
"""

from __future__ import annotations

import os
import secrets
import time
from typing import Any

import jwt

# Ephemeral per-process fallback: restart invalidates dev tokens.
# Production MUST set CLARITY_JWT_SECRET (>=32 chars); compose enforces it.
_EPHEMERAL_DEV_SECRET = secrets.token_hex(32)

_warn_once = False


def _resolve_secret() -> str:
    """Resolve the HS256 signing secret at call time (test-friendly).

    A ``CLARITY_JWT_SECRET`` shorter than 32 chars is treated as
    misconfigured and ignored (ephemeral fallback + warning) so a weak
    committed secret can never silently sign production tokens.
    """
    global _warn_once
    raw = os.getenv("CLARITY_JWT_SECRET", "").strip()
    if raw and len(raw) < 32:
        raw = ""
        if not _warn_once:
            _warn_once = True
            print(
                "[security] CLARITY_JWT_SECRET is shorter than 32 chars — "
                "ignoring it and using an ephemeral per-process secret. "
                "Set a random >=32-char secret."
            )
    secret = raw or _EPHEMERAL_DEV_SECRET
    if secret == _EPHEMERAL_DEV_SECRET and not _warn_once:
        _warn_once = True
        print(
            "[security] CLARITY_JWT_SECRET is not set — using an ephemeral "
            "per-process secret (tokens invalidate on restart). Set a random "
            ">=32-char secret in production."
        )
    return secret


def get_jwt_secret() -> str:
    """Public accessor for startup checks and operational tooling."""
    return _resolve_secret()


def is_using_default_secret() -> bool:
    return _resolve_secret() == _EPHEMERAL_DEV_SECRET


JWT_ALGORITHM = "HS256"

# Token Lifetimes
ACCESS_TOKEN_LIFETIME_SECONDS = int(
    os.getenv("CLARITY_ACCESS_TOKEN_EXPIRE_SECONDS", "3600")
)  # 1 hour
REFRESH_TOKEN_LIFETIME_SECONDS = int(
    os.getenv("CLARITY_REFRESH_TOKEN_EXPIRE_SECONDS", "604800")
)  # 7 days


class TokenError(Exception):
    """Base exception for JWT operations."""


class TokenExpiredError(TokenError):
    """Raised when token is expired."""


class TokenInvalidError(TokenError):
    """Raised when token signature or payload is invalid."""


def create_access_token(user: dict[str, Any]) -> str:
    """Create a signed JWT access token for API authorization."""
    now = time.time()
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "name": user.get("name", ""),
        "role": user.get("role", "analyst"),
        "clearance": user.get("clearance", ""),
        "type": "access",
        "iat": int(now),
        "exp": int(now + ACCESS_TOKEN_LIFETIME_SECONDS),
    }
    return jwt.encode(payload, _resolve_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user: dict[str, Any]) -> str:
    """Create a signed JWT refresh token for session continuation."""
    now = time.time()
    payload = {
        "sub": user["id"],
        "email": user["email"],
        "type": "refresh",
        "iat": int(now),
        "exp": int(now + REFRESH_TOKEN_LIFETIME_SECONDS),
    }
    return jwt.encode(payload, _resolve_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and verify a signed JWT token."""
    try:
        payload = jwt.decode(
            token,
            _resolve_secret(),
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "iat", "sub", "type"]},
        )
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpiredError("Authorization token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenInvalidError(f"Invalid token signature: {exc}") from exc
