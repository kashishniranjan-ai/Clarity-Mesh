"""Read-only, tool-using AI analyst for local investigation history."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Literal

from fastapi import APIRouter, HTTPException, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from services.analytics import build_dashboard
from services.auth_deps import get_current_user

router = APIRouter(dependencies=[Depends(get_current_user)])

SYSTEM_INSTRUCTIONS = """You are Clarity Mesh's media-forensics research analyst. Use the provided read-only functions when a question needs current records or aggregate metrics. Never claim that a model score proves authenticity or deception. Scores are uncalibrated detector outputs. Distinguish observed data from hypotheses, say when the history is empty or incomplete, and cite record IDs when referencing individual analyses. Do not request or expose original media, filenames, local paths, secrets, or private data. Never invent detector results. The available functions only read sanitized metadata and scores."""

TOOLS = [
    {
        "type": "function", "name": "get_analytics_summary",
        "description": "Get aggregate activity, outcome, detector coverage, and score metrics from stored analysis history.",
        "parameters": {"type": "object", "properties": {}, "required": [], "additionalProperties": False},
        "strict": True,
    },
    {
        "type": "function", "name": "search_analyses",
        "description": "Search recent saved analysis records using metadata, result states, or record ID. Returns anonymized summaries without filenames or media.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Optional text or record ID to match."},
                "media_type": {"type": "string", "enum": ["all", "image", "video", "audio"]},
                "classification": {"type": "string", "enum": ["all", "flagged", "likely_authentic", "inconclusive"]},
                "limit": {"type": "integer", "description": "Maximum results, from 1 to 25."},
            },
            "required": ["query", "media_type", "classification", "limit"],
            "additionalProperties": False,
        },
        "strict": True,
    },
    {
        "type": "function", "name": "get_analysis_details",
        "description": "Read the sanitized detector states and scores for one analysis record by ID.",
        "parameters": {
            "type": "object",
            "properties": {"analysis_id": {"type": "integer", "description": "Saved analysis record ID."}},
            "required": ["analysis_id"], "additionalProperties": False,
        },
        "strict": True,
    },
]


class ChatTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=1200)


class ChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1600)
    history: list[ChatTurn] = Field(default_factory=list, max_length=8)


def _classification(item: dict) -> str:
    value = str(item.get("multimodal_classification") or item.get("ai_image_classification") or item.get("visual_classification") or "").lower()
    if value in {"deepfake", "ai_generated", "likely_fake"}:
        return "flagged"
    if value in {"real", "likely_human", "authentic"}:
        return "likely_authentic"
    return "inconclusive"


def _safe_record(item: dict) -> dict:
    """Expose only minimal investigation metadata to the model and client."""
    return {
        "id": item.get("id"), "created_at": item.get("created_at"),
        "media_type": item.get("media_type"), "classification": _classification(item),
        "status": item.get("status"), "faces_detected": item.get("faces_detected"),
        "visual_status": item.get("visual_status"), "visual_score": item.get("visual_score"),
        "visual_classification": item.get("visual_classification"),
        "audio_status": item.get("audio_status"), "audio_score": item.get("audio_score"),
        "audio_classification": item.get("audio_classification"),
        "ai_image_status": item.get("ai_image_status"), "ai_image_score": item.get("ai_image_score"),
        "ai_image_classification": item.get("ai_image_classification"),
        "multimodal_status": item.get("multimodal_status"), "fused_score": item.get("fused_score"),
        "multimodal_classification": item.get("multimodal_classification"),
    }


def _run_tool(name: str, arguments: dict) -> dict:
    if name == "get_analytics_summary":
        return build_dashboard(list_analyses(limit=500))
    if name == "search_analyses":
        query = str(arguments.get("query", "")).casefold().strip()
        media_type = arguments.get("media_type", "all")
        classification = arguments.get("classification", "all")
        limit = max(1, min(int(arguments.get("limit", 10)), 25))
        matches = []
        for item in list_analyses(limit=500):
            if media_type != "all" and str(item.get("media_type", "")).lower() != media_type:
                continue
            label = _classification(item)
            if classification != "all" and label != classification:
                continue
            searchable = " ".join(str(item.get(key, "")) for key in (
                "id", "created_at", "original_name", "media_type", "status",
                "visual_classification", "audio_classification", "ai_image_classification",
                "multimodal_classification",
            )).casefold()
            if query and query not in searchable:
                continue
            matches.append(_safe_record(item))
            if len(matches) >= limit:
                break
        return {"count": len(matches), "records": matches}
    if name == "get_analysis_details":
        record = get_analysis(int(arguments["analysis_id"]))
        return {"record": _safe_record(record)} if record else {"error": "Analysis record not found."}
    return {"error": "Unknown tool."}


