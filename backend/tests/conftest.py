"""
Shared pytest fixtures for the Clarity Mesh backend test suite (STEP 6).

Import setup: the backend imports its modules as ``services.*`` and
``routes.*`` from the ``backend/`` directory, so that directory is added
to ``sys.path`` here regardless of the pytest working directory.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _locate_face_fixture() -> Path | None:
    """Find a photographic test image that contains a detectable face."""
    candidates: list[Path] = []
    env = os.getenv("CLARITY_TEST_FACE")
    if env:
        candidates.append(Path(env))
    temp = os.getenv("TEMP") or os.getenv("TMP")
    if temp:
        candidates.append(Path(temp) / "clarity_step5" / "face_sample.jpg")
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


@pytest.fixture(scope="session")
def face_image_path() -> Path:
    """Path to a test image containing at least one detectable face.

    Set ``CLARITY_TEST_FACE`` to supply your own image; otherwise the
    STEP 5 fixture under ``%TEMP%\\clarity_step5\\`` is used. Face-dependent
    tests are skipped (not failed) when no fixture can be found.
    """
    path = _locate_face_fixture()
    if path is None:
        pytest.skip("No face test fixture available (set CLARITY_TEST_FACE)")
    return path


@pytest.fixture(scope="session")
def client():
    """FastAPI TestClient — exercises the real app in-process."""
    from fastapi.testclient import TestClient

    from main import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def history_db(tmp_path, monkeypatch):
    """Point the history store at a per-test temp database.

    Guarantees the test suite NEVER reads or writes the developer's real
    ``backend/data/history.db``. Returns the resolved temp DB path.
    """
    db_path = tmp_path / "history_test.db"
    monkeypatch.setenv("CLARITY_HISTORY_DB", str(db_path))
    return db_path


@pytest.fixture
def face_video_path(tmp_path, face_image_path) -> Path:
    """Short MP4 (12 frames @ 12 fps) built from the face fixture."""
    import cv2

    image = cv2.imread(str(face_image_path))
    assert image is not None, "face fixture could not be decoded"
    height, width = image.shape[:2]
    width -= width % 2   # mp4v requires even dimensions
    height -= height % 2
    out_path = tmp_path / "face_clip.mp4"
    writer = cv2.VideoWriter(
        str(out_path), cv2.VideoWriter_fourcc(*"mp4v"), 12.0, (width, height)
    )
    assert writer.isOpened(), "cv2.VideoWriter failed to open"
    frame = image[:height, :width]
    for _ in range(12):
        writer.write(frame)
    writer.release()
    assert out_path.exists() and out_path.stat().st_size > 0
    return out_path
