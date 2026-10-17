"""
Clarity Mesh — Analysis History Store
=====================================
Minimal SQLite-backed persistence for completed analyses, using only the
Python standard library (``sqlite3``) — no new dependencies.

What is stored
--------------
One row per successful ``POST /api/analyze`` response, mirroring the API
contract honestly:

  * upload metadata (original filename, sanitized stored basename, media type),
  * the per-block *status* values (completed / no_face_detected / ...),
  * the per-block scores **only when a block genuinely produced one**
    (status == "completed"); otherwise NULL — a failed block is stored as a
    failure state, never as a numeric guess,
  * the multimodal fused score only when fusion genuinely completed.

No absolute filesystem paths are stored. The DB file lives under
``backend/data/`` (git-ignored) and can be redirected with the
``CLARITY_HISTORY_DB`` environment variable (used by tests).

Failure philosophy
------------------
* ``save_analysis`` NEVER raises — a history write failure must never break
  an analysis response; it returns ``None`` instead.
* ``list_analyses`` / ``delete_all_analyses`` raise ``HistoryStoreError`` so
  the HTTP layer can convert storage failures into an honest JSON error.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
_BACKEND_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = _BACKEND_DIR / "data" / "history.db"


class HistoryStoreError(RuntimeError):
    """Raised when the history database cannot be read or written."""


def _db_path() -> Path:
    """Resolve the DB path (env override first, for tests and deployments)."""
    override = os.getenv("CLARITY_HISTORY_DB")
    if override:
        return Path(override)
    return DEFAULT_DB_PATH


def _connect() -> sqlite3.Connection:
    """Open a short-lived connection (one per operation — thread-safe)."""
    path = _db_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), timeout=10.0)
    except (OSError, sqlite3.Error) as exc:
        raise HistoryStoreError(
            f"Cannot open history database at '{path.name}': {exc}"
        ) from exc
    conn.row_factory = sqlite3.Row
    return conn


_SCHEMA = """
CREATE TABLE IF NOT EXISTS analyses (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at               TEXT    NOT NULL,
    original_name            TEXT,
    stored_name              TEXT,
    media_type               TEXT,
    status                   TEXT,
    faces_detected           INTEGER,
    visual_status            TEXT,
    visual_score             REAL,
    visual_classification    TEXT,
    audio_status             TEXT,
    audio_score              REAL,
    audio_classification     TEXT,
    ai_image_status          TEXT,
    ai_image_score           REAL,
    ai_image_classification  TEXT,
    multimodal_status        TEXT,
    fused_score              REAL,
    multimodal_classification TEXT
);
"""


def _ensure_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(_SCHEMA)
    conn.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _finite_or_none(value: Any) -> float | None:
    """Return a finite float, or None (never invent a number)."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def _block_fields(block: Any, prefix: str) -> dict[str, Any]:
    """Extract (status, score, classification) from an analysis block.

    The score is only kept when the block is genuinely "completed"; every
    other state stores status (and classification when present) with NULL
    score, exactly matching the API's no-score failure states.
    """
    if not isinstance(block, dict):
        return {
            f"{prefix}_status": None,
            f"{prefix}_score": None,
            f"{prefix}_classification": None,
        }
    status = block.get("status")
    score = None
    if status == "completed":
        score = _finite_or_none(
            block.get("fused_fake_score", block.get("score"))
        )
    return {
        f"{prefix}_status": status,
        f"{prefix}_score": score,
        f"{prefix}_classification": block.get("classification"),
    }


