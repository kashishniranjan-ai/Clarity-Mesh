import { useState, useEffect, useRef } from 'react';
import UploadZone from './UploadZone';
import FilePreview from './FilePreview';
import {
  API_BASE_URL,
  MAX_UPLOAD_SIZE_MB,
  analyzeMedia,
  describeApiError,
} from '../services/api';
import { formatFileSize, getMediaKind } from '../utils/file';

/**
 * Upload + analyze area.
 *
 * Sends the selected file to the FastAPI backend (POST /api/analyze),
 * which decodes it and runs the pretrained detectors. The backend returns
 * four analysis blocks — `visual_analysis`, `audio_analysis`,
 * `ai_image_analysis` and `multimodal_analysis` — each rendered honestly as-is, including their
 * honest failure states (no face / no audio / model unavailable /
 * inference failed / partial / unavailable) where no score exists. A score
 * is only ever shown when the backend genuinely produced one, and is
 * always labelled as an uncalibrated model output, not a probability.
 */

/* ═══════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
   ═══════════════════════════════════════════════════════════════ */

/**
 * Formats a numeric score for display, or returns an em dash when the value
 * is missing / not a finite number. A missing score is NEVER shown as 0 or
 * any invented number — the backend only supplies `score` after genuine
 * model inference, so absence is rendered as "—".
 */
function formatScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(4) : '—';
}

function formatPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : '—';
}

/** Human-readable classification for the visual block (score is FAKE-oriented). */
function visualClassificationLabel(classification) {
  if (classification === 'deepfake') return 'Deepfake indicators';
  if (classification === 'real') return 'Likely real';
  return '—';
}

/** Human-readable classification for the audio block (score is REAL-oriented). */
function audioClassificationLabel(classification) {
  if (classification === 'deepfake') return 'Synthetic speech indicators';
  if (classification === 'real') return 'Likely genuine speech';
  return '—';
}

/** Human-readable classification for the fused block (score is FAKE-oriented). */
function fusionClassificationLabel(classification) {
  if (classification === 'deepfake') return 'Deepfake indicators';
  if (classification === 'real') return 'Likely real';
  return '—';
}

/** Human-readable classification for the AI-image block (higher = AI-generated). */
function aiImageClassificationLabel(classification) {
  if (classification === 'ai_generated') return 'AI-generated indicators';
  if (classification === 'likely_human') return 'Likely human-made';
  return '—';
}

/** Concise, honest banner for the audio block's non-completed states. */
function audioStateLabel(block) {
  switch (block?.status) {
    case 'not_applicable':
      return 'Not applicable';
    case 'no_audio':
      return 'No audio track';
    case 'inference_failed':
      return 'Inference failed';
    case 'model_unavailable':
      return 'Model unavailable';
    default:
      return 'Not available';
  }
}

/** Concise, honest banner for the AI-image block's non-completed states. */
function aiImageStateLabel(block) {
  switch (block?.status) {
    case 'not_applicable':
      return 'Not applicable';
    case 'invalid_input':
      return 'Invalid input';
    case 'model_unavailable':
      return 'Model unavailable';
    case 'inference_failed':
      return 'Inference failed';
    default:
      return 'Not available';
  }
}

/* ═══════════════════════════════════════════════════════════════
   SVG RADIAL GAUGE COMPONENT
   ═══════════════════════════════════════════════════════════════ */

function RadialGauge({ score, isFakeOriented = true, size = 120, strokeWidth = 8 }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const numericScore = Number.isFinite(Number(score)) ? Number(score) : null;

  useEffect(() => {
    if (numericScore === null) return;
    const timer = setTimeout(() => setAnimatedScore(numericScore), 100);
    return () => clearTimeout(timer);
  }, [numericScore]);

  if (numericScore === null) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <span className="text-sm text-slate-600">N/A</span>
      </div>
    );
  }

  // Risk level for color (if fake-oriented: higher = more danger; if real-oriented: lower = more danger)
  const dangerLevel = isFakeOriented ? animatedScore : 1 - animatedScore;
  const color = dangerLevel < 0.4 ? '#34d399' : dangerLevel < 0.65 ? '#fbbf24' : '#fb7185';
  const glowColor = dangerLevel < 0.4 ? 'rgba(52,211,153,0.3)' : dangerLevel < 0.65 ? 'rgba(251,191,36,0.3)' : 'rgba(251,113,133,0.3)';
  const dashOffset = circumference - animatedScore * circumference;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        {/* Background ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="rgba(148,163,184,0.08)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        {/* Score ring */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition: 'stroke-dashoffset 1.2s ease-out, stroke 0.5s ease',
            filter: `drop-shadow(0 0 6px ${glowColor})`,
          }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xl font-bold" style={{ color }}>
          {formatPercent(animatedScore)}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PIPELINE STEPPER (shown during analysis)
   ═══════════════════════════════════════════════════════════════ */

