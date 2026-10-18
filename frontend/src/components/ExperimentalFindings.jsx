import React, { useState } from 'react';
import { runRPPGAnalysis } from '../services/api';

export default function ExperimentalFindings({ storedName, analysisId, initialData }) {
  const [data, setData] = useState(initialData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleRunAnalysis = async () => {
    if (!storedName && !analysisId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await runRPPGAnalysis({
        storedName,
        analysisId,
        forceEnable: true,
      });
      if (res.status === 'file_not_found' || res.status === 'open_failed') {
        setError(res.error || 'Failed analyzing video stream.');
      } else {
        setData(res);
      }
    } catch (err) {
      setError(err.message || 'Error running rPPG coupling analysis.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-500/30 bg-amber-950/10 p-5 space-y-4 backdrop-blur-xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-white/[0.08]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse" />
          <h4 className="text-xs font-bold uppercase tracking-wider text-amber-300">
            Physio-Acoustic Coupling (rPPG)
          </h4>
        </div>
        <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-300 w-fit">
          EXPERIMENTAL TRIAGE SIGNAL
        </span>
      </div>

      {/* Main Content */}
      {data && data.status === 'experimental' ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.06]">
              <div className="text-[10px] text-slate-400 uppercase">Estimated Pulse</div>
              <div className="text-lg font-bold text-white mt-0.5">
                {data.pulse_rate_bpm ? `${data.pulse_rate_bpm} BPM` : 'Undetected'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.06]">
              <div className="text-[10px] text-slate-400 uppercase">Audio Coupling (r)</div>
              <div className="text-lg font-bold text-cyan-300 mt-0.5">
                {data.correlation_coefficient !== null && data.correlation_coefficient !== undefined
                  ? data.correlation_coefficient
                  : 'No Audio'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.06]">
              <div className="text-[10px] text-slate-400 uppercase">Lag Offset</div>
              <div className="text-lg font-bold text-slate-200 mt-0.5">
                {data.lag_frames !== null && data.lag_frames !== undefined ? `${data.lag_frames} frames` : '—'}
              </div>
            </div>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.06]">
              <div className="text-[10px] text-slate-400 uppercase">Analyzed Frames</div>
              <div className="text-lg font-bold text-slate-200 mt-0.5">
                {data.frames_analyzed || '—'}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/40 border border-white/[0.06]">
          <div className="text-xs text-slate-300">
            {error ? (
              <span className="text-rose-300">{error}</span>
            ) : data?.status === 'insufficient_face_frames' ? (
              <span className="text-amber-200">{data.reason}</span>
            ) : (
              <span>Chrominance pulse extraction is available on video uploads.</span>
            )}
          </div>
          {(storedName || analysisId) && (
            <button
              type="button"
              onClick={handleRunAnalysis}
              disabled={loading}
              className="btn-glossy-primary px-3.5 py-1.5 text-xs font-semibold text-white shrink-0 disabled:opacity-50"
            >
              {loading ? 'Extracting Pulse…' : 'Run rPPG Coupling'}
            </button>
          )}
        </div>
      )}

      {/* Mandatory, non-collapsible disclaimer */}
      <div className="rounded-xl border border-amber-500/20 bg-amber-950/30 p-3 text-[11px] leading-relaxed text-amber-200/90">
        <strong>Forensic Disclaimer:</strong> This is an EXPERIMENTAL triage signal derived via the CHROM chrominance pulse extraction method. It NEVER overrides or modifies the primary visual or multimodal fusion score. Treat with appropriate skepticism.
      </div>
    </div>
  );
}
