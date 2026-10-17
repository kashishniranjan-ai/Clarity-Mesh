"""
Tests for backend/evaluate.py — manifest parsing and metric computation.

These tests exercise ONLY the pure functions (label normalisation, manifest
loading, confusion-matrix arithmetic) with clearly synthetic rows. They do
not run any model and make no accuracy claims about the detectors.
"""

from __future__ import annotations

import csv
from pathlib import Path

import pytest

import evaluate as ev


# ---------------------------------------------------------------------------
# normalise_label
# ---------------------------------------------------------------------------
def test_normalise_label_accepts_real_fake_case_insensitively():
    assert ev.normalise_label("real") == "real"
    assert ev.normalise_label("REAL") == "real"
    assert ev.normalise_label(" Fake ") == "fake"
    assert ev.normalise_label("fake") == "fake"


def test_normalise_label_unknown_for_everything_else():
    assert ev.normalise_label("unknown") == "unknown"
    assert ev.normalise_label("") == "unknown"
    assert ev.normalise_label(None) == "unknown"
    assert ev.normalise_label("deepfake") == "unknown"  # not a manifest label
    assert ev.normalise_label("1") == "unknown"


# ---------------------------------------------------------------------------
# ManifestEntry / load_manifest
# ---------------------------------------------------------------------------
def _write_manifest(tmp_path: Path, rows: list[dict]) -> Path:
    path = tmp_path / "manifest.csv"
    fieldnames = ["filename", "label"]
    if any("face_label" in row for row in rows):
        fieldnames.append("face_label")
    if any("ai_image_label" in row for row in rows):
        fieldnames.append("ai_image_label")
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)
    return path


def test_load_manifest_basic(tmp_path):
    path = _write_manifest(
        tmp_path,
        [
            {"filename": "a.jpg", "label": "real"},
            {"filename": "b.mp4", "label": "FAKE"},
            {"filename": "c.png", "label": "unknown"},
        ],
    )
    entries = ev.load_manifest(path)
    assert [e.filename for e in entries] == ["a.jpg", "b.mp4", "c.png"]
    assert [e.label for e in entries] == ["real", "fake", "unknown"]


def test_load_manifest_per_detector_overrides(tmp_path):
    path = _write_manifest(
        tmp_path,
        [
            {
                "filename": "swap.jpg",
                "label": "fake",
                "face_label": "fake",
                "ai_image_label": "real",  # face swap = not wholly AI-generated
            }
        ],
    )
    entry = ev.load_manifest(path)[0]
    assert entry.effective_label("face") == "fake"
    assert entry.effective_label("ai_image") == "real"
    # audio/fusion fall back to the generic label
    assert entry.effective_label("audio") == "fake"


def test_load_manifest_missing_file_raises(tmp_path):
    with pytest.raises(ValueError, match="not found"):
        ev.load_manifest(tmp_path / "nope.csv")


def test_load_manifest_without_filename_column_raises(tmp_path):
    path = tmp_path / "bad.csv"
    path.write_text("name,label\na.jpg,real\n", encoding="utf-8")
    with pytest.raises(ValueError, match="filename"):
        ev.load_manifest(path)


def test_load_manifest_empty_rows_raises(tmp_path):
    path = tmp_path / "empty.csv"
    path.write_text("filename,label\n", encoding="utf-8")
    with pytest.raises(ValueError, match="no usable rows"):
        ev.load_manifest(path)


# ---------------------------------------------------------------------------
# detector_rows / compute_metrics — synthetic blocks, no inference
# ---------------------------------------------------------------------------
def _synthetic_result(
    visual=None, audio=None, ai_image=None, multimodal=None,
    truth="real", face_truth=None, ai_truth=None,
) -> ev.FileResult:
    """A FileResult with hand-written detector blocks (clearly synthetic)."""
    return ev.FileResult(
        filename="synthetic.jpg",
        ground_truth=truth,
        face_ground_truth=face_truth or truth,
        ai_image_ground_truth=ai_truth or truth,
        media_kind="image",
        visual=visual,
        audio=audio,
        ai_image=ai_image,
        multimodal=multimodal,
    )


