import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const FEATURE_CARDS = [
  {
    eyebrow: 'Case Operations',
    title: 'Investigation workspace with persistent evidence flow',
    description: 'Move from single-file analysis to linked investigations, analyst assignment, custody visibility, and report-ready notes.',
    href: '/cases',
    accent: 'from-cyan-500/20 to-sky-500/5',
    border: 'border-cyan-500/20',
  },
  {
    eyebrow: 'Executive Reporting',
    title: 'Operational reporting for leadership and audit stakeholders',
    description: 'Generate time-windowed exports, summarize detector usage, and hand off concise evidence snapshots for reviews.',
    href: '/reports',
    accent: 'from-emerald-500/20 to-teal-500/5',
    border: 'border-emerald-500/20',
  },
  {
    eyebrow: 'Validation Lab',
    title: 'Benchmark performance and robustness before production trust',
    description: 'Review confusion matrices, sensitivity checks, and advanced research signals alongside normal analysis workflows.',
    href: '/evaluation',
    accent: 'from-violet-500/20 to-fuchsia-500/5',
    border: 'border-violet-500/20',
  },
  {
    eyebrow: 'SecOps Visibility',
    title: 'Telemetry, governance, and chain-of-custody awareness',
    description: 'Track system posture, surface detector readiness, and maintain defensible operational evidence trails.',
    href: '/dashboard',
    accent: 'from-amber-500/20 to-orange-500/5',
    border: 'border-amber-500/20',
  },
];

const READINESS_ITEMS = [
  { label: 'Real model outputs only', value: 'Verified', tone: 'text-emerald-300' },
  { label: 'Explainability workflow', value: 'Built-in', tone: 'text-cyan-300' },
  { label: 'Audit trail persistence', value: 'SQLite-backed', tone: 'text-violet-300' },
  { label: 'Export-ready reporting', value: 'JSON / CSV / PDF', tone: 'text-amber-300' },
];

export default function EnterpriseCommandCenter() {
  return (
    <section className="relative py-20 sm:py-24">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr]">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, ease: 'easeOut' }}
            className="glass-card overflow-hidden p-6 sm:p-8"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-cyan-300">
                Enterprise Workflow Layer
              </span>
              <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                Analyst-first UX
              </span>
            </div>

            <h2 className="mt-5 text-3xl font-black tracking-tight text-white sm:text-4xl">
              Advanced capabilities organized like a professional command center
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-400 sm:text-base">
              The platform already spans core detection, explainability, case management, reporting, and evaluation.
              This surface turns those capabilities into a clearer operations story with better navigation, stronger hierarchy,
              and faster decision support for analyst teams.
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {FEATURE_CARDS.map((item, index) => (
                <motion.div
                  key={item.title}
                  initial={{ opacity: 0, y: 10 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.35, delay: index * 0.04, ease: 'easeOut' }}
                  className={`group relative overflow-hidden rounded-3xl border ${item.border} bg-white/[0.03] p-5`}
                >
                  <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.accent} opacity-60 transition-opacity duration-300 group-hover:opacity-100`} />
                  <div className="relative">
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{item.eyebrow}</p>
                    <h3 className="mt-2 text-lg font-bold tracking-tight text-white">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{item.description}</p>
                    <Link
                      to={item.href}
                      className="mt-5 inline-flex items-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3.5 py-2 text-xs font-bold text-white transition-all hover:border-cyan-400/40 hover:text-cyan-200"
                    >
                      Open workspace
                      <span aria-hidden="true">↗</span>
                    </Link>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.45, delay: 0.08, ease: 'easeOut' }}
            className="space-y-6"
          >
            <div className="glass-card p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">Readiness Matrix</p>
                  <h3 className="mt-2 text-xl font-black tracking-tight text-white">Platform trust signals</h3>
                </div>
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
                  Operational
                </span>
              </div>

              <div className="mt-6 space-y-3">
                {READINESS_ITEMS.map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <span className="text-sm text-slate-300">{item.label}</span>
                    <span className={`text-xs font-black uppercase tracking-[0.18em] ${item.tone}`}>{item.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card overflow-hidden p-6 sm:p-7">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-violet-300">Workflow Spine</p>
                  <h3 className="mt-2 text-xl font-black tracking-tight text-white">Analyst journey</h3>
                </div>
                <span className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  4 phases
                </span>
              </div>

              <div className="mt-6 space-y-4">
                {[
                  ['Ingest', 'Upload media and run multimodal analysis with explainability artifacts.'],
                  ['Escalate', 'Link suspicious assets to cases and annotate evidence with analyst notes.'],
                  ['Validate', 'Review evaluation, robustness, and provenance-oriented research checks.'],
                  ['Report', 'Export executive-ready reports and maintain audit traceability.'],
                ].map(([title, text], index) => (
                  <div key={title} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-xs font-black text-cyan-300">
                        0{index + 1}
                      </span>
                      {index < 3 && <span className="mt-2 h-full w-px bg-gradient-to-b from-cyan-500/40 to-transparent" />}
                    </div>
                    <div className="pb-4">
                      <p className="text-sm font-bold text-white">{title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-slate-400">{text}</p>
                    </div>
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
