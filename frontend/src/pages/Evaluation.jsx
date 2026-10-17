import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';

const DETECTORS = ['face', 'ai_image', 'audio', 'multimodal'];
const LABELS = {
  face: 'Visual Face Detector (EfficientNet-B7)',
  ai_image: 'Generative AI Image (CLIP ViT-L/14)',
  audio: 'Acoustic Biometrics (wav2vec2)',
  multimodal: 'Multimodal Decision Fusion',
};

const asPercent = (value) => (Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—');

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  const headers = (rows.shift() || []).map((value) => value.trim().replace(/^\uFEFF/, '').toLowerCase());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || '').trim()])));
}

function computeMetrics(rows) {
  return Object.fromEntries(
    DETECTORS.map((detector) => {
      const subset = rows.filter((row) => row.detector === detector);
      const eligible = subset.filter(
        (row) => row.status === 'completed' && ['real', 'fake'].includes(row.ground_truth) && ['real', 'fake'].includes(row.predicted_label)
      );
      const cm = { tp: 0, fp: 0, tn: 0, fn: 0 };
      for (const row of eligible) {
        if (row.ground_truth === 'fake' && row.predicted_label === 'fake') cm.tp += 1;
        else if (row.ground_truth === 'real' && row.predicted_label === 'fake') cm.fp += 1;
        else if (row.ground_truth === 'real' && row.predicted_label === 'real') cm.tn += 1;
        else if (row.ground_truth === 'fake' && row.predicted_label === 'real') cm.fn += 1;
      }
      const precision = cm.tp + cm.fp ? cm.tp / (cm.tp + cm.fp) : null;
      const recall = cm.tp + cm.fn ? cm.tp / (cm.tp + cm.fn) : null;
      return [
        detector,
        {
          total_files: subset.length,
          evaluated: eligible.length,
          not_applicable: subset.filter((row) => row.status === 'not_applicable').length,
          failed_or_errored: subset.filter(
            (row) => Boolean(row.error) || ['model_unavailable', 'inference_failed', 'corrupt_media'].includes(row.status)
          ).length,
          unscored:
            subset.length -
            eligible.length -
            subset.filter(
              (row) => Boolean(row.error) || ['model_unavailable', 'inference_failed', 'corrupt_media', 'not_applicable'].includes(row.status)
            ).length,
          confusion_matrix: cm,
          precision,
          recall,
          f1: precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null,
          accuracy: eligible.length ? (cm.tp + cm.tn) / eligible.length : null,
        },
      ];
    })
  );
}

function Metric({ label, value, color = 'text-white' }) {
  return (
    <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-3 text-center">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 font-mono text-base font-bold ${color}`}>{value}</p>
    </div>
  );
}

