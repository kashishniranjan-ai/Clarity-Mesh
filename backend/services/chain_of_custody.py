"""
Clarity Mesh — Chain of Custody Service
========================================
Cryptographic hash-chaining for the audit trail, providing tamper-evident
evidence integrity verification.

Each audit entry stores:
- `entry_hash`: SHA-256(timestamp + action + target + details + prev_hash)
- `prev_hash`: the `entry_hash` of the immediately preceding entry

A verification endpoint re-walks the chain from genesis to HEAD and
reports whether every link is intact.

NOTE: this is an application-level integrity signal for educational /
portfolio demonstration purposes. A production forensic system would use
a hardware-backed append-only log, not an SQLite column.
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.history_store import DEFAULT_DB_PATH


class ChainOfCustodyError(RuntimeError):
    """Raised when chain-of-custody operations fail."""


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

_CHAIN_SCHEMA = """
CREATE TABLE IF NOT EXISTS custody_chain (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp   TEXT    NOT NULL,
    action      TEXT    NOT NULL,
    actor_email TEXT,
    actor_role  TEXT,
    target      TEXT,
    details     TEXT,
    prev_hash   TEXT    NOT NULL DEFAULT '',
    entry_hash  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_custody_timestamp ON custody_chain(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_custody_target ON custody_chain(target);
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
        conn.executescript(_CHAIN_SCHEMA)
        return conn
    except (OSError, sqlite3.Error) as exc:
        raise ChainOfCustodyError(f"Cannot open custody database: {exc}") from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Hash computation
# ---------------------------------------------------------------------------

def compute_entry_hash(
    timestamp: str,
    action: str,
    target: str | None,
    details: str | None,
    prev_hash: str,
) -> str:
    """Deterministic SHA-256 of the canonical entry fields + previous hash."""
    canonical = json.dumps(
        {
            "timestamp": timestamp,
            "action": action,
            "target": target or "",
            "details": details or "",
            "prev_hash": prev_hash,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def init_custody_db() -> None:
    """Ensure custody_chain table exists."""
    conn = _connect()
    conn.close()


def append_custody_event(
    action: str,
    actor: dict[str, Any] | None = None,
    target: str | None = None,
    details: Any = None,
) -> dict[str, Any]:
    """Append a new hash-chained custody event.

    Returns the new entry dict (id, timestamp, entry_hash, prev_hash).
    """
    details_str = (
        json.dumps(details, default=str)
        if details is not None and not isinstance(details, str)
        else (details or "")
    )
    actor_email = (actor or {}).get("email")
    actor_role = (actor or {}).get("role")
    timestamp = _now()

    conn = _connect()
    try:
        # Fetch the most recent entry hash (or "" if genesis)
        last = conn.execute(
            "SELECT entry_hash FROM custody_chain ORDER BY id DESC LIMIT 1"
        ).fetchone()
        prev_hash = last["entry_hash"] if last else ""

        entry_hash = compute_entry_hash(
            timestamp, action, target, details_str, prev_hash
        )

        conn.execute(
            """
            INSERT INTO custody_chain
              (timestamp, action, actor_email, actor_role, target, details, prev_hash, entry_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (timestamp, action, actor_email, actor_role, target, details_str, prev_hash, entry_hash),
        )
        conn.commit()

        return {
            "id": conn.execute("SELECT last_insert_rowid()").fetchone()[0],
            "timestamp": timestamp,
            "action": action,
            "actor_email": actor_email,
            "target": target,
            "entry_hash": entry_hash,
            "prev_hash": prev_hash,
        }
    except sqlite3.Error as exc:
        raise ChainOfCustodyError(f"Cannot append custody event: {exc}") from exc
    finally:
        conn.close()


def verify_chain(limit: int = 5000) -> dict[str, Any]:
    """Walk the custody chain from entry #1 to HEAD and verify every hash link.

    Returns:
        {
            "intact": bool,
            "total_entries": int,
            "verified_entries": int,
            "first_broken_id": int | None,
            "first_broken_reason": str | None,
        }
    """
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT id, timestamp, action, target, details, prev_hash, entry_hash
            FROM custody_chain
            ORDER BY id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    except sqlite3.Error as exc:
        raise ChainOfCustodyError(f"Cannot read custody chain: {exc}") from exc
    finally:
        conn.close()

    total = len(rows)
    if total == 0:
        return {
            "intact": True,
            "total_entries": 0,
            "verified_entries": 0,
            "first_broken_id": None,
            "first_broken_reason": None,
        }

    expected_prev_hash = ""  # genesis has no predecessor
    for row in rows:
        row_dict = dict(row)
        # Verify prev_hash linkage
        if row_dict["prev_hash"] != expected_prev_hash:
            return {
                "intact": False,
                "total_entries": total,
                "verified_entries": row_dict["id"] - 1,
                "first_broken_id": row_dict["id"],
                "first_broken_reason": (
                    f"prev_hash mismatch at entry #{row_dict['id']}: "
                    f"expected {expected_prev_hash[:16]}…, "
                    f"got {row_dict['prev_hash'][:16]}…"
                ),
            }

        # Recompute and verify entry_hash
        recomputed = compute_entry_hash(
            row_dict["timestamp"],
            row_dict["action"],
            row_dict["target"],
            row_dict["details"],
            row_dict["prev_hash"],
        )
        if recomputed != row_dict["entry_hash"]:
            return {
                "intact": False,
                "total_entries": total,
                "verified_entries": row_dict["id"] - 1,
                "first_broken_id": row_dict["id"],
                "first_broken_reason": (
                    f"entry_hash tampered at entry #{row_dict['id']}: "
                    f"stored {row_dict['entry_hash'][:16]}…, "
                    f"recomputed {recomputed[:16]}…"
                ),
            }

        expected_prev_hash = row_dict["entry_hash"]

    return {
        "intact": True,
        "total_entries": total,
        "verified_entries": total,
        "first_broken_id": None,
        "first_broken_reason": None,
    }


def list_custody_events(
    target: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Return custody chain entries, newest first. Optionally filter by target."""
    conn = _connect()
    try:
        if target:
            rows = conn.execute(
                """
                SELECT id, timestamp, action, actor_email, actor_role,
                       target, details, prev_hash, entry_hash
                FROM custody_chain
                WHERE target = ?
                ORDER BY id DESC
                LIMIT ?
                """,
                (target, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, timestamp, action, actor_email, actor_role,
                       target, details, prev_hash, entry_hash
                FROM custody_chain
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()

        results = []
        for r in rows:
            entry = dict(r)
            if entry.get("details"):
                try:
                    entry["details_parsed"] = json.loads(entry["details"])
                except Exception:
                    entry["details_parsed"] = entry["details"]
            results.append(entry)
        return results
    except sqlite3.Error as exc:
        raise ChainOfCustodyError(f"Cannot list custody events: {exc}") from exc
    finally:
        conn.close()
