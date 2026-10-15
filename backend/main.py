"""
Clarity Mesh — FastAPI Backend
==============================
Main application entry point.

This backend serves the Clarity Mesh deepfake-detection platform.  The
analysis pipeline is implemented: ``POST /api/analyze`` validates the
uploaded image/video (type and size), decodes it with OpenCV, samples
frames, detects faces and runs the pretrained EfficientNet-B7 visual
deepfake model (STEP 6).  The response carries upload metadata plus a
``visual_analysis`` block with a genuine model-derived, uncalibrated
score — or an honest failure state with no score when inference cannot
run.  ``GET /api/health`` is a simple liveness probe.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes.analysis import router as analysis_router
from routes.history import router as history_router
from routes.models import router as models_router
from services.history_store import HistoryStoreError, init_db


# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Initialise the SQLite history schema on startup.

    A missing/unwritable database directory must not prevent the API from
    serving: history is an optional convenience, analysis is the core job.
    Failure is reported honestly on stdout.
    """
    try:
        init_db()
    except HistoryStoreError as exc:
        print(f"[startup] History database unavailable: {exc}")
    yield


app = FastAPI(
    title="Clarity Mesh API",
    description="Backend API for the Clarity Mesh deepfake-detection platform.",
    version="0.1.0",
    lifespan=lifespan,
)

# ---------------------------------------------------------------------------
# CORS — allow the Vite React dev-server to reach this backend
# ---------------------------------------------------------------------------
ALLOWED_ORIGINS = [
    "http://localhost:5173",   # Vite dev server (default port)
    "http://127.0.0.1:5173",
    "http://localhost:5175",   # Vite dev server (current port — auto-selected)
    "http://127.0.0.1:5175",
    "http://localhost:5174",   # next port Vite auto-selects when 5173/5175 are busy
    "http://127.0.0.1:5174",
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
app.include_router(models_router, prefix="/api")


# ---------------------------------------------------------------------------
# Health-check endpoint
# ---------------------------------------------------------------------------
@app.get("/api/health")
async def health_check():
    """Simple liveness probe — returns the current status of the backend."""
    return {
        "status": "healthy",
        "service": "Clarity Mesh API",
        "version": "0.1.0",
    }
