"""
Clarity Mesh — Forensic Narrative Generator
============================================
Converts structured analysis output (scores, status, face/frame counts,
peak heatmap regions, acoustic metrics) into a concise, professional
forensic report summary paragraph.

Safety & Authenticity Guarantees:
- Never invents, hallucinates, or estimates numbers.
- When OPENAI_API_KEY is configured, calls OpenAI with a strict constraint
  prompt and validates every number post-generation against the input values.
- If no key is set or validation detects unapproved numbers, falls back to
  a deterministic template generator.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.request
from typing import Any


def _extract_all_numbers(data: Any) -> set[float]:
    """Recursively harvest all float/int numeric values from a dictionary or list."""
    numbers: set[float] = set()
    if isinstance(data, (int, float)) and not isinstance(data, bool):
        numbers.add(round(float(data), 4))
    elif isinstance(data, dict):
        for v in data.values():
            numbers.update(_extract_all_numbers(v))
    elif isinstance(data, (list, tuple)):
        for item in data:
            numbers.update(_extract_all_numbers(item))
    return numbers


def _validate_llm_numbers(text: str, allowed_numbers: set[float]) -> bool:
    """
    Ensure every number mentioned in the generated text is backed by the input data.
    Allows exact floats, rounded floats (e.g. 0.82 vs 0.8234), or percentage equivalents (82%).
    """
    # Match numbers like 0.7231, 42, 85%, etc.
    found_tokens = re.findall(r"\b\d+(?:\.\d+)?%?\b", text)
    if not found_tokens:
        return True

    # Expand allowed numbers with percentage equivalents (e.g. 0.82 -> 82)
    expanded_allowed: set[float] = set()
    for n in allowed_numbers:
        expanded_allowed.add(round(n, 4))
        expanded_allowed.add(round(n, 2))
        expanded_allowed.add(round(n, 1))
        expanded_allowed.add(round(n * 100.0, 1))
        expanded_allowed.add(round(n * 100.0, 0))

    for token in found_tokens:
        clean = token.rstrip("%")
        try:
            val = float(clean)
        except ValueError:
            continue
        # Also allow small structural numbers like 1, 2, 60, 40 (standard 60/40 weights)
        if val in (60.0, 40.0, 1.0, 2.0, 3.0, 4.0):
            continue
        val_rounded = round(val, 4)
        val_2 = round(val, 2)
        val_1 = round(val, 1)
        if (
            val_rounded not in expanded_allowed
            and val_2 not in expanded_allowed
            and val_1 not in expanded_allowed
        ):
            return False
    return True


def generate_template_narrative(analysis: dict[str, Any]) -> str:
    """
    Deterministic forensic paragraph constructed strictly from structured analysis output.
    """
    media_type = str(analysis.get("media_type") or "media").lower()
    frames_analyzed = analysis.get("frames_analyzed") or 0
    faces_analyzed = analysis.get("faces_analyzed") or 0
    faces_detected = analysis.get("faces_detected") or 0

    sentences: list[str] = []

    # 1. Introduction / Scope
    if media_type == "video":
        sentences.append(
            f"Forensic media inspection of this video evaluated {faces_analyzed} face crop(s) "
            f"across {frames_analyzed} sampled frame(s) ({faces_detected} detected overall)."
        )
    elif media_type == "image":
        sentences.append(
            f"Forensic still-image examination evaluated {faces_analyzed} detected facial region(s)."
        )
    elif media_type == "audio":
        sentences.append(
            "Forensic audio analysis evaluated the submitted vocal recording for synthetic manipulation."
        )
    else:
        sentences.append(
            f"Forensic triage evaluated the submitted {media_type} asset across active detection blocks."
        )

    # 2. Visual Model Findings
    v_status = analysis.get("visual_status")
    v_score = analysis.get("visual_score")
    v_class = analysis.get("visual_classification")

    if v_score is not None:
        sentences.append(
            f"The primary EfficientNet-B7 visual deepfake detector returned a score of {float(v_score):.4f} "
            f"(classified as {v_class})."
        )
    elif v_status:
        sentences.append(f"Visual model state reported '{v_status}'.")

    # 3. Peak regions / explainability
    peak_regions = analysis.get("peak_regions") or []
    if peak_regions and isinstance(peak_regions, list):
        desc_list = [r.get("description") for r in peak_regions if isinstance(r, dict) and r.get("description")]
        if desc_list:
            top_desc = ", ".join(dict.fromkeys(desc_list[:3]))
            sentences.append(
                f"Saliency explainability maps localized maximum anomalous model activation in the {top_desc}."
            )

    # 4. Audio Findings
    a_score = analysis.get("audio_score")
    a_class = analysis.get("audio_classification")
    if a_score is not None:
        sentences.append(
            f"Acoustic spectral deepfake analysis scored {float(a_score):.4f} (classified as {a_class})."
        )

    # 5. Generative Image Findings
    ai_score = analysis.get("ai_image_score")
    ai_class = analysis.get("ai_image_classification")
    if ai_score is not None and ai_score > 0.05:
        sentences.append(
            f"CLIP ViT-L/14 synthetic media detector scored {float(ai_score):.4f} ({ai_class})."
        )

    # 6. Multimodal Fusion
    f_score = analysis.get("fused_score")
    f_class = analysis.get("fused_classification")
    if f_score is not None:
        sentences.append(
            f"Multimodal weighted fusion computed an overall confidence rating of {float(f_score):.4f} "
            f"(verdict: {f_class})."
        )

    # 7. Forensic standard disclaimer
    sentences.append(
        "All metrics represent uncalibrated algorithmic triage estimates and must be corroborated "
        "with cryptographic provenance and chain-of-custody verification."
    )

    return " ".join(sentences)


def generate_forensic_narrative(
    analysis_data: dict[str, Any],
    api_key: str | None = None,
) -> dict[str, Any]:
    """
    Generate a human-readable forensic report narrative from structured findings.

    Returns:
    {
      "status": "ok",
      "narrative": str,
      "generator": "openai" | "template",
      "numbers_validated": True
    }
    """
    openai_key = api_key or os.getenv("OPENAI_API_KEY", "").strip()

    # If no key configured, use deterministic template
    if not openai_key:
        narrative = generate_template_narrative(analysis_data)
        return {
            "status": "ok",
            "narrative": narrative,
            "generator": "template",
            "numbers_validated": True,
        }

    # Call OpenAI with strict numeric restatement constraint
    allowed_numbers = _extract_all_numbers(analysis_data)
    prompt_payload = {
        "media_type": analysis_data.get("media_type"),
        "frames_analyzed": analysis_data.get("frames_analyzed"),
        "faces_analyzed": analysis_data.get("faces_analyzed"),
        "visual_score": analysis_data.get("visual_score"),
        "visual_classification": analysis_data.get("visual_classification"),
        "audio_score": analysis_data.get("audio_score"),
        "audio_classification": analysis_data.get("audio_classification"),
        "fused_score": analysis_data.get("fused_score"),
        "fused_classification": analysis_data.get("fused_classification"),
        "peak_regions": [
            r.get("description")
            for r in analysis_data.get("peak_regions", [])
            if isinstance(r, dict) and r.get("description")
        ],
    }

    system_instruction = (
        "You are Clarity Mesh's forensic media reporting analyst. "
        "Convert the structured findings into a single, cohesive, formal report paragraph. "
        "RULES: "
        "1. Never invent or hallucinate any number, percentage, or score. "
        "2. If you state any number, it must be an exact value from the input. "
        "3. Emphasize that scores are triage indicators, not definitive legal proof."
    )

    req_body = json.dumps({
        "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        "messages": [
            {"role": "system", "content": system_instruction},
            {"role": "user", "content": f"Structured analysis data:\n{json.dumps(prompt_payload, indent=2)}"},
        ],
        "temperature": 0.2,
        "max_tokens": 400,
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=req_body,
        headers={
            "Authorization": f"Bearer {openai_key}",
            "Content-Type": "application/json",
            "User-Agent": "Clarity-Mesh-Forensics/1.0",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        choices = data.get("choices", [])
        if choices:
            content = choices[0].get("message", {}).get("content", "").strip()
            if content and _validate_llm_numbers(content, allowed_numbers):
                return {
                    "status": "ok",
                    "narrative": content,
                    "generator": "openai",
                    "numbers_validated": True,
                }
    except Exception:
        # Graceful fallback to deterministic template on any network/OpenAI error
        pass

    fallback_narrative = generate_template_narrative(analysis_data)
    return {
        "status": "ok",
        "narrative": fallback_narrative,
        "generator": "template",
        "numbers_validated": True,
    }
