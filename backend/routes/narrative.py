"""
Clarity Mesh — Forensic Narrative Routes
=========================================
Endpoints:
  POST /api/narrative
  POST /api/v2/narrative

Accepts either an ``analysis_id`` (looking up stored findings) or an inline
structured analysis dictionary, and returns a verified human-readable report narrative.
"""

from typing import Any, List, Optional

from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from services.auth_deps import get_client_ip, get_current_user
from services.audit_store import log_audit_event
from services.history_store import get_analysis
from services.narrative_generator import generate_forensic_narrative
from services.rate_limit import limiter

router = APIRouter()


class NarrativeRequest(BaseModel):
    analysis_id: Optional[int] = None
    media_type: Optional[str] = None
    frames_analyzed: Optional[int] = 0
    faces_analyzed: Optional[int] = 0
    faces_detected: Optional[int] = 0
    visual_score: Optional[float] = None
    visual_classification: Optional[str] = None
    visual_status: Optional[str] = None
    audio_score: Optional[float] = None
    audio_classification: Optional[str] = None
    audio_status: Optional[str] = None
    fused_score: Optional[float] = None
    fused_classification: Optional[str] = None
    multimodal_status: Optional[str] = None
    ai_image_score: Optional[float] = None
    ai_image_classification: Optional[str] = None
    peak_regions: List[dict] = Field(default_factory=list)


NarrativeRequest.model_rebuild()


def _handle_narrative(
    req: NarrativeRequest,
    request: Request,
    current_user: dict[str, Any],
) -> dict[str, Any]:
    analysis_payload: dict[str, Any] = req.model_dump()

    if req.analysis_id is not None:
        rec = get_analysis(int(req.analysis_id))
        if not rec:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Analysis ID {req.analysis_id} not found.",
            )
        # Merge record fields
        analysis_payload.update({
            "media_type": rec.get("media_type") or req.media_type,
            "faces_detected": rec.get("faces_detected") or req.faces_detected,
            "visual_score": rec.get("visual_score") if rec.get("visual_score") is not None else req.visual_score,
            "visual_classification": rec.get("visual_classification") or req.visual_classification,
            "visual_status": rec.get("visual_status") or req.visual_status,
            "audio_score": rec.get("audio_score") if rec.get("audio_score") is not None else req.audio_score,
            "audio_classification": rec.get("audio_classification") or req.audio_classification,
            "audio_status": rec.get("audio_status") or req.audio_status,
            "fused_score": rec.get("fused_score") if rec.get("fused_score") is not None else req.fused_score,
            "fused_classification": rec.get("multimodal_classification") or req.fused_classification,
            "multimodal_status": rec.get("multimodal_status") or req.multimodal_status,
            "ai_image_score": rec.get("ai_image_score") if rec.get("ai_image_score") is not None else req.ai_image_score,
            "ai_image_classification": rec.get("ai_image_classification") or req.ai_image_classification,
        })

    result = generate_forensic_narrative(analysis_payload)

    log_audit_event(
        action="FORENSIC_NARRATIVE_GENERATED",
        user=current_user,
        target=f"analysis_{req.analysis_id}" if req.analysis_id else "inline_analysis",
        ip_address=get_client_ip(request),
        details={
            "generator": result.get("generator"),
            "numbers_validated": result.get("numbers_validated"),
            "analysis_id": req.analysis_id,
        },
    )
    return result


@router.post("")
@limiter.limit("20/minute")
async def create_narrative(
    request: Request,
    req: NarrativeRequest = Body(...),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Generate a verified forensic narrative paragraph (v1 endpoint)."""
    return _handle_narrative(req, request, current_user)


@router.post("/v2/narrative")
@limiter.limit("20/minute")
async def create_narrative_v2(
    request: Request,
    req: NarrativeRequest = Body(...),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Generate a verified forensic narrative paragraph (v2 endpoint)."""
    return _handle_narrative(req, request, current_user)

