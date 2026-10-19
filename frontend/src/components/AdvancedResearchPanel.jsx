import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import ExperimentalFindings from './ExperimentalFindings';
import {
  describeApiError,
  getSourceAttribution,
  getWatermarkDetection,
  runRobustnessEvaluation,
} from '../services/api';

const INITIAL_STATE = { loading: false, data: null, error: '' };

function ResearchCard({
  title,
  badge,
  description,
  tone = 'cyan',
  actionLabel,
  onAction,
  disabled = false,
  busy = false,
  children,
}) {
  const toneMap = {
    cyan: 'border-cyan-500/20 bg-cyan-500/[0.04] text-cyan-300',
    violet: 'border-violet-500/20 bg-violet-500/[0.04] text-violet-300',
    amber: 'border-amber-500/20 bg-amber-500/[0.04] text-amber-300',
  };

  return (
    <div className="glass-card p-5 sm:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold tracking-tight text-white">{title}</h4>
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${toneMap[tone]}`}>
              {badge}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-400">{description}</p>
        </div>

        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            disabled={disabled || busy}
            className="btn-glossy-black rounded-xl px-3.5 py-2 text-xs font-bold text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Running…' : actionLabel}
          </button>
        )}
      </div>

      <div className="mt-4">{children}</div>
    </div>
  );
}

function StatusCallout({ state, idleLabel }) {
  if (state.loading) {
    return (
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.05] p-4 text-xs text-cyan-200">
        Executing analyst check...
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-4 text-xs leading-relaxed text-rose-200">
        {state.error}
      </div>
    );
  }

  if (!state.data) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-400">
        {idleLabel}
      </div>
    );
  }

  const unavailable = state.data.status && state.data.status !== 'ok';
  return (
    <div className={`rounded-2xl border p-4 text-xs leading-relaxed ${
      unavailable
        ? 'border-amber-500/25 bg-amber-500/[0.06] text-amber-100'
        : 'border-emerald-500/25 bg-emerald-500/[0.06] text-emerald-100'
    }`}>
      <p className="font-semibold uppercase tracking-[0.18em]">
        {String(state.data.status || 'ready').replace(/_/g, ' ')}
      </p>
      {state.data.reason && <p className="mt-2">{state.data.reason}</p>}
      {state.data.disclaimer && <p className="mt-2 text-[11px] opacity-90">{state.data.disclaimer}</p>}
    </div>
  );
}

function RobustnessResults({ state, attack, setAttack, canRun, onRun }) {
  const baseline = state.data?.baseline_score;
  const results = Array.isArray(state.data?.results) ? state.data.results : [];
  const maxShift = results.reduce((acc, item) => Math.max(acc, Math.abs(Number(item.delta) || 0)), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Stress Test Profile</p>
          <p className="mt-1 text-xs text-slate-300">
            Measures how sensitive the visual detector is to small perturbations. It does not certify adversarial defense.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAttack('fgsm')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              attack === 'fgsm'
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/40'
                : 'border border-white/10 bg-white/[0.03] text-slate-300'
            }`}
          >
            FGSM
          </button>
          <button
            type="button"
            onClick={() => setAttack('pgd')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold transition-all ${
              attack === 'pgd'
                ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-400/40'
                : 'border border-white/10 bg-white/[0.03] text-slate-300'
            }`}
          >
            PGD
          </button>
          <button
            type="button"
            onClick={onRun}
            disabled={!canRun || state.loading}
            className="btn-glossy-primary rounded-xl px-3.5 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {state.loading ? 'Running…' : 'Run Stress Test'}
          </button>
        </div>
      </div>

      {!state.data && !state.error && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-slate-400">
          Run a stress test after analysis to inspect baseline score drift across adversarial epsilon sweeps.
        </div>
      )}

      {state.error && (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.06] p-4 text-xs text-rose-200">
          {state.error}
        </div>
      )}

      {state.data && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Baseline Score</p>
              <p className="mt-2 font-mono text-2xl font-bold text-white">
                {Number.isFinite(baseline) ? `${(baseline * 100).toFixed(1)}%` : 'N/A'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Attack Mode</p>
              <p className="mt-2 font-mono text-2xl font-bold capitalize text-cyan-300">
                {state.data.attack || attack}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Max Drift</p>
              <p className="mt-2 font-mono text-2xl font-bold text-amber-300">
                {(maxShift * 100).toFixed(1)}%
              </p>
            </div>
          </div>

          {results.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-white/10">
              <div className="grid grid-cols-[1fr_1fr_1fr] bg-white/[0.04] px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
                <span>Epsilon</span>
                <span>Perturbed Score</span>
                <span>Delta</span>
              </div>
              <div className="divide-y divide-white/6 bg-black/20">
                {results.map((item) => (
                  <div key={`${item.epsilon}-${item.perturbed_score}`} className="grid grid-cols-[1fr_1fr_1fr] px-4 py-3 text-xs text-slate-200">
                    <span className="font-mono">{item.epsilon}</span>
                    <span className="font-mono">{(Number(item.perturbed_score) * 100).toFixed(1)}%</span>
                    <span className={`font-mono ${Number(item.delta) > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                      {Number(item.delta) > 0 ? '+' : ''}
                      {(Number(item.delta) * 100).toFixed(2)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {state.data.disclaimer && (
            <p className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.05] p-4 text-[11px] leading-relaxed text-amber-200">
              {state.data.disclaimer}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdvancedResearchPanel({
  storedName,
  analysisId,
  mediaType,
  visualStatus,
}) {
  const [attack, setAttack] = useState('fgsm');
  const [attributionState, setAttributionState] = useState(INITIAL_STATE);
  const [watermarkState, setWatermarkState] = useState(INITIAL_STATE);
  const [robustnessState, setRobustnessState] = useState(INITIAL_STATE);

  const target = useMemo(
    () => ({
      storedName,
      analysisId,
    }),
    [analysisId, storedName],
  );

  const canRunRobustness = Boolean(target.storedName || target.analysisId) && ['image', 'video'].includes(mediaType);

  const runAttribution = async () => {
    setAttributionState({ loading: true, data: null, error: '' });
    try {
      const data = await getSourceAttribution(target.storedName);
      setAttributionState({ loading: false, data, error: '' });
    } catch (error) {
      setAttributionState({ loading: false, data: null, error: describeApiError(error) });
    }
  };

  const runWatermark = async () => {
    setWatermarkState({ loading: true, data: null, error: '' });
    try {
      const data = await getWatermarkDetection(target.storedName);
      setWatermarkState({ loading: false, data, error: '' });
    } catch (error) {
      setWatermarkState({ loading: false, data: null, error: describeApiError(error) });
    }
  };

  const runRobustness = async () => {
    setRobustnessState({ loading: true, data: null, error: '' });
    try {
      const data = await runRobustnessEvaluation({
        storedName: target.storedName,
        analysisId: target.analysisId,
        attack,
        epsilons: attack === 'pgd' ? [0.01, 0.02, 0.05] : [0.005, 0.01, 0.03, 0.05],
        pgdSteps: 5,
        pgdAlpha: 0.01,
        forceEnable: true,
      });
      setRobustnessState({ loading: false, data, error: '' });
    } catch (error) {
      setRobustnessState({ loading: false, data: null, error: describeApiError(error) });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="space-y-6"
    >
      <div className="glass-card overflow-hidden p-6 sm:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-cyan-300">
              Analyst Expansion Layer
            </div>
            <h3 className="mt-4 text-xl font-black tracking-tight text-white sm:text-2xl">
              Advanced Research, Robustness, And Provenance Ops
            </h3>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
              Adds enterprise-style secondary checks on top of the core detector verdict: provenance research hooks,
              invisible watermark readiness, adversarial stress testing, and physiologic coupling signals for video.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Core Verdict</p>
              <p className="mt-2 text-sm font-semibold text-white">
                {visualStatus ? String(visualStatus).replace(/_/g, ' ') : 'Ready'}
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Evidence Target</p>
              <p className="mt-2 truncate font-mono text-xs text-cyan-300">{storedName || `analysis:${analysisId}` || 'pending'}</p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Ops Mode</p>
              <p className="mt-2 text-sm font-semibold text-emerald-300">
                {mediaType === 'video' ? 'Video workflow' : mediaType === 'image' ? 'Image workflow' : 'Audio workflow'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_1.1fr_1.3fr]">
        <ResearchCard
          title="Generator Source Attribution"
          badge="Research Spike"
          tone="violet"
          description="Document generator-origin readiness inside the analyst workflow. This exposes the existing attribution endpoint with honest unavailable handling."
          actionLabel="Run Attribution"
          onAction={runAttribution}
          busy={attributionState.loading}
        >
          <StatusCallout
            state={attributionState}
            idleLabel="No attribution run yet. Launch this to capture whether a generator fingerprint can be determined for the current asset."
          />
        </ResearchCard>

        <ResearchCard
          title="Invisible Watermark Readiness"
          badge="Research Spike"
          tone="amber"
          description="Expose future-facing SynthID or stable-signature verification directly in the workbench, while preserving honest unavailable states."
          actionLabel="Check Watermark"
          onAction={runWatermark}
          busy={watermarkState.loading}
        >
          <StatusCallout
            state={watermarkState}
            idleLabel="No watermark check run yet. This section is designed to absorb future public detector integrations without changing the workflow."
          />
        </ResearchCard>

        <ResearchCard
          title="Adversarial Robustness Stress Lab"
          badge="Advanced Triage"
          tone="cyan"
          description="Probe the face classifier with FGSM or PGD sweeps and measure score drift for operational confidence analysis."
        >
          <RobustnessResults
            state={robustnessState}
            attack={attack}
            setAttack={setAttack}
            canRun={canRunRobustness}
            onRun={runRobustness}
          />
        </ResearchCard>
      </div>

      {mediaType === 'video' && (
        <ExperimentalFindings
          storedName={storedName}
          analysisId={analysisId}
        />
      )}
    </motion.div>
  );
}
