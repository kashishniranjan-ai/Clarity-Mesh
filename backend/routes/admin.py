"""
Clarity Mesh — Administrator Command Center API
===============================================
Endpoints for Root Administrators to monitor live system telemetry,
audit forensics trails, manage investigator clearances, and calibrate
multi-signal model thresholds.
"""

from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel

from services.audit_store import list_audit_logs, log_audit_event
from services.auth_deps import get_client_ip, require_admin
from services.auth_store import list_users, update_user_role
from services.forensic_engine import get_forensic_config, update_forensic_config
from services.telemetry_service import get_real_system_telemetry

router = APIRouter(dependencies=[Depends(require_admin)])


class CalibrationUpdateRequest(BaseModel):
    visual_weight: float | None = None
    audio_weight: float | None = None
    clip_weight: float | None = None
    fft_weight: float | None = None
    ela_weight: float | None = None
    noise_weight: float | None = None
    face_threshold: float | None = None
    audio_threshold: float | None = None
    ai_image_threshold: float | None = None
    ensemble_threshold: float | None = None
    steepness_factor: float | None = None


class RoleUpdateRequest(BaseModel):
    role: str  # "admin" or "analyst"


@router.get("/config")
async def get_config():
    """Get active forensic threshold configuration."""
    return {
        "status": "success",
        "config": get_forensic_config(),
    }


@router.post("/calibrate")
async def calibrate_engine(
    req: CalibrationUpdateRequest,
    request: Request,
    current_admin: dict[str, Any] = Depends(require_admin),
):
    """Update active weights and decision thresholds dynamically."""
    # Pydantic v2 model_dump with fallback
    updates = (
        req.model_dump(exclude_unset=True)
        if hasattr(req, "model_dump")
        else {k: v for k, v in req.dict().items() if v is not None}
    )

    new_cfg = update_forensic_config(updates)

    log_audit_event(
        action="CALIBRATION_UPDATE",
        user=current_admin,
        target="forensic_engine",
        ip_address=get_client_ip(request),
        details=updates,
    )

    return {
        "status": "success",
        "message": f"Updated {len(updates)} forensic engine calibration parameter(s).",
        "config": new_cfg,
    }


@router.get("/telemetry")
async def get_telemetry():
    """Real-time system diagnostics, resource utilization, and model cache vitals."""
    telemetry = get_real_system_telemetry()
    return telemetry


@router.get("/audit")
async def get_audit_trail(
    limit: int = Query(100, ge=1, le=500),
    action: str | None = Query(None),
):
    """Retrieve immutable forensic audit logs."""
    logs = list_audit_logs(limit=limit, action=action)
    return {
        "status": "success",
        "total": len(logs),
        "audit_logs": logs,
    }


@router.get("/users")
async def get_users():
    """List registered forensic investigators and clearance levels."""
    users_list = list_users()
    return {
        "status": "success",
        "investigators": users_list,
    }


@router.patch("/users/{user_id}/role")
async def change_user_role(
    user_id: str,
    req: RoleUpdateRequest,
    request: Request,
    current_admin: dict[str, Any] = Depends(require_admin),
):
    """Promote or demote an investigator's role (Admin only)."""
    try:
        updated = update_user_role(user_id, req.role)
        log_audit_event(
            action="USER_ROLE_UPDATED",
            user=current_admin,
            target=user_id,
            ip_address=get_client_ip(request),
            details={"new_role": req.role, "target_user": user_id},
        )
        return {
            "status": "success",
            "message": f"User {user_id} role updated to {req.role}.",
            "user": updated,
        }
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc


@router.get("/threat-matrix")
async def get_threat_matrix():
    """Simulated cyber threat radar & deepfake interception stream (Labeled demo data)."""
    return {
        "status": "success",
        "is_simulated": True,
        "disclaimer": "Simulated demo data — threat intelligence feed is simulated for cyber-forensics demonstration.",
        "active_threat_level": "ELEVATED",
        "global_attacks_blocked_24h": 1428,
        "incident_feed": [
            {
                "id": "INC-8902",
                "timestamp": "2 min ago",
                "type": "Voice Clone Injection (ElevenLabs v3)",
                "target": "Wire Transfer Authorization Audio",
                "origin": "Eastern Europe / Proxy Network",
                "confidence": 99.8,
                "status": "INTERCEPTED",
                "severity": "CRITICAL",
                "simulation_label": "Simulated demo data",
            },
            {
                "id": "INC-8901",
                "timestamp": "14 min ago",
                "type": "FaceSwap Video Manipulation (SimSwap/RoOP)",
                "target": "Executive Press Conference Stream",
                "origin": "North America / TOR Exit Node",
                "confidence": 97.4,
                "status": "FLAGGED",
                "severity": "HIGH",
                "simulation_label": "Simulated demo data",
            },
            {
                "id": "INC-8900",
                "timestamp": "38 min ago",
                "type": "Synthetic Document Forgery (Midjourney v6.1)",
                "target": "Government Passport Verification",
                "origin": "Southeast Asia / Cloud VPS",
                "confidence": 99.1,
                "status": "QUARANTINED",
                "severity": "HIGH",
                "simulation_label": "Simulated demo data",
            },
            {
                "id": "INC-8899",
                "timestamp": "1 hr ago",
                "type": "Diffusion Artwork Masquerade (FLUX.1-dev)",
                "target": "Intellectual Property Registry",
                "origin": "Western Europe / Residential IP",
                "confidence": 94.6,
                "status": "RESOLVED",
                "severity": "MEDIUM",
                "simulation_label": "Simulated demo data",
            },
        ],
        "attack_vector_distribution": {
            "Voice Clones / Audio Spoofs": 38,
            "FaceSwap & Video Deepfakes": 34,
            "Diffusion Image Synthesis": 22,
            "Biometric Spoof / Splicing": 6,
        },
    }