function Pill({ children, tone = 'green' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider ${
        tone === 'green' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 text-slate-300'
      }`}
    >
      {children}
    </span>
  );
}

export default function Evaluation() {
  const [report, setReport] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [sourceRows, setSourceRows] = useState(0);
  const [busy, setBusy] = useState(false);
  const metrics = useMemo(() => report?.detectors || null, [report]);

  const importFile = async (file) => {
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose a report smaller than 10 MB.');
      const text = await file.text();
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text);
        if (!parsed.detectors || typeof parsed.detectors !== 'object') {
          throw new Error('JSON report must contain a detectors object.');
        }
        setReport(parsed);
        setSourceRows(Number(parsed.files_total) || 0);
      } else if (file.name.toLowerCase().endsWith('.csv')) {
        const rows = parseCsv(text);
        if (!rows.length || !['detector', 'status', 'ground_truth', 'predicted_label'].every((field) => field in rows[0])) {
          throw new Error('CSV requires detector, status, ground_truth, and predicted_label headers.');
        }
        setReport({
          detectors: computeMetrics(rows),
          calibration_note: 'Metrics computed from imported per-file results CSV. Only completed predictions are included.',
        });
        setSourceRows(new Set(rows.map((row) => row.filename).filter(Boolean)).size);
      } else throw new Error('Please choose an evaluation summary .json or results .csv.');
      setFileName(file.name);
    } catch (err) {
      setError(err.message || 'Could not parse evaluation file.');
      setReport(null);
    } finally {
      setBusy(false);
    }
  };

  const downloadManifest = () => {
    const csv = 'filename,label,face_label,ai_image_label\nexample.jpg,unknown,,\n';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    link.download = 'clarity-evaluation-manifest-template.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return (
    <main className="mx-auto min-h-[78vh] max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs">
            <Link to="/dashboard" className="text-slate-400 hover:text-white transition-colors">
              Workspace
            </Link>
            <span className="text-slate-600">/</span>
            <span className="text-cyan-400 font-medium">Evaluation Lab</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Model Evaluation & Benchmarking
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            Inspect model precision, recall, F1-scores, and confusion matrices against ground-truth datasets.
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={downloadManifest}
          className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.08]"
        >
          Download Manifest Template
        </motion.button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        {/* Import Benchmarks Box */}
        <section
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            importFile(event.dataTransfer.files?.[0]);
          }}
          className={`rounded-3xl border-2 border-dashed p-6 sm:p-8 transition-all ${
            dragging
              ? 'border-cyan-500/50 bg-cyan-500/10 shadow-[0_0_30px_rgba(6,182,212,0.2)]'
              : 'border-white/[0.08] bg-[#0E121E]/60 backdrop-blur-xl'
          }`}
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 text-2xl mb-4 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
            📊
          </span>
          <h2 className="text-lg font-bold text-white tracking-tight">Import Benchmark Data</h2>
          <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
            Drop summary JSON or per-file results CSV produced by <code className="text-cyan-300">backend/evaluate.py</code>.
          </p>

          <label className="btn-shimmer mt-5 inline-flex cursor-pointer items-center rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-5 py-2.5 text-xs font-bold text-black shadow-md shadow-cyan-500/20">
            {busy ? 'Reading file…' : 'Choose Evaluation File'}
            <input
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="sr-only"
              onChange={(event) => importFile(event.target.files?.[0])}
            />
          </label>

          {fileName && (
            <p className="mt-3 truncate text-xs font-medium text-emerald-300">
              ✓ Loaded: {fileName}
            </p>
          )}

          {error && (
            <p role="alert" className="mt-4 rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-200">
              {error}
            </p>
          )}

          <div className="mt-8 border-t border-white/[0.06] pt-6">
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              How to Run Benchmark CLI
            </p>
            <ol className="mt-3 space-y-2 text-xs text-slate-400">
              <li>1. Create CSV manifest with ground truth labels.</li>
              <li>2. Run evaluation CLI script inside backend:</li>
            </ol>
            <pre className="mt-3 overflow-x-auto rounded-xl border border-white/[0.06] bg-black/30 p-3.5 font-mono text-[11px] text-cyan-300">
              python evaluate.py --manifest manifest.csv --data-dir ./dataset
            </pre>
          </div>
        </section>

        {/* Scorecard */}
        <section className="glass-card p-6 sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="text-lg font-bold text-white">Detector Scorecard</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                {report ? `${sourceRows} source samples · ${fileName}` : 'Import an evaluation file to visualize metrics'}
              </p>
            </div>
            {report && <Pill tone="green">Benchmark Active</Pill>}
          </div>

          {metrics ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {DETECTORS.map((detector, index) => {
                const metric = metrics[detector] || {};
                const cm = metric.confusion_matrix || {};

                return (
                  <motion.article
                    key={detector}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                          {LABELS[detector]}
                        </h3>
                        <p className="mt-0.5 text-[10px] text-slate-400">
                          {metric.evaluated || 0} evaluated / {metric.total_files || 0} files
                        </p>
                      </div>
                      <span className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 font-mono text-xs font-bold text-cyan-300">
                        F1 {asPercent(metric.f1)}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <Metric label="Precision" value={asPercent(metric.precision)} />
                      <Metric label="Recall" value={asPercent(metric.recall)} />
                      <Metric label="Accuracy" value={asPercent(metric.accuracy)} />
                    </div>

                    <div className="mt-4 rounded-xl border border-white/[0.04] bg-black/20 p-3">
                      <p className="mb-2 text-[9px] uppercase tracking-wider text-slate-400 text-center font-semibold">
                        Confusion Matrix
                      </p>
                      <div className="grid grid-cols-[auto_1fr_1fr] gap-1 text-center text-[10px]">
                        <span />
                        <span className="pb-1 text-slate-400 font-semibold">Pred Fake</span>
                        <span className="pb-1 text-slate-400 font-semibold">Pred Real</span>
                        <span className="self-center pr-1 text-slate-400 font-semibold">True Fake</span>
                        <span className="rounded-lg bg-rose-500/15 py-1.5 font-mono text-rose-200 font-bold">
                          TP {cm.tp ?? 0}
                        </span>
                        <span className="rounded-lg bg-amber-500/15 py-1.5 font-mono text-amber-200 font-bold">
                          FN {cm.fn ?? 0}
                        </span>
                        <span className="self-center pr-1 text-slate-400 font-semibold">True Real</span>
                        <span className="rounded-lg bg-amber-500/15 py-1.5 font-mono text-amber-200 font-bold">
                          FP {cm.fp ?? 0}
                        </span>
                        <span className="rounded-lg bg-emerald-500/15 py-1.5 font-mono text-emerald-200 font-bold">
                          TN {cm.tn ?? 0}
                        </span>
                      </div>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          ) : (
            <div className="mt-14 flex flex-col items-center justify-center text-center p-8">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.03] text-2xl text-slate-500 mb-3">
                ▦
              </span>
              <p className="text-sm font-bold text-white">No Benchmark Loaded</p>
              <p className="mt-1 text-xs text-slate-400 max-w-sm">
                Import a results CSV or summary JSON to inspect live confusion matrices and precision metrics.
              </p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
