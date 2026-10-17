import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { clearHistory, describeApiError, getHistory } from '../services/api';

/* ═══════════════════════════════════════════════════════════════
   HELPERS & FORMATTERS
   ═══════════════════════════════════════════════════════════════ */

function formatScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toFixed(3);
}

function formatPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return `${Math.round(num * 100)}%`;
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Just now';
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffSeconds < 30) return 'Just now';
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    });
  } catch {
    return dateString;
  }
}

function getVerdictConfig(classification) {
  switch (classification) {
    case 'deepfake':
    case 'ai_generated':
      return {
        label: 'Synthetic Detected',
        badge: 'bg-rose-500/10 text-rose-300 border border-rose-500/25',
        dot: 'bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.6)]',
        isFake: true,
      };
    case 'real':
    case 'likely_human':
      return {
        label: 'Organic Authentic',
        badge: 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/25',
        dot: 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.6)]',
        isFake: false,
      };
    case 'inconclusive':
    case 'partial':
      return {
        label: 'Inconclusive Review',
        badge: 'bg-amber-500/10 text-amber-300 border border-amber-500/25',
        dot: 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]',
        isFake: false,
      };
    default:
      return {
        label: classification ? classification.replace(/_/g, ' ') : 'Uncertain',
        badge: 'bg-slate-800/60 text-slate-300 border border-slate-700/50',
        dot: 'bg-slate-400',
        isFake: false,
      };
  }
}

function getStatusPill(status) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/20">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        Processed
      </span>
    );
  }
  if (status === 'no_face_detected' || status === 'no_audio') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/20">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
        {status.replace(/_/g, ' ')}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/60 px-2 py-0.5 text-[10px] font-medium text-slate-400 border border-slate-700/50">
      <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
      {status ? status.replace(/_/g, ' ') : 'queued'}
    </span>
  );
}