const PIPELINE_STEPS = [
  { label: 'Validating media', icon: '🔍', duration: 400 },
  { label: 'Extracting frames', icon: '🖼️', duration: 600 },
  { label: 'Detecting faces', icon: '👤', duration: 800 },
  { label: 'EfficientNet-B7 (Visual)', icon: '🧠', duration: 1200 },
  { label: 'wav2vec2 (Audio)', icon: '🎙️', duration: 1000 },
  { label: 'CLIP ViT-L/14 (AI-Image)', icon: '👁️', duration: 800 },
  { label: 'Multimodal fusion', icon: '⚡', duration: 500 },
];

function PipelineStepper({ isActive }) {
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    if (!isActive) {
      setCurrentStep(0);
      return;
    }

    let step = 0;
    const advance = () => {
      if (step < PIPELINE_STEPS.length - 1) {
        step++;
        setCurrentStep(step);
        setTimeout(advance, PIPELINE_STEPS[step].duration);
      }
    };
    const timer = setTimeout(advance, PIPELINE_STEPS[0].duration);
    return () => clearTimeout(timer);
  }, [isActive]);

  if (!isActive) return null;

  return (
    <div className="glass-card p-5 animate-fade-in">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">Analysis Pipeline</p>
      <div className="space-y-2">
        {PIPELINE_STEPS.map((step, i) => {
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;
          return (
            <div
              key={step.label}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-300 ${
                isCurrent ? 'bg-cyan-500/10 text-cyan-300' : isDone ? 'text-emerald-400' : 'text-slate-600'
              }`}
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full text-xs">
                {isDone ? (
                  <svg className="h-4 w-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                ) : isCurrent ? (
                  <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
                ) : (
                  <span className="h-2 w-2 rounded-full bg-slate-700" />
                )}
              </span>
              <span className="font-medium">{step.label}</span>
              {isCurrent && (
                <span className="ml-auto text-xs text-cyan-500">Processing…</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED UI COMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function StatusBadge({ status, classification }) {
  const configs = {
    deepfake: { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/20', label: 'DEEPFAKE' },
    real: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/20', label: 'LIKELY REAL' },
    ai_generated: { bg: 'bg-rose-500/10', text: 'text-rose-300', border: 'border-rose-500/20', label: 'AI GENERATED' },
    likely_human: { bg: 'bg-emerald-500/10', text: 'text-emerald-300', border: 'border-emerald-500/20', label: 'LIKELY HUMAN' },
  };
  const cfg = configs[classification] || {
    bg: 'bg-slate-500/10', text: 'text-slate-400', border: 'border-slate-500/20',
    label: (status || 'UNKNOWN').toUpperCase().replace(/_/g, ' '),
  };

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      {cfg.label}
    </span>
  );
}

function ResultRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm border-b border-white/[0.03] last:border-b-0">
      <dt className="text-slate-500 shrink-0">{label}</dt>
      <dd className={`text-right font-medium text-slate-300 break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}

function AnalysisNote({ children }) {
  return (
    <p className="mt-3 rounded-lg border border-amber-500/15 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-300/80">
      {children}
    </p>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MODALITY CARD — Each detector gets one
   ═══════════════════════════════════════════════════════════════ */

function ModalityCard({ title, icon, children, accentColor = 'cyan' }) {
  const borderColors = {
    cyan: 'border-cyan-500/10 hover:border-cyan-500/25',
    emerald: 'border-emerald-500/10 hover:border-emerald-500/25',
    purple: 'border-purple-500/10 hover:border-purple-500/25',
    blue: 'border-blue-500/10 hover:border-blue-500/25',
  };

  return (
    <div className={`glass-card-bright rounded-xl border p-5 transition-all duration-300 hover:scale-[1.01] ${borderColors[accentColor]}`}>
      <div className="flex items-center gap-2 mb-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 text-slate-400">
          {icon}
        </span>
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">{title}</h4>
      </div>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   INDIVIDUAL ANALYSIS BLOCKS
   ═══════════════════════════════════════════════════════════════ */

function VisualAnalysisBlock({ visual }) {
  if (!visual) return null;

  const icon = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l7 2.6v5.4c0 4.2-2.9 7.600-7 8.600-4.100-1-7-4.400-7-8.600V5.600L12 3z" />
    </svg>
  );

  if (visual.status === 'completed') {
    return (
      <ModalityCard title="Face Manipulation (EfficientNet-B7)" icon={icon} accentColor="cyan">
        <div className="flex items-center gap-5">
          <RadialGauge score={visual.score} isFakeOriented={true} size={100} strokeWidth={7} />
          <div className="flex-1 space-y-2">
            <StatusBadge classification={visual.classification} />
            <dl className="mt-2">
              <ResultRow label="Score" value={`${formatScore(visual.score)} (uncalibrated)`} mono />
              <ResultRow label="Faces" value={`${visual.faces_analyzed} of ${visual.faces_detected}`} />
              <ResultRow label="Threshold" value={String(visual.threshold)} mono />
              <ResultRow label="Aggregation" value={visual.aggregation || '—'} />
            </dl>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          Score is FAKE-oriented (higher = more likely fake). This detector was developed for face-manipulation detection. Results are indicative signals, not forensic proof.
        </p>
      </ModalityCard>
    );
  }

  const statusLabels = {
    no_face_detected: 'No face detected',
    model_unavailable: 'Model unavailable',
    inference_failed: 'Inference failed',
    not_applicable: 'Not applicable',
  };

  return (
    <ModalityCard title="Face Manipulation (EfficientNet-B7)" icon={icon} accentColor="cyan">
      <StatusBadge status={visual.status} />
      <ResultRow label="Status" value={statusLabels[visual.status] || 'Not available'} />
      <AnalysisNote>
        {visual.message || 'No model score is available for this upload. This is not a real/deepfake verdict.'}
      </AnalysisNote>
    </ModalityCard>
  );
}

function AudioAnalysisBlock({ audio }) {
  if (!audio) return null;

  const icon = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 1v22M8 5v14M4 9v6M16 5v14M20 9v6" />
    </svg>
  );

  if (audio.status === 'completed') {
    return (
      <ModalityCard title="Audio Deepfake (wav2vec2)" icon={icon} accentColor="emerald">
        <div className="flex items-center gap-5">
          <RadialGauge score={audio.score} isFakeOriented={false} size={100} strokeWidth={7} />
          <div className="flex-1 space-y-2">
            <StatusBadge classification={audio.classification} />
            <dl className="mt-2">
              <ResultRow label="Score" value={`${formatScore(audio.score)} (REAL-oriented)`} mono />
              <ResultRow label="Threshold" value={String(audio.threshold)} mono />
              <ResultRow label="Aggregation" value={audio.aggregation || '—'} />
            </dl>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          Score is REAL-oriented (higher = more likely genuine). Softmax output for REAL class, uncalibrated. Treat as a signal, not forensic evidence.
        </p>
      </ModalityCard>
    );
  }

  return (
    <ModalityCard title="Audio Deepfake (wav2vec2)" icon={icon} accentColor="emerald">
      <StatusBadge status={audio.status} />
      <ResultRow label="Status" value={audioStateLabel(audio)} />
      <AnalysisNote>
        {audio.message || 'No audio model score is available for this upload.'}
      </AnalysisNote>
    </ModalityCard>
  );
}

function AiImageAnalysisBlock({ aiImage }) {
  if (!aiImage) return null;

  const icon = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    </svg>
  );

  if (aiImage.status === 'completed') {
    return (
      <ModalityCard title="AI-Generated Image (CLIP ViT-L/14)" icon={icon} accentColor="purple">
        <div className="flex items-center gap-5">
          <RadialGauge score={aiImage.score} isFakeOriented={true} size={100} strokeWidth={7} />
          <div className="flex-1 space-y-2">
            <StatusBadge classification={aiImage.classification} />
            <dl className="mt-2">
              <ResultRow label="Score" value={`${formatScore(aiImage.score)} (uncalibrated)`} mono />
              <ResultRow label="Threshold" value={String(aiImage.threshold)} mono />
              <ResultRow label="Images analyzed" value={String(aiImage.images_analyzed)} />
            </dl>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          Higher score = more likely AI-generated. Whole-image detector (no face detection required). Independent of the face-manipulation detector — scores are never combined.
        </p>
      </ModalityCard>
    );
  }

  return (
    <ModalityCard title="AI-Generated Image (CLIP ViT-L/14)" icon={icon} accentColor="purple">
      <StatusBadge status={aiImage.status} />
      <ResultRow label="Status" value={aiImageStateLabel(aiImage)} />
      <AnalysisNote>
        {aiImage.message || 'No AI-generation score is available for this upload.'}
      </AnalysisNote>
    </ModalityCard>
  );
}

function MultimodalAnalysisBlock({ multimodal }) {
  if (!multimodal) return null;

  const icon = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
      <path d="M12 22V15.5M22 8.5L12 15.5 2 8.5" />
      <path d="M2 15.5L12 8.5l10 7" />
    </svg>
  );

  if (multimodal.status === 'completed') {
    return (
      <ModalityCard title="Multimodal Fusion" icon={icon} accentColor="blue">
        <div className="flex items-center gap-5">
          <RadialGauge score={multimodal.fused_fake_score} isFakeOriented={true} size={100} strokeWidth={7} />
          <div className="flex-1 space-y-2">
            <StatusBadge classification={multimodal.classification} />
            <dl className="mt-2">
              <ResultRow label="Fused score" value={`${formatScore(multimodal.fused_fake_score)} (FAKE-oriented)`} mono />
              <ResultRow label="Weights" value={`Visual ${multimodal.visual_weight} · Audio ${multimodal.audio_weight}`} />
              <ResultRow label="Threshold" value={String(multimodal.threshold)} mono />
            </dl>
          </div>
        </div>
        {/* Fusion balance bar */}
        <div className="mt-4 rounded-lg bg-white/[0.03] p-3">
          <p className="text-xs font-semibold text-slate-500 mb-2">Fusion Balance</p>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-cyan-400 font-medium">Visual {(multimodal.visual_weight * 100).toFixed(0)}%</span>
            <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500"
                style={{ width: `${multimodal.visual_weight * 100}%` }}
              />
            </div>
            <span className="text-emerald-400 font-medium">Audio {(multimodal.audio_weight * 100).toFixed(0)}%</span>
          </div>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          Fused score is a weighted arithmetic combination of two model outputs. {multimodal.aggregation}. Treat as a signal, not forensic evidence.
        </p>
      </ModalityCard>
    );
  }

  const statusLabels = {
    partial: 'Partial',
    unavailable: 'Unavailable',
    invalid_input: 'Invalid input',
  };

  return (
    <ModalityCard title="Multimodal Fusion" icon={icon} accentColor="blue">
      <StatusBadge status={multimodal.status} />
      <ResultRow label="Status" value={statusLabels[multimodal.status] || 'Not performed'} />
      <AnalysisNote>
        {multimodal.message || 'Multimodal fusion was not performed. No fused score or classification was produced.'}
      </AnalysisNote>
    </ModalityCard>
  );
}

/* ═══════════════════════════════════════════════════════════════
   JSON INSPECTOR DRAWER
   ═══════════════════════════════════════════════════════════════ */

function JsonInspector({ data }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!data) return null;

  const jsonStr = JSON.stringify(data, null, 2);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(jsonStr);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = jsonStr;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-xs font-medium text-slate-500 transition-colors hover:text-cyan-400"
      >
        <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 18l6-6-6-6" />
        </svg>
        {open ? 'Hide' : 'View'} Raw API Response
      </button>

      {open && (
        <div className="mt-3 relative rounded-xl border border-white/5 bg-[#060a14] overflow-hidden animate-fade-in">
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-2">
            <span className="text-xs font-mono text-slate-600">application/json</span>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition-colors hover:bg-white/5 hover:text-cyan-400"
            >
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <pre className="max-h-96 overflow-auto p-4 text-xs leading-relaxed text-slate-400 font-mono">
            {jsonStr}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PDF REPORT EXPORT
   ═══════════════════════════════════════════════════════════════ */

function generateReportHtml(result, fileName) {
  const now = new Date().toISOString();
  const visual = result?.visual_analysis;
  const audio = result?.audio_analysis;
  const aiImage = result?.ai_image_analysis;
  const multimodal = result?.multimodal_analysis;

  const row = (label, value) =>
    `<tr><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:13px">${label}</td><td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-weight:600;font-size:13px">${value ?? '—'}</td></tr>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>Clarity Mesh – Forensic Analysis Report</title>
  <style>
    body{font-family:'Inter',system-ui,sans-serif;color:#1e293b;max-width:800px;margin:0 auto;padding:40px 24px}
    h1{font-size:22px;font-weight:800;margin-bottom:4px}
    h2{font-size:16px;font-weight:700;margin-top:32px;padding-bottom:8px;border-bottom:2px solid #0891b2}
    .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase}
    .badge-real{background:#d1fae5;color:#065f46}
    .badge-fake{background:#fecdd3;color:#9f1239}
    .badge-na{background:#f1f5f9;color:#64748b}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    .disclaimer{margin-top:32px;padding:16px;border:1px solid #fde68a;border-radius:8px;background:#fefce8;font-size:12px;color:#92400e;line-height:1.6}
    .footer{margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center}
  </style>
</head>
<body>
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
    <div style="width:36px;height:36px;border-radius:8px;background:#0f172a;display:flex;align-items:center;justify-content:center">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="#22d3ee" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 3l7 2.6v5.4c0 4.2-2.9 7.6-7 8.6-4.1-1-7-4.4-7-8.6V5.6L12 3z"/>
        <path d="M9 12l2.2 2.2L15.5 10"/>
      </svg>
    </div>
    <div>
      <h1>Clarity Mesh — Forensic Analysis Report</h1>
      <p style="color:#64748b;font-size:13px;margin:0">AI-Powered Multimodal Deepfake Detection</p>
    </div>
  </div>

  <h2>📁 File Information</h2>
  <table>
    ${row('Filename', result?.file?.original_name || fileName || '—')}
    ${row('Media Type', result?.media_type || '—')}
    ${row('Content Type', result?.file?.content_type || '—')}
    ${row('File Size', result?.file?.size_human || '—')}
    ${row('Report Generated', now)}
  </table>

  <h2>🛡️ Face Manipulation (EfficientNet-B7)</h2>
  <table>
    ${row('Status', visual?.status || '—')}
    ${row('Score', visual?.status === 'completed' ? `${Number(visual.score).toFixed(4)} (FAKE-oriented, uncalibrated)` : '—')}
    ${row('Classification', visual?.status === 'completed' ? visual.classification : '—')}
    ${row('Faces Analyzed', visual?.status === 'completed' ? `${visual.faces_analyzed} of ${visual.faces_detected}` : '—')}
    ${row('Threshold', visual?.threshold ?? '—')}
    ${row('Model', visual?.model || 'EfficientNet-B7 (TorchScript)')}
  </table>

  <h2>🎙️ Audio Deepfake (wav2vec2)</h2>
  <table>
    ${row('Status', audio?.status || '—')}
    ${row('Score', audio?.status === 'completed' ? `${Number(audio.score).toFixed(4)} (REAL-oriented, uncalibrated)` : '—')}
    ${row('Classification', audio?.status === 'completed' ? audio.classification : '—')}
    ${row('Threshold', audio?.threshold ?? '—')}
    ${row('Model', audio?.model || 'wav2vec-small-anti-deepfake')}
  </table>

  <h2>👁️ AI-Generated Image (CLIP ViT-L/14)</h2>
  <table>
    ${row('Status', aiImage?.status || '—')}
    ${row('Score', aiImage?.status === 'completed' ? `${Number(aiImage.score).toFixed(4)} (FAKE-oriented, uncalibrated)` : '—')}
    ${row('Classification', aiImage?.status === 'completed' ? aiImage.classification : '—')}
    ${row('Threshold', aiImage?.threshold ?? '—')}
    ${row('Model', aiImage?.model || 'UniversalFakeDetect (CLIP ViT-L/14)')}
  </table>

  <h2>⚡ Multimodal Fusion</h2>
  <table>
    ${row('Status', multimodal?.status || '—')}
    ${row('Fused Score', multimodal?.status === 'completed' ? `${Number(multimodal.fused_fake_score).toFixed(4)} (FAKE-oriented, uncalibrated)` : '—')}
    ${row('Classification', multimodal?.status === 'completed' ? multimodal.classification : '—')}
    ${row('Fusion Weights', multimodal?.status === 'completed' ? `Visual ${multimodal.visual_weight} · Audio ${multimodal.audio_weight}` : '—')}
    ${row('Formula', multimodal?.status === 'completed' ? `${multimodal.visual_weight} × visual_fake + ${multimodal.audio_weight} × audio_fake` : '—')}
    ${row('Threshold', multimodal?.threshold ?? '—')}
  </table>

  <div class="disclaimer">
    <strong>⚠️ Important Disclaimer</strong><br/>
    All scores reported in this document are <strong>uncalibrated model outputs</strong>, NOT calibrated probabilities. They should be treated as <strong>indicative signals only</strong> and are NOT forensic evidence or proof of authenticity. Thresholds are engineering defaults that have NOT been scientifically validated on project data. The "real" classification never proves authenticity — it only indicates the model did not detect manipulation signals above its threshold.
  </div>

  <div class="footer">
    Generated by Clarity Mesh — AI-Powered Multimodal Deepfake Detection<br/>
    EfficientNet-B7 (Visual) · wav2vec2 (Audio) · CLIP ViT-L/14 (AI-Image) · Weighted Fusion
  </div>
</body>
</html>`;
}

function ExportReportButton({ result, fileName }) {
  if (!result) return null;

  const handleExport = () => {
    const html = generateReportHtml(result, fileName);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clarity-mesh-report-${Date.now()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm font-medium text-slate-400 transition-all duration-300 hover:border-cyan-500/30 hover:bg-cyan-500/5 hover:text-cyan-300"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
      </svg>
      Download Forensic Report
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN: ANALYZE SECTION
   ═══════════════════════════════════════════════════════════════ */

export default function AnalyzeSection() {
  const [file, setFile] = useState(null);
  // status: null | { type: 'error' | 'info' | 'success', text: string }
  const [status, setStatus] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState(null);
  const resultRef = useRef(null);

  const handleFileSelect = (selected) => {
    setFile(selected);
    setStatus(null);
    setResult(null);
  };

  const handleRemove = () => {
    setFile(null);
    setStatus(null);
    setResult(null);
  };

  const handleAnalyze = async () => {
    if (isUploading) return;

    if (!file) {
      setStatus({
        type: 'error',
        text: 'Please select an image or video before analyzing.',
      });
      return;
    }

    setIsUploading(true);
    setStatus({ type: 'info', text: 'Uploading media to the backend…' });
    setResult(null);

    try {
      const payload = await analyzeMedia(file);
      setResult(payload);
      const visual = payload?.visual_analysis;
      const audio = payload?.audio_analysis;
      const aiImage = payload?.ai_image_analysis;
      const multimodal = payload?.multimodal_analysis;

      // Build an honest top-level summary. Prefer the fused result when a real
      // fusion happened; otherwise summarise the individual modality outcomes
      // without inventing any score.
      if (multimodal?.status === 'completed') {
        setStatus({
          type: 'success',
          text: `Analysis complete — multimodal fusion ${multimodal.classification} (fused score ${Number(multimodal.fused_fake_score).toFixed(4)}, uncalibrated).`,
        });
      } else {
        const parts = [];
        if (visual?.status === 'completed') {
          parts.push(`visual ${visual.classification} (score ${Number(visual.score).toFixed(4)})`);
        } else if (visual) {
          parts.push('visual not scored');
        }
        if (audio?.status === 'completed') {
          parts.push(`audio ${audio.classification} (score ${Number(audio.score).toFixed(4)})`);
        } else if (audio && audio.status !== 'not_applicable') {
          parts.push('audio not scored');
        }
        if (aiImage?.status === 'completed') {
          parts.push(
            `AI-image ${aiImage.classification} (score ${Number(aiImage.score).toFixed(4)}, uncalibrated)`,
          );
        } else if (aiImage && aiImage.status !== 'not_applicable') {
          parts.push('AI-image not scored');
        }
        if (parts.length > 0) {
          setStatus({
            type: 'success',
            text: `Analysis complete — ${parts.join(', ')}. Multimodal fusion not performed. Scores are uncalibrated.`,
          });
        } else {
          setStatus({
            type: 'info',
            text:
              multimodal?.message ||
              visual?.message ||
              audio?.message ||
              'Media analyzed. No modality produced a score.',
          });
        }
      }

      // Scroll to results
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 200);
    } catch (error) {
      setResult(null);
      setStatus({ type: 'error', text: describeApiError(error) });
    } finally {
      setIsUploading(false);
    }
  };

  const fileInfo = result?.file || null;
  const visual = result?.visual_analysis || null;
  const audio = result?.audio_analysis || null;
  const aiImage = result?.ai_image_analysis || null;
  const multimodal = result?.multimodal_analysis || null;

  return (
    <section id="upload" className="relative mx-auto max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
      {/* Section header */}
      <div className="text-center animate-fade-in">
        <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
          Analyze Your Media
        </h2>
        <p className="mt-3 text-slate-400 max-w-xl mx-auto">
          Upload an image or video to check it for signs of AI generation or manipulation.
          All four detectors run automatically.
        </p>
      </div>

      {/* Upload card */}
      <div className="mt-10 glass-card p-5 sm:p-8 space-y-5 animate-slide-up delay-100">
        <UploadZone hasFile={Boolean(file)} onFileSelect={handleFileSelect} />

        {file && <FilePreview file={file} onRemove={handleRemove} />}

        <div className="flex flex-col items-stretch gap-4">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isUploading}
            className="btn-shimmer relative flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-cyan-500/15 transition-all duration-300 hover:shadow-cyan-500/25 hover:scale-[1.01] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1222] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
          >
            {isUploading && (
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {isUploading ? 'Analyzing…' : 'Analyze Media'}
          </button>

          {/* Pipeline stepper — visible only during analysis */}
          <PipelineStepper isActive={isUploading} />

          {/* Status banner */}
          {status && (
            <div
              role={status.type === 'error' ? 'alert' : 'status'}
              className={`rounded-xl border px-4 py-3 text-sm animate-fade-in ${
                status.type === 'error'
                  ? 'border-rose-500/20 bg-rose-500/5 text-rose-300'
                  : status.type === 'success'
                    ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-300'
                    : 'border-amber-500/20 bg-amber-500/5 text-amber-300'
              }`}
            >
              {status.text}
            </div>
          )}

          {/* ═══ RESULTS DASHBOARD ═══ */}
          {fileInfo && (
            <div ref={resultRef} className="space-y-6 animate-slide-up">
              {/* Upload details card */}
              <div className="glass-card-bright p-5">
                <div className="flex items-center gap-2 mb-4">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                  <h3 className="text-sm font-bold text-slate-200">Upload Details</h3>
                </div>

                <dl>
                  <ResultRow label="Filename" value={fileInfo.original_name ?? file?.name ?? '—'} />
                  <ResultRow label="Media type" value={fileInfo.media_type || getMediaKind(file) || '—'} />
                  <ResultRow label="Content type" value={fileInfo.content_type || '—'} mono />
                  <ResultRow label="File size" value={fileInfo.size_human || formatFileSize(file?.size)} />
                </dl>
              </div>

              {/* Section title */}
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400">Analysis Results</h3>
                <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent" />
              </div>

              {/* Modality cards grid */}
              <div className="grid gap-4 sm:grid-cols-2">
                <VisualAnalysisBlock visual={visual} />
                <AudioAnalysisBlock audio={audio} />
                <AiImageAnalysisBlock aiImage={aiImage} />
                <MultimodalAnalysisBlock multimodal={multimodal} />
              </div>

              {/* Export & JSON inspector */}
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <ExportReportButton result={result} fileName={file?.name} />
              </div>
              <JsonInspector data={result} />
            </div>
          )}
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-slate-600">
        Files are sent to the Clarity Mesh backend at{' '}
        <code className="rounded bg-white/5 px-1.5 py-0.5 font-mono text-slate-500">{API_BASE_URL}</code>.
        Maximum file size {MAX_UPLOAD_SIZE_MB}&nbsp;MB.
      </p>
    </section>
  );
}
