"""Transparent, history-only aggregates for the analyst workspace."""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime, timedelta
from typing import Any


def _day(value: Any) -> date | None:
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00")).date()
    except (TypeError, ValueError):
        return None


def _finite_score(value: Any) -> float | None:
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    return score if 0 <= score <= 1 else None


def build_dashboard(items: list[dict[str, Any]], today: date | None = None, days: int = 7) -> dict[str, Any]:
    """Aggregate genuine stored outcomes; never substitute missing scores."""
    today = today or date.today()
    days = max(1, min(int(days), 90))
    period_start = today - timedelta(days=days - 1)
    period_items = [item for item in items if (stamp := _day(item.get("created_at"))) and period_start <= stamp <= today]
    verdicts: Counter[str] = Counter()
    media: Counter[str] = Counter()
    completed = Counter()
    risks: list[float] = []
    daily = { (today - timedelta(days=offset)).isoformat(): 0 for offset in range(days - 1, -1, -1) }

    for item in period_items:
        classification = str(item.get("multimodal_classification") or item.get("ai_image_classification") or item.get("visual_classification") or "").lower()
        if classification in {"deepfake", "ai_generated", "likely_fake"}:
            verdicts["flagged"] += 1
        elif classification in {"real", "likely_human", "authentic"}:
            verdicts["likely_authentic"] += 1
        else:
            verdicts["inconclusive"] += 1

        media[str(item.get("media_type") or "unknown").lower()] += 1
        for name, field in (("visual", "visual_score"), ("audio", "audio_score"), ("ai_image", "ai_image_score"), ("multimodal", "fused_score")):
            if item.get(f"{name}_status") == "completed" and _finite_score(item.get(field)) is not None:
                completed[name] += 1

        # Use only the fused fake score when it exists; otherwise use the
        # visual fake-oriented score. Audio-only and AI-image scores have
        # different semantics and are deliberately not mixed into this trend.
        risk = _finite_score(item.get("fused_score"))
        if risk is None:
            risk = _finite_score(item.get("visual_score"))
        if risk is not None:
            risks.append(risk)

        stamp = _day(item.get("created_at"))
        key = stamp.isoformat() if stamp else None
        if key in daily:
            daily[key] += 1

    total = len(period_items)
    scored = len(risks)
    return {
        "scope": f"latest_500_records · last_{days}_days",
        "records_in_store": len(items),
        "records_analyzed": total,
        "scored_records": scored,
        "mean_fake_score": round(sum(risks) / scored, 4) if scored else None,
        "flagged_rate": round(verdicts["flagged"] / total, 4) if total else None,
        "verdicts": {key: verdicts[key] for key in ("flagged", "likely_authentic", "inconclusive")},
        "media_types": dict(media),
        "completed_detectors": {key: completed[key] for key in ("visual", "audio", "ai_image", "multimodal")},
        "daily_activity": [{"date": key, "count": value} for key, value in daily.items()],
        "methodology": "Aggregates stored detector outcomes only. Mean fake score uses completed fused scores, falling back to completed visual fake-oriented scores. Scores are uncalibrated and not proof of authenticity.",
    }
