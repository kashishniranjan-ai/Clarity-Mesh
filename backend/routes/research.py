"""
Clarity Mesh — Research Spikes Endpoints
=========================================
Scaffold endpoints for:
- Source Attribution (POST /api/v2/attribution)
- Invisible Watermarks / SynthID (POST /api/v2/watermark)

These endpoints strictly return honest status: "unavailable" responses,
documenting the research architecture and future integration points.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from services.auth_deps import get_current_user
from services.rate_limit import limiter
from services.source_attribution import attribute_source
from services.synthid_stub import detect_watermark

router = APIRouter(prefix="/api/v2", dependencies=[Depends(get_current_user)])


class MediaLookupRequest(BaseModel):
    stored_name: str | None = None
    media_url: str | None = None


@router.post("/attribution")
@limiter.limit("10/minute")
async def get_source_attribution(
    request: Request,
    payload: MediaLookupRequest | None = None,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Scaffold endpoint for generator source attribution."""
    stored_name = payload.stored_name if payload else None
    return attribute_source(stored_name)


@router.post("/watermark")
@limiter.limit("10/minute")
async def get_watermark_detection(
    request: Request,
    payload: MediaLookupRequest | None = None,
    current_user: dict[str, Any] = Depends(get_current_user),
):
    """Scaffold endpoint for invisible watermark / SynthID detection."""
    stored_name = payload.stored_name if payload else None
    return detect_watermark(stored_name)
