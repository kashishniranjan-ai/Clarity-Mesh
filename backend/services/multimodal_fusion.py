"""
Clarity Mesh — Multimodal Fusion Service (STEP 8)
=================================================
Pure post-processing layer that combines the two ALREADY-COMPUTED detector
outputs (``visual_analysis`` + ``audio_analysis``) into a separate
``multimodal_analysis`` block for ``POST /api/analyze``.

WHAT THIS MODULE DOES
  * converts both modalities to FAKE-oriented scores and fuses them with a
    transparent weighted arithmetic mean
  * refuses to fuse when a modality is missing, failed, or carries an
    invalid score — failure stays failure, never a default number
  * validates inputs (numeric, finite, within [0, 1]) WITHOUT clamping

WHAT THIS MODULE DOES NOT DO
  * NO model inference of any kind — it never imports a detector, never
    loads weights and never downloads anything
  * it does NOT mutate its inputs (the raw ``visual_analysis`` and
    ``audio_analysis`` blocks are returned to the client untouched)
  * it does NOT change either detector's threshold, preprocessing,
    aggregation or score direction — conversion happens ONLY here

SCORE DIRECTIONS (the two detectors genuinely disagree; conversion lives HERE)
  visual ``score`` = FAKE-oriented   (EfficientNet-B7 sigmoid, threshold 0.7,
                                     higher = more likely fake)
  audio  ``score`` = REAL-oriented   (wav2vec softmax index 1 = REAL,
                                     threshold 0.5, higher = more likely real)
  therefore:   audio_fake_score = 1.0 - audio_analysis["score"]
               fused_fake_score = (VISUAL_WEIGHT * visual_fake_score)
                                + (AUDIO_WEIGHT * audio_fake_score)
  The fused score is FAKE-oriented: >= FUSION_THRESHOLD -> "deepfake".

FUSION WEIGHTS — engineering defaults, NOT scientifically calibrated
  VISUAL_WEIGHT = 0.6  (this project is primarily a visual detector)
  AUDIO_WEIGHT  = 0.4  (audio is an additional independent modality)
  The 0.6/0.4 split is a documented default choice; it is NOT claimed to be
  optimal and must later be validated on an appropriate multimodal
  evaluation dataset.

THRESHOLDS REMAIN FULLY INDEPENDENT (fusion never changes a detector):
  visual threshold = 0.7    audio threshold = 0.5    fusion threshold = 0.5

FAILURE / MISSING-MODALITY POLICY (the heart of this module)
  * only ``status == "completed"`` blocks with a genuine finite score in
    [0, 1] may contribute to a fusion
  * one modality missing/failed  -> status "partial"     (no fused score)
  * both modalities missing      -> status "unavailable" (no fused score)
  * completed but invalid score  -> status "invalid_input" (fusion refused;
    the value is never clamped, defaulted to 0/0.5, or silently dropped)
  * NO missing modality ever receives an invented value of 0, 0.5 or any
    other number. A partial analysis is more correct than a fabricated
    multimodal prediction.
"""

from __future__ import annotations

import math
from collections.abc import Mapping
from typing import Any

# ---------------------------------------------------------------------------
# Fusion constants — the ONE documented location for these values
# ---------------------------------------------------------------------------
VISUAL_WEIGHT = 0.6
AUDIO_WEIGHT = 0.4
FUSION_THRESHOLD = 0.5

AGGREGATION_METHOD = "weighted arithmetic mean"
SCORE_TYPE = (
    "uncalibrated multimodal fusion score — a transparent engineering "
    "combination of two model outputs, NOT a guaranteed probability"
)
FUSION_FORMULA = (
    "fused_fake_score = 0.6 * visual_score + 0.4 * (1 - audio_score)"
)
THRESHOLD_NOTE = (
    "The fusion threshold (0.5) is independent of the visual detector "
    "threshold (0.7) and the audio detector threshold (0.5); fusion never "
    "changes either detector's decision rule."
)
WEIGHTS_NOTE = (
    "VISUAL_WEIGHT=0.6 / AUDIO_WEIGHT=0.4 are engineering defaults chosen "
    "because this project is primarily a visual detector; they are NOT "
    "scientifically calibrated and should later be validated on an "
    "appropriate multimodal evaluation dataset."
)

