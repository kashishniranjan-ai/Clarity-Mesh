import { useState } from 'react';

/* ── Pipeline steps with detailed descriptions ─────────────── */
const STEPS = [
  {
    title: 'Upload Media',
    brief: 'Choose an image, video, or audio file.',
    detail: 'Supported formats include JPG, PNG, MP4, MOV, AVI, MKV, WEBM, MP3, WAV, FLAC and M4A. Files up to 50 MB are accepted. The backend validates MIME type, file size and integrity before processing.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
        <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
      </svg>
    ),
    color: 'cyan',
  },
  {
    title: 'Frame Extraction',
    brief: 'OpenCV decodes media and samples up to 16 frames.',
    detail: 'Images are decoded directly. Videos are sampled at evenly-spaced intervals (≤16 frames). The backend uses OpenCV for reliable, format-agnostic decoding across JPEG, PNG, MP4, MKV and more.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="2" />
        <path d="M2 12h20M12 2v20" />
      </svg>
    ),
    color: 'blue',
  },
  {
    title: 'Face Detection',
    brief: 'Haar cascade detects faces with padded crops.',
    detail: 'Each sampled frame is scanned with OpenCV\'s Haar cascade classifier. Detected faces are cropped with padding to preserve context. Up to 12 face crops are scored per analysis.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21v-1a6 6 0 0112 0v1" />
      </svg>
    ),
    color: 'purple',
  },
  {
    title: 'Visual Analysis',
    brief: 'EfficientNet-B7 scores each face crop.',
    detail: 'The pretrained EfficientNet-B7 binary classifier (Selim Seferbekov\'s 1st-place DFDC solution, exported as TorchScript) produces an uncalibrated sigmoid score per face crop. Higher = more likely fake. Threshold: 0.7.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l7 2.6v5.4c0 4.2-2.9 7.6-7 8.6-4.1-1-7-4.4-7-8.6V5.6L12 3z" />
      </svg>
    ),
    color: 'cyan',
  },
  {
    title: 'Audio Analysis',
    brief: 'wav2vec2 detects synthetic speech.',
    detail: 'FFmpeg extracts the audio track to 16 kHz WAV. The NII Yamagishi Lab\'s wav2vec-small-anti-deepfake model processes 10-second chunks (2-second overlap) and outputs a REAL-class softmax score. Higher = more likely genuine. Threshold: 0.5.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1v22M8 5v14M4 9v6M16 5v14M20 9v6" />
      </svg>
    ),
    color: 'emerald',
  },
  {
    title: 'AI-Image Detection',
    brief: 'CLIP ViT-L/14 scans the whole image.',
    detail: 'UniversalFakeDetect (CLIP ViT-L/14 backbone + published 768→1 linear probe) analyzes the full still image without face detection. Higher score = more likely AI-generated. Independent of the face-manipulation detector — scores are never combined.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      </svg>
    ),
    color: 'purple',
  },
  {
    title: 'Multimodal Fusion',
    brief: 'Visual + audio scores are fused transparently.',
    detail: 'When BOTH visual and audio detectors produce genuine scores, a weighted arithmetic fusion combines them: fused = 0.6 × visual_fake + 0.4 × audio_fake. Threshold: 0.5. Missing modalities are NEVER replaced by invented values.',
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5" />
        <path d="M12 22V15.5M22 8.5L12 15.5 2 8.5" />
      </svg>
    ),
    color: 'blue',
  },
];

const COLOR_MAP = {
  cyan: {
    iconBg: 'bg-cyan-500/10 text-cyan-400',
    ring: 'ring-cyan-500/25',
    activeBg: 'bg-cyan-500/5 border-cyan-500/20',
    dot: 'bg-cyan-400',
    line: 'from-cyan-500/30',
  },
  blue: {
    iconBg: 'bg-blue-500/10 text-blue-400',
    ring: 'ring-blue-500/25',
    activeBg: 'bg-blue-500/5 border-blue-500/20',
    dot: 'bg-blue-400',
    line: 'from-blue-500/30',
  },
  emerald: {
    iconBg: 'bg-emerald-500/10 text-emerald-400',
    ring: 'ring-emerald-500/25',
    activeBg: 'bg-emerald-500/5 border-emerald-500/20',
    dot: 'bg-emerald-400',
    line: 'from-emerald-500/30',
  },
  purple: {
    iconBg: 'bg-purple-500/10 text-purple-400',
    ring: 'ring-purple-500/25',
    activeBg: 'bg-purple-500/5 border-purple-500/20',
    dot: 'bg-purple-400',
    line: 'from-purple-500/30',
  },
};

