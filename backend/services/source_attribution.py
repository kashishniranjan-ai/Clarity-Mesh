"""
Clarity Mesh — Generator Source Attribution (Research Spike Scaffold)
====================================================================
Stub service representing architecture for attributing synthetic media
to specific generator architectures (e.g., ProGAN, StyleGAN2/3, Midjourney,
Stable Diffusion, FLUX).

Returns status: "unavailable" honestly because no suitable public checkpoint
is currently available for this deployment without proprietary training data.
"""

from __future__ import annotations

from typing import Any

ATTRIBUTION_UNAVAILABLE_REASON = (
    "Source attribution requires a specialized classifier checkpoint (e.g., "
    "raw-patch attribution or CLIP fingerprinting trained on generator-specific "
    "artifacts). No suitable public checkpoint is currently available for this deployment."
)


def attribute_source(stored_name: str | None = None) -> dict[str, Any]:
    """Scaffold for source attribution analysis."""
    return {
        "status": "unavailable",
        "reason": ATTRIBUTION_UNAVAILABLE_REASON,
        "disclaimer": (
            "Source attribution is a research spike scaffold. No synthetic generator "
            "origin or architecture claim is made."
        ),
    }