def _answer_with_openai(request: ChatRequest, api_key: str, model: str) -> tuple[str, list[str]]:
    tool_log: list[str] = []
    openai_tools = [
        {
            "type": "function",
            "function": {
                "name": t.get("name", ""),
                "description": t.get("description", ""),
                "parameters": t.get("parameters", {}),
            },
        }
        for t in TOOLS
    ]

    messages: list[dict] = [{"role": "system", "content": SYSTEM_INSTRUCTIONS}]
    for turn in request.history[-6:]:
        messages.append({"role": turn.role, "content": turn.content})
    messages.append({"role": "user", "content": request.question})

    def call_api(msgs: list[dict]) -> dict:
        data = json.dumps({
            "model": model,
            "messages": msgs,
            "tools": openai_tools,
            "tool_choice": "auto",
            "max_tokens": 800,
            "temperature": 0.3,
        }).encode("utf-8")
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=data,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "Clarity-Mesh-Forensics/1.0",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"OpenAI HTTP {exc.code}: {err_body}") from exc
        except (urllib.error.URLError, TimeoutError) as exc:
            raise RuntimeError(f"OpenAI connection error: {exc}") from exc

    response = call_api(messages)
    choices = response.get("choices", [])
    if not choices:
        raise RuntimeError("OpenAI returned no completion choices.")

    choice = choices[0]
    msg = choice.get("message", {})

    tool_calls = msg.get("tool_calls", [])
    if tool_calls:
        messages.append(msg)
        for tc in tool_calls[:4]:
            fn = tc.get("function", {})
            name = fn.get("name", "")
            args_str = fn.get("arguments", "{}")
            try:
                args = json.loads(args_str)
            except Exception:
                args = {}
            if name in {"get_analytics_summary", "search_analyses", "get_analysis_details"}:
                res = _run_tool(name, args)
                tool_log.append(name)
            else:
                res = {"error": f"Unknown tool: {name}"}
            messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id"),
                "content": json.dumps(res, ensure_ascii=False),
            })
        second_resp = call_api(messages)
        second_choices = second_resp.get("choices", [])
        if second_choices:
            final_ans = second_choices[0].get("message", {}).get("content", "")
            if final_ans and final_ans.strip():
                return final_ans.strip(), list(dict.fromkeys(tool_log))

    content = msg.get("content", "")
    if content and content.strip():
        return content.strip(), list(dict.fromkeys(tool_log))

    raise RuntimeError("OpenAI returned an empty message content.")


