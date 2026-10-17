"""SQLite-backed investigation cases and links to analysis records."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from services.history_store import DEFAULT_DB_PATH, get_analysis


class CaseStoreError(RuntimeError):
    pass


def _connect() -> sqlite3.Connection:
    path = Path(os.getenv("CLARITY_HISTORY_DB") or DEFAULT_DB_PATH)
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS cases (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                priority TEXT NOT NULL DEFAULT 'medium',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS case_analyses (
                case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
                analysis_id INTEGER NOT NULL,
                linked_at TEXT NOT NULL,
                PRIMARY KEY (case_id, analysis_id)
            );
            CREATE INDEX IF NOT EXISTS idx_cases_updated ON cases(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_case_analyses_record ON case_analyses(analysis_id);
        """)
        return connection
    except (OSError, sqlite3.Error) as exc:
        raise CaseStoreError(f"Cannot open case database: {exc}") from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def list_cases() -> list[dict[str, Any]]:
    connection = _connect()
    try:
        rows = connection.execute("""
            SELECT c.*, COUNT(ca.analysis_id) AS analysis_count
            FROM cases c LEFT JOIN case_analyses ca ON ca.case_id = c.id
            GROUP BY c.id ORDER BY c.updated_at DESC, c.id DESC
        """).fetchall()
        return [dict(row) for row in rows]
    except sqlite3.Error as exc:
        raise CaseStoreError(f"Cannot list cases: {exc}") from exc
    finally:
        connection.close()


def create_case(title: str, summary: str = "", priority: str = "medium") -> dict[str, Any]:
    connection = _connect()
    timestamp = _now()
    try:
        cursor = connection.execute(
            "INSERT INTO cases (title, summary, priority, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            (title.strip(), summary.strip(), priority, timestamp, timestamp),
        )
        connection.commit()
        return get_case(int(cursor.lastrowid))  # type: ignore[return-value]
    except sqlite3.Error as exc:
        raise CaseStoreError(f"Cannot create case: {exc}") from exc
    finally:
        connection.close()


def update_case(case_id: int, *, status: str | None = None, priority: str | None = None, summary: str | None = None) -> dict[str, Any] | None:
    connection = _connect()
    try:
        current = connection.execute("SELECT id FROM cases WHERE id = ?", (case_id,)).fetchone()
        if not current:
            return None
        updates: dict[str, Any] = {"updated_at": _now()}
        if status is not None: updates["status"] = status
        if priority is not None: updates["priority"] = priority
        if summary is not None: updates["summary"] = summary.strip()
        assignments = ", ".join(f"{column} = ?" for column in updates)
        connection.execute(f"UPDATE cases SET {assignments} WHERE id = ?", (*updates.values(), case_id))
        connection.commit()
    except sqlite3.Error as exc:
        raise CaseStoreError(f"Cannot update case: {exc}") from exc
    finally:
        connection.close()
    return get_case(case_id)


def get_case(case_id: int) -> dict[str, Any] | None:
    connection = _connect()
    try:
        row = connection.execute("SELECT * FROM cases WHERE id = ?", (case_id,)).fetchone()
        if row is None:
            return None
        case = dict(row)
        links = connection.execute(
            "SELECT analysis_id, linked_at FROM case_analyses WHERE case_id = ? ORDER BY linked_at DESC",
            (case_id,),
        ).fetchall()
    except sqlite3.Error as exc:
        raise CaseStoreError(f"Cannot read case: {exc}") from exc
    finally:
        connection.close()
    analyses = []
    for link in links:
        record = get_analysis(link["analysis_id"])
        if record is not None:
            analyses.append({**record, "linked_at": link["linked_at"]})
    case["analyses"] = analyses
    case["analysis_count"] = len(analyses)
    return case


def link_analysis(case_id: int, analysis_id: int) -> dict[str, Any] | None:
    if get_analysis(analysis_id) is None:
        return None
    connection = _connect()
    try:
        if not connection.execute("SELECT 1 FROM cases WHERE id = ?", (case_id,)).fetchone():
            return None
        connection.execute(
            "INSERT OR IGNORE INTO case_analyses (case_id, analysis_id, linked_at) VALUES (?, ?, ?)",
            (case_id, analysis_id, _now()),
        )
        connection.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (_now(), case_id))
        connection.commit()
    except sqlite3.Error as exc:
        raise CaseStoreError(f"Cannot link analysis: {exc}") from exc
    finally:
        connection.close()
    return get_case(case_id)


def unlink_analysis(case_id: int, analysis_id: int) -> dict[str, Any] | None:
    connection = _connect()
    try:
        if not connection.execute("SELECT 1 FROM cases WHERE id = ?", (case_id,)).fetchone():
            return None
        connection.execute("DELETE FROM case_analyses WHERE case_id = ? AND analysis_id = ?", (case_id, analysis_id))
        connection.execute("UPDATE cases SET updated_at = ? WHERE id = ?", (_now(), case_id))
        connection.commit()
    except sqlite3.Error as exc:
        raise CaseStoreError(f"Cannot unlink analysis: {exc}") from exc
    finally:
        connection.close()
    return get_case(case_id)


def delete_case(case_id: int) -> bool:
    connection = _connect()
    try:
        cursor = connection.execute("DELETE FROM cases WHERE id = ?", (case_id,))
        connection.commit()
        return cursor.rowcount > 0
    except sqlite3.Error as exc:
        raise CaseStoreError(f"Cannot delete case: {exc}") from exc
    finally:
        connection.close()
