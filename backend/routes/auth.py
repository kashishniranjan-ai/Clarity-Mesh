"""
Clarity Mesh — Authentication & Identity Routing
================================================
Provides secure authentication, Argon2id verification, signed JWT sessions,
and role-based clearance for Forensics Analysts and Root Administrators.
"""

import time
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Header, Request, status
from pydantic import BaseModel, Field

from services.audit_store import log_audit_event
from services.auth_deps import get_client_ip, get_current_user
from services.rate_limit import limiter
from services.auth_store import (
    AuthStoreError,
    create_user,
    get_user_by_email,
    get_user_by_id,
    verify_user_credentials,
)
from services.jwt_service import (
    TokenExpiredError,
    TokenInvalidError,
    create_access_token,
    create_refresh_token,
    decode_token,
)

router = APIRouter()


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)
    role_requested: Literal["analyst", "admin"] = "analyst"


class RegisterRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    name: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=8, max_length=256)
    role: str = Field(default="analyst", max_length=20)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(min_length=10, max_length=4096)


@router.post("/login")
@limiter.limit("10/minute")
async def login(req: LoginRequest, request: Request):
    ip = get_client_ip(request)
    email_clean = req.email.strip().lower()

    user, error_msg = verify_user_credentials(email_clean, req.password)
    if not user or error_msg:
        log_audit_event(
            action="LOGIN_FAILURE",
            target=email_clean,
            ip_address=ip,
            details={"error": error_msg or "Invalid credentials"},
        )
        status_code = (
            status.HTTP_423_LOCKED
            if error_msg and "locked" in error_msg.lower()
            else status.HTTP_401_UNAUTHORIZED
        )
        raise HTTPException(
            status_code=status_code,
            detail=error_msg or "Invalid email or password.",
        )

    # Verify admin clearance if explicitly requested
    if req.role_requested == "admin" and user["role"] != "admin":
        log_audit_event(
            action="LOGIN_DENIED_CLEARANCE",
            user=user,
            target=email_clean,
            ip_address=ip,
            details="User requested admin role but lacks Tier 4 clearance",
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access Denied: Account does not possess Tier 4 Root Administrator clearance.",
        )

    access_token = create_access_token(user)
    refresh_token = create_refresh_token(user)

    log_audit_event(
        action="LOGIN_SUCCESS",
        user=user,
        target=user["id"],
        ip_address=ip,
        details={"role": user["role"], "clearance": user["clearance"]},
    )

    return {
        "status": "success",
        "message": f"Biometric & identity handshake verified for {user['name']}.",
        "token": access_token,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "clearance": user["clearance"],
            "department": user["department"],
            "avatar": user["avatar"],
        },
    }


@router.post("/register")
@limiter.limit("5/minute")
async def register(req: RegisterRequest, request: Request):
    ip = get_client_ip(request)
    clean_email = req.email.strip().lower()

    if len(req.password) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 8 characters long.",
        )

    try:
        new_user = create_user(
            email=clean_email,
            name=req.name,
            password=req.password,
            role="analyst",  # Always analyst for self-registration
        )
    except AuthStoreError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    access_token = create_access_token(new_user)
    refresh_token = create_refresh_token(new_user)

    log_audit_event(
        action="USER_REGISTERED",
        user=new_user,
        target=new_user["id"],
        ip_address=ip,
        details={"role": new_user["role"], "clearance": new_user["clearance"]},
    )

    return {
        "status": "success",
        "message": f"Investigator account created with {new_user['clearance']}.",
        "token": access_token,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": {
            "id": new_user["id"],
            "email": new_user["email"],
            "name": new_user["name"],
            "role": new_user["role"],
            "clearance": new_user["clearance"],
            "department": new_user["department"],
            "avatar": new_user["avatar"],
        },
    }


@router.post("/refresh")
@limiter.limit("20/minute")
async def refresh_token(req: RefreshRequest, request: Request):
    ip = get_client_ip(request)
    try:
        payload = decode_token(req.refresh_token)
    except TokenExpiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token has expired. Please log in again.",
        ) from exc
    except TokenInvalidError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token.",
        ) from exc

    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type: refresh token expected.",
        )

    user_id = payload.get("sub")
    user = get_user_by_id(user_id) if user_id else None
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account no longer exists.",
        )

    new_access_token = create_access_token(user)
    new_refresh_token = create_refresh_token(user)

    log_audit_event(
        action="TOKEN_REFRESH",
        user=user,
        target=user["id"],
        ip_address=ip,
    )

    return {
        "status": "success",
        "access_token": new_access_token,
        "token": new_access_token,
        "refresh_token": new_refresh_token,
        "token_type": "bearer",
    }


@router.get("/me")
async def get_current_user_profile(
    authorization: str | None = Header(None, alias="Authorization"),
):
    """
    Returns the current user profile if validly authenticated,
    or authenticated: False if unauthenticated or guest.
    """
    if not authorization:
        return {"authenticated": False, "user": None}

    try:
        user = await get_current_user(authorization)
        return {
            "authenticated": True,
            "user": {
                "id": user["id"],
                "email": user["email"],
                "name": user["name"],
                "role": user["role"],
                "clearance": user["clearance"],
                "department": user["department"],
                "avatar": user["avatar"],
            },
        }
    except HTTPException:
        return {"authenticated": False, "user": None}


@router.post("/logout")
async def logout(
    request: Request,
    authorization: str | None = Header(None, alias="Authorization"),
):
    ip = get_client_ip(request)
    if authorization:
        try:
            user = await get_current_user(authorization)
            log_audit_event(
                action="LOGOUT",
                user=user,
                target=user["id"],
                ip_address=ip,
            )
        except HTTPException:
            pass

    return {
        "status": "success",
        "message": "Investigator session terminated safely.",
    }