# Keys that may only ever appear when BOTH modalities genuinely contributed.
_FUSION_SCORE_KEYS = (
    "fused_fake_score",
    "visual_fake_score",
    "audio_fake_score",
)


# ---------------------------------------------------------------------------
# Input extraction — honest triage of one detector block
# ---------------------------------------------------------------------------
def _extract_genuine_score(
    block: Any, modality: str
) -> tuple[float | None, str | None, str | None]:
    """Classify one detector block.

    Returns ``(score, missing_reason, invalid_issue)`` where exactly one of
    the three entries is non-``None``:

    * ``score``          — a genuine finite float in [0, 1] (block is
                           ``completed`` and trustworthy);
    * ``missing_reason`` — the block is absent, failed, or not applicable
                           (missing modality — NEVER replaced by a value);
    * ``invalid_issue``  — the block claims ``completed`` but its score is
                           unusable (non-numeric, NaN/inf, out of range).
    """
    label = "visual_analysis" if modality == "visual" else "audio_analysis"

    if not isinstance(block, Mapping):
        return None, f"{label} result is missing entirely.", None

    status = block.get("status")
    if status != "completed":
        status_text = status if isinstance(status, str) else "unknown"
        return (
            None,
            (
                f"{label} status is '{status_text}' — only a completed "
                "analysis with a genuine score can participate in fusion."
            ),
            None,
        )

    if "score" not in block:
        return (
            None,
            None,
            f"{label} reports status 'completed' but carries no 'score' key.",
        )

    score = block["score"]
    # bool is excluded: it is an int subclass, not a model score.
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        return (
            None,
            None,
            f"{label} score is not numeric (got {type(score).__name__}).",
        )
    score = float(score)
    if not math.isfinite(score):
        return None, None, f"{label} score is not finite (got {score!r})."
    if score < 0.0 or score > 1.0:
        return None, None, f"{label} score is outside [0, 1] (got {score})."
    return score, None, None


def _invalid_payload(issues: list[str]) -> dict[str, Any]:
    """Explicit fusion-failure state for unusable inputs (never clamped)."""
    return {
        "status": "invalid_input",
        "issues": issues,
        "message": (
            "Multimodal fusion was not performed because an input score "
            "was invalid: "
            + " ".join(issues)
            + " Invalid scores are never clamped, defaulted or fused, and "
            "no fused score was produced."
        ),
    }


