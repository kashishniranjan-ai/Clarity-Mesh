import { useState } from 'react';
import UploadZone from './UploadZone';
import FilePreview from './FilePreview';
import {
  API_BASE_URL,
  MAX_UPLOAD_SIZE_MB,
  analyzeMedia,
  describeApiError,
} from '../services/api';
import { formatFileSize, getMediaKind } from '../utils/file';

/**
 * Upload + analyze area.
 *
 * Sends the selected file to the FastAPI backend (POST /api/analyze),
 * which decodes it, detects faces and runs the pretrained visual
 * deepfake model (STEP 6). The `visual_analysis` block returned by the
 * backend is rendered as-is — including its honest failure states
 * (no face / model unavailable / inference failed) where no score exists.
 */

function ResultRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="break-all text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}

export default function AnalyzeSection() {
  const [file, setFile] = useState(null);
  // status: null | { type: 'error' | 'info' | 'success', text: string }
  const [status, setStatus] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState(null);

  const handleFileSelect = (selected) => {
    setFile(selected);
    setStatus(null);
    setResult(null);
  };

  const handleRemove = () => {
    setFile(null);
    setStatus(null);
    setResult(null);
  };

  const handleAnalyze = async () => {
    if (isUploading) return;

    if (!file) {
      setStatus({
        type: 'error',
        text: 'Please select an image or video before analyzing.',
      });
      return;
    }

    setIsUploading(true);
    setStatus({ type: 'info', text: 'Uploading media to the backend…' });
    setResult(null);

    try {
      const payload = await analyzeMedia(file);
      setResult(payload);
      const visual = payload?.visual_analysis;
      if (visual?.status === 'completed') {
        setStatus({
          type: 'success',
          text: `Visual analysis complete — model score ${Number(visual.score).toFixed(4)} (${visual.classification}).`,
        });
      } else if (visual) {
        setStatus({ type: 'info', text: visual.message || 'No model score is available for this upload.' });
      } else {
        setStatus({ type: 'success', text: 'Media analyzed successfully.' });
      }
    } catch (error) {
      setResult(null);
      setStatus({ type: 'error', text: describeApiError(error) });
    } finally {
      setIsUploading(false);
    }
  };

  const fileInfo = result?.file || null;
  const visual = result?.visual_analysis || null;

  return (
    <section id="upload" className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
      <div className="text-center">
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Analyze Your Media</h2>
        <p className="mt-3 text-slate-600">
          Upload an image or video to check it for signs of AI generation or manipulation.
        </p>
      </div>

      <div className="mt-8 space-y-5 rounded-2xl border border-slate-200 bg-slate-100/60 p-4 sm:p-6">
        <UploadZone hasFile={Boolean(file)} onFileSelect={handleFileSelect} />

        {file && <FilePreview file={file} onRemove={handleRemove} />}

        <div className="flex flex-col items-stretch gap-3">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={isUploading}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-cyan-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isUploading && (
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
            )}
            {isUploading ? 'Uploading…' : 'Analyze Media'}
          </button>

          {status && (
            <p
              role={status.type === 'error' ? 'alert' : 'status'}
              className={`rounded-lg border px-4 py-3 text-sm ${
                status.type === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : status.type === 'success'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              {status.text}
            </p>
          )}

          {fileInfo && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 13l4 4L19 7" />
                  </svg>
                </span>
                <h3 className="text-sm font-semibold text-slate-900">Upload details</h3>
              </div>

              <dl className="mt-2 divide-y divide-slate-100">
                <ResultRow label="Filename" value={fileInfo.original_name ?? file?.name ?? '—'} />
                <ResultRow label="Media type" value={fileInfo.media_type || getMediaKind(file) || '—'} />
                <ResultRow label="Content type" value={fileInfo.content_type || '—'} />
                <ResultRow label="File size" value={fileInfo.size_human || formatFileSize(file?.size)} />
                <ResultRow label="Stored as" value={fileInfo.saved_as || '—'} />
                <ResultRow
                  label="Upload status"
                  value={result.status === 'uploaded' ? 'Uploaded' : result.status || 'Uploaded'}
                />
              </dl>

              {visual?.status === 'completed' ? (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Visual deepfake model result
                  </h4>
                  <dl className="mt-1 divide-y divide-slate-200">
                    <ResultRow label="Model score" value={Number(visual.score).toFixed(4)} />
                    <ResultRow
                      label="Classification"
                      value={visual.classification === 'deepfake' ? 'Deepfake indicators' : 'Likely real'}
                    />
                    <ResultRow
                      label="Faces analyzed"
                      value={`${visual.faces_analyzed} of ${visual.faces_detected} detected`}
                    />
                    <ResultRow label="Model" value={visual.model || '—'} />
                  </dl>
                  <p className="mt-2 text-xs text-slate-600">
                    The score is an uncalibrated model output (not a probability); threshold{' '}
                    {visual.threshold}. Aggregation: {visual.aggregation}. Treat it as a signal, not
                    forensic evidence.
                  </p>
                </div>
              ) : visual ? (
                <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {visual.message || 'No model score is available for this upload.'}
                </p>
              ) : (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  No analysis block was returned by the backend for this upload.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-slate-500">
        Files are sent to the Clarity Mesh backend at {API_BASE_URL} and saved in{' '}
        <code className="rounded bg-slate-100 px-1">backend/uploads/</code>. Maximum file size{' '}
        {MAX_UPLOAD_SIZE_MB}&nbsp;MB.
      </p>
    </section>
  );
}
