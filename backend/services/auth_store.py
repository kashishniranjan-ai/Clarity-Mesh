"""
Clarity Mesh — User Store & Identity Persistence
================================================
SQLite-backed user storage with Argon2id password hashing, role-based
clearance management, account lockout after repeated failed attempts,
and initial root admin seeding from environment variables.
"""

from __future__ import annotations

import os
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, VerifyMismatchError

from services.history_store import DEFAULT_DB_PATH

# ---------------------------------------------------------------------------
# Configuration & Argon2 Hasher
# ---------------------------------------------------------------------------
ph = PasswordHasher(
    time_cost=2,
    memory_cost=65536,  # 64 MB
    parallelism=1,
    hash_len=32,
    salt_len=16,
)

MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_SECONDS = 900  # 15 minutes


class AuthStoreError(RuntimeError):
    """Raised when user storage operations fail."""


def _db_path() -> Path:
    override = os.getenv("CLARITY_HISTORY_DB")
    if override:
        return Path(override)
    return DEFAULT_DB_PATH


_USERS_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id                     TEXT PRIMARY KEY,
    email                  TEXT UNIQUE NOT NULL,
    name                   TEXT NOT NULL,
    password_hash          TEXT NOT NULL,
    role                   TEXT NOT NULL DEFAULT 'analyst',
    clearance              TEXT NOT NULL,
    department             TEXT NOT NULL,
    avatar                 TEXT,
    failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
    locked_until           REAL NOT NULL DEFAULT 0.0,
    created_at             TEXT NOT NULL,
    updated_at             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
"""


def _connect() -> sqlite3.Connection:
    path = _db_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.executescript(_USERS_SCHEMA)
        return conn
    except (OSError, sqlite3.Error) as exc:
        raise AuthStoreError(f"Cannot open user database: {exc}") from exc


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def init_auth_db() -> None:
    """Initialize users table only.

    Schema initialization is separate from data seeding.  Use
    :func:`seed_admin` (or call it from the application lifespan) to
    provision the initial admin / analyst accounts from environment
    variables.  Keeping seed logic out of ``init_auth_db`` means the test
    suite can set up a clean schema without requiring ``ADMIN_PASSWORD``
    to be defined.
    """
    conn = _connect()
    try:
        with conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id                     TEXT PRIMARY KEY,
                    email                  TEXT UNIQUE NOT NULL,
                    name                   TEXT NOT NULL,
                    password_hash          TEXT NOT NULL,
                    role                   TEXT NOT NULL DEFAULT 'analyst',
                    clearance              TEXT NOT NULL,
                    department             TEXT NOT NULL,
                    avatar                 TEXT,
                    failed_login_attempts  INTEGER NOT NULL DEFAULT 0,
                    locked_until           REAL NOT NULL DEFAULT 0.0,
                    created_at             TEXT NOT NULL,
                    updated_at             TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
            """)
    finally:
        conn.close()
def get_user_by_email(email: str) -> dict[str, Any] | None:
    """Retrieve full user record by normalized email."""
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.strip().lower(),)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: str) -> dict[str, Any] | None:
    """Retrieve full user record by unique ID."""
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE id = ?", (user_id,)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_users() -> list[dict[str, Any]]:
    """List all users without exposing password hashes."""
    conn = _connect()
    try:
        rows = conn.execute(
            """
            SELECT id, email, name, role, clearance, department, avatar,
                   failed_login_attempts, locked_until, created_at, updated_at
            FROM users ORDER BY created_at ASC
            """
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_user(
    email: str,
    name: str,
    password: str,
    role: str = "analyst",
) -> dict[str, Any]:
    """Create a new user. Always defaults role to analyst for self-registration."""
    clean_email = email.strip().lower()
    if get_user_by_email(clean_email):
        raise AuthStoreError("An account with this email is already registered.")

    # Enforce role safety: self-registration CANNOT create admin accounts
    assigned_role = "analyst"
    clearance = "Tier 2 — Field Forensic Investigator"
    department = "National Security Cyber Telemetry Unit"

    user_id = f"usr_{uuid.uuid4().hex[:10]}"
    password_hash = ph.hash(password)
    now_str = _now()

    conn = _connect()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO users (
                    id, email, name, password_hash, role, clearance,
                    department, avatar, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    user_id,
                    clean_email,
                    name.strip(),
                    password_hash,
                    assigned_role,
                    clearance,
                    department,
                    "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
                    now_str,
                    now_str,
                ),
            )
        return get_user_by_id(user_id)  # type: ignore[return-value]
    finally:
        conn.close()


def update_user_role(user_id: str, new_role: str) -> dict[str, Any]:
    """Promote or demote a user. Only an existing admin may change roles."""
    allowed_roles = {"admin", "analyst"}
    if new_role not in allowed_roles:
        raise AuthStoreError(f"Role '{new_role}' is not in {allowed_roles}.")

    conn = _connect()
    try:
        row = conn.execute("SELECT role FROM users WHERE id = ?", (user_id,)).fetchone()
        if row is None:
            raise AuthStoreError(f"User '{user_id}' does not exist.")

        current_role = row["role"]
        # Never demote an existing admin to analyst through this path.
        if current_role == "admin" and new_role != "admin":
            raise AuthStoreError("Cannot demote an existing administrator.")

        with conn:
            conn.execute(
                "UPDATE users SET role = ?, updated_at = ? WHERE id = ?",
                (new_role, _now(), user_id),
            )
        return get_user_by_id(user_id)  # type: ignore[return-value]
    finally:
        conn.close()


