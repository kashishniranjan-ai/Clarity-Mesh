import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getInsights } from '../services/api';

const number = (value) => Number.isFinite(value) ? value.toLocaleString() : '—';
const percent = (value) => Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—';

function Panel({ children, className = '' }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className={`glass-card ${className}`}
    >
      {children}
    </motion.section>
  );
}

function ActivityChart({ values = [] }) {
  const max = Math.max(1, ...values.map((item) => item.count));
  return (
    <div className="flex h-52 items-end gap-3 pt-6" role="img" aria-label="Analysis activity over the last seven days">
      {values.map((item) => (
        <div key={item.date} className="group flex h-full flex-1 flex-col items-center justify-end gap-2">
          <span className="font-mono text-[10px] text-slate-400 opacity-0 transition group-hover:opacity-100">
            {item.count}
          </span>
          <div className="relative flex w-full flex-1 items-end rounded-xl bg-white/[0.03] overflow-hidden">
            <motion.div
              initial={{ height: 0 }}
              animate={{ height: `${Math.max(item.count ? 10 : 3, (item.count / max) * 100)}%` }}
              transition={{ duration: 0.8, delay: 0.1, ease: 'easeOut' }}
              className="w-full rounded-xl bg-gradient-to-t from-cyan-500 via-sky-400 to-emerald-400 shadow-[0_0_20px_rgba(6,182,212,0.3)]"
            />
          </div>
          <span className="text-[11px] font-medium text-slate-400">
            {new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
          </span>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, detail, color = 'text-white', icon }) {
  return (
    <Panel className="p-6 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500/30">
      <div className="flex items-start justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <span className="text-cyan-400 text-lg">{icon}</span>
      </div>
      <p className={`mt-4 font-mono text-3xl font-extrabold tracking-tight ${color}`}>{value}</p>
      <p className="mt-1.5 text-xs text-slate-400">{detail}</p>
    </Panel>
  );
}

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getInsights());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const verdicts = data?.verdicts || {};
  const totalVerdicts = (verdicts.flagged || 0) + (verdicts.likely_authentic || 0) + (verdicts.inconclusive || 0);
  const split = [
    { label: 'Flagged Synthetic', count: verdicts.flagged || 0, color: 'bg-rose-400' },
    { label: 'Likely Authentic', count: verdicts.likely_authentic || 0, color: 'bg-emerald-400' },
    { label: 'Inconclusive / No Face', count: verdicts.inconclusive || 0, color: 'bg-amber-300' },
  ];

  return (
    <main className="mx-auto min-h-[75vh] max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            Intelligence Telemetry
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Signal Overview
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
            Holistic telemetry across local investigations, multimodal verdicts, and detector accuracy.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={refresh}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] transition-all"
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Sync Metrics'}
          </motion.button>
          <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
            <Link
              to="/#analyze"
              className="btn-shimmer rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-5 py-2.5 text-xs font-bold text-black shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all inline-block"
            >
              New Analysis ↗
            </Link>
          </motion.div>
        </div>
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs sm:text-sm text-amber-200">
          {error}
        </div>
      )}

      {/* Metrics Row */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Media Ingested" value={number(data?.records_analyzed)} detail="Local audit history" icon="📁" />
        <StatCard label="Scored Samples" value={number(data?.scored_records)} detail="Completed neural inference" icon="🧠" />
        <StatCard label="Mean Fake Score" value={percent(data?.mean_fake_score)} detail="Uncalibrated probability" color="text-cyan-300" icon="⚡" />
        <StatCard label="Flagged Rate" value={percent(data?.flagged_rate)} detail={`${number(verdicts.flagged)} synthetic instances`} color="text-rose-400" icon="⚠️" />
      </div>

      {/* Graphs & Outcomes */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="p-6 sm:p-7">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Temporal Activity</h2>
              <p className="mt-0.5 text-xs text-slate-400">Analysis distribution over last 7 days</p>
            </div>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-cyan-300">
              Live Feed
            </span>
          </div>
          <ActivityChart values={data?.daily_activity || []} />
        </Panel>

        <Panel className="p-6 sm:p-7">
          <h2 className="text-base font-bold text-white tracking-tight">Verdict Composition</h2>
          <p className="mt-0.5 text-xs text-slate-400">Categorized by detector classification</p>

          <div className="mt-6 space-y-4">
            {split.map((item) => (
              <div key={item.label}>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="font-medium text-slate-300">{item.label}</span>
                  <span className="font-mono text-slate-400">
                    {number(item.count)}{' '}
                    <span className="text-slate-500">{totalVerdicts ? `(${Math.round((item.count / totalVerdicts) * 100)}%)` : ''}</span>
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${totalVerdicts ? (item.count / totalVerdicts) * 100 : 0}%` }}
                    transition={{ duration: 0.8, ease: 'easeOut' }}
                    className={`h-full rounded-full ${item.color}`}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-5">
            {Object.entries(data?.completed_detectors || {}).map(([name, count]) => (
              <div key={name}>
                <p className="font-mono text-base font-bold text-white">{number(count)}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">{name.replace('_', ' ')} runs</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {/* Module Jump Cards */}
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Link to="/assistant" className="rounded-2xl border border-cyan-500/30 bg-cyan-950/20 p-5 hover:border-cyan-500/50 hover:bg-cyan-950/40 transition-all shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">AI Assistant</p>
          <h3 className="mt-2 text-sm font-bold text-white">Interactive Research Analyst</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Query audit telemetry via read-only tools.</p>
        </Link>
        <Link to="/cases" className="rounded-2xl border border-sky-500/30 bg-sky-950/20 p-5 hover:border-sky-500/50 hover:bg-sky-950/40 transition-all shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-sky-400">Investigation Hub</p>
          <h3 className="mt-2 text-sm font-bold text-white">Case Evidence Workbench</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Organize analyses into persistent cases.</p>
        </Link>
        <Link to="/reports" className="rounded-2xl border border-emerald-500/30 bg-emerald-950/20 p-5 hover:border-emerald-500/50 hover:bg-emerald-950/40 transition-all shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">Reporting Studio</p>
          <h3 className="mt-2 text-sm font-bold text-white">Generate Executive Reports</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Export 7/30/90-day forensic summaries.</p>
        </Link>
        <Link to="/evaluation" className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.04] p-5 hover:border-amber-500/40 hover:bg-amber-500/[0.07] transition-all">
          <p className="text-[10px] font-bold uppercase tracking-widest text-amber-300">Evaluation Lab</p>
          <h3 className="mt-2 text-sm font-bold text-white">Benchmark Confusion Matrices</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-400">Validate model accuracy against ground truth.</p>
        </Link>
      </div>

      <p className="mt-8 text-center text-xs text-slate-400">
        {data?.methodology || 'Metrics reflect local SQLite audit telemetry. Detector predictions are probabilistic estimates.'}
      </p>
    </main>
  );
}
