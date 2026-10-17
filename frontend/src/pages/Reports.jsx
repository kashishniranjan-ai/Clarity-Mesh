import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getInsights } from '../services/api';

const fmt = (value) => (Number.isFinite(value) ? value.toLocaleString() : '—');
const pct = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—');

function Trend({ values = [] }) {
  const max = Math.max(1, ...values.map((item) => item.count));
  const width = 760;
  const height = 180;
  const inset = 18;

  const points = values.map((item, index) => {
    const x = inset + (values.length <= 1 ? width / 2 : (index * (width - inset * 2)) / (values.length - 1));
    const y = height - inset - (item.count / max) * (height - inset * 2);
    return [x, y];
  });

  const d = points.map(([x, y], index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
  const area = points.length ? `${d} L ${points.at(-1)[0]} ${height - inset} L ${points[0][0]} ${height - inset} Z` : '';

  return (
    <div className="mt-6 overflow-hidden">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full overflow-visible" role="img" aria-label="Analysis activity trend">
        <defs>
          <linearGradient id="trendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#EC4899" stopOpacity="0.0" />
          </linearGradient>
        </defs>

        {[0.25, 0.5, 0.75].map((value) => (
          <line
            key={value}
            x1="0"
            x2={width}
            y1={height * value}
            y2={height * value}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="4 6"
          />
        ))}

        {area && <path d={area} fill="url(#trendGradient)" />}

        <motion.path
          d={d}
          fill="none"
          stroke="#A78BFA"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1, ease: 'easeOut' }}
        />

        {points.map(([x, y], index) => (
          <g key={index}>
            <circle cx={x} cy={y} r="4.5" fill="#0E121E" stroke="#C4B5FD" strokeWidth="2.5" />
            <title>{`${values[index].date}: ${values[index].count} analyses`}</title>
          </g>
        ))}
      </svg>

      <div className="flex justify-between text-[11px] font-medium text-slate-400 mt-2">
        {values
          .filter((_, index) => index === 0 || index === values.length - 1 || index % Math.ceil(values.length / 6) === 0)
          .map((item) => (
            <span key={item.date}>
              {new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </span>
          ))}
      </div>
    </div>
  );
}

export default function Reports() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    getInsights(days)
      .then((payload) => {
        if (current) {
          setData(payload);
          setError('');
        }
      })
      .catch((err) => {
        if (current) setError(err.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [days]);

  const exportReport = () => {
    if (!data) return;
    const payload = {
      report: 'Clarity Mesh investigation activity',
      generated_at: new Date().toISOString(),
      period_days: days,
      data,
      interpretation: 'Scores are uncalibrated detector outputs. This aggregate report is not proof of media authenticity.',
    };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    link.download = `clarity-mesh-activity-${days}d-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const csv = () => {
    if (!data) return;
    const rows = [['date', 'analyses'], ...(data.daily_activity || []).map((item) => [item.date, item.count])];
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([rows.map((row) => row.join(',')).join('\r\n')], { type: 'text/csv' }));
    link.download = `clarity-mesh-activity-${days}d.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main className="report-page mx-auto min-h-[78vh] max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <div className="mb-2 text-xs">
            <Link to="/dashboard" className="text-slate-400 hover:text-white transition-colors">
              Workspace
            </Link>
            <span className="mx-2 text-slate-600">/</span>
            <span className="text-cyan-400 font-medium">Reporting Studio</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Activity & Forensic Reports
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Export comprehensive activity summaries and audit trails without exposing raw media.
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={csv}
            disabled={!data}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] disabled:opacity-40"
          >
            Export Activity CSV
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={exportReport}
            disabled={!data}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] disabled:opacity-40"
          >
            Download JSON
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => window.print()}
            disabled={!data}
            className="btn-shimmer rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-5 py-2.5 text-xs font-bold text-black shadow-lg shadow-cyan-500/25 disabled:opacity-40"
          >
            Print / Save PDF
          </motion.button>
        </div>
      </div>

      {/* Report Sheet */}
      <section className="report-sheet mt-8 glass-card p-6 sm:p-10">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.06] pb-6">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
              Clarity Mesh · Executive Dossier
            </span>
            <h2 className="mt-2 text-2xl font-bold text-white">Investigation Activity Report</h2>
            <p className="mt-1 text-xs text-slate-400">
              Generated {new Date().toLocaleString()} · Reflects local audit history
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Period:</span>
            <select
              value={days}
              onChange={(event) => setDays(Number(event.target.value))}
              className="rounded-xl border border-white/10 bg-[#0E121E] px-3.5 py-2 text-xs text-white outline-none"
            >
              <option value={7}>Last 7 Days</option>
              <option value={30}>Last 30 Days</option>
              <option value={90}>Last 90 Days</option>
            </select>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-xs text-amber-200">
            {error}
          </p>
        )}

        {/* Metric Cards */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ['Total Ingested', fmt(data?.records_analyzed), 'Audit records in scope'],
            ['Flagged Manipulations', fmt(data?.verdicts?.flagged), 'Detected synthetic signatures'],
            ['Mean Risk Score', pct(data?.mean_fake_score), 'Uncalibrated detector mean'],
            [
              'Scored Coverage',
              data?.records_analyzed ? `${Math.round((data.scored_records / data.records_analyzed) * 100)}%` : '—',
              `${fmt(data?.scored_records)} records completed`,
            ],
          ].map(([label, value, detail], index) => (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              key={label}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
            >
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
              <p className="mt-3 font-mono text-2xl sm:text-3xl font-extrabold text-white">{value}</p>
              <p className="mt-1 text-xs text-slate-400">{detail}</p>
            </motion.div>
          ))}
        </div>

        {/* Volume Trend Area Chart */}
        <div className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-bold text-white">Daily Volume Trend</h3>
              <p className="mt-0.5 text-xs text-slate-400">Media analyses over {days} days</p>
            </div>
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold text-cyan-300">
              {loading ? 'Refreshing' : 'Live Data'}
            </span>
          </div>
          {loading ? (
            <div className="h-56 animate-pulse rounded-2xl bg-white/[0.02] mt-4" />
          ) : (
            <Trend values={data?.daily_activity || []} />
          )}
        </div>

        {/* Outcome Breakdown & Detectors */}
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <h3 className="text-base font-bold text-white">Recorded Outcomes</h3>
            <div className="mt-5 space-y-4">
              {[
                ['Flagged Synthetic', data?.verdicts?.flagged, 'bg-rose-400'],
                ['Likely Authentic', data?.verdicts?.likely_authentic, 'bg-emerald-400'],
                ['Inconclusive', data?.verdicts?.inconclusive, 'bg-amber-300'],
              ].map(([label, count, color]) => {
                const total = data?.records_analyzed || 0;
                const ratio = total ? count / total : 0;
                return (
                  <div key={label}>
                    <div className="mb-1.5 flex justify-between text-xs">
                      <span className="font-medium text-slate-300">{label}</span>
                      <span className="font-mono text-slate-400">
                        {fmt(count)} &bull; {pct(ratio)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${ratio * 100}%` }}
                        transition={{ duration: 0.7 }}
                        className={`h-full rounded-full ${color}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-6">
            <h3 className="text-base font-bold text-white">Detector Breakdown</h3>
            <p className="mt-0.5 text-xs text-slate-400">Inference runs logged in this reporting window</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              {Object.entries(data?.completed_detectors || {}).map(([name, count]) => (
                <div key={name} className="rounded-xl border border-white/[0.05] bg-white/[0.015] p-3.5">
                  <p className="font-mono text-xl font-bold text-cyan-400">{fmt(count)}</p>
                  <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {name.replace('_', ' ')}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-xs text-amber-200/90 leading-relaxed">
          <p className="font-bold text-amber-100 mb-1">Scientific Notice</p>
          Metrics are generated from local detector scores. These values are mathematical indicators and do not provide legal or forensic proof of manipulation or authenticity.
        </div>
      </section>
    </main>
  );
}