export default function HowItWorks() {
  const [expanded, setExpanded] = useState(null);

  return (
    <section id="how-it-works" className="relative py-20 sm:py-28">
      {/* Subtle top border glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-2/3 bg-gradient-to-r from-transparent via-cyan-500/20 to-transparent" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center animate-fade-in">
          <h2 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl">
            How It Works
          </h2>
          <p className="mt-3 text-slate-400">
            Clarity Mesh follows a transparent, step-by-step pipeline from upload to explained result.
          </p>
        </div>

        {/* Pipeline visualization */}
        <ol className="mt-16 relative">
          {/* Vertical connector line */}
          <div className="absolute left-6 top-0 bottom-0 w-px bg-gradient-to-b from-cyan-500/20 via-blue-500/10 to-transparent hidden sm:block" />

          <div className="space-y-4">
            {STEPS.map((step, index) => {
              const colors = COLOR_MAP[step.color];
              const isExpanded = expanded === index;

              return (
                <li key={step.title} className="animate-slide-up" style={{ animationDelay: `${index * 80}ms` }}>
                  <button
                    type="button"
                    onClick={() => setExpanded(isExpanded ? null : index)}
                    className={`w-full text-left group relative flex items-start gap-4 rounded-xl border p-5 transition-all duration-300 sm:pl-16 ${
                      isExpanded
                        ? `glass-card-bright ${colors.activeBg}`
                        : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.03]'
                    }`}
                  >
                    {/* Step number + icon */}
                    <span className={`absolute left-4 top-5 hidden sm:flex h-8 w-8 items-center justify-center rounded-lg ${colors.iconBg} ring-1 ${colors.ring} transition-all duration-300 ${isExpanded ? 'scale-110' : 'group-hover:scale-105'}`}>
                      {step.icon}
                    </span>

                    {/* Visible on mobile */}
                    <span className={`flex sm:hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg ${colors.iconBg} ring-1 ${colors.ring}`}>
                      {step.icon}
                    </span>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${colors.iconBg}`}>
                          {index + 1}
                        </span>
                        <h3 className="font-bold text-slate-200 group-hover:text-white transition-colors">{step.title}</h3>
                        <svg
                          viewBox="0 0 24 24"
                          className={`ml-auto h-4 w-4 text-slate-600 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">{step.brief}</p>

                      {/* Expanded detail */}
                      {isExpanded && (
                        <div className="mt-4 animate-fade-in">
                          <p className="text-sm leading-relaxed text-slate-400">{step.detail}</p>
                        </div>
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </div>
        </ol>

        {/* Architecture summary */}
        <div className="mt-16 glass-card p-6 sm:p-8 animate-fade-in">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4">System Architecture</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { model: 'EfficientNet-B7', role: 'Face Manipulation', origin: 'DFDC 1st Place (Seferbekov)', type: 'TorchScript' },
              { model: 'wav2vec2', role: 'Audio Deepfake', origin: 'NII Yamagishi Lab', type: 'PyTorch' },
              { model: 'CLIP ViT-L/14', role: 'AI-Image Detection', origin: 'UniversalFakeDetect', type: 'PyTorch' },
              { model: 'Weighted Fusion', role: 'Multimodal Combination', origin: '0.6V + 0.4A formula', type: 'Post-processing' },
            ].map((item) => (
              <div
                key={item.model}
                className="rounded-lg border border-white/5 bg-white/[0.02] p-4 transition-all duration-300 hover:border-cyan-500/15 hover:bg-cyan-500/[0.02]"
              >
                <p className="text-sm font-bold text-slate-200">{item.model}</p>
                <p className="mt-1 text-xs text-cyan-400">{item.role}</p>
                <p className="mt-2 text-xs text-slate-600">{item.origin}</p>
                <span className="mt-2 inline-block rounded-md border border-white/5 bg-white/[0.03] px-2 py-0.5 text-[10px] font-medium text-slate-500">
                  {item.type}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