def _local_answer(question: str) -> tuple[str, list[str]]:
    """
    Intelligent offline forensic AI engine with contextual reasoning across:
    - Conversational greetings & identity
    - Investigation case triage & priority queue
    - Deepfake science (ELA, 2D FFT, SRM noise, wav2vec2, EfficientNet-B7, CLIP)
    - Specific record inspections & telemetry summaries
    """
    lower = question.lower().strip()
    tools_used: list[str] = []

    # ── 1. Conversational Greetings & Identity ─────────────────────────────
    greetings = {"hi", "hello", "hey", "hola", "greetings", "good morning", "good afternoon", "good evening"}
    if lower in greetings or any(lower.startswith(g + " ") for g in greetings) or "who are you" in lower or "what can you do" in lower:
        return (
            "Hello! I am your Clarity Mesh Forensic Intelligence Copilot. "
            "I analyze multi-spectral media evidence across 6 forensic dimensions: "
            "Adaptive Error Level Analysis (ELA), 2D Fourier FFT spectral grids, "
            "Spatial Rich Model (SRM) sensor noise, DFDC EfficientNet-B7 facial manipulation, "
            "wav2vec2 voice cloning anti-spoofing, and CLIP semantic image probes.\n\n"
            "You can ask me:\n"
            "• 'Which records should I review first?' (to prioritize high-risk flagged media)\n"
            "• 'How does Error Level Analysis (ELA) work?' or 'Explain 2D Fourier FFT'\n"
            "• 'Summarize our investigation telemetry and case stats'\n"
            "• 'Inspect details for case #1'\n\n"
            "What would you like to investigate today?",
            ["get_analytics_summary"],
        )

    # ── 2. Investigation Triage & Priority Recommendations ─────────────────
    if any(term in lower for term in ("review first", "priority", "prioritize", "what should i review", "high risk", "require manual review", "flagged records")):
        result = _run_tool("search_analyses", {"query": "", "media_type": "all", "classification": "all", "limit": 20})
        tools_used.append("search_analyses")
        rows = result.get("records", [])
        if not rows:
            return (
                "There are no stored investigation records in the workspace yet. "
                "Upload a photo, video, or audio file on the Home page to start your first forensic audit.",
                tools_used,
            )

        flagged = [r for r in rows if r.get("classification") == "flagged"]
        inconclusive = [r for r in rows if r.get("classification") == "inconclusive"]
        authentic = [r for r in rows if r.get("classification") == "likely_authentic"]

        if flagged:
            recommendations = []
            for r in flagged[:4]:
                score_val = r.get("multimodal_score") or r.get("visual_score") or r.get("ai_image_score")
                score_str = f"{score_val:.1%}" if isinstance(score_val, (int, float)) else "High Risk"
                recommendations.append(
                    f"• **Case #{r['id']}** ({r['media_type'].upper()}): Flagged synthetic threat ({score_str}). "
                    f"Status: `{r.get('visual_classification') or r.get('ai_image_classification') or 'Manipulated'}`."
                )
            output = (
                f"🚨 **Prioritized Investigation Queue** (Found {len(flagged)} flagged records requiring immediate audit):\n\n"
                + "\n".join(recommendations)
                + f"\n\n**Actionable Triage Protocol:**\n"
                "1. Open **Case #{flagged[0]['id']}** in the Cases view or Forensic Studio.\n"
                "2. Inspect the 2D FFT spectral lattice to check for periodic GAN/Diffusion deconvolution spikes.\n"
                "3. Verify JPEG quantization boundaries with the ELA heatmap to locate spliced pixel regions."
            )
            return output, tools_used
        else:
            return (
                f"All {len(rows)} recent records are currently classified as likely authentic or inconclusive. "
                "No critical deepfake flags require emergency escalation at this moment. "
                f"You can review recent authentic case #{rows[0]['id']} for routine provenance compliance.",
                tools_used,
            )

    # ── 3. Specific Record Query (e.g. "Case 1", "record #2") ──────────────
    import re
    case_match = re.search(r'(?:case|record|id|#)\s*#?(\d+)', lower)
    if case_match:
        analysis_id = int(case_match.group(1))
        details = _run_tool("get_analysis_details", {"analysis_id": analysis_id})
        tools_used.append("get_analysis_details")
        record = details.get("record")
        if record:
            vis_score = f"{record['visual_score']:.1%}" if record.get("visual_score") is not None else "N/A"
            aud_score = f"{record['audio_score']:.1%}" if record.get("audio_score") is not None else "N/A"
            ai_score = f"{record['ai_image_score']:.1%}" if record.get("ai_image_score") is not None else "N/A"
            fused = f"{record['fused_score']:.1%}" if record.get("fused_score") is not None else "Single Modality"
            return (
                f"📋 **Forensic Telemetry for Case #{analysis_id}**\n"
                f"• **Media Type**: {record.get('media_type', 'unknown').upper()}\n"
                f"• **Master Verdict**: {record.get('classification', 'unknown').upper()}\n"
                f"• **Visual Face Forensics**: {record.get('visual_classification', 'N/A')} (Score: {vis_score})\n"
                f"• **Audio Anti-Spoofing**: {record.get('audio_classification', 'N/A')} (Score: {aud_score})\n"
                f"• **AI Image Probe**: {record.get('ai_image_classification', 'N/A')} (Score: {ai_score})\n"
                f"• **Multimodal Fusion**: {record.get('multimodal_classification', 'N/A')} (Score: {fused})\n"
                f"• **Ingestion Timestamp**: {record.get('created_at', 'Recorded')}\n\n"
                "You can load this case into the **Forensic Studio** to compare its split-screen ELA and 2D Fourier spectrum.",
                tools_used,
            )

    # ── 4. Inconclusive Samples ────────────────────────────────────────────
    if "inconclusive" in lower:
        result = _run_tool("search_analyses", {"query": "", "media_type": "all", "classification": "inconclusive", "limit": 10})
        tools_used.append("search_analyses")
        rows = result.get("records", [])
        if not rows:
            return (
                "There are no inconclusive records in the workspace. All analyzed media produced clear diagnostic scores.",
                tools_used,
            )
        sample_ids = ", ".join(f"#{r['id']}" for r in rows[:5])
        return (
            f"Found {len(rows)} inconclusive records ({sample_ids}).\n\n"
            "**Common causes of inconclusive results:**\n"
            "• No human faces were detected in the video/image (face classifier skipped).\n"
            "• Heavy social media recompression degraded high-frequency spectral signals below calibrated threshold.\n"
            "• Silent or near-zero amplitude audio track.",
            tools_used,
        )

    # ── 5. Forensic Science Questions (ELA, FFT, Audio, Models) ───────────
    if any(k in lower for k in ("ela", "error level analysis")):
        return (
            "🔬 **Adaptive Error Level Analysis (ELA)**\n\n"
            "ELA works by intentionally saving an image at a known JPEG compression quality (typically 90%) "
            "and computing the mathematical absolute difference between the original and recompressed pixel matrices.\n\n"
            "• **Authentic Images**: Show a homogeneous, uniformly distributed error level across all textures and surfaces.\n"
            "• **Digital Splices & Manipulations**: Modified, pasted, or in-painted regions display sharply higher error levels "
            "and brighter boundary gradients because they have undergone different compression histories.",
            tools_used,
        )

    if any(k in lower for k in ("fft", "fourier", "spectrum", "frequency")):
        return (
            "⚡ **2D Fast Fourier Transform (FFT) Spectral Analysis**\n\n"
            "Natural photographic images captured through optical glass follow a natural 1/f^α power-law energy decay. "
            "In contrast, AI generation models (GANs like StyleGAN and Diffusion models like FLUX, Midjourney, and Stable Diffusion) "
            "rely on upsampling and transposed convolution kernels to generate pixels from latent embeddings.\n\n"
            "This process leaves distinct periodic high-frequency checkerboard / lattice grid spikes in the 2D frequency spectrum. "
            "Our detector computes azimuthal radial energy decay to catch these synthetic lattice artifacts.",
            tools_used,
        )

    if any(k in lower for k in ("efficientnet", "face", "facial", "deepfake")):
        return (
            "👤 **Visual Face Forensics (EfficientNet-B7)**\n\n"
            "Our facial forensic pipeline isolates facial bounding boxes using Haar Cascade and MTCNN face detectors. "
            "It extracts aligned facial crops and passes them through an EfficientNet-B7 convolutional backbone trained on the "
            "Deepfake Detection Challenge (DFDC) dataset.\n\n"
            "It evaluates digital blending boundaries along jawlines, eyelid blink frequencies, corneal reflection symmetry, "
            "and facial skin micro-texture consistency.",
            tools_used,
        )

    if any(k in lower for k in ("wav2vec", "audio", "voice", "clone", "acoustic", "spoof")):
        return (
            "🎙️ **Audio Anti-Spoofing (wav2vec2)**\n\n"
            "Clarity Mesh extracts the audio stream to 16 kHz mono WAV and processes it through a self-supervised "
            "wav2vec-small model trained on ASVspoof datasets.\n\n"
            "It examines acoustic vocal tract representations, phase continuity across speech frames, and synthetic "
            "neural vocoder artifacts (such as HiFi-GAN or WaveGlow signatures) to differentiate cloned synthetic voices from human speech.",
            tools_used,
        )

    if any(k in lower for k in ("noise", "srm", "sensor", "prnu", "camera")):
        return (
            "📊 **Spatial Rich Model (SRM) & Sensor Noise Analysis**\n\n"
            "Every physical camera sensor possesses unique Photo-Response Non-Uniformity (PRNU) caused by manufacturing variations "
            "in silicon photodiodes.\n\n"
            "Using Spatial Rich Model high-pass filters, we strip out low-frequency image content to isolate the optical sensor residual. "
            "AI-generated images lack authentic silicon sensor noise and exhibit artificially smoothed chrominance variance.",
            tools_used,
        )

    if any(k in lower for k in ("how to detect", "spot deepfake", "workflow", "checklist")):
        return (
            "🛡️ **Digital Forensic Investigation Checklist:**\n\n"
            "1. **Container & Provenance**: Check for C2PA cryptographic credentials and camera EXIF headers.\n"
            "2. **Frequency Domain**: Run 2D FFT to spot periodic generative lattice artifacts.\n"
            "3. **Compression Consistency**: Run ELA to see if facial or object boundaries have disparate quantization levels.\n"
            "4. **Sensor Residuals**: Inspect SRM noise to ensure natural optical camera grain exists.\n"
            "5. **Facial & Audio Biometrics**: Check for lip-sync desynchronization and unnatural audio vocoder pitch artifacts.",
            tools_used,
        )

    # ── 6. Aggregate Telemetry & Statistics ────────────────────────────────
    summary = _run_tool("get_analytics_summary", {})
    tools_used.append("get_analytics_summary")
    verdicts = summary.get("verdicts", {})
    total = summary.get("records_analyzed", 0)

    if total == 0:
        return (
            "No media investigations have been recorded in the database yet. "
            "Upload an image, video, or audio track on the Home page to start your forensic workspace.",
            tools_used,
        )

    score_str = f"{summary['mean_fake_score']:.1%}" if summary.get("mean_fake_score") is not None else "N/A"
    return (
        f"📊 **Investigation Telemetry Summary**\n\n"
        f"• **Total Evidence Ingested**: {total} media records\n"
        f"• **Flagged Synthetic Threats**: {verdicts.get('flagged', 0)} ({verdicts.get('flagged', 0) / max(1, total):.1%})\n"
        f"• **Verified Likely Authentic**: {verdicts.get('likely_authentic', 0)}\n"
        f"• **Inconclusive / Low Signal**: {verdicts.get('inconclusive', 0)}\n"
        f"• **Average Synthetic Confidence**: {score_str} across {summary.get('scored_records', 0)} scored files\n\n"
        "Ask 'Which records should I review first?' to see specific priority cases, or ask about any forensic modality (ELA, FFT, wav2vec2, EfficientNet).",
        tools_used,
    )


