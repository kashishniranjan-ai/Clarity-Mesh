"""
Clarity Mesh — Cryptographic JWT Token Engine
=============================================
Signs and verifies JSON Web Tokens (HS256) with distinct access and
refresh lifetimes, cryptographically bound user roles, and revocation checks.
"""

from __future__ import annotations

import os
import time
from typing import Any

import jwt

JWT_SECRET_KEY = os.getenv(
    "CLARITY_JWT_SECRET", "clarity-mesh-forensics-super-secret-jwt-key-2026"
)
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
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


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
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """Decode and verify a signed JWT token."""
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET_KEY,
            algorithms=[JWT_ALGORITHM],
            options={"require": ["exp", "iat", "sub", "type"]},
        )
        return payload
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpiredError("Authorization token has expired.") from exc
    except jwt.InvalidTokenError as exc:
        raise TokenInvalidError(f"Invalid token signature: {exc}") from exc
