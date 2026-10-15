"""
Clarity Mesh — Detector Registry
================================
Single source of truth describing every registered detector WITHOUT importing
heavy ML libraries at module load time. All fields are static metadata mirrored
from each detector's docstring, so importing this module is cheap and cannot
trigger model downloads or torch imports.
"""

from __future__ import annotations

from typing import Any

VISUAL_ENTRY: dict[str, Any] = {
    "id": "visual",
    "display_name": "Face-Manipulation Detector",
    "model": (
        "EfficientNet-B7 DeepfakeDetector "
        "(DFDC winner Selim Seferbekov, facetorch TorchScript export)"
    ),
    "model_source": (
        "https://huggingface.co/tomas-gajarsky/facetorch-deepfake-efficientnet-b7"
    ),
    "model_license": "MIT (original code + weights)",
    "modality": "visual",
    "applies_to": ["image", "video"],
    "score_direction": "fake-oriented — higher score = more likely manipulated",
    "score_type": (
        "sigmoid(model_logit) — uncalibrated model score, "
        "NOT a guaranteed probability"
    ),
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.7,
    "threshold_note": "score >= 0.7 → 'deepfake', else → 'real' (facetorch default)",
    "aggregation": "Arithmetic mean of per-face scores across sampled frames",
    "fusion_role": "visual input to multimodal fusion (weight 0.6)",
    "failure_states": [
        "no_face_detected",
        "model_unavailable",
        "inference_failed",
    ],
}

AI_IMAGE_ENTRY: dict[str, Any] = {
    "id": "ai_image",
    "display_name": "AI-Generated Image Detector",
    "model": (
        "UniversalFakeDetect (CLIP ViT-L/14 + linear probe, WisconsinAIVision)"
    ),
    "model_source": (
        "https://github.com/WisconsinAIVision/UniversalFakeDetect"
    ),
    "model_license": "MIT (code + published linear-probe weights)",
    "modality": "image",
    "applies_to": ["image"],
    "score_direction": "fake-oriented — higher score = more likely AI-generated",
    "score_type": (
        "sigmoid(linear_probe(CLIP image features)) — uncalibrated model "
        "score, NOT a guaranteed probability"
    ),
    "classification_labels": ["likely_human", "ai_generated"],
    "threshold": 0.5,
    "threshold_note": (
        "score >= 0.5 → 'ai_generated', else → 'likely_human'. Neutral "
        "sigmoid operating point; explicitly UNVALIDATED for this deployment."
    ),
    "aggregation": "single forward pass on the full image (no aggregation)",
    "fusion_role": "independent — never fused with visual/audio blocks",
    "failure_states": [
        "not_applicable",
        "invalid_input",
        "model_unavailable",
        "inference_failed",
    ],
}

AUDIO_ENTRY: dict[str, Any] = {
    "id": "audio",
    "display_name": "Audio Deepfake Detector",
    "model": "wav2vec-small-anti-deepfake (NII AntiDeepfake)",
    "model_source": (
        "https://huggingface.co/nii-yamagishilab/wav2vec-small-anti-deepfake"
    ),
    "model_license": "CC BY-NC-SA 4.0 (research and educational use only)",
    "modality": "audio",
    "applies_to": ["video", "audio"],
    "score_direction": "REAL-oriented — higher score = more likely real speech",
    "score_type": "softmax output of the model, not a calibrated probability",
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.5,
    "threshold_note": "score >= 0.5 → 'real', else → 'deepfake'",
    "aggregation": "arithmetic mean over per-chunk REAL-class scores",
    "fusion_role": "audio input to fusion (converted to fake as 1 - score, w=0.4)",
    "failure_states": [
        "no_audio",
        "not_applicable",
        "unsupported_format",
        "extraction_failed",
        "corrupt_audio",
        "weights_unavailable",
        "model_unavailable",
        "inference_failed",
    ],
}

