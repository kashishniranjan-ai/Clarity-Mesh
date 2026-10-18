import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getVisualExplainability } from '../services/api';

/**
 * HeatmapViewer — Forensic Saliency & Grad-CAM visual explainability inspector.
 * Provides original crop, heatmap, and blended overlay inspection with an opacity slider
 * and frame selector for multi-frame media.
 */
export default function HeatmapViewer({
  storedName,
  analysisId,
  perFrameScores = [],
  initialFrame = null,
  onFrameSelect = null,
}) {
  const [activeTab, setActiveTab] = useState('overlay'); // 'original' | 'heatmap' | 'overlay'
  const [method, setMethod] = useState('gradcam');
  const [selectedFrame, setSelectedFrame] = useState(initialFrame ?? (perFrameScores[0]?.frame ?? 0));
  const [opacity, setOpacity] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Sync selectedFrame when initialFrame changes from external clicks (e.g. timeline)
  useEffect(() => {
    if (initialFrame !== null && initialFrame !== undefined) {
      setSelectedFrame(initialFrame);
    }
  }, [initialFrame]);

  useEffect(() => {
    if (!storedName && !analysisId) return;

    let isMounted = true;
    setLoading(true);
    setError(null);

    getVisualExplainability({
      storedName,
      analysisId,
      frameIndex: selectedFrame,
      method,
    })
      .then((res) => {
        if (!isMounted) return;
        if (res.status === 'completed') {
          setData(res);
          setError(null);
        } else if (res.status === 'gradcam_unavailable') {
          // Graceful fallback to occlusion
          setMethod('occlusion');
        } else {
          setError(res.message || res.error || `Status: ${res.status}`);
          setData(res);
        }
      })
      .catch((err) => {
        if (isMounted) setError(err.message || 'Failed loading explanation');
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [storedName, analysisId, selectedFrame, method]);

  const handleFrameChange = (f) => {
    setSelectedFrame(f);
    if (onFrameSelect) onFrameSelect(f);
  };

  return (
    <div className="glass-card p-5 space-y-4 border border-cyan-500/20 bg-slate-950/80 shadow-2xl rounded-2xl">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-pulse" />
          <h3 className="text-sm font-bold tracking-wider text-white uppercase flex items-center gap-2">
            🔬 Visual Explainability (Grad-CAM / Occlusion)
          </h3>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {/* Method selector */}
          <div className="flex bg-slate-900 border border-white/10 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setMethod('gradcam')}
              className={`px-2.5 py-1 rounded-md transition font-mono ${
                method === 'gradcam' ? 'bg-cyan-500 text-black font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Grad-CAM
            </button>
            <button
              type="button"
              onClick={() => setMethod('occlusion')}
              className={`px-2.5 py-1 rounded-md transition font-mono ${
                method === 'occlusion' ? 'bg-cyan-500 text-black font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              Occlusion
            </button>
          </div>

          {/* Frame selector if video has multiple sampled frames */}
          {perFrameScores && perFrameScores.length > 1 && (
            <select
              value={selectedFrame}
              onChange={(e) => handleFrameChange(Number(e.target.value))}
              className="bg-slate-900 border border-white/10 text-white rounded-lg px-2.5 py-1 font-mono text-xs focus:outline-none focus:border-cyan-400"
            >
              {perFrameScores.map((p) => (
                <option key={p.frame} value={p.frame}>
                  Frame {p.frame} ({p.timestamp_s !== undefined ? `${p.timestamp_s}s` : `score ${p.score}`})
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Main View Area */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left side: Image viewport */}
        <div className="lg:col-span-7 flex flex-col items-center">
          {/* View Mode Tabs */}
          <div className="flex items-center justify-center gap-1.5 p-1 bg-slate-900/90 border border-white/10 rounded-xl mb-3 w-full max-w-sm">
            <button
              type="button"
              onClick={() => setActiveTab('original')}
              className={`flex-1 py-1 text-xs rounded-lg transition font-medium ${
                activeTab === 'original' ? 'bg-white/20 text-white shadow' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Face Crop
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('heatmap')}
              className={`flex-1 py-1 text-xs rounded-lg transition font-medium ${
                activeTab === 'heatmap' ? 'bg-cyan-500/30 text-cyan-200 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Heatmap
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('overlay')}
              className={`flex-1 py-1 text-xs rounded-lg transition font-medium ${
                activeTab === 'overlay' ? 'bg-cyan-500 text-slate-950 font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Blended Overlay
            </button>
          </div>

          {/* Image Display Frame */}
          <div className="relative w-full max-w-[360px] aspect-square rounded-2xl overflow-hidden border border-white/15 bg-slate-950 flex items-center justify-center shadow-inner">
            {loading && (
              <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm z-20 flex flex-col items-center justify-center gap-2">
                <div className="w-7 h-7 border-2 border-cyan-400 border-t-transparent rounded-full animate-spin" />
                <span className="text-[11px] font-mono text-cyan-300">Computing {method} activations...</span>
              </div>
            )}

            <AnimatePresence mode="wait">
              {data && data.status === 'completed' ? (
                <motion.div
                  key={`${activeTab}-${selectedFrame}`}
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="relative w-full h-full"
                >
                  {/* Dynamic Opacity Blend if in overlay mode */}
                  {activeTab === 'overlay' ? (
                    <div className="relative w-full h-full">
                      <img
                        src={data.original_crop_b64}
                        alt="Original face crop"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                      <img
                        src={data.heatmap_crop_b64 || data.heatmap_b64}
                        alt="Activation heatmap"
                        style={{ opacity }}
                        className="absolute inset-0 w-full h-full object-cover mix-blend-screen transition-opacity duration-75"
                      />
                    </div>
                  ) : activeTab === 'original' ? (
                    <img
                      src={data.original_crop_b64}
                      alt="Original face crop"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={data.heatmap_crop_b64 || data.heatmap_b64}
                      alt="Saliency heatmap"
                      className="w-full h-full object-cover"
                    />
                  )}
                </motion.div>
              ) : error ? (
                <div className="p-4 text-center text-xs text-rose-300 space-y-1">
                  <p className="font-semibold">Explainability unavailable</p>
                  <p className="text-[11px] text-slate-400">{error}</p>
                </div>
              ) : (
                <div className="text-center text-xs text-slate-500 font-mono">
                  Select an analyzed media to inspect saliency
                </div>
              )}
            </AnimatePresence>
          </div>

          {/* Opacity Slider for Overlay */}
          {activeTab === 'overlay' && (
            <div className="w-full max-w-[360px] mt-3 space-y-1">
              <div className="flex justify-between text-[11px] font-mono text-slate-400">
                <span>Original</span>
                <span className="text-cyan-400 font-bold">{Math.round(opacity * 100)}% Heatmap</span>
                <span>Saliency</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={opacity}
                onChange={(e) => setOpacity(parseFloat(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer h-1.5 bg-slate-800 rounded-lg"
              />
            </div>
          )}
        </div>

        {/* Right side: Peak Activation Regions & Findings */}
        <div className="lg:col-span-5 space-y-3">
          <div className="bg-slate-900/60 border border-white/10 rounded-xl p-3.5 space-y-2">
            <h4 className="text-xs font-semibold text-slate-300 tracking-wide uppercase flex items-center justify-between">
              <span>Peak Activation Regions</span>
              <span className="text-[10px] font-mono text-cyan-400">
                {data?.peak_regions?.length || 0} localized
              </span>
            </h4>

            {data?.peak_regions && data.peak_regions.length > 0 ? (
              <div className="space-y-1.5">
                {data.peak_regions.map((reg, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between bg-slate-950/70 border border-white/5 rounded-lg px-2.5 py-1.5 text-xs"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                      <span className="text-slate-200 capitalize font-medium">
                        {reg.description}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-amber-300 font-semibold">
                      {(reg.peak_intensity * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic py-2">
                No high-density anomalous activations detected in this crop.
              </p>
            )}
          </div>

          {/* Model info panel */}
          {data && (
            <div className="bg-slate-900/40 border border-white/5 rounded-xl p-3 space-y-1.5 text-[11px] font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Model Baseline Score:</span>
                <span className="text-white font-bold">{data.baseline_score ?? 'N/A'}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Verdict Label:</span>
                <span className={data.baseline_classification === 'deepfake' ? 'text-rose-400 font-bold' : 'text-emerald-400 font-bold'}>
                  {data.baseline_classification?.toUpperCase() ?? 'N/A'}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Method Applied:</span>
                <span className="text-cyan-300 font-semibold">{data.method}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Compute Latency:</span>
                <span className="text-slate-300">{data.latency_ms} ms</span>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-500 leading-normal">
            Grad-CAM visualizes features in the final convolutional block that influenced the classification decision. Saliency highlights what the network focused on, not legal culpability.
          </p>
        </div>
      </div>
    </div>
  );
}
