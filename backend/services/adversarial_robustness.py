"""
Clarity Mesh — Adversarial Robustness Stress-Testing Harness
============================================================
Evaluates model sensitivity to pixel-level adversarial perturbations (FGSM and PGD)
against the EfficientNet-B7 deepfake visual detector.

DISCLAIMER:
  This service measures empirical perturbation sensitivity. It does NOT defend the model
  or certify adversarial immunity.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from services.face_processor import crop_face, detect_faces
from services.visual_detector import _import_torch, _load_model, preprocess_face

DEFAULT_EPSILONS = [0.001, 0.005, 0.01, 0.02, 0.05]
ROBUSTNESS_DISCLAIMER = (
    "This measures model sensitivity to adversarial perturbation. "
    "It does NOT claim the model is defended or robust."
)


def is_robustness_enabled() -> bool:
    """Check if adversarial robustness evaluation is enabled via environment."""
    return os.getenv("CLARITY_ENABLE_ROBUSTNESS", "false").strip().lower() in ("1", "true", "yes")


def evaluate_robustness(
    image_input: str | Path | np.ndarray,
    epsilons: list[float] | None = None,
    attack: str = "fgsm",
    pgd_steps: int = 10,
    pgd_alpha: float = 0.005,
    force_enable: bool = False,
) -> dict[str, Any]:
    """
    Run FGSM or PGD adversarial evaluation on a face image.
    """
    if not force_enable and not is_robustness_enabled():
        return {
            "status": "disabled",
            "reason": "Adversarial robustness evaluation is disabled (CLARITY_ENABLE_ROBUSTNESS=false).",
            "disclaimer": ROBUSTNESS_DISCLAIMER,
        }

    # 1. Parse and validate epsilons
    if epsilons is None:
        epsilons = list(DEFAULT_EPSILONS)
    else:
        # Clamp to [0.0001, 0.2]
        sanitized: list[float] = []
        for e in epsilons:
            try:
                val = float(e)
                if 0.0 < val <= 0.5:
                    sanitized.append(round(val, 5))
            except (ValueError, TypeError):
                continue
        epsilons = sanitized or list(DEFAULT_EPSILONS)

    attack = attack.lower().strip()
    if attack not in ("fgsm", "pgd"):
        attack = "fgsm"

    pgd_steps = max(1, min(30, int(pgd_steps)))
    pgd_alpha = max(0.0001, min(0.1, float(pgd_alpha)))

    # 2. Resolve image
    if isinstance(image_input, (str, Path)):
        p = Path(image_input)
        if not p.is_file():
            return {
                "status": "file_not_found",
                "error": f"Image file not found: {p}",
                "disclaimer": ROBUSTNESS_DISCLAIMER,
            }
        img_bgr = cv2.imread(str(p))
    elif isinstance(image_input, np.ndarray):
        img_bgr = image_input
    else:
        return {
            "status": "invalid_input",
            "error": "Expected file path or numpy image array.",
            "disclaimer": ROBUSTNESS_DISCLAIMER,
        }

    if img_bgr is None or img_bgr.size == 0:
        return {
            "status": "decode_failed",
            "error": "Failed to decode image.",
            "disclaimer": ROBUSTNESS_DISCLAIMER,
        }

    # 3. Detect and crop face
    boxes = detect_faces(img_bgr)
    if not boxes:
        return {
            "status": "no_face_detected",
            "error": "No face detected in image for adversarial evaluation.",
            "disclaimer": ROBUSTNESS_DISCLAIMER,
        }

    crop = crop_face(img_bgr, boxes[0])
    if crop is None or crop.size == 0:
        return {
            "status": "crop_failed",
            "error": "Failed to crop detected face ROI.",
            "disclaimer": ROBUSTNESS_DISCLAIMER,
        }

    # 4. Load PyTorch model
    model, load_err = _load_model()
    if model is None:
        return {
            "status": "model_unavailable",
            "error": load_err or "Deepfake visual model unavailable.",
            "disclaimer": ROBUSTNESS_DISCLAIMER,
        }

    torch = _import_torch()
    x = preprocess_face(crop)
    if x is None:
        return {
            "status": "preprocess_failed",
            "error": "Face crop preprocessing failed.",
            "disclaimer": ROBUSTNESS_DISCLAIMER,
        }

    # Baseline forward pass
    with torch.no_grad():
        out = model(x)
        baseline_logit = out[0] if isinstance(out, (tuple, list)) else out
        baseline_score = float(torch.sigmoid(baseline_logit).item())

    results = []

    # 5. Execute perturbation sweeps
    if attack == "fgsm":
        for eps in epsilons:
            x_adv = x.clone().detach().requires_grad_(True)
            out = model(x_adv)
            logit = out[0] if isinstance(out, (tuple, list)) else out
            loss = logit.squeeze()
            loss.backward()

            if x_adv.grad is not None:
                grad_sign = x_adv.grad.sign()
                x_perturbed = x + eps * grad_sign
            else:
                x_perturbed = x

            with torch.no_grad():
                out_p = model(x_perturbed)
                logit_p = out_p[0] if isinstance(out_p, (tuple, list)) else out_p
                pert_score = float(torch.sigmoid(logit_p).item())

            results.append({
                "epsilon": eps,
                "perturbed_score": round(pert_score, 4),
                "delta": round(pert_score - baseline_score, 4),
            })

    elif attack == "pgd":
        for eps in epsilons:
            x_adv = x.clone().detach()
            for _ in range(pgd_steps):
                x_adv.requires_grad_(True)
                out = model(x_adv)
                logit = out[0] if isinstance(out, (tuple, list)) else out
                loss = logit.squeeze()
                loss.backward()

                with torch.no_grad():
                    if x_adv.grad is not None:
                        x_adv = x_adv + pgd_alpha * x_adv.grad.sign()
                        # Project onto L-infinity epsilon ball around original x
                        x_adv = torch.max(torch.min(x_adv, x + eps), x - eps)
                    x_adv.grad = None

            with torch.no_grad():
                out_p = model(x_adv)
                logit_p = out_p[0] if isinstance(out_p, (tuple, list)) else out_p
                pert_score = float(torch.sigmoid(logit_p).item())

            results.append({
                "epsilon": eps,
                "perturbed_score": round(pert_score, 4),
                "delta": round(pert_score - baseline_score, 4),
            })

    return {
        "status": "ok",
        "attack": attack,
        "baseline_score": round(baseline_score, 4),
        "results": results,
        "face_box": boxes[0],
        "disclaimer": ROBUSTNESS_DISCLAIMER,
    }
