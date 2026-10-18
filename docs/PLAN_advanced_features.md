# Clarity Mesh — Advanced Features Plan

**Author:** Senior Full-Stack + ML Engineer  
**Date:** 2026-10-18  
**Branch:** `upgrade/industrial` (to be created)  
**Baseline:** 66 passing backend tests, React 19 + Vite frontend builds cleanly  

---

## Table of Contents

1. [Guiding Principles](#guiding-principles)
2. [Phase 1 — Explainability & Forensic UI](#phase-1--explainability--forensic-ui)
3. [Phase 2 — Real-Time Analysis](#phase-2--real-time-analysis)
4. [Phase 3 — Provenance, Watermarks & Robustness Evaluation](#phase-3--provenance-watermarks--robustness-evaluation)
5. [Phase 4 — Team Collaboration & Chain of Custody](#phase-4--team-collaboration--chain-of-custody)
6. [Research Spikes (scaffold only)](#research-spikes-scaffold-only)
7. [Dependency Approval Matrix](#dependency-approval-matrix)
8. [Acceptance Checklist](#acceptance-checklist)

---

## Guiding Principles

1. **No fabricated scores.** Every detector returns an honest `status` field; placeholder numbers never appear.
2. **Additive API evolution.** Existing `POST /api/analyze` response shape is frozen; new fields are appended, new contracts get new endpoints.
3. **Feature flags and lazy loading.** Every heavyweight addition defaults to OFF via an env var and is imported only when first used.
4. **CPU budget awareness.** Latency impacts are estimated per feature; caps and downsampling are documented.
5. **Test parity.** Every new endpoint gets pytest coverage; the existing 66-test suite must pass after each phase.

---

## Phase 1 — Explainability & Forensic UI

### 1.1 Existing State Assessment

What already exists and will NOT be rewritten:

| Component | File | Status |
|---|---|---|
| Grad-CAM + occlusion heatmap generation | `backend/services/explainability.py` (420 lines) | ✅ Complete — produces genuine heatmaps via forward hooks or masked forwards |
| Explain route | `backend/routes/explain.py` (81 lines) | ✅ Complete — `POST /api/explain` with auth, rate limiting, audit logging |
| Per-frame scores in visual analysis | `backend/services/visual_detector.py` → `_per_frame_means()`, `per_frame_scores` field | ✅ Already emitted in `/api/analyze` response |
| Frame timeline chart | `frontend/src/components/FrameTimeline.jsx` (160 lines) | ✅ Complete — Recharts AreaChart with seek-to-frame |
| Provenance card | `frontend/src/components/ProvenanceCard.jsx` (8.7 KB) | ✅ Complete |
| Explainability tests | `backend/tests/test_explainability.py` (5.8 KB) | ✅ Complete |
| Design system (Tailwind v4 `@theme`) | `frontend/src/index.css` — dark palette, animations | ✅ Already uses near-black shell, neon accents, JetBrains Mono |

### 1.2 What Phase 1 Adds (net-new work only)

Given the assessment above, Phase 1 focuses on **three backend additions** and **four frontend additions** that are genuinely missing:

#### Backend Changes

##### 1.2.1 Enhanced Explain Response — Original + Overlay Base64 Images

**File:** `backend/services/explainability.py`  
**Change type:** Modify `generate_explanation()` return value (additive fields)

Currently the explain endpoint returns only `heatmap_b64` (the colorized heat overlaid on a black canvas). The user request asks for three images: original face crop, heatmap, and blended overlay.

**New additive fields in the `completed` response:**

```json
{
  "original_crop_b64": "data:image/png;base64,...",
  "overlay_b64": "data:image/png;base64,...",
  "overlay_opacity": 0.5,
  "peak_regions": [
    {
      "x": 0.32, "y": 0.18, "w": 0.21, "h": 0.25,
      "peak_intensity": 0.94,
      "description": "right periorbital region"
    }
  ]
}
```

- `original_crop_b64` — the raw BGR face crop resized to 380x380, encoded as PNG.
- `overlay_b64` — alpha-blended composite: `0.5 * original + 0.5 * heatmap`.
- `peak_regions` — bounding boxes (normalized 0-1) where the heatmap intensity exceeds 75th percentile, with anatomical region labels derived from spatial position (forehead / eye / nose / mouth / jaw quadrants — deterministic, no model needed).

**Implementation notes:**
- Overlay is computed with `cv2.addWeighted`. No new dependency.
- Peak region extraction uses `cv2.threshold` + `cv2.findContours` on the heat array, then normalizes coords to [0,1]. Spatial labels are a simple Y-band mapping (top 25% = forehead, 25-45% = eye region, etc.).
- No new model, no new library.

**Latency impact:** +5-10 ms (two additional PNG encodes + contour finding). Negligible.

##### 1.2.2 Additive Per-Frame Timeline Data in Video Analysis

**File:** `backend/services/visual_detector.py`  
**Change type:** Extend `per_frame_scores` entries (additive fields)

Currently each entry is `{"frame": int, "score": float}`. The request asks for timestamp and top face box.

**New shape (additive — `frame` and `score` remain unchanged):**

```json
{
  "frame": 42,
  "score": 0.7231,
  "timestamp_s": 1.750,
  "top_face_box": {"x": 120, "y": 80, "width": 160, "height": 200}
}
```

- `timestamp_s` is computed from `frame_index / fps` (fps passed down from analysis route; default 0 for images).
- `top_face_box` is the box whose crop produced the highest score in that frame. Retrieved from the existing `boxes_by_frame` dict.

**Signature change to `analyse_media()`:** Accept an optional `fps: float = 0.0` parameter. The analysis route already has `processed["fps"]` and can pass it through. Default 0.0 preserves backward compatibility for callers that don't supply it.

**Latency impact:** Zero. Data is already computed; this restructures the return dict.

##### 1.2.3 Forensic Narrative Generator

**File (new):** `backend/services/narrative_generator.py`  
**Route (new):** `POST /api/v2/narrative`  
**Route file (new):** `backend/routes/narrative.py`

Converts structured analysis output into a human-readable forensic report paragraph.

**Request:**
```json
{
  "analysis_id": 42
}
```
*Or inline data:*
```json
{
  "visual_score": 0.82,
  "visual_classification": "deepfake",
  "audio_score": 0.23,
  "audio_classification": "deepfake",
  "fused_score": 0.76,
  "fused_classification": "deepfake",
  "ai_image_classification": "not_applicable",
  "peak_regions": [],
  "media_type": "video",
  "frames_analyzed": 8,
  "faces_analyzed": 12
}
```

**Response:**
```json
{
  "status": "ok",
  "narrative": "This video was analyzed across 8 sampled frames with 12 face crops...",
  "generator": "openai | template",
  "numbers_validated": true
}
```

**Logic:**
1. If `OPENAI_API_KEY` is configured, call the existing OpenAI integration (reuse the `assistant.py` HTTP client pattern) with a strict prompt: "Restate the following numeric findings as a forensic narrative. Do NOT invent any number. Use only the values provided." The response is then validated: every numeric value mentioned in the narrative is cross-checked against the input dict. If any number appears that wasn't in the input, that sentence is replaced with `[redacted: unsupported claim]`.
2. If no API key, fall back to a deterministic Python `str.format` template that slots in the scores and classifications.

**Env vars:** Uses existing `OPENAI_API_KEY`. No new env var.

**New dependency:** None. Reuses `urllib.request` pattern from `assistant.py`.

**Latency impact:**
- Template fallback: <1 ms.
- OpenAI path: 1-3 s (network round-trip). Non-blocking to the analysis pipeline — called on demand via its own endpoint.

#### Frontend Changes

##### 1.2.4 Heatmap Viewer Card

**File (new):** `frontend/src/components/HeatmapViewer.jsx`  
**Integrated into:** `frontend/src/components/AnalyzeSection.jsx`

Three-panel viewer: Original crop | Heatmap | Overlay, with:
- Opacity slider (Framer Motion animated) controlling `overlay_opacity` CSS.
- Frame selector dropdown (for videos with multiple sampled frames — triggers re-fetch to `POST /api/explain` with a `frame_index` query param).
- Framer Motion `AnimatePresence` crossfade between panels.

**New dependency:** None. Uses existing `framer-motion` and `recharts`.

##### 1.2.5 Enhanced Frame Timeline

**File:** `frontend/src/components/FrameTimeline.jsx`  
**Change type:** Extend existing component

Add:
- Click-a-bar to load that frame's heatmap (calls `POST /api/explain` with `frame_index`).
- Bar coloring: gradient from emerald (score < 0.3) through amber (0.3-0.7) to rose (> 0.7).
- Tooltip showing timestamp, score, and face box dimensions.

All data is already available in `per_frame_scores`.

##### 1.2.6 "Why Was This Flagged?" Panel

**File (new):** `frontend/src/components/ForensicNarrative.jsx`  
**Integrated into:** `frontend/src/components/AnalyzeSection.jsx`

Renders:
- The forensic narrative text (fetched from `POST /api/v2/narrative`).
- The `peak_regions` list from the explain response, with region labels and intensity values.
- A disclaimer footer.

##### 1.2.7 Analysis Progress Pipeline UI

**File (new):** `frontend/src/components/AnalysisPipeline.jsx`  
**Integrated into:** `frontend/src/components/AnalyzeSection.jsx`

A horizontal 6-stage progress indicator shown during upload+analysis:

```
[Upload] -> [Decode] -> [Face Detection] -> [Model Inference] -> [Fusion] -> [Explainability]
```

Each stage transitions from `pending` -> `active` (pulsing cyan ring) -> `completed` (filled green checkmark) -> `failed` (red X) as the analysis progresses. The analysis route already returns structured data per stage, so the frontend can derive stage completion from the response keys.

##### 1.2.8 Skeleton Loaders, Empty States, Error States

**File:** Modify `AnalyzeSection.jsx`, `History.jsx`, `Cases.jsx`, `Dashboard.jsx`

Add:
- Skeleton pulse placeholders during loading (CSS `animate-shimmer` already exists in `index.css`).
- Distinct empty-state illustrations with a call-to-action ("Upload your first file", "No cases yet").
- Error-state cards with retry buttons.

##### 1.2.9 Command Palette (Cmd/Ctrl+K)

**File (new):** `frontend/src/components/CommandPalette.jsx`  
**Integrated into:** `frontend/src/App.jsx`

A modal search overlay listing:
- Recent analyses (fetched from `/api/history?limit=10`).
- Cases (fetched from `/api/cases?limit=10`).
- Navigation shortcuts (Dashboard, Reports, Assistant, Evaluation).

Uses `useEffect` with `keydown` listener for Cmd/Ctrl+K. Framer Motion `AnimatePresence` for modal transition.

**New dependency:** None.

#### Files Created / Modified Summary (Phase 1)

| Action | File |
|--------|------|
| Modify | `backend/services/explainability.py` — add `original_crop_b64`, `overlay_b64`, `peak_regions` |
| Modify | `backend/services/visual_detector.py` — add `timestamp_s`, `top_face_box` to per-frame data; accept `fps` param |
| Modify | `backend/routes/analysis.py` — pass `fps` to `analyse_media()` |
| Create | `backend/services/narrative_generator.py` |
| Create | `backend/routes/narrative.py` |
| Modify | `backend/main.py` — register narrative router |
| Create | `backend/tests/test_narrative.py` |
| Modify | `backend/tests/test_explainability.py` — cover new fields |
| Modify | `backend/tests/test_visual_detector.py` — cover new per-frame fields |
| Create | `frontend/src/components/HeatmapViewer.jsx` |
| Create | `frontend/src/components/ForensicNarrative.jsx` |
| Create | `frontend/src/components/AnalysisPipeline.jsx` |
| Create | `frontend/src/components/CommandPalette.jsx` |
| Modify | `frontend/src/components/AnalyzeSection.jsx` — integrate new cards |
| Modify | `frontend/src/components/FrameTimeline.jsx` — enhanced click + color |
| Modify | `frontend/src/App.jsx` — mount CommandPalette |
| Modify | `frontend/src/index.css` — skeleton loader utilities, empty-state styles |
| Modify | Multiple page files — skeleton/empty/error states |

#### New Env Vars (Phase 1)

None new. Reuses existing `OPENAI_API_KEY` and `CLARITY_EXPLAIN_GRID` / `CLARITY_EXPLAIN_BATCH`.

#### DB Schema Changes (Phase 1)

None.

#### New Dependencies (Phase 1)

**None.** All work uses existing libraries (OpenCV, NumPy, torch, urllib, Recharts, Framer Motion).

#### Test Plan (Phase 1)

| Test File | Tests |
|-----------|-------|
| `test_explainability.py` (extend) | `test_completed_includes_original_crop_b64`, `test_completed_includes_overlay_b64`, `test_peak_regions_are_normalized`, `test_peak_regions_empty_when_uniform_heat` |
| `test_visual_detector.py` (extend) | `test_per_frame_scores_include_timestamp`, `test_per_frame_scores_include_top_face_box`, `test_fps_zero_default_backward_compat` |
| `test_narrative.py` (new) | `test_template_fallback_generates_narrative`, `test_narrative_refuses_without_scores`, `test_narrative_validates_numbers`, `test_narrative_inline_data`, `test_narrative_by_analysis_id_not_found` |

**Estimated new tests: 12**  
**Total after Phase 1: ~78 tests**

#### Latency / CPU Impact (Phase 1)

| Feature | Impact |
|---------|--------|
| Enhanced explain (overlay + peak regions) | +5-10 ms per explain call |
| Per-frame timestamp/box | +0 ms (reshuffles existing data) |
| Narrative (template) | <1 ms |
| Narrative (OpenAI) | 1-3 s (network, called on-demand only) |
| Frontend components | Render-time only, no backend cost |

---

## Phase 2 — Real-Time Analysis

### 2.1 Backend Changes

##### 2.1.1 WebSocket Streaming Endpoint

**File (new):** `backend/routes/ws_stream.py`  
**Endpoint:** `WS /ws/analyze/stream`

Accepts a stream of JPEG frames (binary WebSocket messages), samples every Nth frame (configurable via `CLARITY_STREAM_SAMPLE_INTERVAL`, default 5), runs the visual detector on each sampled frame, and emits per-frame JSON events.

**Inbound message format:** Raw JPEG bytes (one frame per message).

**Outbound event format:**
```json
{
  "type": "frame_result",
  "frame_index": 42,
  "score": 0.7123,
  "face_count": 1,
  "status": "ok",
  "running_mean": 0.6891,
  "running_count": 8,
  "latency_ms": 1420
}
```

**Concurrency and safety:**
- `CLARITY_MAX_STREAMS` (default 2) — hard cap on concurrent WebSocket sessions. Beyond this, new connections receive a close frame with code 1013 (Try Again Later).
- `CLARITY_STREAM_MAX_DURATION_S` (default 120) — hard session timeout.
- Each session tracks frame count and enforces a per-session cap (`CLARITY_STREAM_MAX_FRAMES`, default 200).

**New dependency request:** `websockets` — already bundled with `uvicorn[standard]` (see `requirements.txt` line 2). No new pip install needed. FastAPI's WebSocket support comes from Starlette, which is already a dependency.

**Latency impact:** ~1.35 s per sampled frame (same as batch analysis — one `score_face_crop` call per face). Capped by `CLARITY_STREAM_MAX_FRAMES`.

##### 2.1.2 WebSocket Registration

**File:** `backend/main.py`  
**Change:** Import and mount `ws_stream` router.

### 2.2 Frontend Changes

##### 2.2.1 Live Demo Page

**File (new):** `frontend/src/pages/LiveDemo.jsx`  
**Route:** `/live` (lazy loaded)

Features:
- `getUserMedia` -> canvas frame capture -> WebSocket sender.
- Real-time score overlay on the video feed.
- Running aggregate display.
- Clear "EXPERIMENTAL — CPU-THROTTLED" banner.
- Graceful degradation when WebSocket is unavailable.
- Feature-gated: visible only when `VITE_ENABLE_LIVE_DEMO=true`.

##### 2.2.2 Browser Extension Scaffold

**Directory (new):** `extension/`

Contents:
- `manifest.json` (Manifest V3)
- `content.js` (scaffold: detects `<video>`/`<img>`, captures thumbnail, comments showing where API call would go)
- `popup.html` / `popup.js` (scaffold UI)
- `background.js` (service worker scaffold)
- `README.md` — permissions rationale, privacy note, ONNX Runtime Web as documented future step
- `icons/` — placeholder 16/48/128 PNGs

**This is a scaffold only.** The extension does NOT make real API calls. All detection logic is stubbed with `// TODO: implement` comments and `status: "scaffold"` returns.

#### Files Created / Modified Summary (Phase 2)

| Action | File |
|--------|------|
| Create | `backend/routes/ws_stream.py` |
| Modify | `backend/main.py` — mount WS router |
| Create | `backend/tests/test_ws_stream.py` |
| Create | `frontend/src/pages/LiveDemo.jsx` |
| Modify | `frontend/src/App.jsx` — add `/live` route |
| Create | `extension/manifest.json` |
| Create | `extension/content.js` |
| Create | `extension/popup.html`, `extension/popup.js` |
| Create | `extension/background.js` |
| Create | `extension/README.md` |
| Create | `extension/icons/` (placeholder PNGs) |

#### New Env Vars (Phase 2)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLARITY_STREAM_SAMPLE_INTERVAL` | `5` | Sample every Nth frame from WS stream |
| `CLARITY_MAX_STREAMS` | `2` | Max concurrent WS sessions |
| `CLARITY_STREAM_MAX_DURATION_S` | `120` | Hard session timeout (seconds) |
| `CLARITY_STREAM_MAX_FRAMES` | `200` | Max frames per session |
| `VITE_ENABLE_LIVE_DEMO` | `false` | Show/hide the live demo page |

#### DB Schema Changes (Phase 2)

None.

#### New Dependencies (Phase 2)

**None.** WebSocket support is already provided by `uvicorn[standard]` + Starlette.

#### Test Plan (Phase 2)

| Test File | Tests |
|-----------|-------|
| `test_ws_stream.py` (new) | `test_ws_connect_and_receive_event`, `test_ws_max_streams_rejected`, `test_ws_timeout_closes`, `test_ws_invalid_frame_handled`, `test_ws_sampling_interval`, `test_ws_running_aggregate` |

**Estimated new tests: 6**  
**Total after Phase 2: ~84 tests**

#### Latency / CPU Impact (Phase 2)

| Feature | Impact |
|---------|--------|
| WS per-frame inference | ~1.35 s per sampled frame (existing model perf) |
| Concurrent stream cap | Limits CPU to 2 x 1.35 s simultaneous |
| Extension scaffold | Zero runtime cost (no real inference) |

---

## Phase 3 — Provenance, Watermarks & Robustness Evaluation

### 3.1 Existing State Assessment

| Component | File | Status |
|---|---|---|
| Provenance extraction (SHA-256, EXIF, PNG text, MP4 ftyp, C2PA byte markers) | `backend/services/provenance.py` (411 lines) | ✅ Complete |
| Provenance route (integrated into `/api/analyze`) | `backend/routes/analysis.py` line 464 | ✅ Complete |
| Provenance frontend card | `frontend/src/components/ProvenanceCard.jsx` | ✅ Complete |
| Provenance tests | `backend/tests/test_provenance.py` | ✅ Complete |

### 3.2 What Phase 3 Adds

##### 3.2.1 C2PA Signature Verification (c2pa-python)

**File:** `backend/services/provenance.py`  
**Change type:** Extend `extract_provenance()` — additive `c2pa_verification` block

**Dependency approval required: `c2pa-python`**

| Attribute | Value |
|-----------|-------|
| Package | `c2pa-python` |
| Version | latest stable |
| Size | ~5 MB wheel (Rust compiled) |
| License | Apache-2.0 or MIT (dual-licensed) |
| CPU cost | ~50-200 ms per file (signature verification, no model) |
| Purpose | Read-only C2PA manifest validation — signer, claim generator, validation result |

**Feature flag:** `CLARITY_ENABLE_C2PA=false` (default OFF).  
**Lazy load:** `c2pa` is imported only inside the verification function, never at module level.

**New response block (additive to existing provenance):**
```json
{
  "c2pa_verification": {
    "status": "verified | invalid | no_manifest | unavailable",
    "signer": "Adobe Photoshop",
    "claim_generator": "Adobe/1.0",
    "validation_errors": [],
    "disclaimer": "C2PA provenance is complementary metadata. It is NOT a deepfake verdict."
  }
}
```

When `c2pa-python` is not installed or the flag is OFF, returns `status: "unavailable"` with reason.

##### 3.2.2 Adversarial Robustness Harness (FGSM + PGD)

**File (new):** `backend/services/adversarial_robustness.py`  
**Route (new):** `POST /api/v2/robustness`  
**Route file (new):** `backend/routes/robustness.py`

Applies FGSM and PGD perturbations at configurable epsilon values to a test image and reports how the visual detector's score shifts. This is **measurement only** — no claim of defense.

**Request:**
```json
{
  "stored_name": "1697550123_abc123.jpg",
  "epsilons": [0.001, 0.005, 0.01, 0.02, 0.05],
  "attack": "fgsm | pgd",
  "pgd_steps": 10,
  "pgd_alpha": 0.005
}
```

**Response:**
```json
{
  "status": "ok",
  "attack": "fgsm",
  "baseline_score": 0.82,
  "results": [
    {"epsilon": 0.001, "perturbed_score": 0.81, "delta": -0.01},
    {"epsilon": 0.005, "perturbed_score": 0.76, "delta": -0.06}
  ],
  "disclaimer": "This measures model sensitivity to adversarial perturbation. It does NOT claim the model is defended."
}
```

**Implementation:**
- FGSM: single-step `x_adv = x + eps * sign(grad)` using the existing EfficientNet-B7 model + torch autograd.
- PGD: iterative projected gradient descent with `alpha` step size and `eps` ball clipping.
- No new dependency — uses `torch` (already installed) for gradient computation.
- Feature flag: `CLARITY_ENABLE_ROBUSTNESS=false` (default OFF).

**Latency impact:**
- FGSM: ~2 s per epsilon (one forward + one backward pass).
- PGD: ~2 s x `pgd_steps` per epsilon (default 10 steps -> ~20 s per epsilon).
- With 5 epsilons, total: FGSM ~10 s, PGD ~100 s.
- Rate-limited: 2/minute. On-demand only, never in the analysis pipeline.

##### 3.2.3 Physio-Acoustic Coupling (rPPG) — EXPERIMENTAL

**File (new):** `backend/services/rppg_coupling.py`  
**Route (new):** `POST /api/v2/rppg`  
**Feature flag:** `CLARITY_ENABLE_RPPG=false` (default OFF)

Extracts an rPPG pulse signal from a face ROI (CHROM or POS method) using existing OpenCV + NumPy, cross-correlates with the audio speech envelope.

**Response block:**
```json
{
  "status": "experimental",
  "method": "CHROM",
  "correlation_coefficient": 0.42,
  "lag_frames": 3,
  "pulse_rate_bpm": 72.4,
  "audio_envelope_present": true,
  "disclaimer": "This is an EXPERIMENTAL triage signal. It NEVER overrides or modifies the primary fusion score. Treat with appropriate skepticism."
}
```

**Implementation notes:**
- CHROM (de Haan & Jeanne, 2013): extracts RGB channel means from face ROI across frames, applies a fixed linear combination, bandpass filters 0.7-3.5 Hz.
- Cross-correlation with audio envelope (extracted via existing FFmpeg + numpy).
- No new dependency — uses only numpy, opencv, and the existing FFmpeg binary.
- Returns `status: "experimental"` ALWAYS. Never returns `status: "completed"`.
- **Never modifies the primary fusion score.** Exposed as a separate, clearly-labeled block.

**Latency impact:** ~500 ms for a 30-frame video. CPU-bound (numpy FFT). Acceptable for an experimental on-demand feature.

### 3.3 Frontend Changes

##### 3.3.1 Enhanced Provenance Card

**File:** `frontend/src/components/ProvenanceCard.jsx`  
**Change type:** Extend with C2PA verification section

Add a verification badge and signer/generator metadata when `c2pa_verification` block is present.

##### 3.3.2 Experimental Findings Card

**File (new):** `frontend/src/components/ExperimentalFindings.jsx`

Displays the rPPG coupling results with:
- Clear "EXPERIMENTAL" badge with orange border.
- Correlation coefficient gauge.
- Pulse rate display.
- Disclaimer text always visible (not collapsible).

##### 3.3.3 Robustness Tab in Evaluation Lab

**File:** `frontend/src/pages/Evaluation.jsx`  
**Change type:** Add a new tab

Score-vs-epsilon line chart (Recharts) showing how the visual score degrades under FGSM/PGD perturbation. Users select an existing analysis, choose epsilon range, and submit.

#### Files Created / Modified Summary (Phase 3)

| Action | File |
|--------|------|
| Modify | `backend/services/provenance.py` — add C2PA verification block |
| Create | `backend/services/adversarial_robustness.py` |
| Create | `backend/routes/robustness.py` |
| Create | `backend/services/rppg_coupling.py` |
| Create | `backend/routes/rppg.py` |
| Modify | `backend/main.py` — mount new routers |
| Create | `backend/tests/test_adversarial_robustness.py` |
| Create | `backend/tests/test_rppg_coupling.py` |
| Modify | `backend/tests/test_provenance.py` — cover C2PA blocks |
| Create | `frontend/src/components/ExperimentalFindings.jsx` |
| Modify | `frontend/src/components/ProvenanceCard.jsx` — C2PA section |
| Modify | `frontend/src/pages/Evaluation.jsx` — robustness tab |

#### New Env Vars (Phase 3)

| Variable | Default | Purpose |
|----------|---------|---------|
| `CLARITY_ENABLE_C2PA` | `false` | Enable C2PA signature verification |
| `CLARITY_ENABLE_ROBUSTNESS` | `false` | Enable adversarial robustness endpoint |
| `CLARITY_ENABLE_RPPG` | `false` | Enable rPPG physio-acoustic coupling |

#### DB Schema Changes (Phase 3)

None.

#### New Dependencies (Phase 3)

| Package | Size | License | CPU Cost | Justification |
|---------|------|---------|----------|---------------|
| `c2pa-python` | ~5 MB | Apache-2.0 / MIT | ~50-200 ms/file | Read-only C2PA manifest verification — no alternative pure-Python library exists |

**Awaiting approval before adding `c2pa-python` to requirements.txt.**

All other work (FGSM, PGD, rPPG) uses only existing `torch`, `numpy`, `opencv-python`.

#### Test Plan (Phase 3)

| Test File | Tests |
|-----------|-------|
| `test_provenance.py` (extend) | `test_c2pa_unavailable_when_disabled`, `test_c2pa_no_manifest`, `test_c2pa_verified_fixture` (if fixture available) |
| `test_adversarial_robustness.py` (new) | `test_fgsm_score_shift`, `test_pgd_score_shift`, `test_robustness_unavailable_without_model`, `test_robustness_invalid_epsilon`, `test_robustness_respects_feature_flag` |
| `test_rppg_coupling.py` (new) | `test_rppg_returns_experimental_status`, `test_rppg_unavailable_when_disabled`, `test_rppg_no_video_frames`, `test_rppg_never_modifies_fusion_score` |

**Estimated new tests: 12**  
**Total after Phase 3: ~96 tests**

#### Latency / CPU Impact (Phase 3)

| Feature | Impact |
|---------|--------|
| C2PA verification | 50-200 ms per file (on-demand, behind flag) |
| FGSM robustness | ~2 s per epsilon value (on-demand, behind flag) |
| PGD robustness | ~20 s per epsilon value (on-demand, behind flag) |
| rPPG coupling | ~500 ms for 30-frame video (on-demand, behind flag) |

---

## Phase 4 — Team Collaboration & Chain of Custody

### 4.1 Backend Changes

##### 4.1.1 Analysts Table

**File:** `backend/services/auth_store.py`  
**Change type:** Extend existing schema

The existing `users` table in `auth_store.py` already has `role` and `email` fields. Add additive columns:

```sql
ALTER TABLE users ADD COLUMN department TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN specialty TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN assigned_cases TEXT DEFAULT '[]';
```

Migration is applied in `init_auth_db()` with safe `ALTER TABLE` pattern (SQLite).

##### 4.1.2 Case Comments Table

**File:** `backend/services/case_store.py`  
**Change type:** Add `case_comments` table

```sql
CREATE TABLE IF NOT EXISTS case_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    author_id TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_role TEXT NOT NULL DEFAULT 'analyst',
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (case_id) REFERENCES cases(id)
);
```

**New service functions:**
- `add_comment(case_id, author, content) -> dict`
- `list_comments(case_id, limit=50) -> list[dict]`

##### 4.1.3 Evidence Hash Chaining

**File (new):** `backend/services/chain_of_custody.py`

Each audit entry stores `SHA-256(self_data + previous_entry_hash)`, forming a tamper-evident chain.

```sql
CREATE TABLE IF NOT EXISTS custody_chain (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_data TEXT NOT NULL,
    entry_hash TEXT NOT NULL,
    previous_hash TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_by TEXT NOT NULL
);
```

**Verification endpoint:** `GET /api/cases/{id}/chain/verify`

```json
{
  "status": "intact | broken",
  "entries_checked": 42,
  "first_break_at": null,
  "chain_head_hash": "abc123..."
}
```

Re-walks the chain from entry 0, recomputing each hash and comparing. Reports the first break point if found.

##### 4.1.4 Case Assignment & Status Transitions

**File:** `backend/routes/cases.py`  
**Change type:** Add endpoints

- `POST /api/cases/{id}/assign` — assign analyst(s) to a case.
- `PATCH /api/cases/{id}/transition` — status transition (open -> in_review -> closed, with audit trail).
- All transitions logged to the custody chain.

##### 4.1.5 Role Gating Stub

**File:** `backend/services/auth_deps.py`  
**Change type:** Add `require_role(role: str)` dependency

A config-driven auth stub that checks `current_user["role"]` against the required role. Explicitly documented that real authentication (OAuth, SSO) is out of scope.

##### 4.1.6 AI Assistant Field Extension

**File:** `backend/routes/assistant.py`  
**Change type:** Update `_safe_record()` and `SYSTEM_INSTRUCTIONS`

- Exclude any PII fields (analyst names, emails) from records sent to the LLM.
- Add case comment counts and chain integrity status to the allowed data scope.
- Update system instructions to mention the new data types.

### 4.2 Frontend Changes

##### 4.2.1 Case Detail Enhancement

**File:** `frontend/src/pages/Cases.jsx`  
**Change type:** Extend case detail view

Add:
- Activity feed (list of custody chain events with timestamps).
- Comment thread with input form.
- Chain-of-custody timeline with verification status chip (Intact / Broken).
- Analyst assignment control (dropdown of available analysts).

#### Files Created / Modified Summary (Phase 4)

| Action | File |
|--------|------|
| Modify | `backend/services/auth_store.py` — additive columns |
| Modify | `backend/services/case_store.py` — comments table + functions |
| Create | `backend/services/chain_of_custody.py` |
| Modify | `backend/routes/cases.py` — assign, transition, chain verify endpoints |
| Modify | `backend/services/auth_deps.py` — `require_role()` |
| Modify | `backend/routes/assistant.py` — field extension |
| Modify | `backend/main.py` — mount any new routers |
| Create | `backend/tests/test_chain_of_custody.py` |
| Create | `backend/tests/test_case_comments.py` |
| Modify | `backend/tests/test_auth_security.py` — role gating tests |
| Modify | `frontend/src/pages/Cases.jsx` — activity feed, comments, chain, assignment |

#### New Env Vars (Phase 4)

None new. Role configuration uses the existing `ADMIN_EMAIL` / `ADMIN_PASSWORD` seeding mechanism.

#### DB Schema Changes (Phase 4)

| Table | Change |
|-------|--------|
| `users` | Add `department`, `specialty`, `assigned_cases` columns |
| `case_comments` | New table |
| `custody_chain` | New table |

All changes are additive and applied via `init_*_db()` with safe `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS`.

#### New Dependencies (Phase 4)

**None.**

#### Test Plan (Phase 4)

| Test File | Tests |
|-----------|-------|
| `test_chain_of_custody.py` (new) | `test_chain_creation`, `test_chain_verification_intact`, `test_chain_verification_broken`, `test_chain_empty_case`, `test_chain_hash_deterministic` |
| `test_case_comments.py` (new) | `test_add_comment`, `test_list_comments`, `test_comment_requires_auth`, `test_comment_empty_content_rejected` |
| `test_auth_security.py` (extend) | `test_require_role_analyst`, `test_require_role_reviewer`, `test_role_mismatch_forbidden` |

**Estimated new tests: 12**  
**Total after Phase 4: ~108 tests**

#### Latency / CPU Impact (Phase 4)

| Feature | Impact |
|---------|--------|
| Comments CRUD | <5 ms (SQLite) |
| Chain verification | O(n) where n = entries per case; ~1 ms per entry |
| Assignment | <5 ms |
| Role gating | <1 ms (dict lookup) |

---

## Research Spikes (scaffold only)

### Source Attribution

**File (new):** `backend/services/source_attribution.py`  
**Endpoint scaffold:** `POST /api/v2/attribution`

Returns:
```json
{
  "status": "unavailable",
  "reason": "Source attribution requires a specialized classifier checkpoint (e.g., raw-patch attribution or CLIP fingerprinting trained on generator-specific artifacts). No suitable public checkpoint is currently available for this deployment."
}
```

**Design note file:** `docs/DESIGN_source_attribution.md`  
Content: Brief write-up on the raw-patch attribution approach (Marra et al., 2019) and CLIP fingerprinting approach (Ojha et al., 2023), required training data, and expected integration points.

### SynthID / Invisible Watermark Detection

**File (new):** `backend/services/synthid_stub.py`  
**Endpoint scaffold:** `POST /api/v2/watermark`

Returns:
```json
{
  "status": "unavailable",
  "reason": "SynthID and other invisible watermark detectors have no public detection API or weights. This is documented as future work contingent on public availability of detection tools."
}
```

No code, no fake detection, no dependency.

---

## Dependency Approval Matrix

| Package | Phase | Size | License | Required? | Status |
|---------|-------|------|---------|-----------|--------|
| `c2pa-python` | 3 | ~5 MB | Apache-2.0 / MIT | Optional (behind flag) | **AWAITING APPROVAL** |

All other work uses only existing dependencies:
- `torch` (2.7.0, already installed)
- `numpy` (2.5.3, already installed)
- `opencv-python` (4.14.0, already installed)
- `fastapi` / `uvicorn[standard]` (already installed, includes WebSocket support)
- `framer-motion` / `recharts` (already installed in frontend)

---

## Acceptance Checklist

- [ ] Existing 66 tests still pass; new tests added per endpoint/module (~42 new tests planned across 4 phases)
- [ ] No score is ever fabricated; all non-ok paths return explicit statuses with `status` field
- [ ] All new features are behind env-var flags, lazy-loaded, and degrade gracefully
- [ ] Backward compatibility verified — existing `/api/analyze` response shape unchanged (new fields are additive only)
- [ ] Latency impact of every new feature documented in this plan file (see per-phase tables)
- [ ] README updated with flags, env vars, endpoints, and limitations after each phase
- [ ] No unapproved dependencies added (only `c2pa-python` requires approval; see matrix)
- [ ] Each phase delivered as a separate, reviewable set of commits
- [ ] Audio model CC BY-NC-SA 4.0 license respected — no commercial-use code paths introduced
- [ ] AI assistant's allowed data scope updated to exclude PII from new fields (Phase 4)