AUDIO_ENTRY: dict[str, Any] = {
    "id": "audio",
    "display_name": "Audio Deepfake Detector",
    "model": "wav2vec-small-anti-deepfake (NII AntiDeepfake)",
    "model_source": (
        "https://huggingface.co/nii-yamagishilab/wav2vec-small-anti-deepfake"
    ),
    "model_license": "CC BY-NC-SA 4.0 (research and educational use only)",
    "modality": "audio",
    "applies_to": ["video", "audio"],
    "score_direction": "REAL-oriented — higher score = more likely real speech",
    "score_type": "softmax output of the model, not a calibrated probability",
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.5,
    "threshold_note": "score >= 0.5 → 'real', else → 'deepfake'",
    "aggregation": "arithmetic mean over per-chunk REAL-class scores",
    "fusion_role": "audio input to fusion (converted to fake as 1 - score, w=0.4)",
    "failure_states": [
        "no_audio",
        "not_applicable",
        "unsupported_format",
        "extraction_failed",
        "corrupt_audio",
        "weights_unavailable",
        "model_unavailable",
        "inference_failed",
    ],
}

FUSION_ENTRY: dict[str, Any] = {
    "id": "multimodal",
    "display_name": "Multimodal Fusion",
    "model": "Weighted arithmetic fusion (rule-based, no ML model)",
    "model_source": "backend/services/multimodal_fusion.py",
    "model_license": "project code (same repository)",
    "modality": "fusion",
    "applies_to": ["video"],
    "score_direction": "fake-oriented — higher score = more likely manipulated",
    "score_type": (
        "uncalibrated multimodal fusion score — NOT a guaranteed probability"
    ),
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.5,
    "threshold_note": "fused score >= 0.5 → 'deepfake', else → 'real'",
    "aggregation": "weighted arithmetic mean",
    "fusion_role": "consumer of visual (0.6) + audio (0.4) scores",
    "fusion_formula": (
        "fused_fake_score = 0.6 * visual_score + 0.4 * (1 - audio_REAL_score)"
    ),
    "failure_states": ["partial", "unavailable", "invalid_input"],
}

DETECTORS: list[dict[str, Any]] = [
    VISUAL_ENTRY,
    AI_IMAGE_ENTRY,
    AUDIO_ENTRY,
    FUSION_ENTRY,
]



def list_detectors() -> list[dict[str, Any]]:
    """Return a defensive copy of the detector registry entries."""
    "failure_states": [
        "model_unavailable",
        "inference_failed",
    ],
}

