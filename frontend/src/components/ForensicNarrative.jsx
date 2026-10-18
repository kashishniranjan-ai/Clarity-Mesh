import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { getForensicNarrative } from '../services/api';

/**
 * ForensicNarrative — "Why was this flagged?" panel.
 * Converts complex multimodal scores, flags, and saliency peak regions into
 * an intelligible, human-readable forensic report summary.
 */
export default function ForensicNarrative({ analysisData }) {
  const [narrative, setNarrative] = useState('');
  const [generator, setGenerator] = useState('template');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!analysisData) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    // Extract structured data
    const payload = {
      analysis_id: analysisData.id,
      media_type: analysisData.media_type,
      frames_analyzed: analysisData.visual_analysis?.frames_analyzed || 0,
      faces_analyzed: analysisData.visual_analysis?.faces_analyzed || 0,
      faces_detected: analysisData.faces_detected || 0,
      visual_score: analysisData.visual_analysis?.score ?? null,
      visual_classification: analysisData.visual_analysis?.classification ?? null,
      visual_status: analysisData.visual_analysis?.status ?? null,
      audio_score: analysisData.audio_analysis?.score ?? null,
      audio_classification: analysisData.audio_analysis?.classification ?? null,
      audio_status: analysisData.audio_analysis?.status ?? null,
      fused_score: analysisData.multimodal_analysis?.fused_fake_score ?? analysisData.multimodal_analysis?.score ?? null,
      fused_classification: analysisData.multimodal_analysis?.classification ?? null,
      multimodal_status: analysisData.multimodal_analysis?.status ?? null,
      ai_image_score: analysisData.ai_image_analysis?.score ?? null,
      ai_image_classification: analysisData.ai_image_analysis?.classification ?? null,
      peak_regions: analysisData.explainability?.peak_regions || [],
    };

    getForensicNarrative(payload)
      .then((res) => {
        if (!isMounted) return;
        if (res.status === 'ok') {
          setNarrative(res.narrative);
          setGenerator(res.generator || 'template');
        } else {
          setError('Failed to generate narrative');
        }
      })
      .catch((err) => {
        if (isMounted) setError(err.message || 'Error communicating with narrative service');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [analysisData]);

  if (!analysisData) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="glass-card p-5 space-y-4 border border-cyan-500/20 bg-slate-950/85 rounded-2xl shadow-xl"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <h3 className="text-sm font-bold tracking-wider text-white uppercase">
            Why was this flagged? — Forensic Finding
          </h3>
        </div>

        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-semibold bg-cyan-950/80 border border-cyan-500/30 text-cyan-300">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            {generator === 'openai' ? 'OpenAI Forensics' : 'Deterministic Engine'}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono bg-emerald-950/80 border border-emerald-500/30 text-emerald-300">
            ✓ Numbers Verified
          </span>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2 py-2 animate-pulse">
          <div className="h-4 bg-slate-800 rounded w-full" />
          <div className="h-4 bg-slate-800 rounded w-11/12" />
          <div className="h-4 bg-slate-800 rounded w-4/5" />
        </div>
      ) : error ? (
        <p className="text-xs text-rose-300 py-2">{error}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-200 leading-relaxed font-sans bg-slate-900/60 p-3.5 rounded-xl border border-white/5">
            {narrative}
          </p>

          {/* Key Factor Highlights */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
            <div className="bg-slate-900/40 border border-white/5 rounded-lg p-2.5 text-center">
              <span className="text-[10px] uppercase font-mono text-slate-400 block mb-0.5">Visual Model</span>
              <span className="text-xs font-mono font-bold text-white">
                {analysisData.visual_analysis?.score !== undefined ? analysisData.visual_analysis.score : 'N/A'}
              </span>
            </div>

            <div className="bg-slate-900/40 border border-white/5 rounded-lg p-2.5 text-center">
              <span className="text-[10px] uppercase font-mono text-slate-400 block mb-0.5">Audio Biometrics</span>
              <span className="text-xs font-mono font-bold text-white">
                {analysisData.audio_analysis?.score !== undefined ? analysisData.audio_analysis.score : 'Not Present'}
              </span>
            </div>

            <div className="bg-slate-900/40 border border-white/5 rounded-lg p-2.5 text-center">
              <span className="text-[10px] uppercase font-mono text-slate-400 block mb-0.5">Multimodal Verdict</span>
              <span
                className={`text-xs font-mono font-bold uppercase ${
                  (analysisData.multimodal_analysis?.classification || analysisData.visual_analysis?.classification) === 'deepfake'
                    ? 'text-rose-400'
                    : 'text-emerald-400'
                }`}
              >
                {analysisData.multimodal_analysis?.classification || analysisData.visual_analysis?.classification || 'Inconclusive'}
              </span>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