def seed_admin(password: str | None = None) -> dict[str, Any]:
    """Create the **first** admin account (if needed) using ADMIN_* env vars.

    This is intentionally the *only* programmatic way to create a committed
    admin account.  The database schema and defaults allow the root account
    to be provisioned purely from the environment, which keeps it out of
    version control and out of the test fixtures.

    Args:
        password: Optional explicit password.  If not provided, falls back to
            the ``ADMIN_PASSWORD`` environment variable, and finally to an
            interactive ``getpass`` prompt (only for local development).

    Returns the created/updated admin record.
    """
    email = os.getenv("ADMIN_EMAIL", "admin@claritymesh.ai").strip().lower()
    name = os.getenv("ADMIN_NAME", "Director S. Vance")

    if password is None:
        password = os.getenv("ADMIN_PASSWORD")

    if not password:
        import getpass

        # Interactive fallback: ask for a password at the terminal when the
        # environment variable is not set.  Typical production deployments
        # set ADMIN_PASSWORD in the secret manager, so the prompt is only a
        # safety net for local development.
        password = getpass.getpass("Enter the initial admin password: ")

    if len(password) < 12:
        raise AuthStoreError("The initial admin password must be at least 12 characters.")

    conn = _connect()
    try:
        with conn:
            conn.execute(
                """
                INSERT INTO users (id, email, name, password_hash, role, clearance,
                    department, avatar, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(email) DO UPDATE SET
                    name = excluded.name,
                    password_hash = excluded.password_hash,
                    updated_at = excluded.updated_at
                """,
                (
                    f"usr_{uuid.uuid4().hex[:10]}",
                    email,
                    name,
                    ph.hash(password),
                    "admin",
                    "Tier 4 — SecOps Root Commander",
                    "Autonomous Threat Interception & Defense",
                    "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
                    _now(),
                    _now(),
                ),
            )
        conn.commit()
    finally:
        conn.close()
    return get_user_by_email(email)
def update_user_role(user_id: str, new_role: str) -> dict[str, Any]:
    """Promote or demote a user's role (Admin only)."""
    if new_role not in ("admin", "analyst"):
        raise AuthStoreError("Role must be 'admin' or 'analyst'.")

    clearance = (
        "Tier 4 — SecOps Root Commander"
        if new_role == "admin"
        else "Tier 2 — Senior Forensic Investigator"
    )
    now_str = _now()

    conn = _connect()
    try:
        with conn:
            cursor = conn.execute(
                """
                UPDATE users
                SET role = ?, clearance = ?, updated_at = ?
                WHERE id = ?
                """,
                (new_role, clearance, now_str, user_id),
            )
            if cursor.rowcount == 0:
                raise AuthStoreError(f"User {user_id} not found.")
        return get_user_by_id(user_id)  # type: ignore[return-value]
    finally:
        conn.close()


def verify_user_credentials(
    email: str, password: str
) -> tuple[dict[str, Any] | None, str | None]:
    """
    Verify user credentials against Argon2 hash with lockout protection.
    Returns (user_dict, None) on success or (None, failure_reason) on error.
    """
    clean_email = email.strip().lower()
    user = get_user_by_email(clean_email)
    if not user:
        return None, "Invalid email or password."

    current_time = time.time()
    locked_until = user.get("locked_until", 0.0)
    if locked_until > current_time:
        remaining_secs = int(locked_until - current_time)
        return None, f"Account locked due to repeated failed logins. Try again in {remaining_secs} seconds."

    try:
        ph.verify(user["password_hash"], password)
        # Check if hash needs rehash with updated parameters
        if ph.check_needs_rehash(user["password_hash"]):
            new_hash = ph.hash(password)
            conn = _connect()
            try:
                with conn:
                    conn.execute(
                        "UPDATE users SET password_hash = ? WHERE id = ?",
                        (new_hash, user["id"]),
                    )
            finally:
                conn.close()

        # Reset failed attempts on success
        if user.get("failed_login_attempts", 0) > 0:
            conn = _connect()
            try:
                with conn:
                    conn.execute(
                        "UPDATE users SET failed_login_attempts = 0, locked_until = 0.0 WHERE id = ?",
                        (user["id"],),
                    )
            finally:
                conn.close()

        return user, None

    except (VerifyMismatchError, VerificationError):
        # Increment failed attempts
        failed = user.get("failed_login_attempts", 0) + 1
        new_locked_until = 0.0
        if failed >= MAX_FAILED_ATTEMPTS:
            new_locked_until = current_time + LOCKOUT_DURATION_SECONDS

        conn = _connect()
        try:
            with conn:
                conn.execute(
                    "UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?",
                    (failed, new_locked_until, user["id"]),
                )
        finally:
            conn.close()

        if new_locked_until > 0.0:
            return None, "Too many failed attempts. Account locked for 15 minutes."
        remaining = MAX_FAILED_ATTEMPTS - failed
        return None, f"Invalid credentials. ({remaining} attempt(s) remaining before lockout)."
