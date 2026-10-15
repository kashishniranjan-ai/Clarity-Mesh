# Clarity Mesh

**AI-Powered Multimodal Deepfake Detection System**

Clarity Mesh analyzes images and videos and estimates whether the media is likely **real** or **AI-generated / deepfake**. It is a final-year college project built in incremental steps.

> **Current status: STEPS 1–12 completed — visual + audio + fusion pipeline, UniversalFakeDetect AI-image detection, SQLite history API, offline evaluation harness and the cyber-forensics UI are all live.**
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
| STEP 9 | Independent **UniversalFakeDetect** still-image detector — frozen CLIP ViT-L/14 encoder + published 768→1 linear probe → `ai_image_analysis` (images only, never fused) |
| STEP 10 | SQLite-backed audit trail and history API (`/api/history` GET & DELETE) with zero new dependencies |
| STEP 11 | Offline benchmark evaluation harness (`evaluate.py`) with precision, recall, F1, and confusion matrix |
| STEP 12 | 10/10 Enterprise Cyber-Forensics UI Redesign: particle mesh hero, circular SVG gauges, pipeline stepper, forensic report generator, JSON inspector, and advanced telemetry dashboard |

## Technology Stack

| Layer | Technology | Status |
| ----- | ---------- | ------ |
| Frontend | React 19 + Vite + Tailwind CSS v4 (Cyber-forensics design) | **Implemented** |
| Backend API | Python + FastAPI (Uvicorn) | **Implemented** |
| Media processing | OpenCV — decode, frame sampling, face detection | **Implemented** |
| AI / ML Models | EfficientNet-B7 (visual) + wav2vec2 (audio) + CLIP ViT-L/14 (AI images) + weighted fusion | **Implemented** |
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

## STEP 9 — AI-Generated Still-Image Detector (UniversalFakeDetect)

`POST /api/analyze` returns an independent **`ai_image_analysis`** block produced by `backend/services/ai_image_detector.py`:

