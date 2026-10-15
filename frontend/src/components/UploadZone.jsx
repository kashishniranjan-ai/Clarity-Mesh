import { useRef, useState } from 'react';
import { ACCEPT_ATTRIBUTE, SUPPORTED_FORMATS, validateFile } from '../utils/file';

/**
 * Drag-and-drop / browse upload area.
 * Validates the chosen file and reports a valid selection through `onFileSelect`.
 * It does not upload anything anywhere.
 */
export default function UploadZone({ hasFile = false, onFileSelect }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');

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
    // Ignore events fired when moving over child elements.
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
    // Reset so selecting the same file again still triggers onChange.
    event.target.value = '';
  };

  const openBrowser = () => inputRef.current?.click();

  return (
    <div>
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`relative flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 text-center transition-all duration-300 ${
          hasFile ? 'py-8' : 'py-14 sm:py-16'
        } ${
          isDragging
            ? 'border-cyan-400 bg-cyan-500/5 glow-cyan'
            : 'border-white/10 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-cyan-500/[0.02]'
        }`}
      >
        {/* Animated upload icon */}
        <span className={`mb-4 flex h-16 w-16 items-center justify-center rounded-2xl transition-all duration-300 ${
          isDragging
            ? 'bg-cyan-500/10 text-cyan-300 scale-110'
            : 'bg-white/5 text-slate-400'
        }`}>
          <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M12 4l-4 4M12 4l4 4" />
            <path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
          </svg>
        </span>

        <p className="text-base font-semibold text-slate-200">
          {isDragging
            ? 'Drop your file here'
            : hasFile
              ? 'Drag and drop to replace the selected file'
              : 'Drag and drop an image or video here'}
        </p>
        <p className="mt-1 text-sm text-slate-500">or</p>

        <button
          type="button"
          onClick={openBrowser}
          className="btn-shimmer relative mt-4 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/15 transition-all duration-300 hover:shadow-cyan-500/25 hover:scale-[1.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0c1222]"
        >
          Browse Files
        </button>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT_ATTRIBUTE}
          onChange={handleInputChange}
          className="hidden"
          aria-label="Choose an image or video file"
        />

        <ul className="mt-6 flex flex-wrap justify-center gap-2" aria-label="Supported formats">
          {SUPPORTED_FORMATS.map((format) => (
            <li
              key={format.ext}
              className="rounded-md border border-white/5 bg-white/[0.03] px-2.5 py-0.5 text-xs font-medium text-slate-500 transition-colors hover:text-cyan-400 hover:border-cyan-500/20"
            >
              {format.label}
            </li>
          ))}
        </ul>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300"
        >
          {error}
        </p>
      )}
    </div>
  );
}
