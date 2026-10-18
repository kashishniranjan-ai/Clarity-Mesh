import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { canPreviewInBrowser, formatFileSize, getExtension, getMediaKind } from '../utils/file';

/**
 * Clean, modern preview card for selected media with smooth glass styling,
 * rounded framing, and spring removal button.
 */
export default function FilePreview({ file, onRemove }) {
  const [previewUrl, setPreviewUrl] = useState(null);

  const kind = getMediaKind(file);
  const previewable = canPreviewInBrowser(file);

  useEffect(() => {
    if (!previewable) {
      setPreviewUrl(null);
      return undefined;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, previewable]);

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="overflow-hidden rounded-3xl border border-white/10 bg-[#06080D]/90 backdrop-blur-2xl shadow-[0_12px_40px_rgba(0,0,0,0.8)]"
    >
      {/* Media Viewport */}
      <div className="relative flex items-center justify-center bg-black/60 p-4 sm:p-6 min-h-[220px]">
        {previewable && previewUrl && kind === 'image' && (
          <div className="relative">
            <img
              src={previewUrl}
              alt={`Preview of ${file.name}`}
              className="max-h-80 w-auto rounded-2xl object-contain shadow-2xl border border-white/10"
            />
          </div>
        )}
        {previewable && previewUrl && kind === 'video' && (
          <video
            id="cm-preview-video"
            src={previewUrl}
            controls
            preload="metadata"
            className="max-h-80 w-full rounded-2xl bg-black/80 shadow-2xl border border-white/10"
            aria-label={`Preview of ${file.name}`}
          >
            Your browser does not support video preview.
          </video>
        )}
        {previewable && previewUrl && kind === 'audio' && (
          <div className="flex flex-col items-center justify-center p-6 w-full max-w-md">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 mb-3 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 1v22M8 5v14M4 9v6M16 5v14M20 9v6" />
              </svg>
            </span>
            <audio controls src={previewUrl} className="w-full mt-2" />
          </div>
        )}
        {!previewable && (
          <div className="flex h-44 w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 text-slate-400 mb-1 border border-white/10">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="5" width="14" height="14" rx="2" />
                <path d="M17 10l4-2.5v9L17 14" />
              </svg>
            </span>
            <p className="text-sm font-medium text-slate-300">
              Browser preview unavailable for .{getExtension(file.name).toUpperCase()}
            </p>
            <p className="text-xs text-slate-500">Inference will run directly on the backend neural pipeline.</p>
          </div>
        )}
      </div>

      {/* Meta Bar */}
      <div className="flex items-center justify-between gap-4 border-t border-white/[0.08] bg-black/40 p-4 sm:px-6">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-white tracking-tight" title={file.name}>
            {file.name}
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
            <span className="rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-cyan-300 uppercase tracking-wide">
              {kind}
            </span>
            <span>&bull;</span>
            <span>{formatFileSize(file.size)}</span>
          </div>
        </div>

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          type="button"
          onClick={onRemove}
          className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-3.5 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors"
          aria-label={`Remove ${file.name}`}
        >
          Remove File
        </motion.button>
      </div>
    </motion.div>
  );
}
