import { motion } from 'framer-motion';

/**
 * AnalysisPipeline — Visual indicator showing the five multi-stage forensics pipeline steps:
 * Decode → Face Detection → Model Inference → Fusion → Explainability
 */
export default function AnalysisPipeline({ currentStage = 0, isComplete = false, error = null }) {
  const stages = [
    { id: 1, label: 'Media Decode', desc: 'Demux container & sample frames' },
    { id: 2, label: 'Face Detection', desc: 'Haar cascade & spatial alignment' },
    { id: 3, label: 'Model Inference', desc: 'EfficientNet-B7 & wav2vec scoring' },
    { id: 4, label: 'Multimodal Fusion', desc: '60/40 visual-audio calibration' },
    { id: 5, label: 'Explainability', desc: 'Grad-CAM saliency localization' },
  ];

  return (
    <div className="w-full bg-slate-950/70 border border-white/10 rounded-2xl p-4 shadow-xl space-y-3">
      <div className="flex items-center justify-between text-xs font-mono text-slate-400 pb-2 border-b border-white/5">
        <span className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
          <span className="text-white font-bold uppercase tracking-wider">Forensics Pipeline Execution</span>
        </span>
        <span>
          {isComplete ? (
            <span className="text-emerald-400 font-semibold">✓ Completed</span>
          ) : error ? (
            <span className="text-rose-400 font-semibold">✗ Pipeline Interrupted</span>
          ) : (
            <span className="text-cyan-400 animate-pulse">Stage {Math.min(currentStage + 1, stages.length)} of {stages.length}</span>
          )}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
        {stages.map((stage, idx) => {
          const isDone = isComplete || currentStage > idx;
          const isActive = !isComplete && currentStage === idx && !error;
          const isFailed = error && currentStage === idx;

          return (
            <div
              key={stage.id}
              className={`relative flex flex-col p-2.5 rounded-xl border transition-all duration-300 ${
                isDone
                  ? 'bg-slate-900/90 border-emerald-500/40 text-emerald-300'
                  : isActive
                  ? 'bg-cyan-950/50 border-cyan-400 text-cyan-200 shadow-lg shadow-cyan-500/10'
                  : isFailed
                  ? 'bg-rose-950/40 border-rose-500/50 text-rose-300'
                  : 'bg-slate-900/30 border-white/5 text-slate-500'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-mono font-bold">0{stage.id}</span>
                {isDone ? (
                  <span className="text-emerald-400 text-xs font-bold">✓</span>
                ) : isActive ? (
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
                    className="inline-block w-3 h-3 border-2 border-cyan-400 border-t-transparent rounded-full"
                  />
                ) : isFailed ? (
                  <span className="text-rose-400 text-xs font-bold">✗</span>
                ) : (
                  <span className="text-[10px] font-mono text-slate-600">PENDING</span>
                )}
              </div>

              <div className="text-xs font-bold truncate text-slate-200">{stage.label}</div>
              <div className="text-[10px] text-slate-400 leading-tight mt-0.5 line-clamp-1">{stage.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
