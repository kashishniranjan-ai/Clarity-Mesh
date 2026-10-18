"""
Clarity Mesh — Audit Logging Service
====================================
SQLite-backed immutable audit trail for forensic accountability.
Records user actions, targeted entities, client IP addresses,
and operational metadata for every sensitive transaction.
"""

from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.history_store import DEFAULT_DB_PATH


class AuditStoreError(RuntimeError):
    """Raised when audit log operations fail."""


def _db_path() -> Path:
    override = os.getenv("CLARITY_HISTORY_DB")
    if override:
        return Path(override)
    return DEFAULT_DB_PATH


_AUDIT_SCHEMA = """
CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT NOT NULL,
    user_id     TEXT,
    user_email  TEXT,
    user_role   TEXT,
    action      TEXT NOT NULL,
    target      TEXT,
    ip_address  TEXT,
    details     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_email);
"""


def _connect() -> sqlite3.Connection:
    path = _db_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.executescript(_AUDIT_SCHEMA)
        return conn
    except (OSError, sqlite3.Error) as exc:
        raise AuditStoreError(f"Cannot open audit log database: {exc}") from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_audit_db() -> None:
    """Initialize audit_log table and indexes."""
    conn = _connect()
    try:
        with conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp   TEXT NOT NULL,
                    user_id     TEXT,
                    user_email  TEXT,
                    user_role   TEXT,
                    action      TEXT NOT NULL,
                    target      TEXT,
                    ip_address  TEXT,
                    details     TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp DESC);
                CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
                CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_email);
            """)
    finally:
        conn.close()


def log_audit_event(
    action: str,
    user: dict[str, Any] | None = None,
    target: str | None = None,
    ip_address: str | None = None,
    details: Any = None,
) -> None:
    """Record an audit trail event. Never raises to avoid disrupting requests."""
    try:
        user_id = user.get("id") if user else None
        user_email = user.get("email") if user else None
        user_role = user.get("role") if user else None

        details_str = (
            json.dumps(details, default=str)
            if details is not None and not isinstance(details, str)
            else (details or "")
        )

        conn = _connect()
        try:
            with conn:
                conn.execute(
                    """
                    INSERT INTO audit_log (
                        timestamp, user_id, user_email, user_role,
                        action, target, ip_address, details
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        _now(),
                        user_id,
                        user_email,
                        user_role,
                        action,
                        target,
                        ip_address or "127.0.0.1",
                        details_str,
                    ),
                )
        finally:
            conn.close()
    except Exception:
        # Audit logging failure must not crash business logic
        pass


def list_audit_logs(
    limit: int = 100,
    action: str | None = None,
) -> list[dict[str, Any]]:
    """Retrieve audit events, newest first."""
    conn = _connect()
    try:
        if action:
            rows = conn.execute(
                """
                SELECT id, timestamp, user_id, user_email, user_role,
                       action, target, ip_address, details
                FROM audit_log
                WHERE action = ?
                ORDER BY id DESC LIMIT ?
                """,
                (action, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, timestamp, user_id, user_email, user_role,
                       action, target, ip_address, details
                FROM audit_log
                ORDER BY id DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()

        logs = []
        for r in rows:
            entry = dict(r)
            if entry.get("details"):
                try:
                    entry["details_parsed"] = json.loads(entry["details"])
                except Exception:
                    entry["details_parsed"] = entry["details"]
            logs.append(entry)
        return logs
    finally:
        conn.close()
