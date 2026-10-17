#!/usr/bin/env python3
"""
Clarity Mesh — Offline Evaluation Script
========================================
Runs the real detectors over a local manifest of media files with verified
labels and writes honest per-file results + per-detector metrics.

USAGE
-----
    python evaluate.py --manifest manifest.csv --data-dir /path/to/media
                       [--output-dir results] [--limit N]

MANIFEST FORMAT (CSV)
---------------------
    filename,label
    real_person_01.jpg,real
    face_swap_04.mp4,fake
    unknown_clip.webm,unknown

    * ``filename``  — file relative to --data-dir (subfolders allowed).
    * ``label``     — verified ground truth: ``real`` or ``fake``
                      (case-insensitive). Use ``unknown`` (or leave empty)
                      when the true label is not verified — unknown items are
                      still analysed and reported, but are EXCLUDED from the
                      metric aggregates.
    * Optional per-detector override columns ``face_label`` and
      ``ai_image_label``: face-manipulation fakes (e.g. a face swap inside an
      otherwise photographed image) and wholly AI-generated images are
      DIFFERENT phenomena — when your ground truth distinguishes them, supply
      both columns and each detector is scored only against its own label.
      A detector whose effective label is ``unknown``/absent contributes to
      the "unscored" count, never to metrics.

WHAT RUNS
---------
    * EfficientNet-B7 face-manipulation detector (visual, face crops) —
      images and videos.
    * UFD/CLIP whole-image AI-generation detector — still images.
    * NII wav2vec2 audio detector — images (no-op) and videos with audio.
    * Multimodal fusion — videos where both visual and audio completed.

Each detector's metrics (confusion matrix, precision, recall, F1, accuracy)
are computed ONLY over files where (a) the detector genuinely produced a
score (status "completed") and (b) the manifest provides a verified
real/fake label for that detector. Failures, no-face files and unknown
labels are reported as explicit counts — never silently dropped.

HONESTY NOTES
-------------
    * Scores are the same uncalibrated model outputs the API returns; this
      script does not recalibrate them and does not tune any threshold.
    * Thresholds are imported from the detector modules themselves
      (visual 0.7, audio 0.5, ai-image 0.5, fusion 0.5) so evaluation and
      production can never drift apart.
    * The script makes no accuracy claims of its own; the numbers it prints
      describe ONLY the manifest you provide.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Allow running as `python evaluate.py` from the backend/ directory.
_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Thresholds are imported from the detector modules so evaluation and
# production can never drift apart.
from services.visual_detector import (  # noqa: E402
    CLASSIFICATION_THRESHOLD as VISUAL_THRESHOLD,
)
from services.audio_detector import (  # noqa: E402
    CLASSIFICATION_THRESHOLD as AUDIO_THRESHOLD,
)
from services.ai_image_detector import (  # noqa: E402
    CLASSIFICATION_THRESHOLD as AI_IMAGE_THRESHOLD,
)
from services.multimodal_fusion import FUSION_THRESHOLD  # noqa: E402

# ---------------------------------------------------------------------------
# Label vocabulary
# ---------------------------------------------------------------------------
LABEL_REAL = "real"
LABEL_FAKE = "fake"
LABEL_UNKNOWN = "unknown"
_VALID_LABELS = {LABEL_REAL, LABEL_FAKE, LABEL_UNKNOWN}


def normalise_label(raw: Any) -> str:
    """Map a manifest cell to ``real`` / ``fake`` / ``unknown``.

    Only exact (case-insensitive) "real"/"fake" are verified; everything
    else — including empty cells and typos — is treated as ``unknown``,
    i.e. excluded from metrics rather than guessed.
    """
    if raw is None:
        return LABEL_UNKNOWN
    value = str(raw).strip().lower()
    if value in _VALID_LABELS:
        return value
    return LABEL_UNKNOWN


@dataclass
class ManifestEntry:
    """One row of the manifest CSV."""

    filename: str
    label: str = LABEL_UNKNOWN          # fallback ground truth for all detectors
    face_label: str | None = None       # optional override: face detector
    ai_image_label: str | None = None   # optional override: AI-image detector

    def effective_label(self, detector: str) -> str:
        """Ground truth for a specific detector, or ``unknown``.

        The per-detector column wins when present; otherwise the generic
        ``label`` column applies to every detector.
        """
        if detector == "face" and self.face_label is not None:
            return self.face_label
        if detector == "ai_image" and self.ai_image_label is not None:
            return self.ai_image_label
        return self.label


def load_manifest(path: Path) -> list[ManifestEntry]:
    """Parse the manifest CSV. Raises ValueError on structural problems."""
    if not path.is_file():
        raise ValueError(f"Manifest not found: {path}")
    entries: list[ManifestEntry] = []
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        header = [
            (name or "").strip().lower() for name in (reader.fieldnames or [])
        ]
        if "filename" not in header:
            raise ValueError(
                "Manifest must have a header row containing a 'filename' column."
            )
        for row in reader:
            # Tolerate any casing in header names.
            normalised = {
                (key or "").strip().lower(): (value or "").strip()
                for key, value in row.items()
            }
            filename = normalised.get("filename", "")
            if not filename:
                continue  # skip blank rows rather than inventing entries
            face_raw = normalised.get("face_label")
            ai_raw = normalised.get("ai_image_label")
            entries.append(
                ManifestEntry(
                    filename=filename,
                    label=normalise_label(normalised.get("label")),
                    # None means "column absent" (fall back to label);
                    # an explicit value is normalised.
                    face_label=normalise_label(face_raw) if face_raw else None,
                    ai_image_label=(
                        normalise_label(ai_raw) if ai_raw else None
                    ),
                )
            )
    if not entries:
        raise ValueError("Manifest contains no usable rows.")
    return entries


# ---------------------------------------------------------------------------
# Per-file inference — mirrors backend/routes/analysis.py exactly
# ---------------------------------------------------------------------------
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp", ".tif", ".tiff"}
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}


def _media_kind_for(path: Path) -> str:
    """Classify a local file by extension (same families as the API)."""
    ext = path.suffix.lower()
    if ext in IMAGE_EXTS:
        return "image"
    if ext in VIDEO_EXTS:
        return "video"
    return "unknown"


@dataclass
class FileResult:
    """Raw detector outputs for one manifest entry (no metrics here)."""

    filename: str
    ground_truth: str
    face_ground_truth: str
    ai_image_ground_truth: str
    media_kind: str = "unknown"
    error: str | None = None
    visual: dict[str, Any] | None = None
    audio: dict[str, Any] | None = None
    ai_image: dict[str, Any] | None = None
    multimodal: dict[str, Any] | None = None
    elapsed_seconds: float = 0.0


def analyse_file(path: Path, entry: ManifestEntry) -> FileResult:
    """Run every applicable detector on one file, exactly as the API does.

    Never raises for detector/processing problems — those become honest
    ``error`` strings and per-block failure statuses.
    """
    from services.media_processor import (
        MediaProcessingError,
        process_image,
        process_video,
    )
    from services.face_processor import analyse_frames
    from services.visual_detector import analyse_media
    from services.audio_detector import analyse_audio_media
    from services.ai_image_detector import analyse_ai_image
    from services.multimodal_fusion import fuse_multimodal_results

    result = FileResult(
        filename=str(entry.filename),
        ground_truth=entry.label,
        face_ground_truth=entry.effective_label("face"),
        ai_image_ground_truth=entry.effective_label("ai_image"),
        media_kind=_media_kind_for(path),
    )
    if not path.is_file():
        result.error = "file_not_found"
        return result

    started = time.perf_counter()
    try:
        if result.media_kind == "image":
            processed = process_image(path)
            media_frames = [(0, processed["image"])]
        elif result.media_kind == "video":
            processed = process_video(path)
            media_frames = processed["frames"]
        else:
            result.error = "unsupported_extension"
            result.elapsed_seconds = time.perf_counter() - started
            return result
    except MediaProcessingError as exc:
        result.error = f"processing_failed: {exc}"
        result.elapsed_seconds = time.perf_counter() - started
        return result

    face_summary = analyse_frames(media_frames)

    try:
        result.visual = analyse_media(
            media_frames, face_summary["boxes"], media_type=result.media_kind
        )
    except Exception as exc:  # defence in depth, like the API route
        result.visual = {
            "status": "inference_failed",
            "message": f"{type(exc).__name__}: {exc}",
        }

    try:
        result.audio = analyse_audio_media(path, media_type=result.media_kind)
    except Exception as exc:
        result.audio = {
            "status": "inference_failed",
            "message": f"{type(exc).__name__}: {exc}",
        }

    try:
        result.ai_image = analyse_ai_image(
            media_frames, media_type=result.media_kind
        )
    except Exception as exc:
        result.ai_image = {
            "status": "inference_failed",
            "message": f"{type(exc).__name__}: {exc}",
        }

    try:
        result.multimodal = fuse_multimodal_results(result.visual, result.audio)
    except Exception as exc:
        result.multimodal = {
            "status": "unavailable",
            "message": f"{type(exc).__name__}: {exc}",
        }

    result.elapsed_seconds = time.perf_counter() - started
    return result


# ---------------------------------------------------------------------------
# Metric computation — pure functions, fully unit-testable
# ---------------------------------------------------------------------------
# Mapping detector-specific classification strings to the common
# real/fake vocabulary used for confusion matrices. The positive class
# for every detector is "fake".
_PREDICTION_MAP = {
    "real": "real",
    "deepfake": "fake",
    "likely_human": "real",
    "ai_generated": "fake",
}

# Explicit failure states reported by the detectors. A row in one of these
# (or carrying an error string) counts as "failed" in the summary. Honest
# non-scoring states like "no_audio" or "no_face_detected" are NOT failures —
# they simply mean the modality was absent, and they land in "unscored".
_FAILURE_STATUSES = {
    "inference_failed",
    "model_unavailable",
    "extraction_failed",
    "weights_unavailable",
    "unsupported_format",
    "corrupt_audio",
    "invalid_input",
}

DETECTOR_KEYS = ("face", "audio", "ai_image", "multimodal")


def _block_for(result: FileResult, detector: str) -> dict[str, Any] | None:
    return {
        "face": result.visual,
        "audio": result.audio,
        "ai_image": result.ai_image,
        "multimodal": result.multimodal,
    }.get(detector)


def detector_rows(result: FileResult) -> list[dict[str, Any]]:
    """Flatten one FileResult into per-detector rows for the results CSV.

    Every detector × file pair produces exactly one row, including rows
    for failed, not-applicable and unscored cases — nothing is hidden.
    """
    rows: list[dict[str, Any]] = []
    for detector in DETECTOR_KEYS:
        block = _block_for(result, detector) or {}
        if detector == "face":
            truth = result.face_ground_truth
        elif detector == "ai_image":
            truth = result.ai_image_ground_truth
        else:
            truth = result.ground_truth

        status = block.get("status")
        classification = block.get("classification")
        predicted = _PREDICTION_MAP.get(str(classification).lower())

        score = block.get("score")
        if detector == "multimodal":
            score = block.get("fused_fake_score", score)

        correct: bool | None = None
        if (
            status == "completed"
            and predicted is not None
            and truth in (LABEL_REAL, LABEL_FAKE)
        ):
            correct = predicted == truth

        rows.append(
            {
                "filename": result.filename,
                "media_kind": result.media_kind,
                "detector": detector,
                "status": status,
                "score": score,
                "threshold": block.get("threshold"),
                "predicted_label": predicted,
                "ground_truth": truth,
                "correct": correct,
                "error": result.error,
                "elapsed_seconds": round(result.elapsed_seconds, 3),
            }
        )
    return rows


def compute_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate per-detector confusion matrices and derived metrics.

    Only rows with detector status ``completed``, a mapped prediction and
    a verified ``real``/``fake`` ground truth enter the matrix. Everything
    else is reported as an explicit count. When no row is eligible for a
    detector, its metric fields are ``None`` — never fabricated zeros.
    """
    summary: dict[str, Any] = {}
    for detector in DETECTOR_KEYS:
        subset = [row for row in rows if row.get("detector") == detector]
        total = len(subset)
        not_applicable = sum(
            1 for row in subset if row.get("status") == "not_applicable"
        )
        failed = sum(
            1
            for row in subset
            if row.get("error") or row.get("status") in _FAILURE_STATUSES
        )
        evaluated = [
            row
            for row in subset
            if row.get("status") == "completed"
            and row.get("predicted_label") in (LABEL_REAL, LABEL_FAKE)
            and row.get("ground_truth") in (LABEL_REAL, LABEL_FAKE)
        ]
        # Disjoint accounting: evaluated + not_applicable + failed + unscored
        # must equal total_files. "unscored" covers completed rows whose
        # prediction or ground truth was unavailable (e.g. unknown label).
        unscored = total - len(evaluated) - not_applicable - failed

        tp = sum(
            1
            for row in evaluated
            if row["ground_truth"] == LABEL_FAKE
            and row["predicted_label"] == LABEL_FAKE
        )
        fp = sum(
            1
            for row in evaluated
            if row["ground_truth"] == LABEL_REAL
            and row["predicted_label"] == LABEL_FAKE
        )
        tn = sum(
            1
            for row in evaluated
            if row["ground_truth"] == LABEL_REAL
            and row["predicted_label"] == LABEL_REAL
        )
        fn = sum(
            1
            for row in evaluated
            if row["ground_truth"] == LABEL_FAKE
            and row["predicted_label"] == LABEL_REAL
        )

        precision = tp / (tp + fp) if (tp + fp) > 0 else None
        recall = tp / (tp + fn) if (tp + fn) > 0 else None
        if precision is not None and recall is not None and (precision + recall) > 0:
            f1 = 2 * precision * recall / (precision + recall)
        else:
            f1 = None
        accuracy = (tp + tn) / len(evaluated) if evaluated else None

        summary[detector] = {
            "total_files": total,
            "evaluated": len(evaluated),
            "unscored": unscored,
            "not_applicable": not_applicable,
            "failed_or_errored": failed,
            "confusion_matrix": {"tp": tp, "fp": fp, "tn": tn, "fn": fn},
            "precision": precision,
            "recall": recall,
            "f1": f1,
            "accuracy": accuracy,
        }
    return summary


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------
_CSV_FIELDS = [
    "filename",
    "media_kind",
    "detector",
    "status",
    "score",
    "threshold",
    "predicted_label",
    "ground_truth",
    "correct",
    "error",
    "elapsed_seconds",
]


