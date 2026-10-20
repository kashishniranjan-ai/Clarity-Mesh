import { motion } from 'framer-motion';
import Logo from './Logo';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative border-t border-white/[0.08] bg-canvas-bg py-14">
      {/* Subtle top ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 h-px w-2/3 bg-gradient-to-r from-transparent via-cyan-500/35 to-transparent" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          {/* Brand */}
          <div className="space-y-3 max-w-sm">
            <Logo />
            <p className="text-xs leading-relaxed text-slate-400">
              Next-generation multimodal deepfake detection engine combining facial video artifacts, acoustic biometrics, and generative synthesis heuristics into a unified intelligence platform.
            </p>
          </div>

          {/* Model Backbones */}
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Model Backbones</p>
            <div className="flex flex-wrap gap-2 max-w-md">
              {[
                'EfficientNet-B7 DFDC',
                'wav2vec2 Acoustic',
                'CLIP ViT-L/14',
                '2D FFT Lattice',
                'ELA Spectrum',
                'SRM Sensor Noise',
              ].map((tech) => (
                <span
                  key={tech}
                  className="rounded-lg border border-white/[0.08] bg-white/[0.02] px-2.5 py-1 text-xs font-medium text-slate-300"
                >
                  {tech}
                </span>
              ))}
            </div>
          </div>

          {/* Copyright & Disclaimer */}
          <div className="space-y-2 text-xs md:text-right max-w-xs">
            <p className="text-slate-300 font-medium">
              &copy; {year} Clarity Mesh &middot; Workstation Edition
            </p>
            <p className="text-[11px] leading-relaxed text-slate-500">
              Detection verdicts are probabilistic model outputs intended as decision-support signals. Treat results with scientific rigor and human verification.
            </p>
          </div>
        </div>

        <div className="mt-12 border-t border-white/[0.06] pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <p>Hand-crafted with React 19, Vite, Tailwind CSS & Framer Motion</p>
          <div className="flex items-center gap-4">
            <a href="/#analyze" className="hover:text-cyan-300 transition-colors">Analyze</a>
            <a href="/dashboard" className="hover:text-cyan-300 transition-colors">Dashboard</a>
            <a href="/cases" className="hover:text-cyan-300 transition-colors">Cases</a>
            <a href="/assistant" className="hover:text-cyan-300 transition-colors">AI Analyst</a>
          </div>
        </div>
      </div>
    </footer>
  );
}