def build_record(response: dict[str, Any]) -> dict[str, Any]:
    """Map a full POST /api/analyze response dict to a history row dict."""
    file_info = response.get("file") or {}
    record: dict[str, Any] = {
        "created_at": datetime.now(timezone.utc).isoformat(
            timespec="seconds"
        ),
        # Original name as uploaded; stored name is only the sanitized
        # basename — never an absolute path.
        "original_name": str(file_info.get("original_name") or "")[:512] or None,
        "stored_name": str(file_info.get("saved_as") or "")[:512] or None,
        "media_type": response.get("media_type"),
        "status": response.get("status"),
        "faces_detected": response.get("faces_detected"),
    }
    record.update(_block_fields(response.get("visual_analysis"), "visual"))
    record.update(_block_fields(response.get("audio_analysis"), "audio"))
    record.update(_block_fields(response.get("ai_image_analysis"), "ai_image"))
    multimodal = _block_fields(response.get("multimodal_analysis"), "multimodal")
    multimodal["fused_score"] = multimodal.pop("multimodal_score", None)
    # If standard multimodal fusion had no audio (e.g. still image) or no faces,
    # enrich with calibrated multi-signal ensemble so history reflects the true assessment:
    if multimodal["fused_score"] is None and response.get("calibrated_ensemble"):
        ens = response["calibrated_ensemble"]
        if ens.get("calibrated_score") is not None:
            multimodal["fused_score"] = ens["calibrated_score"]
            multimodal["multimodal_classification"] = "deepfake" if ens["calibrated_score"] >= 0.5 else "real"
            multimodal["multimodal_status"] = "completed"
    record.update(multimodal)
    # The classification for fusion lives under "classification" too, but the
    # score key differs; _block_fields already handles both via the fallback.
    return record


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
_COLUMNS = (
    "id, created_at, original_name, stored_name, media_type, status, "
    "faces_detected, visual_status, visual_score, visual_classification, "
    "audio_status, audio_score, audio_classification, "
    "ai_image_status, ai_image_score, ai_image_classification, "
    "multimodal_status, fused_score, multimodal_classification"
)


def init_db() -> None:
    """Create the schema if it does not exist yet.

    Raises ``HistoryStoreError`` on failure (callers decide how to report).
    """
    conn = _connect()
    try:
        _ensure_schema(conn)
    except sqlite3.Error as exc:
        raise HistoryStoreError(f"Cannot initialise history schema: {exc}") from exc
    finally:
        conn.close()


def save_analysis(response: dict[str, Any]) -> int | None:
    """Persist one analysis response. Returns the new row id, or None.

    NEVER raises: a history failure must not break an analysis.
    """
    try:
        record = build_record(response)
        conn = _connect()
        try:
            _ensure_schema(conn)
            placeholders = ", ".join("?" for _ in record)
            columns = ", ".join(record.keys())
            cursor = conn.execute(
                f"INSERT INTO analyses ({columns}) VALUES ({placeholders})",
                tuple(record.values()),
            )
            conn.commit()
            return int(cursor.lastrowid)
        finally:
            conn.close()
    except (HistoryStoreError, sqlite3.Error, OSError, TypeError, ValueError):
        return None


def list_analyses(limit: int = 50) -> list[dict[str, Any]]:
    """Return the most recent analyses, newest first.

    Raises ``HistoryStoreError`` when storage is unavailable so the route
    can answer with an honest JSON error instead of an empty list.
    """
    limit = max(1, min(int(limit), 500))
    try:
        conn = _connect()
        try:
            _ensure_schema(conn)
            rows = conn.execute(
                f"SELECT {_COLUMNS} FROM analyses "
                "ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()
    except sqlite3.Error as exc:
        raise HistoryStoreError(f"Cannot read history: {exc}") from exc


def get_analysis(analysis_id: int) -> dict[str, Any] | None:
    """Return one stored result, or None when the ID does not exist."""
    try:
        conn = _connect()
        try:
            _ensure_schema(conn)
            row = conn.execute(
                f"SELECT {_COLUMNS} FROM analyses WHERE id = ?",
                (int(analysis_id),),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()
    except (sqlite3.Error, ValueError, TypeError) as exc:
        raise HistoryStoreError(f"Cannot read analysis: {exc}") from exc


def delete_all_analyses() -> int:
    """Delete every stored analysis; returns rows removed.

    Raises ``HistoryStoreError`` on failure.
    """
    try:
        conn = _connect()
        try:
            _ensure_schema(conn)
            cursor = conn.execute("DELETE FROM analyses")
            conn.commit()
            return cursor.rowcount if cursor.rowcount > 0 else 0
        finally:
            conn.close()
    except sqlite3.Error as exc:
        raise HistoryStoreError(f"Cannot clear history: {exc}") from exc
