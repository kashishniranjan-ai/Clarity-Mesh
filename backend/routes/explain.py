"""
Clarity Mesh — Explainability Routes
=====================================
``POST /api/explain`` — generate a Grad-CAM or occlusion-sensitivity
heatmap for a previously analysed upload (referenced by its sanitized
``stored_name``).  Requires authentication and is rate limited; every
request is audit-logged.  The response re-uses the detector's honest
state philosophy: a ``heatmap_b64`` exists only when a genuine
computation completed.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from services.audit_store import log_audit_event
from services.auth_deps import get_client_ip, get_current_user
from services.explainability import generate_explanation
from services.rate_limit import limiter

router = APIRouter()

_VALID_METHODS = ("occlusion", "gradcam")


class ExplainRequest(BaseModel):
    stored_name: str
    method: str = "occlusion"


@router.post("")
@limiter.limit("10/minute")
async def explain_upload(
    req: ExplainRequest,
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """
    Generate an explainability heatmap for a stored upload.

    ``method`` is either ``occlusion`` (model-agnostic masked forwards) or
    ``gradcam`` (last-conv gradients when the TorchScript export supports
    autograd).  Honest failure states are returned as JSON with the
    matching ``status`` — the HTTP status stays 200 for computed or
    unavailable results; only malformed requests are rejected.
    """
    if req.method not in _VALID_METHODS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"method must be one of {_VALID_METHODS}.",
        )

    result = generate_explanation(req.stored_name, method=req.method)

    if result.get("status") == "invalid_stored_name":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("error", "Invalid stored_name."),
        )
    if result.get("status") == "file_not_found":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=result.get("error", "Stored upload not found."),
        )

    log_audit_event(
        action="EXPLAINABILITY_GENERATED",
        user=current_user,
        target=req.stored_name,
        ip_address=get_client_ip(request),
        details={
            "method": req.method,
            "status": result.get("status"),
            "baseline_score": result.get("baseline_score"),
        },
    )
    return result
