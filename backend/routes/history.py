"""
Clarity Mesh — History Routes
=============================
Endpoints exposing the SQLite-backed analysis history:

  GET    /api/history        — list recent analyses (newest first)
  DELETE /api/history        — clear the entire history

The store never fabricates data: rows mirror what POST /api/analyze genuinely
returned, and storage failures become honest JSON errors (HTTP 503) rather
than empty lists or tracebacks.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from services.history_store import (
    HistoryStoreError,
    delete_all_analyses,
    list_analyses,
)
from services.analytics import build_dashboard

router = APIRouter()


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
    """Return the most recent stored analyses, newest first.

    ``limit`` clamps to 1–500. Scores are included ONLY where the original
    analysis genuinely produced one; failed blocks carry their status with a
    null score, exactly as they were returned by the API.
    """
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
def clear_history():
    """Delete every stored analysis. Returns how many rows were removed."""
    try:
        deleted = delete_all_analyses()
    except HistoryStoreError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Cannot clear history right now ({exc}).",
        ) from exc
    return {
        "deleted": deleted,
        "message": "History cleared." if deleted else "History was already empty.",
    }
