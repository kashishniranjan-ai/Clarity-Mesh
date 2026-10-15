"""
Clarity Mesh — Model Registry Routes
====================================
Read-only endpoints describing the registered detectors:

  GET /api/models       — every detector with identity, score direction,
                          thresholds, input contract and limitations
  GET /api/models/{id}  — one detector (visual | ai_image | audio | multimodal)

Metadata comes from services/model_registry.py (static, no ML imports), so
these endpoints never load weights, never run inference, and never fabricate
availability — they document the deployment contract.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from services.model_registry import DETECTORS, list_detectors

router = APIRouter()


@router.get("/models")
def get_models():
    """Return every registered detector's documented contract."""
    detectors = list_detectors()
    return {"count": len(detectors), "detectors": detectors}


@router.get("/models/{detector_id}")
def get_model(detector_id: str):
    """Return one detector's documented contract by id."""
    wanted = (detector_id or "").strip().lower()
    for entry in DETECTORS:
        if entry.get("id") == wanted:
            return dict(entry)
    valid = sorted(str(entry.get("id")) for entry in DETECTORS)
    raise HTTPException(
        status_code=404,
        detail=f"Unknown detector '{detector_id}'. Valid ids: {', '.join(valid)}.",
    )