def test_detector_rows_completed_block_is_scored():
    result = _synthetic_result(
        visual={"status": "completed", "score": 0.9, "classification": "deepfake", "threshold": 0.7},
        truth="fake",
    )
    rows = ev.detector_rows(result)
    face_row = next(r for r in rows if r["detector"] == "face")
    assert face_row["status"] == "completed"
    assert face_row["predicted_label"] == "fake"
    assert face_row["ground_truth"] == "fake"
    assert face_row["correct"] is True
    assert face_row["score"] == 0.9
    assert face_row["threshold"] == 0.7


def test_detector_rows_failed_block_is_not_scored():
    result = _synthetic_result(
        visual={"status": "inference_failed", "message": "synthetic"},
        truth="fake",
    )
    rows = ev.detector_rows(result)
    face_row = next(r for r in rows if r["detector"] == "face")
    assert face_row["correct"] is None   # no prediction was made
    assert face_row["predicted_label"] is None


def test_detector_rows_unknown_truth_excluded_from_correctness():
    result = _synthetic_result(
        visual={"status": "completed", "score": 0.5, "classification": "deepfake"},
        truth="unknown",
    )
    face_row = next(
        r for r in ev.detector_rows(result) if r["detector"] == "face"
    )
    assert face_row["predicted_label"] == "fake"
    assert face_row["ground_truth"] == "unknown"
    assert face_row["correct"] is None   # unverified truth -> not judged


def test_compute_metrics_confusion_matrix_and_derived_values():
    """Hand-checked synthetic arithmetic: tp=1 fp=1 tn=1 fn=1."""
    def row(detector, truth, pred, status="completed"):
        return {
            "detector": detector, "ground_truth": truth,
            "predicted_label": pred, "status": status, "error": None,
        }

    rows = [
        row("face", "fake", "fake"),   # tp
        row("face", "real", "fake"),   # fp
        row("face", "real", "real"),   # tn
        row("face", "fake", "real"),   # fn
    ]
    metrics = ev.compute_metrics(rows)["face"]
    assert metrics["confusion_matrix"] == {"tp": 1, "fp": 1, "tn": 1, "fn": 1}
    assert metrics["precision"] == pytest.approx(0.5)
    assert metrics["recall"] == pytest.approx(0.5)
    assert metrics["f1"] == pytest.approx(0.5)
    assert metrics["accuracy"] == pytest.approx(0.5)
    assert metrics["evaluated"] == 4


def test_compute_metrics_no_labelled_rows_returns_none_not_zero():
    rows = [
        {
            "detector": "ai_image", "ground_truth": "unknown",
            "predicted_label": "fake", "status": "completed", "error": None,
        }
    ]
    metrics = ev.compute_metrics(rows)["ai_image"]
    assert metrics["evaluated"] == 0
    assert metrics["unscored"] == 1
    # Honest: metrics are None (not computable), never fabricated 0.0.
    assert metrics["precision"] is None
    assert metrics["recall"] is None
    assert metrics["f1"] is None
    assert metrics["accuracy"] is None


def test_compute_metrics_separates_detectors():
    rows = [
        {
            "detector": "face", "ground_truth": "fake",
            "predicted_label": "fake", "status": "completed", "error": None,
        },
        {
            "detector": "ai_image", "ground_truth": "fake",
            "predicted_label": "real", "status": "completed", "error": None,
        },
    ]
    metrics = ev.compute_metrics(rows)
    assert metrics["face"]["confusion_matrix"]["tp"] == 1
    assert metrics["face"]["confusion_matrix"]["fp"] == 0
    # Whole-image detector judged independently: it missed this fake.
    assert metrics["ai_image"]["confusion_matrix"]["fn"] == 1
    assert metrics["ai_image"]["accuracy"] == 0.0  # single wrong prediction


def test_compute_metrics_counts_failures_and_not_applicable():
    rows = [
        {
            "detector": "audio", "ground_truth": "real",
            "predicted_label": None, "status": "no_audio", "error": None,
        },
        {
            "detector": "audio", "ground_truth": "fake",
            "predicted_label": None, "status": "inference_failed",
            "error": "synthetic",
        },
    ]
    metrics = ev.compute_metrics(rows)["audio"]
    assert metrics["total_files"] == 2
    assert metrics["evaluated"] == 0
    assert metrics["failed_or_errored"] == 1
    assert metrics["not_applicable"] == 0
    assert metrics["unscored"] == 1
    # Disjoint accounting must add up.
    assert (
        metrics["evaluated"] + metrics["not_applicable"]
        + metrics["failed_or_errored"] + metrics["unscored"]
        == metrics["total_files"]
    )