function exportHistoryCsv(items) {
  if (!items || items.length === 0) return;

  const headers = [
    'ID',
    'Timestamp',
    'Original Filename',
    'Media Type',
    'Overall Status',
    'Faces Detected',
    'Visual Status',
    'Visual Score',
    'Visual Classification',
    'Audio Status',
    'Audio Score',
    'Audio Classification',
    'AI Image Status',
    'AI Image Score',
    'AI Image Classification',
    'Multimodal Status',
    'Fused Score',
    'Multimodal Classification',
  ];

  const rows = items.map((item) => [
    item.id,
    item.created_at || '',
    `"${(item.original_name || item.stored_name || '').replace(/"/g, '""')}"`,
    item.media_type || '',
    item.status || '',
    item.faces_detected ?? '',
    item.visual_status || '',
    item.visual_score ?? '',
    item.visual_classification || '',
    item.audio_status || '',
    item.audio_score ?? '',
    item.audio_classification || '',
    item.ai_image_status || '',
    item.ai_image_score ?? '',
    item.ai_image_classification || '',
    item.multimodal_status || '',
    item.fused_score ?? '',
    item.multimodal_classification || '',
  ]);

  const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `clarity_mesh_history_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ═══════════════════════════════════════════════════════════════
   SUBCOMPONENTS
   ═══════════════════════════════════════════════════════════════ */

function MediaIcon({ type, className = 'h-5 w-5' }) {
  if (type === 'video') {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
      </svg>
    );
  }
  if (type === 'audio') {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.5A2.25 2.25 0 0 1 2.25 13.5v-3a2.25 2.25 0 0 1 2.25-2.25h2.25Z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
    </svg>
  );
}

function DetectorCell({ label, modelName, status, score, classification, isReversed = false }) {
  const completed = status === 'completed';
  const numericScore = typeof score === 'number' && Number.isFinite(score) ? score : null;
  const percent = numericScore !== null ? Math.min(Math.max(numericScore * 100, 0), 100) : 0;

  let barGradient = 'from-cyan-500 to-sky-500';
  if (!isReversed) {
    if (percent > 65) barGradient = 'from-amber-500 to-rose-500';
    else if (percent > 35) barGradient = 'from-sky-500 to-amber-500';
    else barGradient = 'from-emerald-500 to-teal-500';
  } else {
    if (percent < 35) barGradient = 'from-amber-500 to-rose-500';
    else if (percent < 65) barGradient = 'from-sky-500 to-amber-500';
    else barGradient = 'from-emerald-500 to-teal-500';
  }

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-white/5 bg-slate-900/40 p-4 backdrop-blur-md transition-all hover:border-cyan-500/30 hover:bg-slate-900/60">
      <div>
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-xs font-semibold text-slate-200">{label}</span>
          {getStatusPill(status)}
        </div>
        <p className="mt-0.5 text-[10px] text-slate-400 font-medium truncate">{modelName}</p>
      </div>

      <div className="mt-3.5">
        {completed && numericScore !== null ? (
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-base font-bold text-white tracking-tight">
                {formatScore(numericScore)}
              </span>
              <span className="text-[11px] font-semibold text-slate-400">
                {formatPercent(numericScore)}
              </span>
            </div>

            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800/80">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${percent}%` }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                className={`h-full rounded-full bg-gradient-to-r ${barGradient}`}
              />
            </div>

            <div className="mt-2.5 flex items-center justify-between">
              <span className="text-[10px] text-slate-400">Model output</span>
              {classification && (
                <span className="rounded-md px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase bg-slate-800/80 text-slate-300 border border-slate-700/50">
                  {classification.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="py-2 text-center">
            <span className="text-xs font-medium text-slate-400">Output not generated</span>
            <p className="mt-0.5 text-[10px] text-slate-400">
              {status === 'no_face_detected'
                ? 'No human face detected'
                : status === 'no_audio'
                  ? 'No audio track present'
                  : 'Modality not evaluated'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmClearModal({ isOpen, onClose, onConfirm, clearing }) {
  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-md rounded-3xl border border-white/10 bg-[#0E131F] p-6 shadow-2xl"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-bold text-white tracking-tight">Clear Analysis History?</h3>
              <p className="mt-1.5 text-sm text-slate-400 leading-relaxed">
                This will remove all stored analysis records and model telemetry from your local database. This action cannot be undone.
              </p>
            </div>
          </div>

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={clearing}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-slate-300 transition-all hover:bg-white/10 hover:text-white"
            >
              Cancel
            </button>
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={onConfirm}
              disabled={clearing}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-rose-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-rose-500/20 transition-all disabled:opacity-50"
            >
              {clearing ? (
                <>
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Clearing Records…
                </>
              ) : (
                'Confirm & Clear'
              )}
            </motion.button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN HISTORY PAGE
   ═══════════════════════════════════════════════════════════════ */

export default function History() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clearing, setClearing] = useState(false);
  const [isClearModalOpen, setIsClearModalOpen] = useState(false);

  // Filters & Sorting
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState('all');
  const [verdictFilter, setVerdictFilter] = useState('all');
  const [sortOption, setSortOption] = useState('newest');

  // Expanded items state
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [copiedId, setCopiedId] = useState(null);

  const toggleExpand = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const copyRecordJson = (item) => {
    navigator.clipboard.writeText(JSON.stringify(item, null, 2));
    setCopiedId(item.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await getHistory(100);
      setItems(payload.items || []);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleClearConfirm = async () => {
    setClearing(true);
    setError(null);
    try {
      await clearHistory();
      setItems([]);
      setIsClearModalOpen(false);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setClearing(false);
    }
  };

  /* ── Computed Metrics ────────────────────────────────────────── */
  const analytics = useMemo(() => {
    const total = items.length;
    if (total === 0) {
      return { total: 0, fakeCount: 0, fakePercent: 0, realCount: 0, realPercent: 0, avgRisk: null };
    }

    let fakeCount = 0;
    let realCount = 0;
    let scoreSum = 0;
    let scoreCount = 0;

    for (const item of items) {
      const isFake =
        item.multimodal_classification === 'deepfake' ||
        item.visual_classification === 'deepfake' ||
        item.audio_classification === 'deepfake' ||
        item.ai_image_classification === 'ai_generated';

      const isReal =
        item.multimodal_classification === 'real' ||
        item.multimodal_classification === 'likely_human' ||
        item.visual_classification === 'real' ||
        item.ai_image_classification === 'likely_human';

      if (isFake) fakeCount++;
      else if (isReal) realCount++;

      if (typeof item.fused_score === 'number' && Number.isFinite(item.fused_score)) {
        scoreSum += item.fused_score;
        scoreCount++;
      }
    }

    return {
      total,
      fakeCount,
      fakePercent: Math.round((fakeCount / total) * 100),
      realCount,
      realPercent: Math.round((realCount / total) * 100),
      avgRisk: scoreCount > 0 ? (scoreSum / scoreCount).toFixed(3) : null,
    };
  }, [items]);

  /* ── Filtered & Sorted ───────────────────────────────────────── */
  const filteredItems = useMemo(() => {
    return items
      .filter((item) => {
        if (mediaFilter !== 'all') {
          if (mediaFilter === 'image' && item.media_type !== 'image') return false;
          if (mediaFilter === 'video' && item.media_type !== 'video') return false;
          if (mediaFilter === 'audio' && item.media_type !== 'audio') return false;
        }

        if (verdictFilter !== 'all') {
          const isFake =
            item.multimodal_classification === 'deepfake' ||
            item.visual_classification === 'deepfake' ||
            item.audio_classification === 'deepfake' ||
            item.ai_image_classification === 'ai_generated';

          const isReal =
            item.multimodal_classification === 'real' ||
            item.multimodal_classification === 'likely_human' ||
            item.visual_classification === 'real' ||
            item.ai_image_classification === 'likely_human';

          if (verdictFilter === 'deepfake' && !isFake) return false;
          if (verdictFilter === 'real' && !isReal) return false;
          if (verdictFilter === 'inconclusive' && (isFake || isReal)) return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const name = (item.original_name || item.stored_name || '').toLowerCase();
          const type = (item.media_type || '').toLowerCase();
          const verdict = (item.multimodal_classification || '').toLowerCase();
          return name.includes(q) || type.includes(q) || verdict.includes(q);
        }

        return true;
      })
      .sort((a, b) => {
        if (sortOption === 'newest') {
          return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        }
        if (sortOption === 'oldest') {
          return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
        }
        if (sortOption === 'risk_desc') {
          return (b.fused_score ?? -1) - (a.fused_score ?? -1);
        }
        if (sortOption === 'risk_asc') {
          return (a.fused_score ?? 999) - (b.fused_score ?? 999);
        }
        return 0;
      });
  }, [items, mediaFilter, verdictFilter, searchQuery, sortOption]);

  return (
    <div className="relative min-h-[calc(100vh-4.5rem)] px-4 py-12 sm:px-6 lg:px-8">
      {/* Ambient background glows */}
      <div className="pointer-events-none absolute -top-40 right-10 h-96 w-96 rounded-full bg-cyan-600/10 blur-[120px]" />
      <div className="pointer-events-none absolute top-1/2 -left-20 h-96 w-96 rounded-full bg-sky-600/10 blur-[120px]" />

      <div className="relative mx-auto max-w-6xl">
        {/* Page Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"
        >
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
              Activity Archive
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
              Analysis <span className="bg-gradient-to-r from-cyan-400 via-sky-300 to-emerald-400 bg-clip-text text-transparent">History</span>
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-400 leading-relaxed">
              Browse past media evaluations, inspect multi-model confidence scores, and export activity data.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={load}
              disabled={loading}
              title="Refresh database records"
              className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-900/60 px-4 py-2.5 text-xs font-semibold text-slate-200 transition-all hover:bg-slate-800 hover:text-white disabled:opacity-50"
            >
              <svg className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
              </svg>
              Refresh
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => exportHistoryCsv(filteredItems)}
              disabled={filteredItems.length === 0}
              title="Download CSV report of current records"
              className="inline-flex items-center gap-2 rounded-2xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2.5 text-xs font-semibold text-cyan-300 transition-all hover:bg-cyan-500/20 hover:text-cyan-200 disabled:opacity-40"
            >
              <svg className="h-4 w-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Export CSV
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              type="button"
              onClick={() => setIsClearModalOpen(true)}
              disabled={clearing || items.length === 0}
              className="inline-flex items-center gap-2 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-xs font-semibold text-rose-300 transition-all hover:bg-rose-500/20 hover:text-rose-200 disabled:opacity-40"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
              </svg>
              Clear Records
            </motion.button>
          </div>
        </motion.div>

        {/* Analytics Summary Cards */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          {/* Card 1: Total */}
          <div className="glass-card relative overflow-hidden p-5 transition-all duration-300 hover:border-cyan-500/30">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Total Scans</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 5.625c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
                </svg>
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white tracking-tight">{analytics.total}</span>
              <span className="text-xs text-slate-400 font-medium">files analyzed</span>
            </div>
            <div className="mt-2 text-[11px] text-cyan-300/80">Persistent local store</div>
          </div>

          {/* Card 2: Synthetic */}
          <div className="glass-card relative overflow-hidden p-5 transition-all duration-300 hover:border-rose-500/30">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Synthetic Detected</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m0-10.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.002A11.959 11.959 0 0 1 12 2.714Zm0 13.036h.008v.008H12v-.008Z" />
                </svg>
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-rose-400 tracking-tight">{analytics.fakeCount}</span>
              <span className="text-xs text-rose-400/80">({analytics.fakePercent}%)</span>
            </div>
            <div className="mt-2 text-[11px] text-rose-300/80">High synthetic probability</div>
          </div>

          {/* Card 3: Authentic */}
          <div className="glass-card relative overflow-hidden p-5 transition-all duration-300 hover:border-emerald-500/30">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Organic Verified</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.002A11.959 11.959 0 0 1 12 2.714Z" />
                </svg>
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-emerald-400 tracking-tight">{analytics.realCount}</span>
              <span className="text-xs text-emerald-400/80">({analytics.realPercent}%)</span>
            </div>
            <div className="mt-2 text-[11px] text-emerald-300/80">Passes organic thresholds</div>
          </div>

          {/* Card 4: Mean Confidence */}
          <div className="glass-card relative overflow-hidden p-5 transition-all duration-300 hover:border-indigo-500/30">
            <div className="flex items-center justify-between text-slate-400">
              <span className="text-xs font-semibold uppercase tracking-wider">Average Score</span>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
                </svg>
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white tracking-tight">
                {analytics.avgRisk ?? '—'}
              </span>
              <span className="text-xs text-slate-400 font-medium">ensemble mean</span>
            </div>
            <div className="mt-2 text-[11px] text-indigo-300/80">Aggregate fusion metric</div>
          </div>
        </motion.div>

        {/* Filter and Search Bar */}
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="mt-8 rounded-3xl border border-white/5 bg-slate-900/40 p-4 backdrop-blur-xl"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
                </svg>
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by title, format, or verdict..."
                className="w-full rounded-2xl border border-white/10 bg-slate-950/60 py-2.5 pl-10 pr-9 text-xs text-white placeholder-slate-400 transition-all focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400/50"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-slate-400 hover:text-white"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Media Type Filter */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3 sm:border-t-0 sm:pt-0">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Format:</span>
              {[
                { id: 'all', label: 'All' },
                { id: 'image', label: 'Images' },
                { id: 'video', label: 'Videos' },
                { id: 'audio', label: 'Audio' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMediaFilter(tab.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                    mediaFilter === tab.id
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50 shadow-sm'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Verdict Filter */}
            <div className="flex flex-wrap items-center gap-1.5 border-t border-white/5 pt-3 sm:border-t-0 sm:pt-0">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Verdict:</span>
              {[
                { id: 'all', label: 'All' },
                { id: 'deepfake', label: 'Synthetic' },
                { id: 'real', label: 'Authentic' },
                { id: 'inconclusive', label: 'Uncertain' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setVerdictFilter(tab.id)}
                  className={`rounded-xl px-3 py-1.5 text-xs font-medium transition-all ${
                    verdictFilter === tab.id
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/50 shadow-sm'
                      : 'bg-slate-900/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Sort Dropdown */}
            <div className="flex items-center gap-2 border-t border-white/5 pt-3 sm:border-t-0 sm:pt-0">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Sort:</span>
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value)}
                className="rounded-xl border border-white/10 bg-slate-950 px-3 py-1.5 text-xs text-slate-300 focus:border-cyan-400 focus:outline-none"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="risk_desc">Highest Score</option>
                <option value="risk_asc">Lowest Score</option>
              </select>
            </div>
          </div>
        </motion.div>

        {/* Error Alert */}
        {error && (
          <div
            role="alert"
            className="mt-6 flex items-center justify-between rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300 backdrop-blur-md"
          >
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 shrink-0 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={load}
              className="rounded-xl bg-rose-500/20 px-3 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-500/30"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Spinner */}
        {loading && (
          <div className="mt-12 flex flex-col items-center justify-center rounded-3xl border border-white/5 bg-slate-900/30 py-20 text-center backdrop-blur-xl">
            <div className="h-10 w-10 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
            <h3 className="mt-5 text-sm font-semibold tracking-wide text-white">Loading Evaluation History</h3>
            <p className="mt-1.5 text-xs text-slate-400">Retrieving past records from your local database…</p>
          </div>
        )}

        {/* Empty State: Zero database items */}
        {!loading && items.length === 0 && !error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mt-12 flex flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-slate-900/20 px-6 py-20 text-center backdrop-blur-xl"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shadow-xl shadow-cyan-950/40">
              <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.57-.598-3.75h-.002A11.959 11.959 0 0 1 12 2.714Z" />
              </svg>
            </div>

            <h2 className="mt-5 text-xl font-bold text-white tracking-tight">No Analysis History Found</h2>
            <p className="mt-2 max-w-md text-sm text-slate-400 leading-relaxed">
              When you evaluate images, videos, or audio tracks, detailed telemetry and model breakdowns will automatically be archived here.
            </p>
            <Link
              to="/#upload"
              className="mt-6 inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-6 py-3 text-sm font-bold text-black shadow-lg shadow-cyan-500/25 transition-all hover:brightness-105"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
              </svg>
              Upload Your First File
            </Link>
          </motion.div>
        )}

        {/* Empty State: Zero filtered matches */}
        {!loading && items.length > 0 && filteredItems.length === 0 && (
          <div className="mt-8 flex flex-col items-center justify-center rounded-3xl border border-white/5 bg-slate-900/30 px-6 py-16 text-center backdrop-blur-xl">
            <p className="text-base font-semibold text-slate-300">No matching records found</p>
            <p className="mt-1 text-xs text-slate-400">
              No analyses matched &quot;{searchQuery}&quot; or your current filter parameters.
            </p>
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setMediaFilter('all');
                setVerdictFilter('all');
              }}
              className="mt-4 rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-4 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20"
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* Record Cards List */}
        {!loading && filteredItems.length > 0 && (
          <div className="mt-8 space-y-4">
            <div className="flex items-center justify-between px-1 text-xs text-slate-400">
              <span>Showing {filteredItems.length} of {items.length} records</span>
              <span className="capitalize">Sorted by: {sortOption.replace('_', ' ')}</span>
            </div>

            <AnimatePresence>
              {filteredItems.map((item, index) => {
                const verdict = getVerdictConfig(item.multimodal_classification);
                const isExpanded = expandedIds.has(item.id);
                const numericFused = typeof item.fused_score === 'number' && Number.isFinite(item.fused_score) ? item.fused_score : null;

                return (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: Math.min(index * 0.04, 0.3) }}
                    className="glass-card relative overflow-hidden p-5 sm:p-6 transition-all duration-300 hover:border-cyan-500/30 group"
                  >
                    {/* Top Bar: Media badge, Filename, Timestamp, Verdict Pill */}
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 border border-white/10 text-cyan-400 group-hover:border-cyan-500/40 transition-colors">
                          <MediaIcon type={item.media_type} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="truncate text-base font-bold text-white tracking-tight" title={item.original_name || item.stored_name}>
                              {item.original_name || item.stored_name || 'Unnamed upload'}
                            </h3>
                            <button
                              type="button"
                              onClick={() => copyRecordJson(item)}
                              title="Copy JSON to clipboard"
                              className="rounded-lg p-1 text-slate-400 hover:text-cyan-300 hover:bg-slate-800 transition-colors"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                              </svg>
                            </button>
                            {copiedId === item.id && (
                              <span className="text-[10px] text-cyan-400 animate-fade-in font-medium">Copied!</span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                            <span className="rounded-md bg-slate-800/80 px-2 py-0.5 text-[10px] uppercase font-semibold text-slate-300">
                              {item.media_type || 'file'}
                            </span>
                            <span>•</span>
                            <span title={item.created_at}>{formatRelativeTime(item.created_at)}</span>
                            {typeof item.faces_detected === 'number' && (
                              <>
                                <span>•</span>
                                <span className="text-slate-300">
                                  {item.faces_detected} {item.faces_detected === 1 ? 'face' : 'faces'} analyzed
                                </span>
                              </>
                            )}
                            <span>•</span>
                            <span className="text-slate-400">ID #{item.id}</span>
                          </div>
                        </div>
                      </div>

                      {/* Verdict Pill & Fused Score Pill */}
                      <div className="flex flex-wrap items-center gap-3">
                        {numericFused !== null && (
                          <div className="flex items-center gap-2 rounded-2xl border border-white/5 bg-slate-900/80 px-3 py-1.5 text-xs">
                            <span className="text-slate-400">Score:</span>
                            <span className="font-bold text-white">{formatScore(numericFused)}</span>
                            <span className="text-[10px] text-slate-400 font-medium">({formatPercent(numericFused)})</span>
                          </div>
                        )}

                        <div className={`inline-flex items-center gap-1.5 rounded-2xl px-3 py-1.5 text-xs font-semibold tracking-wide ${verdict.badge}`}>
                          <span className={`h-2 w-2 rounded-full ${verdict.dot}`} />
                          {verdict.label}
                        </div>

                        <button
                          type="button"
                          onClick={() => toggleExpand(item.id)}
                          title="Toggle details"
                          className="rounded-xl border border-white/5 bg-slate-900/60 p-2 text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                        >
                          <svg className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* 4-Modality Detector Breakdown Grid */}
                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <DetectorCell
                        label="Visual Artifacts"
                        modelName="EfficientNet-B7"
                        status={item.visual_status}
                        score={item.visual_score}
                        classification={item.visual_classification}
                        isReversed={false}
                      />

                      <DetectorCell
                        label="Audio Acoustics"
                        modelName="wav2vec2-base"
                        status={item.audio_status}
                        score={item.audio_score}
                        classification={item.audio_classification}
                        isReversed={true}
                      />

                      <DetectorCell
                        label="AI Image Synthesis"
                        modelName="CLIP ViT-L/14"
                        status={item.ai_image_status}
                        score={item.ai_image_score}
                        classification={item.ai_image_classification}
                        isReversed={false}
                      />

                      <DetectorCell
                        label="Unified Ensemble"
                        modelName="Cross-Modal Fusion"
                        status={item.multimodal_status}
                        score={item.fused_score}
                        classification={item.multimodal_classification}
                        isReversed={false}
                      />
                    </div>

                    {/* Expandable Technical Details Drawer */}
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="mt-5 border-t border-white/5 pt-4"
                      >
                        <div className="flex items-center justify-between">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-cyan-300">
                            Model Telemetry & Raw Record
                          </h4>
                          <button
                            type="button"
                            onClick={() => copyRecordJson(item)}
                            className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-cyan-300"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
                            </svg>
                            Copy JSON
                          </button>
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3 text-xs text-slate-400">
                          <div className="rounded-2xl bg-slate-950/70 p-3 border border-white/5">
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Stored File</span>
                            <span className="text-slate-200 truncate block mt-0.5">{item.stored_name || 'N/A'}</span>
                          </div>
                          <div className="rounded-2xl bg-slate-950/70 p-3 border border-white/5">
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Timestamp</span>
                            <span className="text-slate-200 block mt-0.5">{item.created_at || 'N/A'}</span>
                          </div>
                          <div className="rounded-2xl bg-slate-950/70 p-3 border border-white/5">
                            <span className="text-slate-400 block text-[10px] uppercase font-semibold">Status</span>
                            <span className="text-slate-200 block mt-0.5 capitalize">{item.status || 'completed'}</span>
                          </div>
                        </div>

                        <div className="mt-3 overflow-hidden rounded-2xl border border-white/5 bg-[#070A11] p-3.5">
                          <pre className="max-h-52 overflow-auto text-[11px] font-mono text-slate-300 scrollbar-thin">
                            {JSON.stringify(item, null, 2)}
                          </pre>
                        </div>
                      </motion.div>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <ConfirmClearModal
        isOpen={isClearModalOpen}
        onClose={() => setIsClearModalOpen(false)}
        onConfirm={handleClearConfirm}
        clearing={clearing}
      />
    </div>
  );
}
