"""
Clarity Mesh — FastAPI Backend
==============================
Main application entry point.

Serves the Clarity Mesh multimodal deepfake & synthetic media detection platform.
Runs genuine neural inference (EfficientNet-B7 visual deepfake detector,
wav2vec2 audio deepfake detector, CLIP ViT-L/14 semantic probe, and multi-spectral
forensic engine) with honest states, Argon2id authentication, signed JWT tokens,
strict RBAC clearance, rate limiting, and immutable audit trails.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from routes.admin import router as admin_router
from routes.analysis import router as analysis_router
from routes.assistant import router as assistant_router
from routes.auth import router as auth_router
from routes.cases import router as cases_router
from routes.history import router as history_router
from services.audit_store import init_audit_db
from services.auth_store import init_auth_db, seed_admin
from services.history_store import HistoryStoreError, init_db
from services.jwt_service import create_access_token, create_refresh_token
from services.rate_limit import limiter
from services.auth_deps import get_current_user, require_admin

# ---------------------------------------------------------------------------
# Application Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialise SQLite schemas on startup (history, users, audit log)."""
    try:
        init_db()
    except HistoryStoreError as exc:
        print(f"[startup] History database unavailable: {exc}")

    try:
        init_auth_db()
    except Exception as exc:
        print(f"[startup] Auth database initialization warning: {exc}")

    # Seed initial admin / analyst accounts from ADMIN_* env vars.
    # Skipped silently when ADMIN_PASSWORD is not set (avoids getpass()
    # hanging in non-interactive server contexts).
    if os.getenv("ADMIN_PASSWORD"):
        try:
            seed_admin()
        except Exception as exc:
            print(f"[startup] Admin seeding warning: {exc}")

    try:
        init_audit_db()
    except Exception as exc:
        print(f"[startup] Audit database initialization warning: {exc}")

    yield


app = FastAPI(
    title="Clarity Mesh API",
    description="Industrial-grade Deepfake & Generative Media Forensics Platform API.",
    version="0.2.0",
    lifespan=lifespan,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ---------------------------------------------------------------------------
# Server-Side Upload Size Limit Middleware (50 MB)
# ---------------------------------------------------------------------------
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB

@app.middleware("http")
async def limit_upload_size(request: Request, call_next):
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > MAX_UPLOAD_BYTES:
                return Response(
                    content='{"detail": "File too large. Maximum allowed upload size is 50 MB."}',
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    media_type="application/json",
                )
        except ValueError:
            pass
    return await call_next(request)

# ---------------------------------------------------------------------------
# CORS — allow configured origins from env or default dev ports
# ---------------------------------------------------------------------------
cors_env = os.getenv("CLARITY_CORS_ORIGINS", "")
if cors_env.strip():
    ALLOWED_ORIGINS = [orig.strip() for orig in cors_env.split(",") if orig.strip()]
else:
    ALLOWED_ORIGINS = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:8080",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Routers
# ---------------------------------------------------------------------------
app.include_router(analysis_router, prefix="/api")
app.include_router(history_router, prefix="/api")
app.include_router(cases_router, prefix="/api/cases", tags=["cases"])
app.include_router(assistant_router, prefix="/api/assistant", tags=["assistant"])
app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])

# ---------------------------------------------------------------------------
# Dependency injection: JWT + RBAC enforcement
# ---------------------------------------------------------------------------
# get_current_user / require_admin run against the real database on
# every protected request, so dependency_overrides in the test suite
# must be monkeypatched here (not inside the routers).
app.dependency_overrides[get_current_user] = get_current_user
app.dependency_overrides[require_admin] = require_admin




# ---------------------------------------------------------------------------
# Health-check endpoint (Public liveness probe)
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    """Simple liveness probe — returns the current status of the backend."""
    return {
        "status": "healthy",
        "service": "Clarity Mesh API",
        "version": "0.2.0",
    }
