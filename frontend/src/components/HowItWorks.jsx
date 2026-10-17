import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STEPS = [
  {
    title: 'Media Intake & Validation',
    brief: 'High-speed ingestion of video, image, or audio files.',
    detail: 'Supports MP4, MOV, AVI, MKV, JPG, PNG, WEBM, WAV, MP3, FLAC, and M4A up to 50 MB. Validates media headers and container streams before neural allocation.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
        <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
    ),
    color: 'cyan',
  },
  {
    title: 'Adaptive Frame Sampling',
    brief: 'Temporal OpenCV frame extraction.',
    detail: 'Videos are sampled across uniform temporal windows (up to 16 keyframes) ensuring motion consistency without frame-drop artifacts.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="3" />
        <path d="M2 12h20M12 2v20" />
      </svg>
    ),
    color: 'indigo',
  },
  {
    title: 'Biometric Face Localization',
    brief: 'Haar cascade detection with contextual margin crops.',
    detail: 'Extracts bounding coordinates with calibrated padding to preserve facial landmarks, hair boundary lines, and compression seams.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a6 6 0 0112 0v1" />
      </svg>
    ),
    color: 'pink',
  },
  {
    title: 'Deepfake Feature Scoring (EfficientNet-B7)',
    brief: 'DFDC 1st-place TorchScript neural classifier.',
    detail: 'Evaluates micro-artifacts in face crops at high resolution. Outputs an uncalibrated sigmoid score where values above 0.7 indicate synthetic manipulation.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l8 4.5v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10v-6L12 2z" />
      </svg>
    ),
    color: 'rose',
  },
  {
    title: 'Acoustic Anti-Spoofing (wav2vec2)',
    brief: 'NII Yamagishi Lab audio biometric transformer.',
    detail: 'Decodes voice tracks to 16 kHz WAV, evaluating 10-second chunks for vocoder phase distortion, neural voice clones, and synthetic speech anomalies.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1v22M8 5v14M4 9v6M16 5v14M20 9v6" />
      </svg>
    ),
    color: 'emerald',
  },
  {
    title: 'AI-Image Synthesis Analysis (CLIP ViT-L/14)',
    brief: 'UniversalFakeDetect linear probe on whole-image embeddings.',
    detail: 'Scans the full image composition to detect diffusion artifacts (Midjourney, DALL-E, Stable Diffusion) independent of facial presence.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      </svg>
    ),
    color: 'amber',
  },
  {
    title: 'Transparent Multimodal Fusion',
    brief: 'Cross-modality weighted decision layer.',
    detail: 'When visual and audio modalities both exist, a transparent weighted formula (0.6 Visual + 0.4 Audio) synthesizes a balanced verdict.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
        <path d="M12 22V15.5M22 8.5L12 15.5 2 8.5" />
      </svg>
    ),
    color: 'cyan',
  },
];

const COLOR_MAP = {
  cyan: {
    iconBg: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    dot: 'bg-cyan-400',
    hoverBorder: 'hover:border-cyan-500/40',
  },
  indigo: {
    iconBg: 'bg-sky-500/10 text-sky-300 border-sky-500/20',
    dot: 'bg-sky-400',
    hoverBorder: 'hover:border-sky-500/30',
  },
  pink: {
    iconBg: 'bg-pink-500/10 text-pink-300 border-pink-500/20',
    dot: 'bg-pink-400',
    hoverBorder: 'hover:border-pink-500/30',
  },
  rose: {
    iconBg: 'bg-rose-500/10 text-rose-300 border-rose-500/20',
    dot: 'bg-rose-400',
    hoverBorder: 'hover:border-rose-500/30',
  },
  emerald: {
    iconBg: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20',
    dot: 'bg-emerald-400',
    hoverBorder: 'hover:border-emerald-500/30',
  },
  amber: {
    iconBg: 'bg-amber-500/10 text-amber-300 border-amber-500/20',
    dot: 'bg-amber-400',
    hoverBorder: 'hover:border-amber-500/30',
  },
};