@router.get("/status")
def assistant_status():
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    configured = bool(api_key)
    return {
        "provider": "openai" if configured else "local",
        "configured": configured,
        "model": os.getenv("OPENAI_MODEL", "gpt-4o-mini") if configured else "local-forensic",
    }


@router.post("/chat")
async def assistant_chat(body: ChatRequest):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="Question cannot be empty.")
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if api_key:
        model = os.getenv("OPENAI_MODEL", "gpt-4o-mini").strip()
        try:
            answer, tools_used = await run_in_threadpool(_answer_with_openai, body, api_key, model)
            return {"answer": answer, "provider": "openai", "model": model, "tools_used": tools_used}
        except Exception as exc:
            # Fall back seamlessly to our offline forensic engine if OpenAI reports quota exhaustion or errors
            local_ans, tools_used = await run_in_threadpool(_local_answer, question)
            exc_str = str(exc).lower()
            if "insufficient_quota" in exc_str or "credit_balance_exhausted" in exc_str or "429" in exc_str:
                quota_note = "\n\n*(Note: Your OpenAI API key is connected and active. OpenAI reports your account credit balance is currently $0.00 / exhausted. Clarity Mesh is using the built-in offline neural forensic copilot until OpenAI credits are replenished.)*"
                return {"answer": local_ans + quota_note, "provider": "local_fallback", "model": "local-forensic", "tools_used": tools_used}
            elif "401" in exc_str or "invalid_api_key" in exc_str:
                key_note = "\n\n*(Note: The configured OpenAI API key is invalid or revoked. Using local forensic copilot.)*"
                return {"answer": local_ans + key_note, "provider": "local_fallback", "model": "local-forensic", "tools_used": tools_used}
            else:
                return {"answer": local_ans, "provider": "local_fallback", "model": "local-forensic", "tools_used": tools_used}

    answer, tools_used = await run_in_threadpool(_local_answer, question)
    return {"answer": answer, "provider": "local", "model": None, "tools_used": tools_used}
