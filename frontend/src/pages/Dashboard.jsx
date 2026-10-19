import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getInsights } from '../services/api';

const HORIZONS = [7, 30, 90];

const number = (value) => Number.isFinite(value) ? value.toLocaleString() : '—';
const percent = (value, digits = 0) => Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
const decimal = (value, digits = 1) => Number.isFinite(value) ? value.toFixed(digits) : '—';

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

function SectionHeader({ eyebrow, title, description, action }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">{eyebrow}</p>
        )}
        <h2 className="mt-2 text-lg font-bold tracking-tight text-white">{title}</h2>
        {description && <p className="mt-1 text-xs leading-relaxed text-slate-400">{description}</p>}
      </div>
      {action}
    </div>
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

function StatCard({ label, value, detail, color = 'text-white', icon, tone = 'border-white/10' }) {
  return (
    <Panel className={`p-6 transition-all duration-300 hover:-translate-y-1 hover:border-cyan-500/30 ${tone}`}>
      <div className="flex items-start justify-between">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
        <span className="text-cyan-400 text-lg">{icon}</span>
      </div>
      <p className={`mt-4 font-mono text-3xl font-extrabold tracking-tight ${color}`}>{value}</p>
      <p className="mt-1.5 text-xs text-slate-400">{detail}</p>
    </Panel>
  );
}

