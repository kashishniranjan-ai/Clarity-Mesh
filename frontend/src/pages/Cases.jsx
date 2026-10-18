import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import {
  addAnalysisToCase,
  addCaseComment,
  assignCase,
  createCase,
  deleteCase,
  deleteCaseComment,
  getCase,
  getCaseComments,
  getCaseCustody,
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

const formatTime = (value) =>
  value
    ? new Date(value).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : '';

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
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide ${tones[tone]}`}
    >
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
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <Pill tone="violet">Investigation Hub</Pill>
            <span className="text-xs text-slate-400 font-mono">CHAIN-OF-CUSTODY AUDITED</span>
          </div>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Forensic Case Files
          </h1>
          <p className="mt-2 text-sm text-slate-400 max-w-2xl">
            Correlate related deepfake analyses, track chain-of-custody signatures, assign lead
            analysts, and maintain tamper-evident investigation dossiers.
          </p>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className="btn-shimmer flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-5 py-3 text-xs font-bold text-black shadow-lg shadow-cyan-500/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
        >
          <span className="text-base leading-none">＋</span>
          <span>New Investigation</span>
        </button>
      </div>

      {/* Metrics Row */}
      <div className="mt-8 grid grid-cols-3 gap-3.5 sm:gap-5">
        {[
          { label: 'Active Open Cases', count: counts.open, tone: 'text-cyan-400', border: 'border-cyan-500/20' },
          { label: 'In Forensics Review', count: counts.in_review, tone: 'text-amber-400', border: 'border-amber-500/20' },
          { label: 'Resolved Dossiers', count: counts.resolved, tone: 'text-emerald-400', border: 'border-emerald-500/20' },
        ].map((stat) => (
          <div key={stat.label} className={`glass-card p-4 sm:p-5 border ${stat.border}`}>
            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">{stat.label}</p>
            <p className={`mt-2 font-mono text-2xl sm:text-3xl font-bold ${stat.tone}`}>{stat.count}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
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
                  <div className="flex flex-col items-end gap-1.5">
                    <Pill tone={item.status === 'resolved' ? 'green' : item.status === 'in_review' ? 'amber' : 'violet'}>
                      {STATUS[item.status] || item.status}
                    </Pill>
                  </div>
                </div>

                <h3 className="mt-4 line-clamp-1 text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
                  {item.title}
                </h3>
                <p className="mt-2 min-h-10 line-clamp-2 text-xs leading-relaxed text-slate-400">
                  {item.summary || 'No investigation notes have been logged.'}
                </p>

                {item.assigned_to && (
                  <div className="mt-3 flex items-center gap-1.5 text-[11px] text-cyan-300 font-mono">
                    <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span>Assignee: {item.assigned_name || item.assigned_to}</span>
                  </div>
                )}

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
  const { user, isAdmin } = useAuth();
  const [item, setItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [comments, setComments] = useState([]);
  const [custody, setCustody] = useState({ items: [], chain_intact: true, verification: null });
  const [selected, setSelected] = useState('');
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);
  const [assignEmail, setAssignEmail] = useState('');
  const [assignName, setAssignName] = useState('');
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignSuccess, setAssignSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState('evidence'); // 'evidence' | 'comments' | 'custody'
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [caseData, historyData, commentsData, custodyData] = await Promise.all([
        getCase(id),
        getHistory(100),
        getCaseComments(id).catch(() => ({ items: [] })),
        getCaseCustody(id).catch(() => ({ items: [], chain_intact: true })),
      ]);
      setItem(caseData);
      setHistory(historyData.items || []);
      setComments(commentsData.items || []);
      setCustody(custodyData || { items: [], chain_intact: true });
      setAssignEmail(caseData.assigned_to || '');
      setAssignName(caseData.assigned_name || '');
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
      // Refresh custody timeline after mutation
      getCaseCustody(id).then(setCustody).catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  };

  const attach = async () => {
    if (!selected) return;
    try {
      setItem(await addAnalysisToCase(id, selected));
      setSelected('');
      getCaseCustody(id).then(setCustody).catch(() => {});
    } catch (err) {
      setError(err.message);
    }
  };

  const handlePostComment = async (event) => {
    event.preventDefault();
    if (!newComment.trim()) return;
    setSubmittingComment(true);
    try {
      const added = await addCaseComment(id, newComment.trim());
      setComments((prev) => [added, ...prev]);
      setNewComment('');
      getCaseCustody(id).then(setCustody).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!window.confirm('Delete this comment?')) return;
    try {
      await deleteCaseComment(id, commentId);
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch (err) {
      setError(err.message);
    }
  };

  const handleAssignAnalyst = async (event) => {
    event.preventDefault();
    if (!assignEmail.trim()) return;
    setIsAssigning(true);
    try {
      const updated = await assignCase(id, assignEmail.trim(), assignName.trim());
      setItem(updated);
      setAssignSuccess(true);
      setTimeout(() => setAssignSuccess(false), 3000);
      getCaseCustody(id).then(setCustody).catch(() => {});
    } catch (err) {
      setError(err.message);
    } finally {
      setIsAssigning(false);
    }
  };

  const exportReport = () => {
    const report = {
      generated_at: new Date().toISOString(),
      case: item,
      chain_of_custody_intact: custody.chain_intact,
      chain_events: custody.items,
      comments: comments,
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

      {/* Case Header */}
      <div className="mt-4 flex flex-col justify-between gap-5 lg:flex-row lg:items-start">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="violet">Case #{String(item.id).padStart(4, '0')}</Pill>
            <Pill tone={item.status === 'resolved' ? 'green' : item.status === 'in_review' ? 'amber' : 'violet'}>
              {STATUS[item.status]}
            </Pill>
            {item.assigned_to ? (
              <Pill tone="violet">👤 {item.assigned_name || item.assigned_to}</Pill>
            ) : (
              <Pill tone="slate">Unassigned</Pill>
            )}
            <div
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wide ${
                custody.chain_intact
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  custody.chain_intact ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                }`}
              />
              <span>{custody.chain_intact ? 'Custody Chain: INTACT' : 'Custody Chain: TAMPERED'}</span>
            </div>
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

      {/* Main Grid: Tabs on left, Inspector sidebar on right */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div>
          {/* Tab Navigation */}
          <div className="flex border-b border-white/10 gap-2 mb-6">
            <button
              onClick={() => setActiveTab('evidence')}
              className={`pb-3 px-4 text-xs font-bold transition-colors border-b-2 ${
                activeTab === 'evidence'
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Linked Evidence ({item.analyses?.length || 0})
            </button>
            <button
              onClick={() => setActiveTab('comments')}
              className={`pb-3 px-4 text-xs font-bold transition-colors border-b-2 ${
                activeTab === 'comments'
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Forensic Comments ({comments.length})
            </button>
            <button
              onClick={() => setActiveTab('custody')}
              className={`pb-3 px-4 text-xs font-bold transition-colors border-b-2 ${
                activeTab === 'custody'
                  ? 'border-cyan-400 text-cyan-300'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              Chain of Custody ({custody.items?.length || 0})
            </button>
          </div>

          {/* TAB 1: EVIDENCE */}
          {activeTab === 'evidence' && (
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
                    <motion.article layout key={record.id} className="glass-card p-5">
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
                              getCaseCustody(id).then(setCustody).catch(() => {});
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
                          <div
                            key={label}
                            className="rounded-xl border border-white/[0.04] bg-white/[0.02] px-3 py-2 text-xs"
                          >
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
                  No analysis records linked to this case yet. Use the sidebar to attach stored analyses.
                </div>
              )}
            </section>
          )}

          {/* TAB 2: COMMENTS */}
          {activeTab === 'comments' && (
            <section className="space-y-5">
              <form onSubmit={handlePostComment} className="glass-card p-5">
                <label className="block text-xs font-bold text-slate-300 mb-2">
                  Add Forensic Observation / Team Note
                </label>
                <textarea
                  required
                  rows={3}
                  maxLength={5000}
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  placeholder="Record investigative findings, hypothesis notes, or peer review comments…"
                  className="w-full resize-y rounded-xl border border-white/10 bg-black/30 p-3.5 text-xs leading-relaxed text-white outline-none focus:border-cyan-400/60"
                />
                <div className="mt-3 flex justify-between items-center">
                  <span className="text-[10px] text-slate-500">
                    Logged to immutable chain-of-custody upon submission.
                  </span>
                  <button
                    type="submit"
                    disabled={submittingComment || !newComment.trim()}
                    className="btn-shimmer rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-black disabled:opacity-40"
                  >
                    {submittingComment ? 'Posting…' : 'Post Comment'}
                  </button>
                </div>
              </form>

              {comments.length ? (
                <div className="space-y-3">
                  {comments.map((comm) => {
                    const isAuthor =
                      user && (user.id === comm.author_id || user.email === comm.author_email);
                    const canDelete = isAuthor || isAdmin;
                    return (
                      <div key={comm.id} className="glass-card p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-xs font-bold text-cyan-300">
                              {comm.author_name ? comm.author_name[0].toUpperCase() : 'A'}
                            </span>
                            <div>
                              <p className="text-xs font-bold text-white">
                                {comm.author_name || comm.author_email}
                              </p>
                              <p className="text-[10px] text-slate-500">
                                {comm.author_email} &bull; {date(comm.created_at)} at {formatTime(comm.created_at)}
                              </p>
                            </div>
                          </div>
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteComment(comm.id)}
                              className="text-[11px] text-slate-500 hover:text-rose-400 transition-colors"
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed pl-9">
                          {comm.body}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-xs text-slate-400">
                  No forensic comments logged yet. Use the form above to add observations.
                </div>
              )}
            </section>
          )}

          {/* TAB 3: CHAIN OF CUSTODY */}
          {activeTab === 'custody' && (
            <section className="space-y-4">
              {/* Integrity status card */}
              <div
                className={`glass-card p-5 border ${
                  custody.chain_intact ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{custody.chain_intact ? '🛡️' : '⚠️'}</span>
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        {custody.chain_intact
                          ? 'Cryptographic Chain Integrity Verified'
                          : 'Chain of Custody Anomaly Detected'}
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {custody.chain_intact
                          ? 'Each event is SHA-256 hash-chained to its predecessor, guaranteeing tamper-evidence.'
                          : 'A cryptographic hash mismatch was detected. Investigation trail integrity is compromised.'}
                      </p>
                    </div>
                  </div>
                  <Pill tone={custody.chain_intact ? 'green' : 'rose'}>
                    {custody.chain_intact ? 'INTACT' : 'TAMPERED'}
                  </Pill>
                </div>
              </div>

              {/* Custody events timeline */}
              {custody.items?.length ? (
                <div className="space-y-3">
                  {custody.items.map((event, idx) => (
                    <div key={event.id || idx} className="glass-card p-4 space-y-2 font-mono text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300 font-sans">
                            {event.action}
                          </span>
                          <span className="text-slate-400 text-[11px] font-sans">
                            {event.actor_email ? `by ${event.actor_email}` : 'System'}
                          </span>
                        </div>
                        <span className="text-slate-500 text-[10px]">
                          {date(event.timestamp)} {formatTime(event.timestamp)}
                        </span>
                      </div>

                      {event.details && (
                        <div className="rounded-lg bg-black/30 p-2.5 text-[11px] text-slate-300 font-sans break-all">
                          {typeof event.details === 'object'
                            ? JSON.stringify(event.details)
                            : String(event.details)}
                        </div>
                      )}

                      <div className="pt-2 border-t border-white/[0.05] grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] text-slate-500">
                        <div className="truncate">
                          <span className="text-slate-400">Entry Hash: </span>
                          <span className="text-cyan-400 font-bold">{event.entry_hash ? event.entry_hash.slice(0, 16) + '…' : '—'}</span>
                        </div>
                        <div className="truncate">
                          <span className="text-slate-400">Prev Hash: </span>
                          <span>{event.prev_hash ? event.prev_hash.slice(0, 16) + '…' : '(Genesis)'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-3xl border border-dashed border-white/10 p-10 text-center text-xs text-slate-400">
                  No custody events recorded for this case yet.
                </div>
              )}
            </section>
          )}
        </div>

        {/* Controls Sidebar */}
        <aside className="space-y-4">
          {/* Status & Priority */}
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

          {/* Analyst Assignment Card */}
          <section className="glass-card p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
              Analyst Assignment
            </p>
            <form onSubmit={handleAssignAnalyst} className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Analyst Email
                </label>
                <input
                  required
                  type="email"
                  value={assignEmail}
                  onChange={(e) => setAssignEmail(e.target.value)}
                  placeholder="investigator@agency.gov"
                  className="w-full rounded-xl border border-white/10 bg-[#0E121E] px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/60"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-300 mb-1">
                  Analyst Full Name
                </label>
                <input
                  type="text"
                  value={assignName}
                  onChange={(e) => setAssignName(e.target.value)}
                  placeholder="e.g. Dana Scully"
                  className="w-full rounded-xl border border-white/10 bg-[#0E121E] px-3 py-2 text-xs text-white outline-none focus:border-cyan-400/60"
                />
              </div>
              <button
                type="submit"
                disabled={isAssigning || !assignEmail.trim()}
                className="btn-shimmer w-full rounded-xl bg-cyan-500/20 border border-cyan-500/40 px-3 py-2 text-xs font-bold text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-40"
              >
                {isAssigning ? 'Saving…' : 'Update Assignment'}
              </button>
              {assignSuccess && (
                <p className="text-[11px] text-emerald-400 text-center">
                  ✓ Assignment logged to custody chain.
                </p>
              )}
            </form>
          </section>

          {/* Attach Analysis */}
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
