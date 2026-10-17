"""
Clarity Mesh — Authentication & Identity Routing
================================================
Provides secure authentication, session management, and role-based clearance
for Forensics Analysts, Security Operations, and Root Administrators.
"""

from __future__ import annotations

import time
import uuid
from typing import Any
from pydantic import BaseModel, EmailStr
from fastapi import APIRouter, HTTPException, Header

router = APIRouter()

# In-memory session store & registered users
# Seeded with default Analyst and Root Admin accounts for seamless demo & operation
USERS_DB: dict[str, dict[str, Any]] = {
    "analyst@claritymesh.ai": {
        "id": "usr_analyst_01",
        "email": "analyst@claritymesh.ai",
        "name": "Special Agent J. Miller",
        "role": "analyst",
        "clearance": "Tier 2 — Senior Forensic Investigator",
        "department": "Cyber Defense Forensics Group",
        "avatar": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
        "password": "clarity2026",
        "created_at": "2026-01-15T09:00:00Z",
    },
    "admin@claritymesh.ai": {
        "id": "adm_secops_01",
        "email": "admin@claritymesh.ai",
        "name": "Director S. Vance",
        "role": "admin",
        "clearance": "Tier 4 — SecOps Root Commander",
        "department": "Autonomous Threat Interception & Defense",
        "avatar": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
        "password": "rootmesh2026",
        "created_at": "2026-01-01T00:00:00Z",
    },
}

ACTIVE_TOKENS: dict[str, dict[str, Any]] = {}


class LoginRequest(BaseModel):
    email: str
    password: str
    role_requested: str = "analyst"  # "analyst" or "admin"


class RegisterRequest(BaseModel):
    email: str
    name: str
    password: str
    role: str = "analyst"


@router.post("/login")
async def login(req: LoginRequest):
    email_clean = req.email.strip().lower()
    user = USERS_DB.get(email_clean)

    if not user or user["password"] != req.password:
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials. Verify your identity or use the quick demo credentials.",
        )

    # If user requests admin role, verify they have admin privileges
    if req.role_requested == "admin" and user["role"] != "admin":
        raise HTTPException(
            status_code=403,
            detail="Access Denied: Account does not possess Tier 4 Root Administrator clearance.",
        )

    token = f"cm_{uuid.uuid4().hex}"
    session_data = {
        "token": token,
        "user_id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "clearance": user["clearance"],
        "department": user["department"],
        "avatar": user["avatar"],
        "issued_at": time.time(),
        "expires_in_seconds": 86400,
    }

    ACTIVE_TOKENS[token] = session_data

    return {
        "status": "success",
        "message": f"Biometric & identity handshake verified for {user['name']}.",
        "token": token,
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
async def register(req: RegisterRequest):
    email_clean = req.email.strip().lower()
    if email_clean in USERS_DB:
        raise HTTPException(
            status_code=400,
            detail="An investigator account with this email is already registered.",
        )

    user_id = f"usr_{uuid.uuid4().hex[:8]}"
    role = "admin" if req.role == "admin" else "analyst"
    clearance = "Tier 4 — SecOps Root Commander" if role == "admin" else "Tier 2 — Field Forensic Investigator"

    new_user = {
        "id": user_id,
        "email": email_clean,
        "name": req.name.strip(),
        "role": role,
        "clearance": clearance,
        "department": "National Security Cyber Telemetry Unit",
        "avatar": "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
        "password": req.password,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }

    USERS_DB[email_clean] = new_user

    # Auto login upon registration
    token = f"cm_{uuid.uuid4().hex}"
    ACTIVE_TOKENS[token] = {
        "token": token,
        "user_id": new_user["id"],
        "email": new_user["email"],
        "name": new_user["name"],
        "role": new_user["role"],
        "clearance": new_user["clearance"],
        "department": new_user["department"],
        "avatar": new_user["avatar"],
        "issued_at": time.time(),
        "expires_in_seconds": 86400,
    }

    return {
        "status": "success",
        "message": f"Investigator account created with {clearance}.",
        "token": token,
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


@router.get("/me")
async def get_current_user(authorization: str | None = Header(None)):
    if not authorization:
        # Return guest profile
        return {
            "authenticated": False,
            "user": None,
        }

    token = authorization.replace("Bearer ", "").strip()
    session = ACTIVE_TOKENS.get(token)

    if not session:
        return {
            "authenticated": False,
            "user": None,
        }

    return {
        "authenticated": True,
        "user": {
            "id": session["user_id"],
            "email": session["email"],
            "name": session["name"],
            "role": session["role"],
            "clearance": session["clearance"],
            "department": session["department"],
            "avatar": session["avatar"],
        },
    }


@router.post("/logout")
async def logout(authorization: str | None = Header(None)):
    if authorization:
        token = authorization.replace("Bearer ", "").strip()
        ACTIVE_TOKENS.pop(token, None)
    return {"status": "success", "message": "Investigator session terminated safely."}