def write_results_csv(rows: list[dict[str, Any]], path: Path) -> None:
    """Write the per-detector result rows to CSV."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=_CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key) for key in _CSV_FIELDS})


def build_summary(
    rows: list[dict[str, Any]],
    thresholds: dict[str, float],
    manifest_path: Path,
    data_dir: Path,
    total_files: int,
    wall_seconds: float,
) -> dict[str, Any]:
    """Assemble the JSON summary document (all values measured, none invented)."""
    return {
        "generated_at_utc": datetime.now(timezone.utc).isoformat(
            timespec="seconds"
        ),
        "manifest": str(manifest_path),
        "data_dir": str(data_dir),
        "files_total": total_files,
        "wall_seconds": round(wall_seconds, 2),
        "thresholds_used": thresholds,
        "calibration_note": (
            "All scores are raw uncalibrated model outputs. Thresholds are the "
            "production constants (not tuned on this manifest). Metrics below "
            "describe ONLY the provided manifest; no generalisation is claimed."
        ),
        "detectors": compute_metrics(rows),
    }


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Evaluate Clarity Mesh detectors on a local manifest of labelled "
            "media. Writes a per-file CSV and a JSON summary with metrics "
            "computed only where verified labels make them meaningful."
        )
    )
    parser.add_argument(
        "--manifest",
        required=True,
        type=Path,
        help="CSV with columns: filename,label[,face_label,ai_image_label]",
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=None,
        help="Directory containing the media files (default: manifest's parent).",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Where results are written (default: <data-dir>/eval_results).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Evaluate at most N manifest entries (0 = no limit).",
    )
    args = parser.parse_args(argv)

    manifest_path: Path = args.manifest
    data_dir: Path = args.data_dir or manifest_path.resolve().parent
    output_dir: Path = args.output_dir or (data_dir / "eval_results")

    try:
        entries = load_manifest(manifest_path)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    if args.limit > 0:
        entries = entries[: args.limit]

    thresholds = {
        "face_visual": VISUAL_THRESHOLD,
        "audio": AUDIO_THRESHOLD,
        "ai_image": AI_IMAGE_THRESHOLD,
        "multimodal_fusion": FUSION_THRESHOLD,
    }
    print(f"Evaluating {len(entries)} manifest entr(ies) from {manifest_path}")
    print(f"Data directory: {data_dir}")
    print(f"Thresholds (imported from detector modules): {thresholds}")

    rows: list[dict[str, Any]] = []
    started = time.perf_counter()
    for index, entry in enumerate(entries, start=1):
        path = data_dir / entry.filename
        print(f"[{index}/{len(entries)}] {entry.filename} ...", end=" ", flush=True)
        result = analyse_file(path, entry)
        rows.extend(detector_rows(result))
        if result.error:
            print(f"ERROR ({result.error})")
        else:
            print(f"done in {result.elapsed_seconds:.1f}s")
    wall = time.perf_counter() - started

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    results_csv = output_dir / f"results_{stamp}.csv"
    summary_json = output_dir / f"summary_{stamp}.json"
    write_results_csv(rows, results_csv)
    summary = build_summary(
        rows, thresholds, manifest_path, data_dir, len(entries), wall
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    with open(summary_json, "w", encoding="utf-8") as handle:
        json.dump(summary, handle, indent=2)

    print()
    print("=" * 68)
    for detector, stats in summary["detectors"].items():
        matrix = stats["confusion_matrix"]
        print(f"[{detector}]  evaluated={stats['evaluated']}/{stats['total_files']}")
        print(
            f"    tp={matrix['tp']} fp={matrix['fp']} "
            f"tn={matrix['tn']} fn={matrix['fn']}"
        )
        for metric in ("precision", "recall", "f1", "accuracy"):
            value = stats[metric]
            shown = f"{value:.4f}" if value is not None else "n/a (insufficient labelled data)"
            print(f"    {metric}: {shown}")
        if stats["unscored"] or stats["not_applicable"] or stats["failed_or_errored"]:
            print(
                f"    excluded: unscored={stats['unscored']} "
                f"not_applicable={stats['not_applicable']} "
                f"failed={stats['failed_or_errored']}"
            )
    print("=" * 68)
    print(f"Per-file CSV : {results_csv}")
    print(f"JSON summary : {summary_json}")
    print("Reminder: scores are UNCALIBRATED; see the calibration note in the JSON.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
