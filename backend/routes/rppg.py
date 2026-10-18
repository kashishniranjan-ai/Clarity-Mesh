"""
Clarity Mesh — Physio-Acoustic Coupling (rPPG) Routes
=====================================================
Endpoint:
  POST /api/v2/rppg
  POST /api/rppg

Performs experimental rPPG chrominance pulse extraction and speech-envelope
cross-correlation.
"""

from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel

from services.audit_store import log_audit_event
from services.auth_deps import get_client_ip, get_current_user
from services.history_store import get_analysis
from services.rate_limit import limiter
from services.rppg_coupling import extract_rppg_coupling

router = APIRouter()

UPLOADS_DIR = Path(__file__).resolve().parents[2] / "uploads"


class RPPGRequest(BaseModel):
    stored_name: Optional[str] = None
    analysis_id: Optional[int] = None
    max_frames: int = 120
    force_enable: bool = False


RPPGRequest.model_rebuild()


@router.post("")
@router.post("/rppg")
@router.post("/v2/rppg")
@limiter.limit("10/minute")
async def run_rppg_analysis(
    request: Request,
    body: RPPGRequest = Body(...),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """
    Extract rPPG pulse signal and compute physio-acoustic coupling correlation.
    """
    target_stored_name: str | None = body.stored_name

    if body.analysis_id is not None:
        rec = get_analysis(body.analysis_id)
        if not rec or not rec.get("stored_name"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Analysis ID {body.analysis_id} not found in database.",
            )
        target_stored_name = rec["stored_name"]

    if not target_stored_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide stored_name or analysis_id.",
        )

    file_path = UPLOADS_DIR / target_stored_name
    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Stored video file '{target_stored_name}' not found.",
        )

    result = extract_rppg_coupling(
        video_path=file_path,
        max_frames=body.max_frames,
        force_enable=body.force_enable,
    )

    log_audit_event(
        action="rppg_coupling_analysis",
        user=current_user,
        target=target_stored_name,
        ip_address=get_client_ip(request),
        details={
            "status": result.get("status"),
            "pulse_rate_bpm": result.get("pulse_rate_bpm"),
            "correlation_coefficient": result.get("correlation_coefficient"),
        },
    )

    return result