DETECTORS: list[dict[str, Any]] = [
    VISUAL_ENTRY,
    AI_IMAGE_ENTRY,
    AUDIO_ENTRY,
    FUSION_ENTRY,
"""
Clarity Mesh — Detector Registry
================================
Single source of truth describing every registered detector WITHOUT importing
heavy ML libraries at module load time. All fields are static metadata mirrored
from each detector's docstring, so importing this module is cheap and cannot
trigger model downloads or torch imports.
"""

from __future__ import annotations

from typing import Any

VISUAL_ENTRY: dict[str, Any] = {
    "id": "visual",
    "display_name": "Face-Manipulation Detector",
    "model": (
        "EfficientNet-B7 DeepfakeDetector "
        "(DFDC winner Selim Seferbekov, facetorch TorchScript export)"
    ),
    "model_source": (
        "https://huggingface.co/tomas-gajarsky/facetorch-deepfake-efficientnet-b7"
    ),
    "model_license": "MIT (original code + weights)",
    "modality": "visual",
    "applies_to": ["image", "video"],
    "score_direction": "fake-oriented — higher score = more likely manipulated",
    "score_type": (
        "sigmoid(model_logit) — uncalibrated model score, "
        "NOT a guaranteed probability"
    ),
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.7,
    "threshold_note": "score >= 0.7 → 'deepfake', else → 'real' (facetorch default)",
    "aggregation": "Arithmetic mean of per-face scores across sampled frames",
    "fusion_role": "visual input to multimodal fusion (weight 0.6)",
    "failure_states": [
        "no_face_detected",
        "model_unavailable",
        "inference_failed",
    ],
}

AI_IMAGE_ENTRY: dict[str, Any] = {
    "id": "ai_image",
    "display_name": "AI-Generated Image Detector",
    "model": (
        "UniversalFakeDetect (CLIP ViT-L/14 + linear probe, WisconsinAIVision)"
    ),
    "model_source": (
        "https://github.com/WisconsinAIVision/UniversalFakeDetect"
    ),
    "model_license": "MIT (code + published linear-probe weights)",
    "modality": "image",
    "applies_to": ["image"],
    "score_direction": "fake-oriented — higher score = more likely AI-generated",
    "score_type": (
        "sigmoid(linear_probe(CLIP image features)) — uncalibrated model "
        "score, NOT a guaranteed probability"
    ),
    "classification_labels": ["likely_human", "ai_generated"],
    "threshold": 0.5,
    "threshold_note": (
        "score >= 0.5 → 'ai_generated', else → 'likely_human'. Neutral "
        "sigmoid operating point; explicitly UNVALIDATED for this deployment."
    ),
    "aggregation": "single forward pass on the full image (no aggregation)",
    "fusion_role": "independent — never fused with visual/audio blocks",
    "failure_states": [
        "not_applicable",
        "invalid_input",
        "model_unavailable",
        "inference_failed",
    ],
}

AUDIO_ENTRY: dict[str, Any] = {
    "id": "audio",
    "display_name": "Audio Deepfake Detector",
    "model": "wav2vec-small-anti-deepfake (NII AntiDeepfake)",
    "model_source": (
        "https://huggingface.co/nii-yamagishilab/wav2vec-small-anti-deepfake"
    ),
    "model_license": "CC BY-NC-SA 4.0 (research and educational use only)",
    "modality": "audio",
    "applies_to": ["video", "audio"],
    "score_direction": "REAL-oriented — higher score = more likely real speech",
    "score_type": "softmax output of the model, not a calibrated probability",
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.5,
    "threshold_note": "score >= 0.5 → 'real', else → 'deepfake'",
    "aggregation": "arithmetic mean over per-chunk REAL-class scores",
    "fusion_role": "audio input to fusion (converted to fake as 1 - score, w=0.4)",
    "failure_states": [
        "no_audio",
        "not_applicable",
        "unsupported_format",
        "extraction_failed",
        "corrupt_audio",
        "weights_unavailable",
        "model_unavailable",
        "inference_failed",
    ],
}

FUSION_ENTRY: dict[str, Any] = {
    "id": "multimodal",
    "display_name": "Multimodal Fusion",
    "model": "Weighted arithmetic fusion (rule-based, no ML model)",
    "model_source": "backend/services/multimodal_fusion.py",
    "model_license": "project code (same repository)",
    "modality": "fusion",
    "applies_to": ["video"],
    "score_direction": "fake-oriented — higher score = more likely manipulated",
    "score_type": (
        "uncalibrated multimodal fusion score — NOT a guaranteed probability"
    ),
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.5,
    "threshold_note": "fused score >= 0.5 → 'deepfake', else → 'real'",
    "aggregation": "weighted arithmetic mean",
    "fusion_role": "consumer of visual (0.6) + audio (0.4) scores",
    "fusion_formula": (
        "fused_fake_score = 0.6 * visual_score + 0.4 * (1 - audio_REAL_score)"
    ),
    "failure_states": ["partial", "unavailable", "invalid_input"],
}

DETECTORS: list[dict[str, Any]] = [
    VISUAL_ENTRY,
    AI_IMAGE_ENTRY,
    AUDIO_ENTRY,
    FUSION_ENTRY,
]


def list_detectors() -> list[dict[str, Any]]:
    """Return a defensive copy of the detector registry entries."""
    return [dict(entry) for entry in DETECTORS]

"""
Clarity Mesh — Detector Registry
================================
Single source of truth describing every registered detector WITHOUT importing
heavy ML libraries at module load time. All fields are static metadata mirrored
from each detector's docstring, so importing this module is cheap and cannot
trigger model downloads or torch imports.
"""

from __future__ import annotations
VISUAL_ENTRY: dict[str, Any] = {
    "id": "visual",
    "display_name": "Face-Manipulation Detector",
    "model": (
        "EfficientNet-B7 DeepfakeDetector "
        "(DFDC winner Selim Seferbekov, facetorch TorchScript export)"
    ),
    "model_source": (
        "https://huggingface.co/tomas-gajarsky/facetorch-deepfake-efficientnet-b7"
    ),
    "model_license": "MIT (original code + weights)",
    "modality": "visual",
    "applies_to": ["image", "video"],
    "score_direction": "fake-oriented — higher score = more likely manipulated",
    "score_type": (
        "sigmoid(model_logit) — uncalibrated model score, "
        "NOT a guaranteed probability"
    ),
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.7,
    "threshold_note": "score >= 0.7 → 'deepfake', else → 'real' (facetorch default)",
    "aggregation": "Arithmetic mean of per-face scores across sampled frames",
    "fusion_role": "visual input to multimodal fusion (weight 0.6)",
    "failure_states": [
        "no_face_detected",
        "model_unavailable",
        "inference_failed",
    ],
}

AI_IMAGE_ENTRY: dict[str, Any] = {
    "id": "ai_image",
    "display_name": "AI-Generated Image Detector",
    "model": (
        "UniversalFakeDetect (CLIP ViT-L/14 + linear probe, WisconsinAIVision)"
    ),
    "model_source": (
        "https://github.com/WisconsinAIVision/UniversalFakeDetect"
    ),
    "model_license": "MIT (code + published linear-probe weights)",
    "modality": "image",
    "applies_to": ["image"],
    "score_direction": "fake-oriented — higher score = more likely AI-generated",
    "score_type": (
        "sigmoid(linear_probe(CLIP image features)) — uncalibrated model "
        "score, NOT a guaranteed probability"
    ),
    "classification_labels": ["likely_human", "ai_generated"],
    "threshold": 0.5,
    "threshold_note": (
        "score >= 0.5 → 'ai_generated', else → 'likely_human'. Neutral "
        "sigmoid operating point; explicitly UNVALIDATED for this deployment."
    ),
    "aggregation": "single forward pass on the full image (no aggregation)",
    "fusion_role": "independent — never fused with visual/audio blocks",
    "failure_states": [
        "not_applicable",
        "invalid_input",
        "model_unavailable",
        "inference_failed",
    ],
}

AUDIO_ENTRY: dict[str, Any] = {
    "id": "audio",
    "display_name": "Audio Deepfake Detector",
    "model": "wav2vec-small-anti-deepfake (NII AntiDeepfake)",
    "model_source": (
        "https://huggingface.co/nii-yamagishilab/wav2vec-small-anti-deepfake"
    ),
    "model_license": "CC BY-NC-SA 4.0 (research and educational use only)",
    "modality": "audio",
    "applies_to": ["video", "audio"],
    "score_direction": "REAL-oriented — higher score = more likely real speech",
    "score_type": "softmax output of the model, not a calibrated probability",
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.5,
    "threshold_note": "score >= 0.5 → 'real', else → 'deepfake'",
    "aggregation": "arithmetic mean over per-chunk REAL-class scores",
    "fusion_role": "audio input to fusion (converted to fake as 1 - score, w=0.4)",
    "failure_states": [
        "no_audio",
        "not_applicable",
        "unsupported_format",
        "extraction_failed",
        "corrupt_audio",
        "weights_unavailable",
        "model_unavailable",
        "inference_failed",
    ],
}

FUSION_ENTRY: dict[str, Any] = {
    "id": "multimodal",
    "display_name": "Multimodal Fusion",
    "model": "Weighted arithmetic fusion (rule-based, no ML model)",
    "model_source": "backend/services/multimodal_fusion.py",
    "model_license": "project code (same repository)",
    "modality": "fusion",
    "applies_to": ["video"],
    "score_direction": "fake-oriented — higher score = more likely manipulated",
    "score_type": (
        "uncalibrated multimodal fusion score — NOT a guaranteed probability"
    ),
    "classification_labels": ["real", "deepfake"],
    "threshold": 0.5,
    "threshold_note": "fused score >= 0.5 → 'deepfake', else → 'real'",
    "aggregation": "weighted arithmetic mean",
    "fusion_role": "consumer of visual (0.6) + audio (0.4) scores",
    "fusion_formula": (
        "fused_fake_score = 0.6 * visual_score + 0.4 * (1 - audio_REAL_score)"
    ),
    "failure_states": ["partial", "unavailable", "invalid_input"],
}

DETECTORS: list[dict[str, Any]] = [
    VISUAL_ENTRY,
    AI_IMAGE_ENTRY,
    AUDIO_ENTRY,
    FUSION_ENTRY,
]


def list_detectors() -> list[dict[str, Any]]:
    """Return a defensive copy of the detector registry entries."""
    return [dict(entry) for entry in DETECTORS]
