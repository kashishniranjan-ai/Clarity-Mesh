# Clarity Mesh

**AI-Powered Multimodal Deepfake Detection System**

Clarity Mesh analyzes images, videos, and audio and estimates whether media may be AI-generated or manipulated. It includes an investigation workbench for triage, evidence organization, reporting, and human review.

> **Current status: multimodal detection, investigation case management, analytics, reports, and an optional tool-using AI analyst are implemented.**
> A React + Vite frontend and a FastAPI backend are implemented and wired together: uploads are validated, decoded with OpenCV, sampled into frames, scanned for faces, scored by a **real pretrained EfficientNet-B7 visual deepfake model** (Selim Seferbekov's DFDC-winning solution, exported through facetorch as TorchScript) and, where an audio track exists, by a **real pretrained wav2vec-small-anti-deepfake audio model** (NII Yamagishi Lab). When **both** modalities produce genuine scores, a transparent weighted fusion layer combines them into a `multimodal_analysis` block. Every score is genuine model output — never hardcoded or guessed.

## Completed Steps

| Step | What was delivered |
| ---- | ------------------ |
| STEP 1 | Project foundation: folder structure, Git setup, documentation |
| STEP 2 | React + Vite + Tailwind CSS frontend (upload/analysis UI) |
| STEP 3 | FastAPI backend with validation, upload handling and CORS |
| STEP 4 | Frontend ↔ backend wiring (UI posts files, renders results) |
| STEP 5 | OpenCV media processing: image/video decode, frame sampling (≤16 frames/video), Haar-cascade face detection with padded face crops |
| STEP 6 | Real EfficientNet-B7 visual deepfake model integrated into `POST /api/analyze` |
| STEP 7 | Real wav2vec-small-anti-deepfake audio detector integrated as independent `audio_analysis` block (16 kHz, 10 s chunks / 2 s overlap, REAL-class score, threshold 0.5) |
| STEP 8 | Genuine multimodal fusion layer (`backend/services/multimodal_fusion.py`): weighted fusion of the two real detector outputs into `multimodal_analysis` |
| STEP 9 | Pretrained CLIP ViT-L/14 synthetic/AI-generated image detector (`ai_image_analysis`) |
| STEP 10 | SQLite-backed audit trail and history API (`/api/history` GET & DELETE) with zero new dependencies |
| STEP 11 | Offline benchmark evaluation harness (`evaluate.py`) with precision, recall, F1, and confusion matrix |
| STEP 12 | Cyber-forensics visual system: animated mesh hero, circular score gauges, analysis pipeline display, report generator, JSON inspector, and telemetry cards |
| STEP 13 | Analyst workspace with Framer Motion route transitions and live analytics at `/dashboard` |
| STEP 14 | Investigation case management (`/cases`) with status/priority workflow, linked analysis evidence, and case report export |
| STEP 15 | Read-only AI research agent (`/assistant`) using the OpenAI Responses API and constrained history tools, with a no-key local fallback |
| STEP 16 | Reporting studio (`/reports`) with 7/30/90-day activity views and JSON, CSV, and print-to-PDF exports |
| STEP 17 | Model evaluation lab (`/evaluation`) imports benchmark JSON/CSV locally and visualizes confusion matrices, precision, recall, F1, and coverage |
| PHASE 1 | **Explainability & Forensic UI:** Grad-CAM + Occlusion saliency heatmaps with blended overlay & peak regions (`POST /api/explain/visual`), per-frame timeline timestamps & bounding boxes, deterministic & LLM-verified forensic narrative generator (`POST /api/v2/narrative`), interactive HeatmapViewer, and Cmd/Ctrl+K command palette |

## Technology Stack

| Layer | Technology | Status |
| ----- | ---------- | ------ |
| Frontend | React 19 + Vite + Tailwind CSS v4 + Framer Motion | **Implemented** |
| Backend API | Python + FastAPI (Uvicorn) | **Implemented** |
| Media processing | OpenCV — decode, frame sampling, face detection | **Implemented** |
| AI / ML Models | EfficientNet-B7 (visual) + wav2vec2 (audio) + CLIP ViT-L/14 (AI images) + weighted fusion | **Implemented** |
| Research assistant | Optional OpenAI Responses API agent with read-only history tools; local summary fallback | **Implemented** |
| Case workflow | SQLite investigation cases, status and priority, evidence links, and exports | **Implemented** |
| Audio | FFmpeg + librosa + wav2vec-small-anti-deepfake (16 kHz, chunked) | **Implemented** |
| Fusion | Multimodal (visual + audio) weighted arithmetic aggregation | **Implemented** |
| Database | SQLite (`backend/data/history.db`) for forensic audit logging | **Implemented** |
| Evaluation | Offline benchmark CLI (`evaluate.py`) | **Implemented** |

## The Visual Model

- **Architecture:** EfficientNet-B7 binary classifier — one logit passed through a sigmoid — exported as a **TorchScript** artifact (`model.pt`).
- **Origin:** **Selim Seferbekov's 1st-place solution to the Facebook/Meta Deepfake Detection Challenge (DFDC, 2020)**, re-exported through **facetorch** and hosted on Hugging Face (`tomas-gajarsky/facetorch-deepfake-efficientnet-b7`, MIT licence).
- **Weights:** stored locally under **`backend/weights/model.pt`** (~270 MB) and **excluded from Git** (`.gitignore` ignores `weights/`). They download automatically on the first analysis and are SHA-256 verified on every load — mismatched weights are refused.
- **Score:** an **uncalibrated sigmoid score** in `[0, 1]`, higher = more likely fake. **It is NOT a guaranteed probability** and never proof of authenticity. Classification uses a fixed threshold of `0.7` → `real` / `deepfake` (documented in `backend/services/visual_detector.py`).
- **Aggregation:** arithmetic mean of the per-face scores over the sampled frames (the original DFDC default strategy); at most 12 evenly spaced face crops are scored per analysis (`CLARITY_VISUAL_MAX_FACES`).
- **Honest failure states:** `no_face_detected`, `model_unavailable` and `inference_failed` are returned as explicit `status` values with **no score** — a failure is never guessed as "real".

## STEP 8 — Multimodal Visual + Audio Fusion

`POST /api/analyze` now also returns a **`multimodal_analysis`** block, computed by the
pure post-processing module `backend/services/multimodal_fusion.py` (`fuse_multimodal_results`).
It performs **no model inference itself** — it only fuses the two already-computed detector blocks.

### Score directions (the two detectors genuinely disagree — conversion lives in the fusion layer)

- **Visual** `visual_analysis.score` is **FAKE-oriented** (EfficientNet-B7 sigmoid; higher = more likely fake; threshold **0.7**).
- **Audio** `audio_analysis.score` is **REAL-oriented** (wav2vec softmax index 1 = REAL; higher = more likely real; threshold **0.5**).
- The fusion layer converts first: `audio_fake_score = 1.0 - audio_analysis.score`, while `visual_fake_score = visual_analysis.score` passes through unchanged. Neither detector was modified.

### Fusion formula (transparent weighted arithmetic mean)

```text
fused_fake_score = 0.6 * visual_fake_score + 0.4 * audio_fake_score
```

- Default weights live as constants in **one documented location** (`VISUAL_WEIGHT = 0.6`, `AUDIO_WEIGHT = 0.4` in `multimodal_fusion.py`). This project is primarily a visual detector, so visual carries the larger weight; audio is an additional independent modality.
- These are **engineering/default weights — NOT scientifically optimal** and NOT tuned on project data. They should later be validated on an appropriate multimodal evaluation dataset.
- The fused score is explicitly an **uncalibrated multimodal fusion score** — a transparent engineering combination, **NOT a guaranteed probability**.
- Fusion threshold is its own named constant: **`FUSION_THRESHOLD = 0.5`** — fused ≥ 0.5 → `"deepfake"`, fused < 0.5 → `"real"`. The three thresholds stay independent: visual 0.7, audio 0.5, fusion 0.5.

### Missing / failed modality policy (no invented values, ever)

Only blocks with `status == "completed"` **and** a genuine finite score in `[0, 1]` may be fused. Failure states (`no_face_detected`, `no_audio`, `corrupt_audio`, `model_unavailable`, `inference_failed`, `not_applicable`, …) are **never** converted into numbers:

| Situation | `multimodal_analysis.status` | Fused score? |
|---|---|---|
| Both modalities completed | `"completed"` (with `visual_fake_score`, `audio_fake_score`, weights, `fused_fake_score`, `classification`) | ✅ yes |
| Only one modality completed | `"partial"` (`available_modalities` / `missing_modalities` + reason) | ❌ never |
| Neither modality completed | `"unavailable"` | ❌ never |
| A completed score is non-numeric / NaN / infinite / outside [0, 1] | `"invalid_input"` (never clamped or defaulted) | ❌ never |

Consequences: **images and standalone-audio files never receive a fused score** (the other modality is `not_applicable`); a video without an audio track gets `partial`, not a guessed fusion; the successful modality's own block always remains available independently. The raw `visual_analysis` and `audio_analysis` blocks are returned untouched beside `multimodal_analysis` for explainability and debugging.

### Example (arithmetic illustration only — real outputs always come from the models)

```text
visual score (FAKE-oriented) = 0.72
audio score  (REAL-oriented) = 0.18 → audio_fake_score = 1.00 − 0.18 = 0.82
fused = 0.6 × 0.72 + 0.4 × 0.82 = 0.76 → "deepfake" (≥ 0.5)
```

Nothing here is a claim of accuracy: the fused score is uncalibrated, the weights are defaults awaiting benchmark validation, and `real` never proves authenticity.

## Project Structure

```
Clarity-Mesh/
├── frontend/                 # React + Vite + Tailwind UI (STEPS 2–4)
│   └── src/                  # components, pages, API client
├── backend/                  # FastAPI server (STEPS 3–6)
│   ├── routes/               # analysis, history, cases, assistant API endpoints
│   ├── services/             # detectors, case/history stores, fusion, and analytics
│   ├── tests/                # pytest suite (unit + API tests, 66 tests)
│   ├── weights/              # model.pt — downloaded locally, git-ignored
│   ├── models/               # Database/schema models (SQLite) — NOT ML models
│   └── utils/                # Shared helpers
├── ai/                       # Scratch dir for future ML experiments (audio + fusion live in services/)
├── datasets/                 # Local training/evaluation data (git-ignored)
├── uploads/                  # User-uploaded media (git-ignored)
├── results/                  # Generated analysis outputs (git-ignored)
├── README.md
└── .gitignore
```

## Architecture Notes

- **Modular by design.** Routes stay model-agnostic: they call `services/*`, which orchestrate the processors. The integrated visual detector lives in `backend/services/visual_detector.py` (STEP 6); the audio and fusion modules already live in `backend/services/audio_detector.py` (STEP 7) and `backend/services/multimodal_fusion.py` (STEP 8) behind the same service interface, without changing routes or the frontend.
- **Separation of concerns.** `routes` handle HTTP, `services` orchestrate work, `models` describe stored data, `utils` hold shared helpers.
- **No fake results.** Scores come only from genuine model inference. When inference cannot run (no face / model unavailable / inference failure), the API returns an explicit state and **no score** — never a made-up prediction.

## Current API Endpoints

The backend serves on **`http://127.0.0.1:8000`** (all routes under `/api`):

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/health` | Liveness probe → `{"status": "healthy", "service": "Clarity Mesh API", "version": "0.1.0"}` |
| `POST` | `/api/analyze` | Multipart upload (form field `file`) of an image, video or audio file. Validates the file (type, size ≤ 50 MB), decodes with OpenCV, samples frames, detects faces, runs the EfficientNet-B7 visual deepfake detector, wav2vec2 audio deepfake detector, and CLIP ViT-L/14 synthetic image detector, then fuses genuine scores into `multimodal_analysis`. Saves audit record to SQLite. |
| `GET` | `/api/history` | List recent stored analyses from local SQLite store (newest first, limit query param, default 50). |
| `GET` | `/api/insights` | Aggregate the latest 500 audit records into activity, outcome, detector coverage, and score metrics. |
| `GET` | `/api/cases` | List investigation cases and their evidence counts. |
| `POST` | `/api/cases` | Create an investigation case. |
| `GET` | `/api/cases/{id}` | Read one case and its linked analysis records. |
| `PATCH` | `/api/cases/{id}` | Update case status, priority, or investigation notes. |
| `POST` | `/api/cases/{id}/analyses/{analysis_id}` | Link a stored analysis to a case. |
| `DELETE` | `/api/cases/{id}` | Delete a case; analysis history remains intact. |
| `GET` | `/api/assistant/status` | Report whether the AI provider is configured (never returns secrets). |
| `POST` | `/api/explain` | Saliency explainability heatmap for stored upload (occlusion or gradcam). |
| `POST` | `/api/explain/visual` | Targeted visual explainability: accepts stored_name, analysis_id, frame_index, or direct image upload. Returns base64 original face crop, heatmap crop, blended overlay (50%), and localized peak activation regions. |
| `POST` | `/api/v2/narrative` | Structured-to-human forensic narrative generator: converts detector outputs, flags, and peak saliency regions into a cohesive report paragraph with strict number verification (OpenAI or deterministic template). |
| `DELETE` | `/api/history` | Purge all stored analysis records from the local SQLite store. |

## Analyst Workspace and Deployment

- `/dashboard` shows activity over seven days, outcome distribution, detector coverage, score coverage, and a mean fake-oriented score for the latest 500 records.
- `/analyst` answers common questions with transparent summaries grounded in those local aggregates. It does not call an external LLM or upload media.
- Framer Motion adds route, chart, and card transitions; route chunks load on demand.
- `docker-compose.yml` starts the API behind an Nginx-served frontend, persists SQLite/uploads/model cache in named volumes, and waits for the API health check before starting the UI.

To start the containerized app, run `docker compose up --build`. Open **http://localhost:8080**. The first model-backed analysis can download pretrained weights and requires network access from the backend container. For production exposure, place TLS and authentication at a trusted reverse proxy and set an appropriate access policy for the local audit data.

**Accepted uploads:** images — JPEG, PNG, WebP, GIF, BMP; videos — MP4, MPEG, QuickTime/MOV, AVI, WebM, MKV; standalone audio — MP3, WAV, FLAC, M4A.

Interactive auto-generated docs: **`http://127.0.0.1:8000/docs`** (FastAPI/Swagger UI). All analyses are persistently audited to local SQLite (`backend/data/history.db`). Detector scores remain uncalibrated and are not proof of authenticity.

## Investigation Workspace and Deployment

- `/dashboard` shows activity, outcome distribution, detector coverage, score coverage, and mean fake-oriented score over the selected history window.
- `/cases` organizes records into persistent investigations with notes, priority, status, and linked analysis evidence.
- `/assistant` can use OpenAI function calling over three read-only tools: aggregate history, search analysis records, and inspect one analysis ID. It receives sanitized detector metadata only; original media and filenames are not sent. With no API key, local summary mode remains available.
- `/reports` builds time-windowed activity reports and exports JSON/CSV or uses browser print-to-PDF.
- `/evaluation` reads outputs from the existing benchmark CLI directly in the browser; labeled media and benchmark files are not uploaded.
- Framer Motion adds route, chart, and card transitions; route chunks load on demand.
- `docker-compose.yml` starts the API behind an Nginx-served frontend, persists SQLite/uploads/model cache in named volumes, and waits for the API health check before starting the UI.

To enable OpenAI analysis, copy `.env.example` to `.env` and add a server-side `OPENAI_API_KEY`. Start the containerized app with `docker compose up --build`; open **http://localhost:8080**. The first model-backed analysis can download pretrained weights and requires network access from the backend container. For production exposure, place TLS and authentication at a trusted reverse proxy and set an appropriate access policy for local audit data.

## Local URLs

| Service | URL |
| ------- | --- |
| Frontend (Vite dev server) | http://localhost:5173 |
| Backend (FastAPI / Uvicorn) | http://127.0.0.1:8000 |
| Backend health check | http://127.0.0.1:8000/api/health |
| API docs (Swagger UI) | http://127.0.0.1:8000/docs |

The frontend calls the backend at `http://127.0.0.1:8000` by default (override with the `VITE_API_BASE_URL` environment variable). The backend's CORS policy allows the Vite dev origins listed in `ALLOWED_ORIGINS` in `backend/main.py` (5173 plus follow-on ports such as 5175 when Vite shifts ports).

## How to Start the Backend

Open a terminal in the repository root:

```bash
cd backend
python -m venv venv
# Windows: venv\Scripts\activate    |  macOS/Linux: source venv/bin/activate
pip install torch==2.7.0 --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API is then available at **http://127.0.0.1:8000** (health check: http://127.0.0.1:8000/api/health). If port 8000 is busy, use `--port 8001` and point the frontend at it (see `frontend/.env`, `VITE_API_BASE_URL`).

## How to Start the Frontend

Open a **second** terminal in the repository root:

```bash
cd frontend
npm install
npm run dev
```

The UI is then available at the port Vite prints (usually **http://localhost:5173**; if busy, the next free port, e.g. 5174/5175) — that exact origin must be in `ALLOWED_ORIGINS` in `backend/main.py`.

### Notes

- **Model weights:** `backend/weights/model.pt` (~270 MB) downloads automatically on the first analysis and is SHA-256 verified on every load. It is not stored in Git.
- **Tests:** with the backend venv active, run `python -m pytest backend/tests` from the repository root (66 tests: STEP 6 + STEP 7 + STEP 8 fusion).
- **FFmpeg is required for audio analysis** (STEP 7+): videos need an audio-track probe/extraction step; uploads without an audio stream return `audio_analysis.status == "no_audio"` and no invented score. OpenCV's bundled decoder still handles video frame extraction.

- **Audio model licence (research / non-commercial).** The audio detector uses the NII Yamagishi Lab `wav2vec-small-anti-deepfake` weights, licensed **CC BY-NC-SA 4.0 (research and educational use only)**. This college submission stays within that scope; commercial use or redistribution of the weights is not permitted.

## Current Limitations

- **CPU inference is relatively slow.** The model runs on CPU at roughly **1.35 s per face crop**, so analyzing a video takes seconds to tens of seconds (bounded by the 12-crop cap, `CLARITY_VISUAL_MAX_FACES`). There is no GPU requirement, but there is no GPU acceleration either.
- **The model is a visual/face-based detector only.** It judges what it can see in detected faces. A voice-cloned or dubbed video whose faces are untouched will **not** be flagged by the visual model (the audio model covers the soundtrack where an audio stream exists).
- **The visual score is uncalibrated.** The sigmoid output is a raw model signal, **not a guaranteed probability**, and it has not been calibrated on this project's data. It should be read as a relative indicator, not a percentage chance. The same holds for the STEP 8 **fused score**: it is an *uncalibrated engineering combination* of the two model outputs (default weights 0.6 visual / 0.4 audio, threshold 0.5), not a probability and not scientifically optimal.
- **Audio is analyzed only when an audio stream genuinely exists.** A silent video or image yields no audio score and therefore no fused score — only an explicit `partial`/`unavailable` multimodal state, never a default number.
- **Detection performance depends on the input and face quality.** Results vary with face size, pose, occlusion, lighting, blur and compression; small, blurred or turned-away faces are harder to judge. If no face is found, the API returns `no_face_detected` and **no verdict** rather than guessing.
- **It is not a guarantee of authenticity.** A `real` classification does not prove a file is authentic, and a `deepfake` classification does not prove manipulation. Deepfake detection is probabilistic by nature — treat results as estimates, never as forensic evidence.

## Advanced Features (Industrial Forensic Capabilities)

### Phase 1: Forensic Explainability & Saliency Maps
- **Grad-CAM Saliency Visualizations**: Extracts heatmaps directly over the final convolutional layer of EfficientNet-B7 with zero external dependencies. Exposes `original_crop_b64`, `heatmap_crop_b64`, and 50% `overlay_b64`.
- **Explainability API**: `POST /api/explain/visual` supports on-demand analysis by `stored_name` or direct image upload.
- **Forensic Narrative Generator**: `POST /api/narrative` generates natural-language evidence summaries with strict numeric verification against model outputs.
- **Command Palette (`⌘K`)**: Instant keyboard navigation across cases, analyses, and forensic views.

### Phase 2: Real-Time Media Stream Forensics & Web Companion
- **Real-Time WebSocket Forensics (`WS /ws/analyze/stream`)**:
  - Live video frame streaming via binary JPEG buffers or base64 JSON packets.
  - Architectural guardrails: hard cap on concurrent streams (`CLARITY_MAX_STREAMS`, default 2), max duration (`CLARITY_STREAM_MAX_DURATION_S`, default 120s), frame cap (`CLARITY_STREAM_MAX_FRAMES`, default 200), and frame subsampling (`CLARITY_STREAM_SAMPLE_INTERVAL`, default 5).
  - Emits real-time forensic telemetry (`running_mean`, `face_count`, `latency_ms`, face bounding boxes).
- **Live Stream Forensic HUD (`/live`)**:
  - Direct webcam integration via `getUserMedia`.
  - Real-time manipulation probability gauge, facial bounding box canvas overlay, and telemetry sparklines.
  - Prominent **"EXPERIMENTAL — CPU-THROTTLED"** banner ensuring full operational transparency.
- **Forensics Web Companion (Browser Extension Scaffold)**:
  - Located under `extension/`, compliant with Chrome Manifest V3.
  - Scoped permissions (`activeTab`, `storage`, `contextMenus`) with zero background tracking.
  - Context menu and popup trigger in-page media inspections, bridging web content with the Clarity Mesh workstation.
  - Documented client-side inference roadmap for future ONNX Runtime Web integration.

## Datasets and Model Files

Datasets and model weights are **not** stored in git. Place datasets under `datasets/`; the visual model's `model.pt` lives under `backend/weights/` (downloaded on first use). Both locations are ignored by `.gitignore`.

## Disclaimer

Deepfake detection is probabilistic. Results from this project are **estimates, not proof of authenticity or manipulation**. The uncalibrated score must never be presented as a guaranteed probability or used as the sole basis for accusing or clearing any piece of media.
