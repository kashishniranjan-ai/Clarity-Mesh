"""
Clarity Mesh — FastAPI Authentication Dependencies
==================================================
Reusable route dependencies to extract authenticated investigator identity,
enforce role-based access control (RBAC), and reject unverified requests.
"""

from __future__ import annotations

import os
import time
from typing import Any

from fastapi import Depends, HTTPException, Header, Request, status

from services.auth_store import get_user_by_id
from services.jwt_service import TokenExpiredError, TokenInvalidError, decode_token


def get_client_ip(request: Request) -> str:
    """Extract real client IP address.

    Proxy headers (X-Forwarded-For / X-Real-IP) are only honored when the
    deployment explicitly opts in via CLARITY_TRUST_PROXY=true (i.e. the app
    is behind nginx/compose which sets them). Otherwise the direct peer
    address is used, so a client cannot spoof its audit IP.
    """
    if os.getenv("CLARITY_TRUST_PROXY", "false").lower() == "true":
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
    return request.client.host if request.client else "127.0.0.1"


async def get_current_user(
    authorization: str | None = Header(None, alias="Authorization"),
) -> dict[str, Any]:
    """
    Validate Bearer JWT access token and return the authenticated user record.
    Raises 401 UNAUTHORIZED if missing, expired, or invalid.
    """
    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header. Bearer token required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authorization format. Must be 'Bearer <token>'.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = parts[1]
    try:
        payload = decode_token(token)
    except TokenExpiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    except TokenInvalidError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type: access token required.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed token: missing subject claim.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = get_user_by_id(user_id)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account no longer exists.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Check if locked
    if user.get("locked_until", 0.0) > time.time():
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail="Account is currently locked.",
        )

    return user


async def require_admin(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Ensure the current user possesses Administrator clearance.
    Raises 403 FORBIDDEN if the user is not an admin.
    """
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator clearance required. Access denied.",
        )
    return current_user


# Alias used by main.py's dependency_overrides wiring and by tests that
# monkeypatch a single function (app.dependency_overrides[require_admin])
# rather than the pair.
get_current_user = get_current_user


def require_admin_always(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """Admin gate: decode token and then enforce Tier 4 clearance."""
    if current_user.get("role") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator clearance required. Access denied.",
        )
    return current_user


def require_role(required_role: str):
    """Factory creating a dependency that checks if the authenticated user has a specific role.

    Config-driven role gating stub for portfolio/educational demonstration.
    (Production systems would integrate enterprise SSO/OIDC/RBAC).
    """
    async def _role_checker(
        current_user: dict[str, Any] = Depends(get_current_user),
    ) -> dict[str, Any]:
        user_role = current_user.get("role")
        if user_role != required_role and user_role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Clearance level '{required_role}' required. Access denied.",
            )
        return current_user

    return _role_checker

