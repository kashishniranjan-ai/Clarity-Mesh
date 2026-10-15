import Logo from './Logo';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-white/5 bg-[#060a14]">
      {/* Subtle top glow line */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-1/2 bg-gradient-to-r from-transparent via-cyan-500/30 to-transparent" />

      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-8 md:flex-row md:items-start md:justify-between">
          {/* Left — Brand */}
          <div className="space-y-3">
            <Logo />
            <p className="max-w-xs text-sm leading-relaxed text-slate-500">
              AI-Powered Multimodal Deepfake Detection — combining visual, audio, and AI-image analysis with transparent, explainable results.
            </p>
          </div>

          {/* Center — Tech stack badges */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Powered By</p>
            <div className="flex flex-wrap gap-2">
              {[
                'EfficientNet-B7',
                'wav2vec2',
                'CLIP ViT-L/14',
                'FastAPI',
                'React',
                'PyTorch',
              ].map((tech) => (
                <span
                  key={tech}
                  className="rounded-md border border-white/5 bg-white/[0.03] px-2.5 py-1 text-xs font-medium text-slate-400 transition-colors hover:border-cyan-500/20 hover:text-cyan-300"
                >
                  {tech}
                </span>
              ))}
            </div>
          </div>

          {/* Right — Info */}
          <div className="space-y-2 text-sm md:text-right">
            <p className="text-slate-400">
              Final-year project &middot; &copy; {year} Clarity Mesh
            </p>
            <p className="text-xs leading-relaxed text-slate-600">
              Detection results are probabilistic estimates (uncalibrated model outputs), not proof of authenticity. Treat all scores as signals, never as forensic evidence.
            </p>
          </div>
        </div>

        {/* Bottom border line */}
        <div className="mt-8 border-t border-white/5 pt-6 text-center text-xs text-slate-600">
          Built with React + Vite + TailwindCSS + FastAPI + PyTorch
        </div>
      </div>
    </footer>
  );
}
