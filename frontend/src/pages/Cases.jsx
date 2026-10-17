import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  addAnalysisToCase,
  createCase,
  deleteCase,
  getCase,
  getCases,
  getHistory,
  removeAnalysisFromCase,
  updateCase,
} from '../services/api';

const STATUS = { open: 'Open', in_review: 'In Review', resolved: 'Resolved' };
const PRIORITIES = ['low', 'medium', 'high', 'critical'];
const date = (value) =>
  value
    ? new Date(value).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '—';

const outcomeOf = (item) =>
  item?.multimodal_classification ||
  item?.ai_image_classification ||
  item?.visual_classification ||
  'inconclusive';

function Pill({ children, tone = 'slate' }) {
  const tones = {
    violet: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
    amber: 'border-amber-500/25 bg-amber-500/10 text-amber-300',
    green: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
    rose: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
    slate: 'border-white/[0.08] bg-white/[0.03] text-slate-300',
  };
  return (
    <span className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide ${tones[tone]}`}>
      {children}
    </span>
  );
}

function CaseBoard() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: '', summary: '', priority: 'medium' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getCases();
      setItems(data.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(
    () =>
      items.filter(
        (item) =>
          (status === 'all' || item.status === status) &&
          `${item.title} ${item.summary}`.toLowerCase().includes(query.toLowerCase())
      ),
    [items, query, status]
  );

  const counts = useMemo(
    () => ({
      open: items.filter((item) => item.status === 'open').length,
      in_review: items.filter((item) => item.status === 'in_review').length,
      resolved: items.filter((item) => item.status === 'resolved').length,
    }),
    [items]
  );

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await createCase(form);
      setForm({ title: '', summary: '', priority: 'medium' });
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto min-h-[78vh] max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
        <div>
          <Pill tone="violet">Evidence Workflow</Pill>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Investigation Case Files
          </h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-slate-400">
            Group related media items, track review statuses, and curate auditable investigation evidence dossiers.
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => setShowCreate(true)}
          className="btn-shimmer rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-5 py-3 text-xs font-bold text-black shadow-lg shadow-cyan-500/25 transition-all"
        >
          ＋ New Case File
        </motion.button>
      </div>

      {/* Metrics Row */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ['All Cases', items.length, 'text-white'],
          ['Open Status', counts.open, 'text-cyan-300'],
          ['Under Review', counts.in_review, 'text-amber-300'],
          ['Resolved Dossiers', counts.resolved, 'text-emerald-300'],
        ].map(([label, value, color]) => (
          <div key={label} className="glass-card p-5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
            <p className={`mt-2 font-mono text-2xl sm:text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filter / Search Bar */}
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500">🔍</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by case title or notes…"
            className="w-full rounded-2xl border border-white/[0.08] bg-[#0E121E] py-3 pl-11 pr-4 text-sm text-white outline-none focus:border-cyan-400/60 transition-all placeholder:text-slate-500"
          />
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-2xl border border-white/[0.08] bg-[#0E121E] px-4 py-3 text-sm text-slate-300 outline-none focus:border-cyan-400/60"
        >
          <option value="all">All Statuses</option>
          {Object.entries(STATUS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>
      </div>

      {error && (
        <div role="alert" className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-4 text-xs sm:text-sm text-amber-200">
          {error}
        </div>
      )}

      {loading ? (
        <div className="py-24 text-center text-sm text-slate-400">Loading cases…</div>
      ) : visible.length ? (
        <div className="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
            >
              <Link
                to={`/cases/${item.id}`}
                className="group block h-full glass-card p-6 hover:-translate-y-1.5 transition-all duration-300 hover:border-cyan-500/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 font-mono text-xs font-bold text-cyan-300">
                    #{String(item.id).padStart(2, '0')}
                  </div>
                  <Pill tone={item.status === 'resolved' ? 'green' : item.status === 'in_review' ? 'amber' : 'violet'}>
                    {STATUS[item.status] || item.status}
                  </Pill>
                </div>

                <h3 className="mt-4 line-clamp-1 text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
                  {item.title}
                </h3>
                <p className="mt-2 min-h-10 line-clamp-2 text-xs leading-relaxed text-slate-400">
                  {item.summary || 'No investigation notes have been logged.'}
                </p>

                <div className="mt-6 flex items-center justify-between border-t border-white/[0.06] pt-4">
                  <div className="flex items-center gap-2">
                    <Pill tone={item.priority === 'critical' || item.priority === 'high' ? 'rose' : 'slate'}>
                      {item.priority}
                    </Pill>
                    <span className="text-[11px] text-slate-400">{item.analysis_count || 0} items</span>
                  </div>
                  <span className="text-[10px] text-slate-500">Updated {date(item.updated_at)}</span>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      ) : (
        <div className="mt-10 rounded-3xl border border-dashed border-white/10 p-16 text-center">
          <p className="text-3xl text-slate-600 mb-2">📁</p>
          <p className="font-bold text-white text-base">
            {items.length ? 'No matching investigations' : 'Investigation desk is clear'}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            {items.length ? 'Try adjusting your search criteria.' : 'Create your first case file to track related media analyses.'}
          </p>
          {!items.length && (
            <button
              onClick={() => setShowCreate(true)}
              className="mt-5 rounded-xl bg-cyan-500 text-black px-4 py-2 text-xs font-bold"
            >
              Create Case File
            </button>
          )}
        </div>
      )}

      {/* Modal with AnimatePresence */}
      <AnimatePresence>
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-md">
            <motion.form
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onSubmit={submit}
              className="w-full max-w-lg rounded-3xl border border-white/15 bg-[#0E121E] p-7 shadow-2xl"
            >
              <div className="flex items-start justify-between">
                <div>
                  <Pill tone="violet">New Case</Pill>
                  <h2 className="mt-3 text-xl font-bold text-white">Create Investigation</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="text-xl text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <label className="mt-5 block text-xs font-semibold text-slate-300">
                Case Title
                <input
                  required
                  minLength={3}
                  maxLength={140}
                  value={form.title}
                  onChange={(event) => setForm({ ...form, title: event.target.value })}
                  placeholder="e.g. Political Debate Voice Clone Triage"
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/60"
                />
              </label>

              <label className="mt-4 block text-xs font-semibold text-slate-300">
                Investigation Notes
                <textarea
                  maxLength={2000}
                  rows={4}
                  value={form.summary}
                  onChange={(event) => setForm({ ...form, summary: event.target.value })}
                  placeholder="Summarize context, source handles, and priority reasons…"
                  className="mt-2 w-full resize-y rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-400/60"
                />
              </label>

              <label className="mt-4 block text-xs font-semibold text-slate-300">
                Initial Priority
                <select
                  value={form.priority}
                  onChange={(event) => setForm({ ...form, priority: event.target.value })}
                  className="mt-2 w-full rounded-2xl border border-white/10 bg-[#0E121E] px-4 py-3 text-sm text-white outline-none"
                >
                  {PRIORITIES.map((value) => (
                    <option key={value} value={value}>
                      {value[0].toUpperCase() + value.slice(1)} Priority
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-7 flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/5"
                >
                  Cancel
                </button>
                <button
                  disabled={saving}
                  className="btn-shimmer rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-5 py-2.5 text-xs font-bold text-black disabled:opacity-50"
                >
                  {saving ? 'Creating…' : 'Save Dossier'}
                </button>
              </div>
            </motion.form>
          </div>
        )}
      </AnimatePresence>
    </main>
  );
}

function CaseDetail({ id }) {
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [caseData, historyData] = await Promise.all([getCase(id), getHistory(100)]);
      setItem(caseData);
      setHistory(historyData.items || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const linked = new Set((item?.analyses || []).map((record) => record.id));
  const available = history.filter((record) => !linked.has(record.id));

  const patch = async (body) => {
    try {
      setItem(await updateCase(id, body));
    } catch (err) {
      setError(err.message);
    }
  };

  const attach = async () => {
    if (!selected) return;
    try {
      setItem(await addAnalysisToCase(id, selected));
      setSelected('');
    } catch (err) {
      setError(err.message);
    }
  };

  const exportReport = () => {
    const report = {
      generated_at: new Date().toISOString(),
      case: item,
      caveat: 'Detector outputs are uncalibrated investigative aids, not proof of legal authenticity.',
    };
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    link.download = `clarity-case-${item.id}-report.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const removeCase = async () => {
    if (!window.confirm('Delete this case? Analysis records will remain in history.')) return;
    try {
      await deleteCase(id);
      navigate('/cases');
    } catch (err) {
      setError(err.message);
    }
  };

  if (loading) {
    return <main className="mx-auto min-h-[70vh] max-w-7xl px-4 py-16 text-sm text-slate-400">Loading case file…</main>;
  }

  if (!item) {
    return (
      <main className="mx-auto min-h-[70vh] max-w-7xl px-4 py-16">
        <Link to="/cases" className="text-sm text-cyan-400 font-semibold">← All Cases</Link>
        <p className="mt-6 text-white">{error || 'Case not found.'}</p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-[78vh] max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <Link to="/cases" className="text-xs font-semibold text-cyan-400 hover:text-white transition-colors">
        ← Investigation Desk
      </Link>

      <div className="mt-4 flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="violet">Case #{String(item.id).padStart(4, '0')}</Pill>
            <Pill tone={item.status === 'resolved' ? 'green' : item.status === 'in_review' ? 'amber' : 'violet'}>
              {STATUS[item.status]}
            </Pill>
          </div>
          <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-white">{item.title}</h1>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-400">
            {item.summary || 'No investigation notes logged.'}
          </p>
          <p className="mt-3 text-[11px] text-slate-500">
            Created {date(item.created_at)} &bull; Updated {date(item.updated_at)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2.5">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={exportReport}
            className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/[0.08]"
          >
            Export Dossier JSON
          </motion.button>
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={removeCase}
            className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"
          >
            Delete Case
          </motion.button>
        </div>
      </div>

      {error && (
        <div className="mt-5 rounded-2xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-xs text-amber-200">
          {error}
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Linked Records */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white">Linked Analysis Evidence</h2>
              <p className="text-xs text-slate-400 mt-0.5">Media items referenced in this investigation.</p>
            </div>
            <Pill>{item.analyses?.length || 0} Items</Pill>
          </div>

          {item.analyses?.length ? (
            <div className="space-y-3.5">
              {item.analyses.map((record) => (
                <motion.article
                  layout
                  key={record.id}
                  className="glass-card p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 font-mono text-xs font-bold text-cyan-300">
                        #{record.id}
                      </span>
                      <div>
                        <p className="text-sm font-bold text-white">
                          {record.media_type || 'Media'} &bull; {date(record.created_at)}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-0.5 capitalize">
                          {outcomeOf(record).replace(/_/g, ' ')}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={async () => {
                        try {
                          setItem(await removeAnalysisFromCase(id, record.id));
                        } catch (err) {
                          setError(err.message);
                        }
                      }}
                      className="text-xs text-slate-400 hover:text-rose-300"
                    >
                      Unlink
                    </button>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[
                      ['Visual Score', record.visual_score],
                      ['Audio Biometrics', record.audio_score],
                      ['AI Image Diffusion', record.ai_image_score],
                      ['Fused Verdict', record.fused_score],
                    ].map(([label, score]) => (
                      <div key={label} className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-xs">
                        <p className="text-[10px] uppercase font-semibold text-slate-400">{label}</p>
                        <p className="mt-1 font-mono font-bold text-slate-200">
                          {Number.isFinite(score) ? `${(score * 100).toFixed(1)}%` : '—'}
                        </p>
                      </div>
                    ))}
                  </div>
                </motion.article>
              ))}
            </div>
          ) : (
            <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-xs text-slate-400">
              No analysis records linked to this case yet.
            </div>
          )}
        </section>

        {/* Controls Sidebar */}
        <aside className="space-y-4">
          <section className="glass-card p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
              Status & Priority
            </p>
            <label className="block text-xs font-semibold text-slate-300">
              Current Status
              <select
                value={item.status}
                onChange={(event) => patch({ status: event.target.value })}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0E121E] px-3.5 py-2.5 text-xs text-white"
              >
                {Object.entries(STATUS).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </label>

            <label className="mt-4 block text-xs font-semibold text-slate-300">
              Urgency Priority
              <select
                value={item.priority}
                onChange={(event) => patch({ priority: event.target.value })}
                className="mt-1.5 w-full rounded-xl border border-white/10 bg-[#0E121E] px-3.5 py-2.5 text-xs text-white"
              >
                {PRIORITIES.map((value) => (
                  <option key={value} value={value}>
                    {value[0].toUpperCase() + value.slice(1)} Priority
                  </option>
                ))}
              </select>
            </label>

            <label className="mt-4 block text-xs font-semibold text-slate-300">
              Dossier Notes
              <textarea
                rows={4}
                maxLength={2000}
                defaultValue={item.summary}
                onBlur={(event) => {
                  if (event.target.value !== item.summary) patch({ summary: event.target.value });
                }}
                className="mt-1.5 w-full resize-y rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-relaxed text-white outline-none focus:border-cyan-400/60"
              />
            </label>
          </section>

          <section className="glass-card p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Attach Analysis Record
            </p>
            {available.length ? (
              <>
                <select
                  value={selected}
                  onChange={(event) => setSelected(event.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-[#0E121E] px-3 py-2.5 text-xs text-white"
                >
                  <option value="">Choose recent record…</option>
                  {available.map((record) => (
                    <option key={record.id} value={record.id}>
                      #{record.id} · {record.media_type} · {outcomeOf(record)}
                    </option>
                  ))}
                </select>
                <button
                  onClick={attach}
                  disabled={!selected}
                  className="btn-shimmer mt-3 w-full rounded-xl bg-cyan-500 px-4 py-2.5 text-xs font-bold text-black disabled:opacity-40"
                >
                  Link to Case
                </button>
              </>
            ) : (
              <p className="text-xs text-slate-400">
                All recent records are already linked or no records exist in history.
              </p>
            )}
          </section>
        </aside>
      </div>
    </main>
  );
}

export default function Cases() {
  const { caseId } = useParams();
  return caseId ? <CaseDetail id={caseId} /> : <CaseBoard />;
}
