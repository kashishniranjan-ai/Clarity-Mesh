import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const HIGHLIGHTS = [
  {
    title: 'Operational command surface',
    text: 'Upgraded navigation, clearer hierarchy, and sharper analyst workflows for triage teams.',
  },
  {
    title: 'Advanced research hooks',
    text: 'Robustness stress tests, provenance readiness, and experimental physiologic checks now surface in-product.',
  },
  {
    title: 'Executive-ready outputs',
    text: 'Case flow, reporting, explainability, and evidence export stay connected from intake to review.',
  },
];

const STATS = [
  { value: '3', label: 'Core Modalities' },
  { value: '4+', label: 'Detection Layers' },
  { value: 'PDF/CSV/JSON', label: 'Export Paths' },
  { value: 'Audit-Ready', label: 'Evidence Flow' },
];

function AmbientGlowMesh() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Radiant Cyan Orb */}
      <motion.div
        animate={{
          scale: [1, 1.15, 1],
          x: [0, 25, 0],
          y: [0, -30, 0],
        }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
        className="absolute -top-24 left-1/4 h-[550px] w-[550px] rounded-full bg-gradient-to-br from-cyan-500/15 via-blue-600/10 to-transparent blur-[110px]"
      />

      {/* Emerald Atmospheric Glow */}
      <motion.div
        animate={{
          scale: [1, 1.2, 1],
          x: [0, -35, 0],
          y: [0, 25, 0],
        }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        className="absolute top-1/3 -right-20 h-[480px] w-[480px] rounded-full bg-gradient-to-bl from-teal-500/12 via-emerald-600/8 to-cyan-500/5 blur-[100px]"
      />

      {/* Gentle Obsidian Mirror Base */}
      <motion.div
        animate={{
          scale: [1.1, 0.95, 1.1],
          x: [0, 20, 0],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
        className="absolute -bottom-20 left-10 h-[400px] w-[400px] rounded-full bg-gradient-to-tr from-blue-700/10 via-cyan-500/8 to-transparent blur-[90px]"
      />
    </div>
  );
}

function AmbientLightCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let animationId;
    let particles = [];

    const resize = () => {
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    };

    const createParticles = () => {
      particles = [];
      const count = Math.min(32, Math.floor(canvas.offsetWidth / 40));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.offsetWidth,
          y: Math.random() * canvas.offsetHeight,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
          r: Math.random() * 1.8 + 0.6,
          alpha: Math.random() * 0.35 + 0.1,
          hue: Math.random() > 0.5 ? 185 : 210, // cyan or ice blue
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 130) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `hsla(${particles[i].hue}, 80%, 75%, ${0.04 * (1 - dist / 130)})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        }
      }

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.offsetWidth) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.offsetHeight) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${p.hue}, 80%, 70%, ${p.alpha})`;
        ctx.fill();
      }

      animationId = requestAnimationFrame(draw);
    };

    resize();
    createParticles();
    draw();

    const handleResize = () => {
      resize();
      createParticles();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    />
  );
}

export default function Hero() {
  return (
    <section className="relative overflow-hidden py-16 lg:py-24">
      <AmbientGlowMesh />
      <AmbientLightCanvas />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div>
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-4 py-1.5 text-xs font-bold text-cyan-200 backdrop-blur-md shadow-[0_0_15px_rgba(6,182,212,0.25)]"
            >
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              Multimodal Forensic Intelligence Platform
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
              className="mt-7 text-4xl font-black leading-[1.04] tracking-tight text-white sm:text-6xl lg:text-7xl"
            >
              Enterprise-grade media integrity workflows
              <span className="mt-2 block bg-gradient-to-r from-cyan-300 via-white to-teal-200 bg-clip-text text-transparent">
                with stronger visual clarity
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
              className="mt-6 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg"
            >
              Clarity Mesh combines real multimodal detection, explainability, case management, reporting, and advanced research signals inside a more polished analyst experience built for serious review workflows.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}
              className="mt-10 flex flex-col gap-4 sm:flex-row"
            >
              <motion.a
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                href="#analyze"
                className="btn-glossy-primary btn-shimmer relative rounded-2xl px-8 py-3.5 text-center text-sm font-extrabold text-white shadow-xl shadow-cyan-500/25 transition-all hover:shadow-cyan-500/40"
              >
                Launch Analysis Workspace
              </motion.a>
              <motion.a
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                href="/dashboard"
                className="btn-glossy-black rounded-2xl px-7 py-3.5 text-center text-sm font-bold text-slate-200 transition-all"
              >
                Open Command Center
              </motion.a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
              className="mt-10 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
            >
              {STATS.map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 backdrop-blur-xl">
                  <p className="text-lg font-black tracking-tight text-white sm:text-xl">{stat.value}</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{stat.label}</p>
                </div>
              ))}
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.5, ease: 'easeOut' }}
              className="mt-8 grid gap-4 sm:grid-cols-3"
            >
              {HIGHLIGHTS.map((item) => (
                <div key={item.title} className="rounded-3xl border border-white/[0.08] bg-white/[0.03] p-5">
                  <h3 className="text-sm font-bold tracking-tight text-white">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.text}</p>
                </div>
              ))}
            </motion.div>
          </div>

          <motion.div
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.7, delay: 0.25, ease: 'easeOut' }}
            className="glass-card overflow-hidden p-6 sm:p-7"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-300">Analyst Command Deck</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-white">Live-ready operational surface</h2>
              </div>
              <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                Workflow active
              </span>
            </div>

            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-3xl border border-cyan-500/20 bg-cyan-500/[0.05] p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-cyan-300">Core stack</p>
                <p className="mt-3 text-lg font-bold text-white">EfficientNet-B7 + wav2vec2 + CLIP + spectral forensics</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Combines neural inference with ELA, FFT, SRM, explainability, and reporting in one review loop.
                </p>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Decision lane</p>
                <div className="mt-3 space-y-3">
                  {[
                    ['Analyze', 'Multimodal detection'],
                    ['Investigate', 'Case linking + notes'],
                    ['Validate', 'Research and evaluation'],
                    ['Report', 'Export and share'],
                  ].map(([title, text], index) => (
                    <div key={title} className="flex items-center gap-3">
                      <span className="flex h-8 w-8 items-center justify-center rounded-2xl border border-white/10 bg-black/20 text-[11px] font-black text-white">
                        0{index + 1}
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-white">{title}</p>
                        <p className="text-xs text-slate-400">{text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-3xl border border-white/10 bg-black/20 p-5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Surface upgrades included</p>
                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-violet-300">New in UI</span>
              </div>
              <div className="mt-4 grid gap-3">
                {[
                  ['Operational dashboard intelligence', 'Time-range switching, triage alerts, and queue-focused recommendations.'],
                  ['Advanced analysis controls', 'Robustness, watermark readiness, attribution hooks, and experimental video signals.'],
                  ['More premium visual hierarchy', 'Sharper cards, cleaner density, stronger emphasis, and more executive-grade presentation.'],
                ].map(([title, text]) => (
                  <div key={title} className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-400">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
