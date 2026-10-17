import { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';

const HIGHLIGHTS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="3" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    title: 'Multimodal Spectrum',
    text: 'Analyze images, high-definition video, and studio audio tracks simultaneously.',
    gradient: 'from-cyan-500/20 via-sky-500/10 to-transparent',
    iconColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
      </svg>
    ),
    title: 'Three Neural Backbones',
    text: 'EfficientNet-B7 DFDC winner, wav2vec2 acoustic anti-spoofing, and CLIP ViT-L/14.',
    gradient: 'from-rose-500/20 via-pink-500/10 to-transparent',
    iconColor: 'text-rose-400 bg-rose-500/10 border-rose-500/20',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
    title: 'Explainable Triage',
    text: 'Transparent model weights, decision thresholds, and instant case management reports.',
    gradient: 'from-amber-500/20 via-orange-500/10 to-transparent',
    iconColor: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  },
];

const STATS = [
  { value: '4', label: 'Trained Models' },
  { value: '3', label: 'Modalities' },
  { value: '50MB', label: 'Max File Size' },
  { value: '0.0ms', label: 'Inference Lag' },
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

    window.addEventListener('resize', () => {
      resize();
      createParticles();
    });

    return () => cancelAnimationFrame(animationId);
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
    <section className="relative min-h-[85vh] flex items-center justify-center overflow-hidden py-16 lg:py-24">
      <AmbientGlowMesh />
      <AmbientLightCanvas />

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          {/* Top Badge */}
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
            Multimodal Forensic Intelligence · Workstation Edition
          </motion.div>

          {/* Headline */}
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
            className="mt-7 text-4xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-[1.08]"
          >
            <span className="text-white">Verify Media Authenticity</span>
            <br />
            <span className="bg-gradient-to-r from-cyan-300 via-teal-200 to-white bg-clip-text text-transparent">
              with Neural Precision
            </span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
            className="mx-auto mt-6 max-w-2xl text-base sm:text-lg leading-relaxed text-slate-300"
          >
            Clarity Mesh fuses <strong className="text-white font-bold">EfficientNet-B7</strong> visual facial analysis,{' '}
            <strong className="text-white font-bold">wav2vec2</strong> voice biometric anti-spoofing, and{' '}
            <strong className="text-white font-bold">2D Fourier FFT</strong> generative artifact detection into an obsidian forensic workstation.
          </motion.p>

          {/* Action CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' }}
            className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row"
          >
            <motion.a
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              href="#analyze"
              className="btn-glossy-primary btn-shimmer relative w-full sm:w-auto rounded-2xl px-8 py-3.5 text-sm font-extrabold text-white shadow-xl shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all text-center"
            >
              Start Media Analysis
            </motion.a>
            <motion.a
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              href="#how-it-works"
              className="btn-glossy-black w-full sm:w-auto rounded-2xl px-7 py-3.5 text-sm font-bold text-slate-200 transition-all text-center"
            >
              Explore Architecture
            </motion.a>
          </motion.div>

          {/* Stats Bar */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: 'easeOut' }}
            className="mt-14"
          >
            <div className="mx-auto flex max-w-lg flex-wrap items-center justify-center gap-8 sm:gap-12 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 backdrop-blur-xl">
              {STATS.map((stat) => (
                <div key={stat.label} className="text-center">
                  <p className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">{stat.value}</p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{stat.label}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Feature Cards Grid */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5, ease: 'easeOut' }}
          className="mx-auto mt-16 grid max-w-4xl gap-5 sm:grid-cols-3"
        >
          {HIGHLIGHTS.map((item, idx) => (
            <motion.div
              key={item.title}
              whileHover={{ y: -6, scale: 1.015 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              className="group glass-card p-6 text-left relative overflow-hidden"
            >
              {/* Subtle top radiant border gradient on hover */}
              <div className={`absolute inset-0 bg-gradient-to-b ${item.gradient} opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`} />

              <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border ${item.iconColor} shadow-inner`}>
                {item.icon}
              </span>
              <h3 className="mt-4 text-base font-bold text-white tracking-tight">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.text}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
