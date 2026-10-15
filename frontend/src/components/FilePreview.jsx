import { useEffect, useState } from 'react';
import { canPreviewInBrowser, formatFileSize, getExtension, getMediaKind } from '../utils/file';

/**
 * Shows details of the selected file (name, type, size) with a preview
 * when the browser can render it, plus a remove button.
 */
export default function FilePreview({ file, onRemove }) {
  const [previewUrl, setPreviewUrl] = useState(null);

  const kind = getMediaKind(file);
  const previewable = canPreviewInBrowser(file);

  // Create an object URL for the preview and always release it afterwards.
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
    <div className="overflow-hidden rounded-2xl border border-white/5 bg-white/[0.02] glass-card animate-fade-in">
      {/* Preview area */}
      <div className="relative flex items-center justify-center bg-black/40">
        {/* Scan-line overlay for forensic feel */}
        {previewable && previewUrl && (
          <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
            <div className="absolute inset-x-0 h-12 bg-gradient-to-b from-cyan-400/5 to-transparent animate-scan" />
          </div>
        )}

        {previewable && previewUrl && kind === 'image' && (
          <img
            src={previewUrl}
            alt={`Preview of ${file.name}`}
            className="max-h-80 w-full object-contain"
          />
        )}
        {previewable && previewUrl && kind === 'video' && (
          <video
            src={previewUrl}
            controls
            preload="metadata"
            className="max-h-80 w-full bg-black"
            aria-label={`Preview of ${file.name}`}
          >
            Your browser does not support video preview.
          </video>
        )}
        {!previewable && (
          <div className="flex h-48 w-full flex-col items-center justify-center gap-2 px-4 text-center">
            <svg viewBox="0 0 24 24" className="h-10 w-10 text-slate-600" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="14" height="14" rx="2" />
              <path d="M17 10l4-2.500v9L17 14" />
            </svg>
            <p className="text-sm text-slate-500">
              Preview not available for .{getExtension(file.name).toUpperCase()} files in the browser.
            </p>
            <p className="text-xs text-slate-600">The file can still be analyzed once the backend is connected.</p>
          </div>
        )}
      </div>

      {/* File info bar */}
      <div className="flex items-center justify-between gap-3 border-t border-white/5 p-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-200" title={file.name}>
            {file.name}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            <span className="capitalize">{kind}</span> &middot; {formatFileSize(file.size)}
          </p>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-sm font-medium text-slate-400 transition-all duration-200 hover:border-rose-500/30 hover:bg-rose-500/5 hover:text-rose-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
          aria-label={`Remove ${file.name}`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}
