import { useEffect, useRef } from 'react';

/* ── Feature highlight cards ─────────────────────────────────── */
const HIGHLIGHTS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </svg>
    ),
    title: 'Images & Videos',
    text: 'Analyze photos, video clips, and audio files in one unified platform.',
    color: 'cyan',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
      </svg>
    ),
    title: 'Multimodal AI',
    text: 'Three independent detectors fused into a single transparent verdict.',
    color: 'blue',
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9M12 4h9M4 8l4-4 4 4M4 16l4 4 4-4" />
      </svg>
    ),
    title: 'Explainable Results',
    text: 'Every score comes with model details, thresholds, and honest failure states.',
    color: 'purple',
  },
];

/* ── Stats counters ──────────────────────────────────────────── */
const STATS = [
  { value: '4', label: 'AI Models' },
  { value: '3', label: 'Modalities' },
  { value: '50MB', label: 'Max Upload' },
  { value: '100%', label: 'Transparent' },
];

const COLOR_MAP = {
  cyan: 'from-cyan-500/20 to-cyan-600/5 border-cyan-500/15 text-cyan-400',
  blue: 'from-blue-500/20 to-blue-600/5 border-blue-500/15 text-blue-400',
  purple: 'from-purple-500/20 to-purple-600/5 border-purple-500/15 text-purple-400',
};

/* ── Animated background orbs (pure CSS) ─────────────────────── */
function BackgroundOrbs() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {/* Large gradient orb — top right */}
      <div className="absolute -top-32 -right-32 h-[500px] w-[500px] rounded-full bg-gradient-to-br from-cyan-600/8 to-blue-700/5 blur-3xl animate-float" />
      {/* Small orb — left */}
      <div className="absolute top-1/3 -left-20 h-[300px] w-[300px] rounded-full bg-gradient-to-tr from-purple-600/6 to-cyan-600/3 blur-3xl animate-float delay-300" />
      {/* Bottom orb */}
      <div className="absolute -bottom-20 right-1/4 h-[350px] w-[350px] rounded-full bg-gradient-to-tl from-blue-600/6 to-emerald-600/3 blur-3xl animate-float delay-600" />
      {/* Grid overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.4) 1px, transparent 1px)',
          backgroundSize: '60px 60px',
        }}
      />
    </div>
  );
}

/* ── Animated particle dots ──────────────────────────────────── */
function ParticleDots() {
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
      const count = Math.min(40, Math.floor(canvas.offsetWidth / 25));
      for (let i = 0; i < count; i++) {
        particles.push({
          x: Math.random() * canvas.offsetWidth,
          y: Math.random() * canvas.offsetHeight,
          vx: (Math.random() - 0.5) * 0.3,
          vy: (Math.random() - 0.5) * 0.3,
          r: Math.random() * 1.5 + 0.5,
          alpha: Math.random() * 0.4 + 0.1,
        });
      }
    };

    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight);

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.strokeStyle = `rgba(34, 211, 238, ${0.06 * (1 - dist / 120)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas.offsetWidth) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.offsetHeight) p.vy *= -1;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(34, 211, 238, ${p.alpha})`;
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

    return () => {
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
    <section className="relative min-h-[85vh] flex items-center overflow-hidden bg-[#060a14]">
      <BackgroundOrbs />
      <ParticleDots />

      <div className="relative mx-auto max-w-7xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8 lg:py-32">
        <div className="mx-auto max-w-3xl text-center">
          {/* Badge */}
          <div className="animate-fade-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/5 px-4 py-1.5 text-xs font-semibold text-cyan-300 backdrop-blur-sm">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-400" />
              </span>
              AI-Powered Multimodal Deepfake Detection
            </span>
          </div>

          {/* Headline */}
          <h1 className="mt-8 text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl animate-slide-up">
            <span className="text-white">Detect Deepfakes</span>
            <br />
            <span className="text-gradient-cyber">with Precision AI</span>
          </h1>

          {/* Subheadline */}
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg animate-slide-up delay-100">
            Clarity Mesh combines <strong className="text-slate-300">EfficientNet-B7 visual analysis</strong>,{' '}
            <strong className="text-slate-300">wav2vec2 audio detection</strong>, and{' '}
            <strong className="text-slate-300">CLIP-based AI-image scanning</strong>{' '}
            into a single, transparent multimodal verdict.
          </p>

          {/* CTA Buttons */}
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row animate-slide-up delay-200">
            <a
              href="#upload"
              className="btn-shimmer relative w-full rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-cyan-500/20 transition-all duration-300 hover:shadow-cyan-500/30 hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-[#060a14] sm:w-auto"
            >
              Upload & Analyze
            </a>
            <a
              href="#how-it-works"
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] px-8 py-3.5 text-sm font-semibold text-slate-300 backdrop-blur-sm transition-all duration-300 hover:border-cyan-500/30 hover:bg-cyan-500/5 hover:text-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 sm:w-auto"
            >
              See How It Works
            </a>
          </div>

          {/* Stats bar */}
          <div className="mt-14 animate-slide-up delay-300">
            <div className="mx-auto flex max-w-lg flex-wrap items-center justify-center gap-6 sm:gap-10">
              {STATS.map((stat, i) => (
                <div key={stat.label} className={`text-center animate-count-up delay-${(i + 3) * 100}`}>
                  <p className="text-2xl font-extrabold text-white sm:text-3xl">{stat.value}</p>
                  <p className="mt-1 text-xs font-medium uppercase tracking-wider text-slate-500">{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Feature cards */}
        <ul className="mx-auto mt-16 grid max-w-4xl gap-4 sm:grid-cols-3 animate-slide-up delay-400">
          {HIGHLIGHTS.map((item) => (
            <li
              key={item.title}
              className={`group glass-card rounded-xl border bg-gradient-to-br p-5 text-left transition-all duration-300 hover:scale-[1.02] hover:glow-cyan ${COLOR_MAP[item.color]}`}
            >
              <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 ${item.color === 'cyan' ? 'text-cyan-400' : item.color === 'blue' ? 'text-blue-400' : 'text-purple-400'}`}>
                {item.icon}
              </span>
              <p className="mt-3 text-sm font-semibold text-white">{item.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