export default function HowItWorks() {
  const [expanded, setExpanded] = useState(0);

  return (
    <section id="how-it-works" className="relative py-20 sm:py-28">
      {/* Subtle top divider */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-2/3 bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300">
            Pipeline Transparency
          </span>
          <h2 className="mt-4 text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            How Clarity Mesh Works
          </h2>
          <p className="mt-3 text-sm sm:text-base text-slate-400 leading-relaxed">
            Every score is genuinely generated by pretrained deep learning models with honest failure states and clear thresholds.
          </p>
        </div>

        {/* Step-by-Step Interactive Accordion */}
        <div className="mt-14 max-w-4xl mx-auto space-y-3">
          {STEPS.map((step, index) => {
            const colors = COLOR_MAP[step.color] || COLOR_MAP.cyan;
            const isExpanded = expanded === index;

            return (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: '-50px' }}
                transition={{ duration: 0.35, delay: index * 0.05 }}
              >
                <button
                  type="button"
                  onClick={() => setExpanded(isExpanded ? null : index)}
                  className={`w-full text-left rounded-2xl border p-5 transition-all duration-300 ${
                    isExpanded
                      ? 'border-cyan-500/40 bg-cyan-500/[0.04] shadow-lg shadow-cyan-500/10'
                      : `border-white/[0.07] bg-white/[0.02] ${colors.hoverBorder} hover:bg-white/[0.035]`
                  }`}
                >
                  <div className="flex items-center gap-4">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${colors.iconBg}`}>
                      {step.icon}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="text-xs font-mono font-bold text-slate-400">
                          0{index + 1}
                        </span>
                        <h3 className="text-base font-bold text-white tracking-tight">
                          {step.title}
                        </h3>
                      </div>
                      <p className="mt-0.5 text-xs sm:text-sm text-slate-400">
                        {step.brief}
                      </p>
                    </div>

                    <div className="shrink-0 text-slate-400">
                      <motion.svg
                        animate={{ rotate: isExpanded ? 180 : 0 }}
                        transition={{ duration: 0.2 }}
                        viewBox="0 0 24 24"
                        className="h-5 w-5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polyline points="6 9 12 15 18 9" />
                      </motion.svg>
                    </div>
                  </div>

                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.25, ease: 'easeOut' }}
                        className="overflow-hidden"
                      >
                        <div className="mt-4 pt-4 border-t border-white/[0.06] pl-14 text-sm leading-relaxed text-slate-300">
                          {step.detail}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </button>
              </motion.div>
            );
          })}
        </div>

        {/* Neural Architecture Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mt-16 glass-card p-6 sm:p-8"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Model Inventory & Lineage
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Pretrained weights hosted on Hugging Face & validated offline.
              </p>
            </div>
            <span className="hidden sm:inline-block rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold text-emerald-300">
              Zero Hardcoded Scores
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                model: 'EfficientNet-B7',
                role: 'Visual Deepfake',
                spec: 'DFDC Winner (Seferbekov)',
                badge: 'TorchScript',
                color: 'cyan',
              },
              {
                model: 'wav2vec2-small',
                role: 'Voice Biometrics',
                spec: 'NII Yamagishi Lab',
                badge: 'PyTorch / safetensors',
                color: 'emerald',
              },
              {
                model: 'CLIP ViT-L/14',
                role: 'AI-Image Synthesis',
                spec: 'UniversalFakeDetect',
                badge: 'Linear Probe',
                color: 'rose',
              },
              {
                model: 'Multimodal Fusion',
                role: 'Cross-Domain Verdict',
                spec: '0.6 Visual + 0.4 Audio',
                badge: 'Arithmetic Fusion',
                color: 'amber',
              },
            ].map((item) => (
              <motion.div
                key={item.model}
                whileHover={{ y: -4, scale: 1.02 }}
                className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 hover:border-white/15 transition-all"
              >
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  {item.role}
                </span>
                <p className="mt-1 text-sm font-bold text-white">{item.model}</p>
                <p className="mt-1 text-xs text-slate-400">{item.spec}</p>
                <div className="mt-3">
                  <span className="inline-block rounded-md border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-medium text-slate-300">
                    {item.badge}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
}