- **Model:** [UniversalFakeDetect](https://github.com/WisconsinAIVision/UniversalFakeDetect) (Wang et al., ICLR 2024) — a frozen OpenAI **CLIP ViT-L/14** image encoder (768-d projected embedding) plus the published linear probe `nn.Linear(768, 1)`. MIT-licensed code and probe weights.
- **Scope:** **still images only.** It scores the FULL image without face detection and is completely independent of the EfficientNet-B7/audio blocks — its score is never fused with them. Videos and standalone audio report `not_applicable` with no score.
- **Preprocessing:** mirrors the UFD reference transform exactly — resize shorter edge to 256 (bilinear), centre crop 224, CLIP mean/std normalisation — implemented with cv2/numpy/torch only (Pillow and torchvision are deliberately not required).
- **Weights:** the CLIP backbone is cached from Hugging Face (`openai/clip-vit-large-patch14`); the 4 KB probe head `fc_weights.pth` auto-downloads on first use from the UFD repository and is SHA-256 verified on every load (`47710074…4c7847`).
- **Score:** an **uncalibrated sigmoid** in `(0, 1)` — **higher = more likely AI-generated**. Classification uses a fixed threshold of **0.5** (the neutral sigmoid operating point; UFD's own validation-selected threshold has not been reproduced here, see *Current Limitations*).

## STEP 10 — Analysis History (SQLite Audit Trail)

Every `POST /api/analyze` is appended to a local SQLite database at **`backend/data/history.db`** via `backend/services/history_store.py` — Python's built-in `sqlite3`, **zero new dependencies**.

- **Auto-save:** the analysis route stores the record just before returning. A storage failure never breaks an analysis — the API response always wins; history is best-effort.
- **Endpoints:** `GET /api/history?limit=50` lists records newest-first (allowed range 1–500); `DELETE /api/history` purges everything and reports how many rows were removed. Both return an honest `503` JSON error if the database is unreadable — never an empty list or a traceback.
- **Columns:** original/stored file names (basename only, never absolute paths), media type, face count, timestamp, and per-block `status` / `score` / `classification` for visual, audio, AI-image and fusion. **The score column stays NULL whenever its block did not complete** — history never invents numbers either.
- **Frontend:** the **History** page (`frontend/src/pages/History.jsx`) renders the records as cards with one cell per detector (score shown only when genuinely present, honest status otherwise), plus Refresh / Clear actions and loading, empty and error states.
- **Override:** set `CLARITY_HISTORY_DB=/path/to.db` to relocate the database (the test suite uses this to point at a temp file).

## STEP 11 — Offline Evaluation Harness

`backend/evaluate.py` runs the **exact same detector pipeline as the API** over a labelled folder of media and writes per-file rows plus aggregate metrics:

```bash
cd backend
python evaluate.py --manifest manifest.csv --data-dir /path/to/media --output-dir results [--limit N]
```

- **Manifest:** a CSV with `filename` (relative to `--data-dir`, subfolders allowed) and `label` — verified ground truth `real`/`fake` (case-insensitive). `unknown` or empty means the truth is unavailable: the file still counts as evaluated but is excluded from correctness metrics rather than assumed.
- **Detectors evaluated per file:** visual (face crops), AI-image (UFD, still images), audio (only videos with an audio stream) and fusion (only where both modalities completed) — every failure mode (`no_face`, `no_audio`, `not_applicable`, model errors) is reported as its own honest status, never converted to a score.
- **Metrics per detector:** confusion matrix (real/fake), accuracy, precision, recall and F1 — each `None` (never a fake `0`) when the denominator is zero — plus evaluated / failed / unscored / not-applicable counts that reconcile exactly with the total.
- **Outputs:** timestamped `results_*.csv` (one row per detector per file) and `summary_*.json` in the output directory.
- **Tests:** `backend/tests/test_evaluate.py` covers manifest parsing, label normalisation and the metric math **without running any model inference**.

## Project Structure

```
Clarity-Mesh/
├── frontend/                 # React + Vite + Tailwind UI (STEPS 2–4)
│   └── src/                  # components, pages, API client
├── backend/                  # FastAPI server (STEPS 3–6)
│   ├── routes/               # HTTP endpoints (analyze, history)
│   ├── services/             # media_processor, face_processor, visual_detector, audio_detector, ai_image_detector, multimodal_fusion, history_store
│   ├── tests/                # pytest suite (unit + API tests, 111 tests)
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
| `DELETE` | `/api/history` | Purge all stored analysis records from the local SQLite store. |

**Accepted uploads:** images — JPEG, PNG, WebP, GIF, BMP; videos — MP4, MPEG, QuickTime/MOV, AVI, WebM, MKV; standalone audio — MP3, WAV, FLAC, M4A.

Interactive auto-generated docs: **`http://127.0.0.1:8000/docs`** (FastAPI/Swagger UI). All analyses are persistently audited to local SQLite (`backend/data/history.db`).

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
- **Tests:** with the backend venv active, run `python -m pytest backend/tests` from the repository root (111 tests covering STEPs 6–11: visual, audio, fusion, UFD AI-image detector, history store/API and evaluation metrics).
- **FFmpeg is required for audio analysis** (STEP 7+): videos need an audio-track probe/extraction step; uploads without an audio stream return `audio_analysis.status == "no_audio"` and no invented score. OpenCV's bundled decoder still handles video frame extraction.

- **Audio model licence (research / non-commercial).** The audio detector uses the NII Yamagishi Lab `wav2vec-small-anti-deepfake` weights, licensed **CC BY-NC-SA 4.0 (research and educational use only)**. This college submission stays within that scope; commercial use or redistribution of the weights is not permitted.

## Current Limitations

- **CPU inference is relatively slow.** The model runs on CPU at roughly **1.35 s per face crop**, so analyzing a video takes seconds to tens of seconds (bounded by the 12-crop cap, `CLARITY_VISUAL_MAX_FACES`). There is no GPU requirement, but there is no GPU acceleration either.
- **The model is a visual/face-based detector only.** It judges what it can see in detected faces. A voice-cloned or dubbed video whose faces are untouched will **not** be flagged by the visual model (the audio model covers the soundtrack where an audio stream exists).
- **The visual score is uncalibrated.** The sigmoid output is a raw model signal, **not a guaranteed probability**, and it has not been calibrated on this project's data. It should be read as a relative indicator, not a percentage chance. The same holds for the STEP 8 **fused score**: it is an *uncalibrated engineering combination* of the two model outputs (default weights 0.6 visual / 0.4 audio, threshold 0.5), not a probability and not scientifically optimal.
- **Audio is analyzed only when an audio stream genuinely exists.** A silent video or image yields no audio score and therefore no fused score — only an explicit `partial`/`unavailable` multimodal state, never a default number.
- **Detection performance depends on the input and face quality.** Results vary with face size, pose, occlusion, lighting, blur and compression; small, blurred or turned-away faces are harder to judge. If no face is found, the API returns `no_face_detected` and **no verdict** rather than guessing.
- **The UFD AI-image threshold (0.5) is uncalibrated.** UFD selects its decision threshold by maximising accuracy on a validation set; no such calibrated threshold has been established for this deployment, so 0.5 is only the neutral sigmoid operating point. A quick sanity check showed an AI-generated portrait scoring *lower* than a real photo — ordering is model- and image-dependent, and **no accuracy is claimed** for this block.
- **The face detector can miss faces outside its comfort zone.** Face localisation uses a Haar cascade tuned for near-frontal faces; profile poses, heavy occlusion, tight crops or low-resolution video may produce `no_face_detected` and therefore no visual verdict at all. This domain mismatch with in-the-wild deepfake footage is reported honestly — never filled in with a guess.
- **No benchmark accuracy claims are made.** The STEP 11 evaluation harness computes precision/recall/F1 and confusion matrices, but it has only been exercised on synthetic sanity fixtures so far. No labelled benchmark dataset has been evaluated, so this project quotes **no accuracy figures**.
- **History is local, unencrypted and single-user.** `backend/data/history.db` is plain SQLite in the working tree (git-ignored); anyone with file access can read or delete it, and `DELETE /api/history` is irreversible.
- **It is not a guarantee of authenticity.** A `real` classification does not prove a file is authentic, and a `deepfake` classification does not prove manipulation. Deepfake detection is probabilistic by nature — treat results as estimates, never as forensic evidence.

## Roadmap

1. **STEPS 1–12 (done):** project foundation → React frontend → FastAPI backend → frontend↔backend wiring → OpenCV preprocessing + face detection → EfficientNet-B7 visual deepfake model → wav2vec audio deepfake detector → transparent weighted visual+audio fusion → UniversalFakeDetect still-image detector → SQLite history + `/api/history` → offline evaluation harness → enterprise cyber-forensics UI redesign.
2. **Possible later work (only when requested):** calibrated thresholds validated on a labelled benchmark, GPU inference, richer per-region explainability.

Out of scope for now: blockchain, browser extensions, mobile apps, and real-time webcam/video-call detection.

## Datasets and Model Files

Datasets and model weights are **not** stored in git. Place datasets under `datasets/`; the visual model's `model.pt` lives under `backend/weights/` (downloaded on first use), the UFD probe head under `backend/weights/ai_image/fc_weights.pth`, and the CLIP ViT-L/14 backbone is cached by Hugging Face. All these locations are ignored by `.gitignore` (the history database under `backend/data/` is ignored too).

## Disclaimer

Deepfake detection is probabilistic. Results from this project are **estimates, not proof of authenticity or manipulation**. The uncalibrated score must never be presented as a guaranteed probability or used as the sole basis for accusing or clearing any piece of media.
