"""
Clarity Mesh — Adversarial Robustness Evaluation Routes
======================================================
Endpoint:
  POST /api/v2/robustness
  POST /api/robustness

Performs adversarial sensitivity stress-testing (FGSM / PGD) on face crops
against the EfficientNet-B7 deepfake model.
"""

import base64
from pathlib import Path
from typing import Any, List, Optional

import cv2
import numpy as np
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel

from services.audit_store import log_audit_event
from services.auth_deps import get_client_ip, get_current_user
from services.adversarial_robustness import evaluate_robustness, is_robustness_enabled
from services.history_store import get_analysis
from services.rate_limit import limiter

router = APIRouter()

UPLOADS_DIR = Path(__file__).resolve().parents[2] / "uploads"


class RobustnessRequest(BaseModel):
    stored_name: Optional[str] = None
    analysis_id: Optional[int] = None
    image_b64: Optional[str] = None
    epsilons: Optional[List[float]] = None
    attack: str = "fgsm"
    pgd_steps: int = 10
    pgd_alpha: float = 0.005
    force_enable: bool = False


RobustnessRequest.model_rebuild()


@router.post("")
@router.post("/robustness")
@router.post("/v2/robustness")
@limiter.limit("10/minute")
async def run_adversarial_robustness(
    request: Request,
    body: RobustnessRequest = Body(...),
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """
    Execute empirical adversarial robustness perturbation sweeps on a media face.
    """
    img_bgr: np.ndarray | None = None
    target_identifier = "unknown"

    # 1. Base64 payload provided directly
    if body.image_b64:
        raw_b64 = body.image_b64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        try:
            buf = base64.b64decode(raw_b64)
            arr = np.frombuffer(buf, np.uint8)
            img_bgr = cv2.imdecode(arr, cv2.IMREAD_COLOR)
            target_identifier = "base64_payload"
        except Exception:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid base64 encoding for image_b64.",
            )

    # 2. Analysis ID lookup
    elif body.analysis_id is not None:
        rec = get_analysis(body.analysis_id)
        if not rec or not rec.get("stored_name"):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Analysis ID {body.analysis_id} not found in database.",
            )
        target_name = rec["stored_name"]
        file_path = UPLOADS_DIR / target_name
        if not file_path.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stored file for analysis #{body.analysis_id} no longer exists.",
            )
        img_bgr = cv2.imread(str(file_path))
        target_identifier = target_name

    # 3. Direct stored_name lookup
    elif body.stored_name:
        file_path = UPLOADS_DIR / body.stored_name
        if not file_path.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Stored file '{body.stored_name}' not found.",
            )
        img_bgr = cv2.imread(str(file_path))
        target_identifier = body.stored_name

    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Must provide analysis_id, stored_name, or image_b64.",
        )

    if img_bgr is None or img_bgr.size == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Failed to decode image from the requested source.",
        )

    result = evaluate_robustness(
        image_input=img_bgr,
        epsilons=body.epsilons,
        attack=body.attack,
        pgd_steps=body.pgd_steps,
        pgd_alpha=body.pgd_alpha,
        force_enable=body.force_enable,
    )

    # Audit logging
    log_audit_event(
        action="adversarial_robustness_evaluation",
        user=current_user,
        target=target_identifier,
        ip_address=get_client_ip(request),
        details={
            "attack": body.attack,
            "status": result.get("status"),
            "baseline_score": result.get("baseline_score"),
        },
    )

    return result
