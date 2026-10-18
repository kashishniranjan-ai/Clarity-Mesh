"""
Clarity Mesh — History Routes
=============================
Endpoints exposing the SQLite-backed analysis history:

  GET    /api/history        — list recent analyses (newest first, authenticated)
  GET    /api/insights       — aggregate metrics (authenticated)
  DELETE /api/history        — clear entire history (Admin only + audit log)
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from services.audit_store import log_audit_event
from services.auth_deps import get_client_ip, get_current_user, require_admin
from services.history_store import (
    HistoryStoreError,
    delete_all_analyses,
    list_analyses,
)
from services.analytics import build_dashboard

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/insights")
def get_insights(days: int = Query(default=7, ge=1, le=90)):
    """Return transparent aggregate metrics for the most recent 500 records."""
    try:
        items = list_analyses(limit=500)
    except HistoryStoreError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Analytics are temporarily unavailable ({exc}).",
        ) from exc
    return build_dashboard(items, days=days)


@router.get("/history")
def get_history(limit: int = Query(default=50, ge=1, le=500)):
    """Return the most recent stored analyses, newest first."""
    try:
        items = list_analyses(limit=limit)
    except HistoryStoreError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Analysis history is temporarily unavailable "
                f"({exc}). Analyses still work; only persistence is affected."
            ),
        ) from exc
    return {"count": len(items), "items": items}


@router.delete("/history")
def clear_history(
    request: Request,
    current_admin: dict[str, Any] = Depends(require_admin),
):
    """Delete every stored analysis. Admin clearance required."""
    try:
        deleted = delete_all_analyses()
        log_audit_event(
            action="HISTORY_PURGE",
            user=current_admin,
            target="all_analyses",
            ip_address=get_client_ip(request),
            details={"deleted_count": deleted},
        )
    except HistoryStoreError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot clear history right now ({exc}).",
        ) from exc
    return {
        "deleted": deleted,
        "message": "History cleared." if deleted else "History was already empty.",
    }