function ReadinessBar({ label, value, total, color }) {
  const width = total > 0 ? Math.max(4, (value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-300">{label}</span>
        <span className="font-mono text-slate-400">{number(value)}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${width}%` }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className={`h-full rounded-full ${color}`}
        />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = async (selectedDays = days) => {
    setLoading(true);
    setError('');
    try {
      setData(await getInsights(selectedDays));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh(days);
  }, [days]);

  const verdicts = data?.verdicts || {};
  const detectorCoverage = data?.completed_detectors || {};
  const recordsAnalyzed = data?.records_analyzed || 0;
  const scoredRecords = data?.scored_records || 0;
  const flaggedCount = verdicts.flagged || 0;
  const authenticCount = verdicts.likely_authentic || 0;
  const inconclusiveCount = verdicts.inconclusive || 0;
  const totalVerdicts = (verdicts.flagged || 0) + (verdicts.likely_authentic || 0) + (verdicts.inconclusive || 0);
  const averageDailyVolume = days > 0 ? recordsAnalyzed / days : 0;
  const detectorKeys = Object.keys(detectorCoverage);
  const detectorAverage = detectorKeys.length > 0
    ? detectorKeys.reduce((sum, key) => sum + (Number(detectorCoverage[key]) || 0), 0) / detectorKeys.length
    : 0;
  const detectorUtilization = scoredRecords > 0 ? Math.min(1, detectorAverage / scoredRecords) : 0;
  const reviewPriority = (data?.flagged_rate || 0) > 0.45 ? 'Critical' : (data?.flagged_rate || 0) > 0.2 ? 'Elevated' : 'Stable';
  const operationalPosture = scoredRecords === 0
    ? 'Waiting for evidence'
    : (data?.flagged_rate || 0) > 0.45
      ? 'Escalate analyst review'
      : detectorUtilization < 0.55
        ? 'Increase detector coverage'
        : 'Normal operating posture';
  const split = [
    { label: 'Flagged Synthetic', count: verdicts.flagged || 0, color: 'bg-rose-400' },
    { label: 'Likely Authentic', count: verdicts.likely_authentic || 0, color: 'bg-emerald-400' },
    { label: 'Inconclusive / No Face', count: verdicts.inconclusive || 0, color: 'bg-amber-300' },
  ];
  const alerts = [
    {
      title: 'Review Queue',
      text: flaggedCount > 0
        ? `${number(flaggedCount)} assets need deeper analyst review in the current window.`
        : 'No currently flagged assets require escalation in this window.',
      tone: flaggedCount > 0 ? 'border-rose-500/25 bg-rose-500/[0.06] text-rose-100' : 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100',
    },
    {
      title: 'Detector Coverage',
      text: scoredRecords > 0
        ? `${percent(detectorUtilization)} average detector completion across scored records.`
        : 'Detector coverage will appear after completed analyses are available.',
      tone: detectorUtilization < 0.55 ? 'border-amber-500/25 bg-amber-500/[0.06] text-amber-100' : 'border-cyan-500/25 bg-cyan-500/[0.06] text-cyan-100',
    },
    {
      title: 'Operating Posture',
      text: operationalPosture,
      tone: 'border-white/10 bg-white/[0.03] text-slate-200',
    },
  ];
  const workflowCards = [
    {
      title: 'Flagged queue',
      value: number(flaggedCount),
      detail: flaggedCount > 0 ? 'Send into case review or export for review board.' : 'No synthetic alerts in this horizon.',
      color: 'text-rose-300',
    },
    {
      title: 'Likely authentic',
      value: number(authenticCount),
      detail: 'Benign outcomes can still be linked to cases for documentation.',
      color: 'text-emerald-300',
    },
    {
      title: 'Needs manual validation',
      value: number(inconclusiveCount),
      detail: 'Focus on no-face, partial, and unsupported-modality outcomes.',
      color: 'text-amber-300',
    },
  ];
  const recommendations = [
    flaggedCount > 0 ? 'Open the flagged queue and link suspicious evidence into an investigation case.' : 'Use the Forensic Studio to add new evidence and grow the review dataset.',
    detectorUtilization < 0.55 ? 'Investigate low detector completion for certain media types or missing modalities.' : 'Detector completion is healthy for the selected time window.',
    (data?.mean_fake_score || 0) > 0.55 ? 'Escalate high mean fake score windows with executive summary reporting.' : 'Maintain routine review cadence and continue exporting periodic reports.',
  ];

  return (
    <main className="mx-auto min-h-[75vh] max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1 text-xs font-semibold text-cyan-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-400" />
            Operations Command Center
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Analyst telemetry with triage posture
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
            Review activity, detector posture, escalation volume, and operational guidance across the selected evidence window.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:items-end">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-1.5">
            {HORIZONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setDays(option)}
                className={`rounded-xl px-3.5 py-2 text-xs font-bold transition-all ${
                  days === option
                    ? 'bg-cyan-500/15 text-cyan-300 shadow-[0_0_18px_rgba(6,182,212,0.18)]'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {option}d
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => refresh(days)}
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
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs sm:text-sm text-amber-200">
          {error}
        </div>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Media In Window" value={number(recordsAnalyzed)} detail={`${days}-day evidence volume`} icon="📁" />
        <StatCard label="Average Per Day" value={decimal(averageDailyVolume)} detail="Useful for staffing and throughput planning" icon="📈" color="text-cyan-300" />
        <StatCard label="Review Priority" value={reviewPriority} detail={`${number(flaggedCount)} flagged assets in queue`} icon="🚨" color="text-rose-300" tone="border-rose-500/15" />
        <StatCard label="Detector Utilization" value={percent(detectorUtilization)} detail="Average completion across detector modules" icon="🧠" color="text-emerald-300" tone="border-emerald-500/15" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Panel className="p-6 sm:p-7">
          <SectionHeader
            eyebrow="Throughput"
            title="Temporal activity"
            description={`Analysis distribution over the last ${days} days.`}
            action={(
              <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-cyan-300">
                Live feed
              </span>
            )}
          />
          <ActivityChart values={data?.daily_activity || []} />
        </Panel>

        <Panel className="p-6 sm:p-7">
          <SectionHeader
            eyebrow="Disposition"
            title="Verdict composition"
            description="Categorized by current detector classifications."
          />

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
            {Object.entries(detectorCoverage).map(([name, count]) => (
              <div key={name}>
                <p className="font-mono text-base font-bold text-white">{number(count)}</p>
                <p className="text-[10px] uppercase tracking-wider text-slate-400">{name.replace('_', ' ')} runs</p>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Panel className="p-6 sm:p-7">
          <SectionHeader
            eyebrow="Triage board"
            title="Operational alerts"
            description="Condenses the current window into actions an analyst team can immediately take."
          />

          <div className="mt-6 grid gap-4">
            {alerts.map((item) => (
              <div key={item.title} className={`rounded-2xl border p-4 ${item.tone}`}>
                <p className="text-[11px] font-bold uppercase tracking-[0.18em]">{item.title}</p>
                <p className="mt-2 text-sm leading-relaxed">{item.text}</p>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {workflowCards.map((item) => (
              <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">{item.title}</p>
                <p className={`mt-3 text-2xl font-black tracking-tight ${item.color}`}>{item.value}</p>
                <p className="mt-2 text-xs leading-relaxed text-slate-400">{item.detail}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className="p-6 sm:p-7">
          <SectionHeader
            eyebrow="Coverage"
            title="Detector readiness"
            description="Shows how often each detector completed in the selected horizon."
          />

          <div className="mt-6 space-y-4">
            {Object.entries(detectorCoverage).length > 0 ? (
              Object.entries(detectorCoverage).map(([name, count]) => (
                <ReadinessBar
                  key={name}
                  label={name.replace(/_/g, ' ')}
                  value={Number(count) || 0}
                  total={Math.max(scoredRecords, Number(count) || 0)}
                  color={name.includes('audio') ? 'bg-emerald-400' : name.includes('ai') ? 'bg-violet-400' : 'bg-cyan-400'}
                />
              ))
            ) : (
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-400">
                Detector readiness appears after successful analyses populate history.
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Recommended next actions</p>
            <div className="mt-3 space-y-2">
              {recommendations.map((item) => (
                <p key={item} className="text-sm leading-relaxed text-slate-300">
                  {item}
                </p>
              ))}
            </div>
          </div>
        </Panel>
      </div>

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
        {data?.methodology || 'Metrics reflect local SQLite audit telemetry. Detector predictions are probabilistic estimates and are not proof of authenticity.'}
      </p>
    </main>
  );
}
