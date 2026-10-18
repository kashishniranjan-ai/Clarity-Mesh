"""
Clarity Mesh — Case Comments Service
=====================================
SQLite-backed threaded comments on investigation cases.

Each comment records the author, timestamp, and body. Comments are
soft-linked to a case_id; deleting a case cascades to its comments.
"""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.history_store import DEFAULT_DB_PATH


class CommentStoreError(RuntimeError):
    """Raised when comment storage operations fail."""


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

_COMMENT_SCHEMA = """
CREATE TABLE IF NOT EXISTS case_comments (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id     INTEGER NOT NULL,
    author_id   TEXT    NOT NULL,
    author_email TEXT   NOT NULL,
    author_name TEXT    NOT NULL DEFAULT '',
    body        TEXT    NOT NULL,
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_comments_case ON case_comments(case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_author ON case_comments(author_email);
"""


def _db_path() -> Path:
    override = os.getenv("CLARITY_HISTORY_DB")
    return Path(override) if override else DEFAULT_DB_PATH


def _connect() -> sqlite3.Connection:
    path = _db_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(_COMMENT_SCHEMA)
        return conn
    except (OSError, sqlite3.Error) as exc:
        raise CommentStoreError(f"Cannot open comments database: {exc}") from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def init_comments_db() -> None:
    """Ensure case_comments table exists."""
    conn = _connect()
    conn.close()


def add_comment(
    case_id: int,
    author: dict[str, Any],
    body: str,
) -> dict[str, Any]:
    """Add a comment to a case. Returns the new comment dict."""
    timestamp = _now()
    conn = _connect()
    try:
        # Verify case exists
        case_row = conn.execute("SELECT id FROM cases WHERE id = ?", (case_id,)).fetchone()
        if case_row is None:
            raise CommentStoreError(f"Case {case_id} not found")

        cursor = conn.execute(
            """
            INSERT INTO case_comments
              (case_id, author_id, author_email, author_name, body, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                case_id,
                author.get("id", ""),
                author.get("email", ""),
                author.get("name", ""),
                body.strip(),
                timestamp,
                timestamp,
            ),
        )
        conn.commit()
        comment_id = cursor.lastrowid

        return {
            "id": comment_id,
            "case_id": case_id,
            "author_id": author.get("id", ""),
            "author_email": author.get("email", ""),
            "author_name": author.get("name", ""),
            "body": body.strip(),
            "created_at": timestamp,
            "updated_at": timestamp,
        }
    except sqlite3.IntegrityError as exc:
        raise CommentStoreError(f"Cannot add comment: {exc}") from exc
    except sqlite3.Error as exc:
        raise CommentStoreError(f"Cannot add comment: {exc}") from exc
    finally:
        conn.close()


def list_comments(case_id: int, limit: int = 200) -> list[dict[str, Any]]:
    """List comments for a case, oldest first (chronological)."""
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT id, case_id, author_id, author_email, author_name,
                   body, created_at, updated_at
            FROM case_comments
            WHERE case_id = ?
            ORDER BY created_at ASC
            LIMIT ?
            """,
            (case_id, limit),
        ).fetchall()
        return [dict(r) for r in rows]
    except sqlite3.Error as exc:
        raise CommentStoreError(f"Cannot list comments: {exc}") from exc
    finally:
        conn.close()


def delete_comment(comment_id: int, requesting_user: dict[str, Any]) -> bool:
    """Delete a comment. Only the author or an admin may delete."""
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT author_id FROM case_comments WHERE id = ?", (comment_id,)
        ).fetchone()
        if row is None:
            return False

        is_author = row["author_id"] == requesting_user.get("id", "")
        is_admin = requesting_user.get("role") == "admin"
        if not is_author and not is_admin:
            raise CommentStoreError("Only the comment author or an admin may delete this comment")

        conn.execute("DELETE FROM case_comments WHERE id = ?", (comment_id,))
        conn.commit()
        return True
    except sqlite3.Error as exc:
        raise CommentStoreError(f"Cannot delete comment: {exc}") from exc
    finally:
        conn.close()