# ---------------------------------------------------------------------------
# Public API — the only entry point used by backend/routes/analysis.py
# ---------------------------------------------------------------------------
def fuse_multimodal_results(
    visual_analysis: Any,
    audio_analysis: Any,
) -> dict[str, Any]:
    """Fuse the two already-computed detector blocks.

    Runs NO inference and mutates NEITHER input. Possible outcomes:

    ``completed``     — both modalities contributed genuine scores:
                        weighted fusion, fake-oriented fused score and
                        classification against ``FUSION_THRESHOLD`` (0.5);
    ``partial``       — exactly one modality has a genuine score; NO fused
                        score, NO weights — the other modality is listed in
                        ``missing_modalities`` with an honest reason;
    ``unavailable``   — neither modality has a genuine score; NO fused
                        score, NO classification, NO guessed value;
    ``invalid_input`` — a modality claims ``completed`` but its score is
                        unusable (non-numeric / non-finite / outside
                        [0, 1]); fusion is refused rather than clamped.
    """
    visual_score, visual_missing, visual_issue = _extract_genuine_score(
        visual_analysis, "visual"
    )
    audio_score, audio_missing, audio_issue = _extract_genuine_score(
        audio_analysis, "audio"
    )

    issues = [issue for issue in (visual_issue, audio_issue) if issue]
    if issues:
        return _invalid_payload(issues)

    # Defensive: the documented weights must form a convex combination.
    if not math.isclose(VISUAL_WEIGHT + AUDIO_WEIGHT, 1.0):
        return _invalid_payload(
            [
                (
                    "configured fusion weights do not sum to 1.0 "
                    f"({VISUAL_WEIGHT} + {AUDIO_WEIGHT} = "
                    f"{VISUAL_WEIGHT + AUDIO_WEIGHT})."
                )
            ]
        )

    available = [
        modality
        for modality, score in (("visual", visual_score), ("audio", audio_score))
        if score is not None
    ]
    missing = [
        modality
        for modality in ("visual", "audio")
        if modality not in available
    ]

    # ── CASE A: both genuine scores exist → full multimodal fusion ────────
    if len(available) == 2:
        # Score-direction conversion: audio is REAL-oriented (index 1),
        # so its FAKE-oriented counterpart is 1 - REAL score. The visual
        # score is already FAKE-oriented and passes through unchanged.
        audio_fake_score = 1.0 - float(audio_score)
        fused_raw = (
            VISUAL_WEIGHT * float(visual_score)
        ) + (AUDIO_WEIGHT * audio_fake_score)
        if not (math.isfinite(fused_raw) and 0.0 <= fused_raw <= 1.0):
            return _invalid_payload(
                ["computed fused score is not finite or outside [0, 1] "
                 f"(got {fused_raw!r})."]
            )
        fused_fake_score = round(fused_raw, 4)
        classification = (
            "deepfake" if fused_fake_score >= FUSION_THRESHOLD else "real"
        )
        return {
            "status": "completed",
            "visual_fake_score": round(float(visual_score), 4),
            "audio_fake_score": round(audio_fake_score, 4),
            "visual_weight": VISUAL_WEIGHT,
            "audio_weight": AUDIO_WEIGHT,
            "fused_fake_score": fused_fake_score,
            "classification": classification,
            "threshold": FUSION_THRESHOLD,
            "aggregation": AGGREGATION_METHOD,
            "score_type": SCORE_TYPE,
            "formula": FUSION_FORMULA,
            "threshold_note": THRESHOLD_NOTE,
            "weights_note": WEIGHTS_NOTE,
            "message": (
                "Multimodal fusion performed: "
                f"{VISUAL_WEIGHT} * visual FAKE score + {AUDIO_WEIGHT} * "
                f"(1 - audio REAL score) = {fused_fake_score} "
                "(fake-oriented, uncalibrated)."
            ),
        }

    # ── CASES B/C: exactly one genuine score → explicit partial state ─────
    # NO fused score, NO weights, NO default value for the missing modality.
    if len(available) == 1:
        present = available[0]
        absent = missing[0]
        reasons = {
            "visual": visual_missing,
            "audio": audio_missing,
        }
        return {
            "status": "partial",
            "available_modalities": available,
            "missing_modalities": missing,
            "missing_reasons": {absent: reasons[absent]},
            "message": (
                "Multimodal fusion was not performed because "
                f"{absent} analysis did not produce a genuine score "
                f"({reasons[absent]}) No fused score, classification or "
                f"default value was produced; the {present} result remains "
                "available independently in its own block."
            ),
        }

    # ── CASE D: neither modality produced a score ─────────────────────────
    return {
        "status": "unavailable",
        "available_modalities": [],
        "missing_modalities": ["visual", "audio"],
        "missing_reasons": {
            "visual": visual_missing,
            "audio": audio_missing,
        },
        "message": (
            "Multimodal fusion was not performed because neither modality "
            "produced a genuine score. No fused score, classification or "
            "guessed value was produced."
        ),
    }
