# Clarity Mesh — Backend

FastAPI backend for the Clarity Mesh deepfake-detection platform.

## Quick Start

```bash
# 1. Create a virtual environment
python -m venv venv

# 2. Activate it
# Windows:
venv\Scripts\activate
# macOS / Linux:
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt
# On Windows, install the PyTorch CPU wheel first (smaller download):
#   pip install torch==2.7.0 --index-url https://download.pytorch.org/whl/cpu
# On the first analysis the ~270 MB model.pt is downloaded into
# backend/weights/ and verified against its published SHA-256 (git-ignored).

# 4. Run the development server
uvicorn main:app --reload --port 8000
```

To enable the OpenAI research assistant, set `OPENAI_API_KEY` in the backend environment. `OPENAI_MODEL` can override the default. The key stays server-side; the agent tools return sanitized analysis metadata and do not read uploaded media.

## Endpoints

| Method | Path           | Description                          |
|--------|----------------|--------------------------------------|
| GET    | `/api/health`  | Health-check / liveness probe        |
| POST   | `/api/analyze` | Upload an image, video or audio file; validates, decodes, samples frames, detects faces, runs the pretrained visual deepfake model (EfficientNet-B7), audio deepfake model (wav2vec2), and AI image detector (CLIP ViT-L/14), then fuses genuine scores into `multimodal_analysis`. Each block carries a real model score **only** when its own inference genuinely succeeded. |
| GET    | `/api/history` | List recent stored analyses from local SQLite store (newest first, limit configurable). |
| DELETE | `/api/history` | Purge all stored analysis records from the local SQLite store. |
| GET    | `/api/insights?days=30` | Aggregate a selected 1–90 day window from the latest 500 records. |
| GET/POST/PATCH/DELETE | `/api/cases` | Create and manage investigation cases; link analyses at `/api/cases/{id}/analyses/{analysis_id}`. |
| GET    | `/api/assistant/status` | Report local/OpenAI analyst mode without exposing credentials. |
| POST   | `/api/assistant/chat` | Run a bounded read-only AI agent over sanitized analysis records. |

## Project Structure

backend/
├── main.py            # FastAPI app, CORS, health-check
├── evaluate.py        # Offline benchmark evaluation CLI
├── routes/
│   ├── __init__.py
│   ├── analysis.py    # /api/analyze upload endpoint
│   ├── history.py     # /api/history and /api/insights
│   ├── cases.py       # investigation-case workflow
│   └── assistant.py   # read-only research agent
├── services/
│   ├── __init__.py
│   ├── media_processor.py  # Decode, metadata, bounded frame sampling
│   ├── face_processor.py   # OpenCV face detection, boxes & crops
│   ├── visual_detector.py  # Pretrained EfficientNet-B7 deepfake model inference
│   ├── audio_detector.py   # Pretrained wav2vec2 audio deepfake model inference
│   ├── ai_image_detector.py# Pretrained CLIP ViT-L/14 synthetic image detector
│   ├── multimodal_fusion.py# Multimodal score fusion and classification
│   ├── history_store.py    # SQLite audit trail persistence
│   ├── case_store.py       # case and evidence links
│   └── analytics.py        # dashboard and reporting aggregates
├── data/              # SQLite database (history.db, git-ignored)
├── weights/           # Pretrained weights (downloaded + SHA-256 verified, git-ignored)
├── uploads/           # Uploaded media files
├── tests/             # pytest suite (111 unit & integration tests)
├── requirements.txt   # pinned deps (FastAPI, torch CPU, librosa, soundfile, …)
└── README.md          # this file
```

## Notes

### Visual deepfake model (STEP 6 — implemented)

`POST /api/analyze` now runs **one genuine pretrained model** on the
detected face crops and returns a `visual_analysis` block:

| Field | Meaning |
|-------|---------|
| `status` | `completed` / `no_face_detected` / `model_unavailable` / `inference_failed` |
| `score` | sigmoid model output in (0,1) — **present only** when `status == "completed"` |
| `classification` | `"deepfake"` if `score >= 0.7`, else `"real"` |
| `threshold`, `score_type`, `aggregation` | documented decision context (0.7; uncalibrated sigmoid; mean over faces/frames) |
| `faces_detected` / `faces_analyzed` / `frames_analyzed` | how many faces the model actually ran on |

**Model card**

- **Architecture:** EfficientNet-B7 binary classifier (one logit → sigmoid).
- **Weights:** Selim Seferbekov's 1st-place DFDC (Deepfake Detection
  Challenge) solution checkpoint, republished for facetorch with a
  tensor-verified mapping (all 1,202 tensors match the original).
- **Source:** `https://huggingface.co/tomas-gajarsky/facetorch-deepfake-efficientnet-b7`
  (revision `4acc494f…`, artifact `model.pt`, 268 MB,
  SHA-256 `e36197ae83fa7c050e8ceba267a1f028f2d74d8ad805bf5d5037a26e8ca96c13`
  — verified on every download; mismatched weights are refused).
- **Original reference:** `https://github.com/selimsef/dfdc_deepfake_challenge` (MIT).
- **Preprocessing:** BGR→RGB, /255, bilinear antialiased resize to 380×380,
  ImageNet normalization (mean `[0.485,0.456,0.406]`, std `[0.229,0.224,0.225]`).
- **Direction:** higher score = more likely fake (the original DFDC solution
  treats `pred > 0.8` as fake).
- **Threshold:** 0.7 — facetorch's default for this model (`PostSigmoidBinary`).

**Honest-failure contract** — a score is *never* invented:

- no face detected → `no_face_detected`, no `score`/`classification` keys
  (zero faces is informational only, never a "real" verdict);
- weights/torch unavailable → `model_unavailable`, no score;
- every crop's forward pass raised → `inference_failed`, no score;
- a single failed crop does not break the rest (`faces_failed` reports it);
- the API never crashes because of a model/per-crop failure.

**Honest limitations:** the score is an *uncalibrated model output*, not a
probability; the model was trained on DFDC (2019-era) face-swap fakes, so
newer diffusion-era fakes and domain shift reduce accuracy; Haar detection
is frontal-biased; CPU inference is ≈1.35 s/crop (bounded by
`CLARITY_VISUAL_MAX_FACES`); results are a signal, not forensic evidence.

### Processing limits (environment variables)

`CLARITY_MAX_VIDEO_SAMPLE_FRAMES` (default 16),
`CLARITY_MAX_VIDEO_DURATION_SECONDS` (default 3600),
`CLARITY_MAX_IMAGE_MEGAPIXELS` (default 40),
`CLARITY_MAX_FRAMES_SCANNED` (default 600),
`CLARITY_VISUAL_MAX_FACES` (default 12 — max face crops scored per upload),
`CLARITY_WEIGHTS_DIR` (override where `model.pt` lives).

### Audio licence note + remaining scope

The audio detector uses the NII Yamagishi Lab wav2vec-small-anti-deepfake weights, licensed **CC BY-NC-SA 4.0 (research and educational use only)**. This submission stays within that scope; commercial use or redistribution of the weights is not permitted.


### Audit persistence & Benchmark evaluation

- **Database Persistence:** Every completed analysis is logged to local SQLite (`backend/data/history.db`) via `services/history_store.py` with zero new external dependencies, queryable and purgable via `/api/history`.
- **Benchmark Evaluation:** `evaluate.py` provides an offline evaluation CLI computing precision, recall, F1, accuracy, and confusion matrix over labeled test datasets.
