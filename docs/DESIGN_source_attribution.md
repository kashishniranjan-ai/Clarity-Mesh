# Source Attribution & Generative Fingerprinting — System Architecture & Design Note

**Status:** Research Spike Scaffold  
**Date:** 2026-10-18  
**Component:** `backend/services/source_attribution.py` & `POST /api/v2/attribution`

---

## 1. Objective

To attribute synthetic and manipulated media to specific generative model architectures (e.g., ProGAN, StyleGAN2/3, Latent Diffusion / Stable Diffusion v1-v2.1 / SDXL, Midjourney v5/v6, FLUX.1) by analyzing high-frequency residual artifacts and feature-space representations.

---

## 2. Theoretical Frameworks

### 2.1 Raw-Patch PRNU / High-Frequency Fingerprinting (Marra et al., 2019)
- **Principle:** Convolutional neural networks and upsampling operations (transposed convolutions, nearest-neighbor interpolation) leave deterministic spatial artifacts and high-frequency spectral spikes (checkerboard patterns, periodic Fourier peaks).
- **Extraction:** High-pass filtering (Wiener filtering or learned residual extraction $R = X - f(X)$) isolating subtle generator-specific noise fingerprints similar to Photo-Response Non-Uniformity (PRNU) in physical sensors.
- **Classification:** A lightweight patch-level classifier (ResNet-18 or shallow CNN) operating strictly on the residual domain rather than semantic content, preventing bias toward semantic objects.

### 2.2 Pre-trained Feature Space Fingerprinting (Ojha et al., CVPR 2023)
- **Principle:** Universal generative features are captured effectively in the visual representation space of frozen vision-language models (CLIP ViT-L/14).
- **Approach:** Pass media through frozen visual encoders; train linear probing or multi-class MLP heads on top of the normalized visual tokens to classify generator family.
- **Advantage:** Higher robustness to lossy JPEG compression and resizing compared to pure spatial-frequency methods.

---

## 3. Required Training Data & Checkpoints

To deploy a genuine attribution model (avoiding pseudo-science or hardcoded labels):
1. **Multi-Generator Benchmark Dataset:**
   - 100k+ images balanced across 12 distinct generative families (GAN architectures: ProGAN, StyleGAN2, StyleGAN3; Diffusion architectures: Stable Diffusion 1.5, 2.1, SDXL, DeepFloyd IF, Midjourney v5/v6, DALL-E 3, FLUX.1).
   - Matched pristine camera captures across equal scene categories.
2. **Post-Processing Augmentation:**
   - Perturbations mimicking social media pipelines (WebP, JPEG $Q \in [50, 95]$, Gaussian blur, random cropping).
3. **Model Weights:**
   - A specialized multi-class classifier checkpoint (~150MB-300MB) trained and verified with cross-validation confusion matrices.

---

## 4. Why Clarity Mesh Returns `status: "unavailable"`

In accordance with Clarity Mesh Core Principles:
> **"NEVER hardcode or fake model scores, metrics, telemetry or incident data."**

No validated, open-access, multi-generator attribution checkpoint is currently bundled in the standard deployment. Rather than hallucinating a plausible generator name (e.g. claiming "Midjourney v6"), the endpoint truthfully returns:
```json
{
  "status": "unavailable",
  "reason": "Source attribution requires a specialized classifier checkpoint (e.g., raw-patch attribution or CLIP fingerprinting trained on generator-specific artifacts). No suitable public checkpoint is currently available for this deployment."
}
```

---

## 5. Future Integration Points

When an authorized weights checkpoint is trained and approved:
1. Lazy-load model in `backend/services/source_attribution.py` guarded by `CLARITY_ENABLE_ATTRIBUTION=true`.
2. Integrate into forensic report studio (`frontend/src/pages/Studio.jsx`).
3. Maintain zero-overhead fallback when flag is disabled.
