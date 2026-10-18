"""
Clarity Mesh — Explainability Routes
=====================================
``POST /api/explain`` — generate a Grad-CAM or occlusion-sensitivity
heatmap for a previously analysed upload (referenced by its sanitized
``stored_name``).  Requires authentication and is rate limited; every
request is audit-logged.  The response re-uses the detector's honest
state philosophy: a ``heatmap_b64`` exists only when a genuine
computation completed.

``POST /api/explain/visual`` — targeted explainability endpoint accepting
either an uploaded image, a base64 payload, or referencing a previous analysis
ID / stored_name. Returns original face crop, heatmap crop, blended overlay,
and peak activation bounding boxes.
"""

from __future__ import annotations

import base64
from typing import Any

import cv2
import numpy as np
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from services.audit_store import log_audit_event
from services.auth_deps import get_client_ip, get_current_user
from services.explainability import (
    explain_image_bgr,
    generate_explanation,
)
from services.history_store import get_analysis
from services.rate_limit import limiter

router = APIRouter()

_VALID_METHODS = ("occlusion", "gradcam")


class ExplainRequest(BaseModel):
    stored_name: str
    method: str = "occlusion"
    frame_index: int | None = None


class ExplainVisualRequest(BaseModel):
    stored_name: str | None = None
    analysis_id: int | None = None
    frame_index: int | None = None
    method: str = "gradcam"
    image_b64: str | None = None


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

    result = generate_explanation(
        req.stored_name,
        method=req.method,
        frame_index=req.frame_index,
    )

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
            "frame_index": req.frame_index,
        },
    )
    return result


@router.post("/visual")
@limiter.limit("15/minute")
async def explain_visual(
    request: Request,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """
    Visual explainability endpoint returning original face crop, heatmap crop,
    blended overlay base64 PNGs, and peak activation regions.

    Supports:
    - JSON payload with ``analysis_id``, ``stored_name``, or ``image_b64``
    - Multipart upload with image ``file``
    """
    content_type = request.headers.get("content-type", "")
    target_stored_name: str | None = None
    target_frame_index: int | None = None
    method: str = "gradcam"
    raw_image_bytes: bytes | None = None

    if "multipart/form-data" in content_type:
        form = await request.form()
        upload_file = form.get("file")
        if upload_file and hasattr(upload_file, "read"):
            raw_image_bytes = await upload_file.read()
        target_stored_name = form.get("stored_name")
        a_id = form.get("analysis_id")
        if a_id:
            try:
                rec = get_analysis(int(a_id))
                if rec and rec.get("stored_name"):
                    target_stored_name = rec["stored_name"]
            except Exception:
                pass
        f_idx = form.get("frame_index")
        if f_idx:
            try:
                target_frame_index = int(f_idx)
            except ValueError:
                pass
        method = str(form.get("method") or "gradcam")
    else:
        try:
            body = await request.json()
        except Exception:
            body = {}
        target_stored_name = body.get("stored_name")
        analysis_id = body.get("analysis_id")
        if analysis_id is not None:
            try:
                rec = get_analysis(int(analysis_id))
                if not rec:
                    raise HTTPException(
                        status_code=status.HTTP_404_NOT_FOUND,
                        detail=f"Analysis ID {analysis_id} not found in records.",
                    )
                target_stored_name = rec.get("stored_name")
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed looking up analysis ID: {exc}",
                )

        target_frame_index = body.get("frame_index")
        method = body.get("method") or "gradcam"
        image_b64 = body.get("image_b64")
        if image_b64:
            if "," in image_b64:
                image_b64 = image_b64.split(",", 1)[1]
            try:
                raw_image_bytes = base64.b64decode(image_b64)
            except Exception:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Invalid base64 encoding for image_b64.",
                )

    if method not in _VALID_METHODS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"method must be one of {_VALID_METHODS}.",
        )

    # 1. Direct raw image bytes provided
    if raw_image_bytes:
        arr = np.frombuffer(raw_image_bytes, np.uint8)
        img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provided file could not be decoded as an image.",
            )
        result = explain_image_bgr(img_bgr, method=method)
        target_name = "direct_image_upload"

    # 2. Stored upload or analysis reference
    elif target_stored_name:
        result = generate_explanation(
            target_stored_name,
            method=method,
            frame_index=target_frame_index,
        )
        target_name = target_stored_name
        if result.get("status") == "file_not_found":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=result.get("error", "Stored upload not found."),
            )
        if result.get("status") == "invalid_stored_name":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=result.get("error", "Invalid stored_name."),
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide stored_name, analysis_id, image file, or image_b64.",
        )

    log_audit_event(
        action="EXPLAINABILITY_VISUAL_GENERATED",
        user=current_user,
        target=target_name,
        ip_address=get_client_ip(request),
        details={
            "method": method,
            "status": result.get("status"),
            "baseline_score": result.get("baseline_score"),
            "frame_index": target_frame_index,
            "peak_regions_count": len(result.get("peak_regions", [])),
        },
    )
    return result

