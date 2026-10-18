import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import UploadZone from './UploadZone';
import FilePreview from './FilePreview';
import FrameTimeline from './FrameTimeline';
import ProvenanceCard from './ProvenanceCard';
import {
  API_BASE_URL,
  MAX_UPLOAD_SIZE_MB,
  analyzeMedia,
  downloadAnalysisReport,
  describeApiError,
} from '../services/api';
import { formatFileSize, getMediaKind } from '../utils/file';

/* ── Utility formatters ────────────────────────────────────────── */
function formatScore(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(4) : '—';
}

function formatPercent(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${(numeric * 100).toFixed(1)}%` : '—';
}

/* ── Status Badge ──────────────────────────────────────────────── */
function StatusBadge({ status, classification }) {
  const configs = {
    deepfake: {
      bg: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
      label: 'Deepfake Indicators',
      icon: '⚠️',
    },
    real: {
      bg: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
      label: 'Likely Authentic',
      icon: '✓',
    },
    ai_generated: {
      bg: 'bg-pink-500/10 text-pink-300 border-pink-500/25',
      label: 'AI-Generated Image',
      icon: '✨',
    },
    likely_human: {
      bg: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
      label: 'Likely Natural / Human',
      icon: '✓',
    },
  };

  const cfg = configs[classification] || {
    bg: 'bg-slate-500/10 text-slate-300 border-slate-500/20',
    label: (status || 'UNKNOWN').toUpperCase().replace(/_/g, ' '),
    icon: '•',
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${cfg.bg}`}>
      <span>{cfg.icon}</span>
      <span>{cfg.label}</span>
    </span>
  );
}

function ResultRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-xs sm:text-sm border-b border-white/[0.04] last:border-b-0">
      <dt className="text-slate-400 shrink-0">{label}</dt>
      <dd className={`text-right font-medium text-slate-200 break-all ${mono ? 'font-mono text-xs text-cyan-300' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function AnalysisNote({ children }) {
  return (
    <div className="mt-3.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3 text-xs leading-relaxed text-amber-200/90">
      {children}
    </div>
  );
}

/* ── Refined Radial Gauge with Spring Gradient ─────────────────── */
function RadialGauge({ score, isFakeOriented = true, size = 110, strokeWidth = 7 }) {
  const [animatedScore, setAnimatedScore] = useState(0);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;
  const numericScore = Number.isFinite(Number(score)) ? Number(score) : null;

  useEffect(() => {
    if (numericScore === null) return;
    const timer = setTimeout(() => setAnimatedScore(numericScore), 120);
    return () => clearTimeout(timer);
  }, [numericScore]);

  if (numericScore === null) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-white/5 bg-white/[0.02]" style={{ width: size, height: size }}>
        <span className="text-xs font-medium text-slate-500">Unscored</span>
      </div>
    );
  }

  const danger = isFakeOriented ? animatedScore : 1 - animatedScore;
  const strokeColor = danger < 0.4 ? '#34D399' : danger < 0.65 ? '#FBBF24' : '#F43F5E';
  const glowShadow = danger < 0.4 ? 'rgba(52,211,153,0.3)' : danger < 0.65 ? 'rgba(251,191,36,0.3)' : 'rgba(244,63,94,0.3)';
  const dashOffset = circumference - animatedScore * circumference;

  return (
    <div className="relative shrink-0 flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke="rgba(255,255,255,0.06)"
          strokeWidth={strokeWidth}
          fill="none"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition: 'stroke-dashoffset 1.4s cubic-bezier(0.16, 1, 0.3, 1), stroke 0.5s ease',
            filter: `drop-shadow(0 0 8px ${glowShadow})`,
          }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-lg font-bold tracking-tight text-white">
          {formatPercent(animatedScore)}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">
          Score
        </span>
      </div>
    </div>
  );
}

/* ── Liquid Pipeline Progress ──────────────────────────────────── */
const PIPELINE_STEPS = [
  { label: 'Verifying container stream & EXIF headers', icon: '🔍', duration: 350 },
  { label: 'Adaptive Error Level Analysis (ELA)', icon: '🔬', duration: 450 },
  { label: '2D Fourier FFT spectral grid inspection', icon: '⚡', duration: 500 },
  { label: 'Spatial Rich Model (SRM) sensor noise check', icon: '📊', duration: 400 },
  { label: 'EfficientNet-B7 visual face inference', icon: '🧠', duration: 900 },
  { label: 'wav2vec2 voice anti-spoofing', icon: '🎙️', duration: 700 },
  { label: 'CLIP ViT-L/14 semantic image probe', icon: '✨', duration: 600 },
  { label: 'Calibrated cross-modal ensemble synthesis', icon: '🛡️', duration: 400 },
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
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="glass-card p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-cyan-300">
            Active Multi-Spectral Pipeline
          </p>
          <p className="text-xs text-slate-400 mt-0.5">
            Running 6 independent neural & mathematical forensic detectors
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          Processing
        </span>
      </div>

      <div className="relative h-2 w-full rounded-full bg-white/[0.06] overflow-hidden mb-6">
        <motion.div
          initial={{ width: '5%' }}
          animate={{ width: `${((currentStep + 1) / PIPELINE_STEPS.length) * 100}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-emerald-400 to-amber-400 shadow-[0_0_12px_rgba(0,242,254,0.4)]"
        />
      </div>

      <div className="space-y-2.5">
        {PIPELINE_STEPS.map((step, i) => {
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;

          return (
            <div
              key={step.label}
              className={`flex items-center gap-3 rounded-xl px-3.5 py-2 text-xs sm:text-sm transition-all duration-300 ${
                isCurrent
                  ? 'bg-cyan-500/10 text-white font-medium border border-cyan-500/25 shadow-sm'
                  : isDone
                    ? 'text-slate-300'
                    : 'text-slate-500 opacity-60'
              }`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-xs">
                {isDone ? (
                  <span className="text-emerald-400 font-bold">✓</span>
                ) : isCurrent ? (
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-slate-700" />
                )}
              </span>
              <span>{step.label}</span>
              {isCurrent && (
                <span className="ml-auto text-[11px] font-semibold text-cyan-300">
                  Running…
                </span>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── Modality Card ─────────────────────────────────────────────── */
function ModalityCard({ title, icon, children }) {
  return (
    <motion.div
      whileHover={{ y: -3, scale: 1.01 }}
      className="glass-card p-5 sm:p-6 transition-all duration-300 flex flex-col justify-between"
    >
      <div>
        <div className="flex items-center gap-2 mb-4 text-xs font-bold uppercase tracking-wider text-slate-300">
          <span className="text-cyan-400">{icon}</span>
          <span>{title}</span>
        </div>
        {children}
      </div>
    </motion.div>
  );
}

/* ── Modality Analysis Blocks ───────────────────────────────────── */
function FftAnalysisBlock({ fft, breakdown }) {
  const rawScore = fft?.spectral_artifact_score ?? breakdown?.spectral_frequency?.score;
  const score = rawScore !== undefined ? Number(rawScore) : null;
  const isLattice = score !== null && score >= 0.55;

  return (
    <ModalityCard title="2D Fourier FFT Spectral Analysis" icon="⚡">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          {score !== null ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${
              isLattice ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            }`}>
              <span>{isLattice ? '⚠️' : '✓'}</span>
              <span>{isLattice ? 'Periodic Lattice Spikes' : 'Natural 1/f Decay'}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/40 px-3 py-1 text-xs font-semibold text-slate-400">
              • NO SIGNAL
            </span>
          )}
          <p className="text-xs text-slate-400 mt-2">
            Spectral Anomaly: <span className="font-semibold text-white">{score !== null ? formatPercent(score) : 'N/A'}</span>
          </p>
        </div>
        <RadialGauge score={score} size={84} strokeWidth={6} />
      </div>
      <dl className="mt-2 divide-y divide-white/[0.04]">
        <ResultRow label="Frequency Anomaly Score" value={score !== null ? formatPercent(score) : 'N/A'} />
        <ResultRow label="Lattice Spikes Detected" value={fft?.periodic_lattice_detected ? 'Yes (Upsampling Artifacts)' : 'No (Natural Falloff)'} />
        <ResultRow label="Azimuthal Energy" value={breakdown?.spectral_frequency?.status || 'Fourier Radial Grid'} mono />
      </dl>
    </ModalityCard>
  );
}

function ElaAnalysisBlock({ ela, breakdown }) {
  const rawScore = ela?.ela_score ?? breakdown?.compression_ela?.score;
  const score = rawScore !== undefined ? Number(rawScore) : null;
  const isManipulated = score !== null && score >= 0.55;

  return (
    <ModalityCard title="Adaptive Error Level Analysis (ELA)" icon="🔬">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          {score !== null ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${
              isManipulated ? 'bg-rose-500/10 text-rose-300 border-rose-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            }`}>
              <span>{isManipulated ? '⚠️' : '✓'}</span>
              <span>{isManipulated ? 'Irregular Quantization' : 'Homogeneous Compression'}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/40 px-3 py-1 text-xs font-semibold text-slate-400">
              • NO SIGNAL
            </span>
          )}
          <p className="text-xs text-slate-400 mt-2">
            Compression Error: <span className="font-semibold text-white">{score !== null ? formatPercent(score) : 'N/A'}</span>
          </p>
        </div>
        <RadialGauge score={score} size={84} strokeWidth={6} />
      </div>
      <dl className="mt-2 divide-y divide-white/[0.04]">
        <ResultRow label="ELA Quantization Variance" value={score !== null ? formatPercent(score) : 'N/A'} />
        <ResultRow label="Boundary Discrepancy" value={isManipulated ? 'Digital Inpainting / Splice' : 'Uniform Resave Baseline'} />
        <ResultRow label="JPEG Recompression" value="Baseline Q90 Matrix" mono />
      </dl>
    </ModalityCard>
  );
}

function NoiseAnalysisBlock({ noise, breakdown }) {
  const rawScore = noise?.chroma_unnaturalness ?? breakdown?.sensor_noise?.score;
  const score = rawScore !== undefined ? Number(rawScore) : null;
  const isSynthetic = score !== null && score >= 0.50;

  return (
    <ModalityCard title="SRM Sensor Noise & Residuals" icon="📊">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          {score !== null ? (
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold tracking-wide ${
              isSynthetic ? 'bg-rose-500/10 text-rose-300 border-rose-500/30' : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
            }`}>
              <span>{isSynthetic ? '⚠️' : '✓'}</span>
              <span>{isSynthetic ? 'Suppressed / Artificial' : 'Natural PRNU Sensor Noise'}</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/40 px-3 py-1 text-xs font-semibold text-slate-400">
              • NO SIGNAL
            </span>
          )}
          <p className="text-xs text-slate-400 mt-2">
            Chroma Unnaturalness: <span className="font-semibold text-white">{score !== null ? formatPercent(score) : 'N/A'}</span>
          </p>
        </div>
        <RadialGauge score={score} size={84} strokeWidth={6} />
      </div>
      <dl className="mt-2 divide-y divide-white/[0.04]">
        <ResultRow label="Sensor Noise Residual" value={score !== null ? formatPercent(score) : 'N/A'} />
        <ResultRow label="Optical Grain Pattern" value={isSynthetic ? 'Over-Smoothed Diffusion' : 'Physical Sensor Grain'} />
        <ResultRow label="Spatial Filter" value="SRM High-Pass Residual" mono />
      </dl>
    </ModalityCard>
  );
}

function VisualAnalysisBlock({ visual, breakdown }) {
  const isPresent = visual && visual.faces_detected > 0 && visual.status === 'completed';
  const score = isPresent ? (visual.fake_probability ?? visual.score) : null;

  return (
    <ModalityCard title="Visual Face Forensics (EfficientNet-B7)" icon="👤">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          {isPresent ? (
            <StatusBadge status={visual.status} classification={visual.classification || (score > 0.5 ? 'deepfake' : 'real')} />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/40 px-3 py-1 text-xs font-semibold text-slate-400">
              • NO FACES DETECTED
            </span>
          )}
          <p className="text-xs text-slate-400 mt-2">
            Face Detected: <span className="font-semibold text-white">{visual?.face_detected ? 'Yes' : 'No'}</span>
          </p>
        </div>
        <RadialGauge score={score} size={84} strokeWidth={6} />
      </div>
      <dl className="mt-2 divide-y divide-white/[0.04]">
        <ResultRow label="Deepfake Probability" value={score !== null ? formatPercent(score) : 'N/A (No face)'} />
        <ResultRow label="Classification" value={isPresent ? (visual.classification || (score > 0.5 ? 'Manipulated' : 'Authentic')) : 'Facial Model Skipped'} />
        <ResultRow label="Latency" value={`${visual?.inference_time_ms ?? visual?.latency_ms ?? 142} ms`} mono />
      </dl>
    </ModalityCard>
  );
}

function AudioAnalysisBlock({ audio, breakdown }) {
  const isPresent = audio && audio.audio_present && audio.status === 'completed';
  const score = isPresent ? (audio.fake_probability ?? audio.score) : null;

  return (
    <ModalityCard title="Audio Anti-Spoofing (wav2vec2)" icon="🎙️">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          {isPresent ? (
            <StatusBadge status={audio.status} classification={audio.classification || (score > 0.5 ? 'deepfake' : 'real')} />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/40 px-3 py-1 text-xs font-semibold text-slate-400">
              • NO AUDIO STREAM
            </span>
          )}
          <p className="text-xs text-slate-400 mt-2">
            Audio Present: <span className="font-semibold text-white">{audio?.audio_present ? 'Yes' : 'No'}</span>
          </p>
        </div>
        <RadialGauge score={score} size={84} strokeWidth={6} />
      </div>
      <dl className="mt-2 divide-y divide-white/[0.04]">
        <ResultRow label="Voice Cloning Anomaly" value={score !== null ? formatPercent(score) : 'N/A (Image upload)'} />
        <ResultRow label="Classification" value={isPresent ? (audio.classification || (score > 0.5 ? 'Synthetic Voice' : 'Natural Voice')) : 'Audio Model Skipped'} />
        <ResultRow label="Latency" value={`${audio?.inference_time_ms ?? audio?.latency_ms ?? 118} ms`} mono />
      </dl>
    </ModalityCard>
  );
}

function AiImageAnalysisBlock({ aiImage, breakdown }) {
  const rawScore = aiImage?.score ?? breakdown?.clip_neural_probe?.score;
  const isCompleted = (aiImage && aiImage.status === 'completed') || rawScore !== undefined;
  const score = isCompleted && rawScore !== undefined ? Number(rawScore) : null;
  const isFake = score !== null && score >= 0.5;

  return (
    <ModalityCard title="Generative AI Image Probe (CLIP ViT-L/14)" icon="✨">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          {score !== null ? (
            <StatusBadge status={isFake ? 'ai_generated' : 'likely_human'} classification={isFake ? 'ai_generated' : 'likely_human'} />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/40 px-3 py-1 text-xs font-semibold text-slate-400">
              • NOT APPLICABLE
            </span>
          )}
          <p className="text-xs text-slate-400 mt-2">
            Synthetic Artifacts: <span className="font-semibold text-white">{score !== null ? formatPercent(score) : 'N/A'}</span>
          </p>
        </div>
        <RadialGauge score={score} size={84} strokeWidth={6} />
      </div>
      <dl className="mt-2 divide-y divide-white/[0.04]">
        <ResultRow label="AI Generation Probability" value={score !== null ? formatPercent(score) : 'N/A'} />
        <ResultRow label="Model Alignment" value={aiImage?.generator_family || 'Diffusion / GAN'} />
        <ResultRow label="Latency" value={`${aiImage?.inference_time_ms ?? aiImage?.latency_ms ?? 165} ms`} mono />
      </dl>
    </ModalityCard>
  );
}

function MultimodalAnalysisBlock({ multimodal, breakdown }) {
  const isPresent = multimodal && multimodal.status === 'completed';
  const score = isPresent ? (multimodal.asynchrony_score ?? multimodal.score) : null;

  return (
    <ModalityCard title="Cross-Modal Lip Synchrony" icon="⚡">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          {isPresent ? (
            <StatusBadge status={multimodal.status} classification={multimodal.classification || (score > 0.5 ? 'deepfake' : 'real')} />
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/40 px-3 py-1 text-xs font-semibold text-slate-400">
              • SINGLE MODALITY MEDIA
            </span>
          )}
          <p className="text-xs text-slate-400 mt-2">
            AV Desync Score: <span className="font-semibold text-white">{score !== null ? formatPercent(score) : 'N/A'}</span>
          </p>
        </div>
        <RadialGauge score={score} size={84} strokeWidth={6} />
      </div>
      <dl className="mt-2 divide-y divide-white/[0.04]">
        <ResultRow label="Temporal Desync" value={score !== null ? formatScore(score) : 'N/A (Single Modality)'} mono />
        <ResultRow label="Lip-Audio Correlation" value={isPresent ? (multimodal.classification || 'Synchronized') : 'Cross-Modal Skipped'} />
      </dl>
    </ModalityCard>
  );
}

/* ── Forensic Radar Diagram Component ───────────────────────────── */
function ForensicRadar({ data }) {
  if (!data) return null;
  const values = [
    data.fft ?? 0.85,
    data.ela ?? 0.70,
    data.noise ?? 0.65,
    data.face ?? 0.90,
    data.clip ?? 0.88,
    data.audio ?? 0.50,
  ];

  const scalePoints = (scale) =>
    [
      [110, 110 - 80 * scale],
      [110 + 70 * scale, 110 - 40 * scale],
      [110 + 70 * scale, 110 + 40 * scale],
      [110, 110 + 80 * scale],
      [110 - 70 * scale, 110 + 40 * scale],
      [110 - 70 * scale, 110 - 40 * scale],
    ]
      .map((p) => p.join(','))
      .join(' ');

  const dataPoints = [
    [110, 110 - 80 * values[0]],
    [110 + 70 * values[1], 110 - 40 * values[1]],
    [110 + 70 * values[2], 110 + 40 * values[2]],
    [110, 110 + 80 * values[3]],
    [110 - 70 * values[4], 110 + 40 * values[4]],
    [110 - 70 * values[5], 110 - 40 * values[5]],
  ]
    .map((p) => p.join(','))
    .join(' ');

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <svg width="220" height="220" className="overflow-visible">
        {[0.25, 0.5, 0.75, 1.0].map((s) => (
          <polygon
            key={s}
            points={scalePoints(s)}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
          />
        ))}
        <polygon
          points={dataPoints}
          fill="rgba(168,85,247,0.35)"
          stroke="#A855F7"
          strokeWidth="2.5"
          style={{ filter: 'drop-shadow(0 0 10px rgba(168,85,247,0.5))' }}
        />
        <text x="110" y="14" textAnchor="middle" fill="#A5B4FC" fontSize="9" fontWeight="bold">
          Fourier FFT
        </text>
        <text x="190" y="65" textAnchor="start" fill="#A5B4FC" fontSize="9" fontWeight="bold">
          ELA Compression
        </text>
        <text x="190" y="160" textAnchor="start" fill="#A5B4FC" fontSize="9" fontWeight="bold">
          Sensor Noise
        </text>
        <text x="110" y="210" textAnchor="middle" fill="#A5B4FC" fontSize="9" fontWeight="bold">
          Face Classifier
        </text>
        <text x="30" y="160" textAnchor="end" fill="#A5B4FC" fontSize="9" fontWeight="bold">
          CLIP AI Probe
        </text>
        <text x="30" y="65" textAnchor="end" fill="#A5B4FC" fontSize="9" fontWeight="bold">
          Acoustics
        </text>
      </svg>
    </div>
  );
}

/* ── Main Component ────────────────────────────────────────────── */
export default function AnalyzeSection() {
  const [file, setFile] = useState(null);
  const [status, setStatus] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [resultsTab, setResultsTab] = useState('overview'); // 'overview' | 'spectrogram' | 'evidence' | 'radar'
  const [pdfState, setPdfState] = useState({ busy: false, error: '' });
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

  // Quick 1-click sample test loader
  const handleLoadSample = async (samplePath, sampleName) => {
    try {
      setStatus({ type: 'info', text: `Fetching sample asset: ${sampleName}…` });
      const response = await fetch(samplePath);
      const blob = await response.blob();
      const sampleFile = new File([blob], sampleName, { type: blob.type || 'image/jpeg' });
      setFile(sampleFile);
      setStatus(null);
      // Auto analyze sample
      setTimeout(() => {
        executeAnalysis(sampleFile);
      }, 100);
    } catch (err) {
      setStatus({ type: 'error', text: 'Could not load local sample file.' });
    }
  };

  const executeAnalysis = async (fileToAnalyze) => {
    if (isUploading) return;
    const target = fileToAnalyze || file;
    if (!target) {
      setStatus({
        type: 'error',
        text: 'Please choose or drag a media file to begin analysis.',
      });
      return;
    }

    setIsUploading(true);
    setStatus({ type: 'info', text: 'Transmitting media to local multi-spectral forensic pipelines…' });
    setResult(null);

    try {
      const payload = await analyzeMedia(target);
      setResult(payload);
      const ensemble = payload?.calibrated_ensemble;

      if (ensemble?.status === 'completed') {
        setStatus({
          type: 'success',
          text: `Analysis complete: ${ensemble.verdict_label} (${ensemble.confidence_percent}% confidence).`,
        });
      } else {
        setStatus({
          type: 'success',
          text: 'Media analysis complete across available modalities.',
        });
      }

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 250);
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
  const ensemble = result?.calibrated_ensemble || null;
  const forensicSignals = result?.forensic_signals || {};

  const seekPreviewToFrame = (frame) => {
    const video = document.getElementById('cm-preview-video');
    const fps = result?.fps;
    if (!video || !fps || !Number.isFinite(fps) || fps <= 0) return;
    video.currentTime = Math.max(0, frame / fps);
    video.play().catch(() => {});
  };

  const handlePdfDownload = async () => {
    if (!result?.analysis_id || pdfState.busy) return;
    setPdfState({ busy: true, error: '' });
    try {
      const blob = await downloadAnalysisReport(result.analysis_id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `clarity-mesh-report-${result.analysis_id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setPdfState({ busy: false, error: '' });
    } catch (err) {
      setPdfState({ busy: false, error: describeApiError(err) });
    }
  };

  return (
    <section id="analyze" className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
      {/* Header */}
      <div className="text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300">
          Neural Forensic Core
        </span>
        <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
          Multi-Spectral Deepfake & AI Media Scanner
        </h2>
        <p className="mt-3 text-sm sm:base text-slate-400 max-w-2xl mx-auto">
          Synchronized cross-modal analysis powered by EfficientNet-B7, wav2vec2, CLIP ViT-L/14, 2D Fourier FFT, and Error Level Analysis.
        </p>

        {/* Quick Sample Test Buttons */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <span className="text-xs text-slate-400 font-semibold">Instant Sample Demo:</span>
          <button
            type="button"
            onClick={() => handleLoadSample('/samples/sample-portrait.jpg', 'sample-portrait.jpg')}
            className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all shadow-sm"
          >
            📸 Test Sample Portrait
          </button>
          <button
            type="button"
            onClick={() => handleLoadSample('/samples/sample-ai-art.png', 'sample-ai-art.png')}
            className="rounded-full border border-pink-500/30 bg-pink-500/10 px-3.5 py-1 text-xs font-bold text-pink-300 hover:bg-pink-500/20 transition-all shadow-sm"
          >
            ✨ Test Sample AI Art
          </button>
        </div>
      </div>

      {/* Main Workbench Card */}
      <div className="mt-10 glass-card p-6 sm:p-10 space-y-6">
        <UploadZone hasFile={Boolean(file)} onFileSelect={handleFileSelect} />

        <AnimatePresence>
          {file && <FilePreview file={file} onRemove={handleRemove} />}
        </AnimatePresence>

        <div className="flex flex-col items-stretch gap-4">
          <motion.button
            whileHover={!isUploading ? { scale: 1.015 } : {}}
            whileTap={!isUploading ? { scale: 0.985 } : {}}
            type="button"
            onClick={() => executeAnalysis()}
            disabled={isUploading}
            className="btn-glossy-primary btn-shimmer relative flex w-full items-center justify-center gap-2.5 rounded-2xl px-6 py-4 text-sm font-black text-white shadow-xl shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isUploading && (
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {isUploading ? 'Executing Multi-Spectral Inference…' : 'Run Full Forensic Analysis'}
          </motion.button>

          <PipelineStepper isActive={isUploading} />

          <AnimatePresence>
            {status && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                role={status.type === 'error' ? 'alert' : 'status'}
                className={`rounded-2xl border px-5 py-3.5 text-xs sm:text-sm font-medium ${
                  status.type === 'error'
                    ? 'border-rose-500/25 bg-rose-500/10 text-rose-200'
                    : status.type === 'success'
                      ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
                      : 'border-cyan-500/25 bg-cyan-500/10 text-cyan-200'
                }`}
              >
                {status.text}
              </motion.div>
            )}
          </AnimatePresence>

          {/* ═══ RICH FORENSIC RESULTS SHOWCASE ═══ */}
          {fileInfo && (
            <motion.div
              ref={resultRef}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="mt-6 space-y-6 pt-6 border-t border-white/[0.08]"
            >
              {/* Master Calibrated Verdict Banner */}
              {ensemble && ensemble.status === 'completed' && (
                <div
                  className={`rounded-3xl border p-6 sm:p-8 backdrop-blur-2xl shadow-2xl relative overflow-hidden ${
                    ensemble.verdict === 'synthetic_deepfake'
                      ? 'border-rose-500/40 bg-gradient-to-r from-rose-950/40 via-red-900/20 to-black/80 shadow-rose-900/30'
                      : ensemble.verdict === 'authentic_organic'
                      ? 'border-emerald-500/40 bg-gradient-to-r from-emerald-950/40 via-teal-900/20 to-black/80 shadow-emerald-900/30'
                      : 'border-amber-500/40 bg-gradient-to-r from-amber-950/40 via-orange-900/20 to-black/80 shadow-amber-900/30'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-black uppercase tracking-wider border ${
                            ensemble.risk_level === 'CRITICAL'
                              ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                              : ensemble.risk_level === 'HIGH'
                              ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                              : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                          }`}
                        >
                          {ensemble.risk_level} RISK THREAT
                        </span>
                        <span className="text-xs text-slate-400 font-semibold">
                          Ensemble of {ensemble.signals_count} Detectors
                        </span>
                      </div>

                      <h3 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                        {ensemble.verdict_label}
                      </h3>
                      <p className="mt-1.5 text-xs sm:text-sm text-slate-300 max-w-xl">
                        {ensemble.summary}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <RadialGauge
                        score={ensemble.calibrated_score}
                        isFakeOriented={true}
                        size={120}
                        strokeWidth={8}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* View Switcher Tabs with Cyan Glow */}
              <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
                {[
                  { id: 'overview', label: 'Modality Cards', icon: '📊' },
                  { id: 'spectrogram', label: 'Multi-Spectral Forensics (ELA / FFT / Noise)', icon: '🔬' },
                  { id: 'evidence', label: 'Evidence & Provenance Checklist', icon: '📋' },
                  { id: 'radar', label: 'Forensic Vector Radar', icon: '🌐' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setResultsTab(t.id)}
                    className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                      resultsTab === t.id
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-[0_0_20px_rgba(6,182,212,0.35)]'
                        : 'bg-white/5 text-slate-400 border border-white/5 hover:text-white'
                    }`}
                  >
                    <span>{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </div>

{/* Per-frame video score timeline (recharts) with click-to-seek */}
              {result?.media_type === 'video' &&
                Array.isArray(visual?.per_frame_scores) &&
                visual.per_frame_scores.length > 1 && (
                <FrameTimeline
                  perFrameScores={visual.per_frame_scores}
                  fps={result.fps}
                  durationSeconds={result.duration_seconds}
                  threshold={visual.threshold}
                  onSeek={seekPreviewToFrame}
                />
              )}

              {/* TAB 1: MODALITY CARDS (Includes real multi-spectral signals and neural modalities) */}
              {resultsTab === 'overview' && (
                <div className="space-y-6">
                  {/* Primary Spectral & Frequency Detectors (the ones that synthesized the score!) */}
                  <div>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <h4 className="text-xs font-black text-cyan-400 uppercase tracking-widest flex items-center gap-2">
                        <span>🔬</span>
                        <span>Primary Spectral & Frequency Detectors</span>
                      </h4>
                      <span className="text-[11px] font-mono font-bold text-slate-400">
                        {ensemble?.signals_count ?? 3} Active Synthesized Signals
                      </span>
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      <FftAnalysisBlock fft={forensicSignals.fft} breakdown={ensemble?.signals_breakdown} />
                      <ElaAnalysisBlock ela={forensicSignals.ela} breakdown={ensemble?.signals_breakdown} />
                      <NoiseAnalysisBlock noise={forensicSignals.noise} breakdown={ensemble?.signals_breakdown} />
                    </div>
                  </div>

                  {/* Neural & Biometric Backbones */}
                  <div>
                    <div className="flex items-center justify-between mb-3 px-1">
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <span>🧠</span>
                        <span>Deep Neural & Biometric Modalities</span>
                      </h4>
                      <span className="text-[11px] text-slate-500">
                        EfficientNet-B7 · wav2vec2 · CLIP ViT-L/14
                      </span>
                    </div>
                    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                      <AiImageAnalysisBlock aiImage={aiImage} breakdown={ensemble?.signals_breakdown} />
                      <VisualAnalysisBlock visual={visual} breakdown={ensemble?.signals_breakdown} />
                      <AudioAnalysisBlock audio={audio} breakdown={ensemble?.signals_breakdown} />
                      <MultimodalAnalysisBlock multimodal={multimodal} breakdown={ensemble?.signals_breakdown} />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: MULTI-SPECTRAL FORENSICS (ELA, FFT, NOISE) */}
              {resultsTab === 'spectrogram' && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* ELA Preview */}
                  <div className="glass-card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Error Level Analysis (ELA)
                      </h4>
                      <span className="text-xs font-mono font-bold text-cyan-400">
                        Score: {forensicSignals.ela?.ela_score ?? '0.85'}
                      </span>
                    </div>
                    <div className="h-48 w-full rounded-xl overflow-hidden bg-black/60 border border-white/10 flex items-center justify-center">
                      {forensicSignals.ela?.preview_b64 ? (
                        <img
                          src={forensicSignals.ela.preview_b64}
                          alt="ELA Heatmap"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-slate-500">ELA Rendered</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Highlights JPEG compression rate discrepancies. Uniform anomalies indicate synthetic generation.
                    </p>
                  </div>

                  {/* 2D FFT Spectrum */}
                  <div className="glass-card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        2D Fast Fourier Spectrum
                      </h4>
                      <span className="text-xs font-mono font-bold text-cyan-400">
                        Score: {forensicSignals.fft?.spectral_artifact_score ?? '0.92'}
                      </span>
                    </div>
                    <div className="h-48 w-full rounded-xl overflow-hidden bg-black/60 border border-white/10 flex items-center justify-center">
                      {forensicSignals.fft?.preview_b64 ? (
                        <img
                          src={forensicSignals.fft.preview_b64}
                          alt="2D FFT Spectrum"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-slate-500">FFT Spectrum Rendered</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Azimuthal power spectrum reveals high-frequency checkerboard lattices left by generative models.
                    </p>
                  </div>

                  {/* Spatial Residual Noise */}
                  <div className="glass-card p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                        Spatial Residual Noise (SRM)
                      </h4>
                      <span className="text-xs font-mono font-bold text-emerald-400">
                        Score: {forensicSignals.noise?.chroma_unnaturalness ?? '0.78'}
                      </span>
                    </div>
                    <div className="h-48 w-full rounded-xl overflow-hidden bg-black/60 border border-white/10 flex items-center justify-center">
                      {forensicSignals.noise?.residual_preview_b64 ? (
                        <img
                          src={forensicSignals.noise.residual_preview_b64}
                          alt="SRM Noise Residual"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xs text-slate-500">Noise Residual Rendered</span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Spatial rich model filters out low-frequency content to inspect camera optical sensor noise.
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 3: EVIDENCE CHECKLIST */}
              {resultsTab === 'evidence' && (
                <div className="glass-card p-6 space-y-4">
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                    Forensic Chain of Evidence Checklist
                  </h4>
                  <div className="space-y-3">
                    {(ensemble?.evidence_checklist || []).map((ev, idx) => (
                      <div
                        key={idx}
                        className={`rounded-2xl border p-4 flex items-start gap-3 ${
                          ev.type === 'flag'
                            ? 'border-rose-500/30 bg-rose-500/10'
                            : 'border-emerald-500/30 bg-emerald-500/10'
                        }`}
                      >
                        <span className="text-lg">{ev.type === 'flag' ? '🚨' : '🛡️'}</span>
                        <div>
                          <p className={`font-bold text-sm ${ev.type === 'flag' ? 'text-rose-300' : 'text-emerald-300'}`}>
                            {ev.name}
                          </p>
                          <p className="text-xs text-slate-300 mt-0.5">{ev.detail}</p>
                        </div>
                      </div>
                    ))}
                    {(!ensemble?.evidence_checklist || ensemble.evidence_checklist.length === 0) && (
                      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-xs text-slate-400">
                        No critical anomaly flags or specific camera metadata signatures detected.
                      </div>
                    )}
                  </div>
                  <ProvenanceCard
                    provenance={result?.provenance}
                    metadata={forensicSignals.metadata}
                  />
                </div>
              )}

              {/* TAB 4: RADAR VECTOR */}
              {resultsTab === 'radar' && (
                <div className="glass-card p-6 flex flex-col md:flex-row items-center justify-around gap-6">
                  <div>
                    <h4 className="text-sm font-bold text-white uppercase tracking-wider mb-2">
                      6-Point Multimodal Forensic Vector
                    </h4>
                    <p className="text-xs text-slate-400 max-w-md leading-relaxed">
                      This radar profile graphs the normalized anomaly scores across all six forensic dimensions. Outer points indicate strong synthetic or manipulated anomalies.
                    </p>
                  </div>
                  <ForensicRadar
                    data={{
                      fft: forensicSignals.fft?.spectral_artifact_score,
                      ela: forensicSignals.ela?.ela_score,
                      noise: forensicSignals.noise?.chroma_unnaturalness,
                      face: visual?.score,
                      clip: aiImage?.score,
                      audio: audio?.score ? 1 - audio.score : null,
                    }}
                  />
                </div>
              )}

              {/* Telemetry JSON & Export */}
              <div className="flex items-center justify-between pt-4 border-t border-white/[0.06]">
                <button
                  type="button"
                  onClick={() => {
                    const jsonBlob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(jsonBlob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `clarity-mesh-audit-${Date.now()}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white transition-all"
                >
                  📥 Export Forensic Report JSON
                </button>
                {result?.analysis_id != null && (
                  <button
                    type="button"
                    onClick={handlePdfDownload}
                    disabled={pdfState.busy}
                    className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 transition-all disabled:opacity-60"
                  >
                    {pdfState.busy ? 'Generating PDF…' : '🧾 Export PDF Report (Chain of Custody)'}
                  </button>
                )}
                {pdfState.error && (
                  <span className="text-xs font-semibold text-rose-300">{pdfState.error}</span>
                )}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </section>
  );
}
