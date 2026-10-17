import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ACCEPT_ATTRIBUTE, SUPPORTED_FORMATS, validateFile } from '../utils/file';

/**
 * Drag-and-drop / browse upload area with Canva/Claude style aesthetics,
 * smooth spring physics, format chips, and 1-click demo sample testing.
 */
export default function UploadZone({ hasFile = false, onFileSelect }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');
  const [loadingSample, setLoadingSample] = useState(false);

  const handleFiles = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    if (files.length > 1) {
      setError('Please select only one file at a time.');
      return;
    }

    const result = validateFile(files[0]);
    if (!result.valid) {
      setError(result.error);
      return;
    }

    setError('');
    onFileSelect(files[0]);
  };

  const handleDragOver = (event) => {
    event.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (event) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    setIsDragging(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragging(false);
    handleFiles(event.dataTransfer.files);
  };

  const handleInputChange = (event) => {
    handleFiles(event.target.files);
    event.target.value = '';
  };

  const openBrowser = () => inputRef.current?.click();

  const loadSample = async (samplePath, filename, mimeType) => {
    setLoadingSample(true);
    setError('');
    try {
      const res = await fetch(samplePath);
      if (!res.ok) throw new Error('Sample could not be loaded');
      const blob = await res.blob();
      const file = new File([blob], filename, { type: mimeType });
      handleFiles([file]);
    } catch (err) {
      setError(`Failed to load sample: ${err.message}`);
    } finally {
      setLoadingSample(false);
    }
  };

  return (
    <div className="w-full">
      <motion.div
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        animate={{
          scale: isDragging ? 1.015 : 1,
          borderColor: isDragging ? 'rgba(0, 242, 254, 0.7)' : 'rgba(255, 255, 255, 0.1)',
        }}
        transition={{ type: 'spring', stiffness: 350, damping: 25 }}
        className={`relative flex flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 text-center transition-all duration-300 overflow-hidden ${
          hasFile ? 'py-8' : 'py-12 sm:py-16'
        } ${
          isDragging
            ? 'bg-gradient-to-b from-cyan-500/10 via-sky-500/5 to-transparent shadow-[0_0_40px_rgba(6,182,212,0.25)]'
            : 'bg-black/40 backdrop-blur-xl hover:bg-black/60 hover:border-cyan-500/30'
        }`}
      >
        {/* Soft background glow on drag */}
        <div
          className={`absolute inset-0 bg-radial from-cyan-500/15 via-transparent to-transparent pointer-events-none transition-opacity duration-300 ${
            isDragging ? 'opacity-100' : 'opacity-0'
          }`}
        />

        {/* Floating Upload / Sparkles Icon */}
        <motion.div
          animate={{
            y: isDragging ? -8 : [0, -5, 0],
            scale: isDragging ? 1.12 : 1,
          }}
          transition={{
            y: isDragging ? { duration: 0.2 } : { repeat: Infinity, duration: 4, ease: 'easeInOut' },
            scale: { duration: 0.2 },
          }}
          className={`mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border transition-all duration-300 ${
            isDragging
              ? 'bg-gradient-to-tr from-cyan-500 to-emerald-400 text-black border-cyan-300 shadow-lg shadow-cyan-500/40'
              : 'border-cyan-500/20 bg-cyan-950/30 text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.15)]'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
            <path d="M12 12v9" />
            <path d="m16 16-4-4-4 4" />
          </svg>
        </motion.div>

        {/* Text descriptions */}
        <h3 className="text-lg font-bold text-white tracking-tight">
          {isDragging
            ? 'Release to upload media'
            : hasFile
              ? 'Drag and drop to replace current file'
              : 'Drag & drop image, video, or audio'}
        </h3>
        <p className="mt-1 text-xs text-slate-400 max-w-sm">
          Files up to 50 MB accepted. Runs multi-spectral neural pipeline (2D FFT, ELA, Sensor Noise, CLIP).
        </p>

        {/* Primary Action Button */}
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            type="button"
            onClick={openBrowser}
            className="btn-shimmer relative rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-7 py-2.5 text-xs font-bold text-black shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all"
          >
            Browse Files
          </motion.button>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleInputChange}
          className="hidden"
          aria-label="Choose an image or video file"
        />

        {/* Quick Demo Sample Selector */}
        {!hasFile && (
          <div className="mt-7 pt-6 border-t border-white/[0.06] w-full max-w-md">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2.5">
              Quick Test Samples
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <motion.button
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => loadSample('/samples/sample-portrait.jpg', 'facial-sample.jpg', 'image/jpeg')}
                disabled={loadingSample}
                className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-200 hover:bg-cyan-500/20 transition-all shadow-[0_0_12px_rgba(6,182,212,0.15)]"
              >
                <span>👤</span> Facial Analysis Sample
              </motion.button>

              <motion.button
                whileHover={{ scale: 1.03, y: -1 }}
                whileTap={{ scale: 0.97 }}
                type="button"
                onClick={() => loadSample('/samples/sample-ai-art.png', 'synthetic-art.png', 'image/png')}
                disabled={loadingSample}
                className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-500/20 transition-all shadow-[0_0_12px_rgba(16,185,129,0.15)]"
              >
                <span>🎨</span> AI Synthesis Sample
              </motion.button>
            </div>
          </div>
        )}

        {/* Supported Formats Chips */}
        <ul className="mt-5 flex flex-wrap justify-center gap-1.5" aria-label="Supported formats">
          {SUPPORTED_FORMATS.slice(0, 8).map((format) => (
            <li
              key={format.ext}
              className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[11px] font-medium text-slate-400"
            >
              {format.label}
            </li>
          ))}
          <li className="rounded-md border border-white/[0.06] bg-white/[0.02] px-2 py-0.5 text-[11px] font-medium text-slate-500">
            +more
          </li>
        </ul>
      </motion.div>

      {/* Error Alert */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            role="alert"
            className="mt-3.5 flex items-center gap-2.5 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-xs text-rose-200"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-rose-400" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
