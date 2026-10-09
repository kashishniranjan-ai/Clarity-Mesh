/**
 * Clarity Mesh — Frontend API client
 * ==================================
 * Small helper around the FastAPI backend.
 *
 * The backend currently exposes:
 *   GET  /api/health
 *   POST /api/analyze   (multipart/form-data, field name: "file")
 *
 * POST /api/analyze runs the full visual pipeline (OpenCV decode, frame
 * sampling, face detection and the pretrained EfficientNet-B7 deepfake
 * model) and returns upload metadata plus a `visual_analysis` block with
 * an uncalibrated sigmoid score — or an honest failure state with no score.
 */

/** Base URL of the FastAPI backend. Override with VITE_API_BASE_URL. */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000';

/** Mirrors the backend limit so we can fail fast before uploading. */
export const MAX_UPLOAD_SIZE_MB = 50;
export const MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024;

/**
 * Errors thrown by this client carry an HTTP status so the UI can render
 * precise messages (0 = request never reached the server).
 */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'unknown' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/**
 * MIME types by extension.
 *
 * Browsers sometimes report "" or "application/octet-stream" for containers
 * such as .avi / .mkv. The backend validates the Content-Type, so we always
 * send an explicit type derived from the extension.
 */
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
};

function extensionOf(fileName = '') {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** Returns the Content-Type we should send for this file. */
export function resolveUploadMimeType(file) {
  const type = file?.type?.toLowerCase() || '';
  const generic =
    !type || type === 'application/octet-stream' || type === 'binary/octet-stream';
  if (!generic && type.includes('/')) return type;
  return MIME_BY_EXTENSION[extensionOf(file?.name)] || 'application/octet-stream';
}

/** Reads a JSON body safely — the backend always returns JSON, but never crash on it. */
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * POST a file to /api/analyze as multipart/form-data (field name: "file").
 *
 * Resolves with the backend metadata payload, or rejects with an ApiError.
 */
export async function analyzeMedia(file) {
  if (!file) {
    throw new ApiError('No file selected.', { status: 0, code: 'no_file' });
  }

  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
    throw new ApiError(
      `File too large (${sizeMb} MB). Maximum allowed size is ${MAX_UPLOAD_SIZE_MB} MB.`,
      { status: 413, code: 'too_large' },
    );
  }

  const formData = new FormData();
  const blob = new Blob([file], { type: resolveUploadMimeType(file) });
  formData.append('file', blob, file.name);

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      body: formData,
    });
  } catch {
    throw new ApiError(
      'Could not reach the backend. Make sure it is running at ' +
        `${API_BASE_URL} and try again.`,
      { status: 0, code: 'unreachable' },
    );
  }

  const payload = await readJson(response);

  if (!response.ok) {
    const detail =
      (typeof payload?.detail === 'string' && payload.detail) ||
      (Array.isArray(payload?.detail) &&
        payload.detail.map((d) => d.msg || d).join('; ')) ||
      `Request failed with HTTP ${response.status}.`;
    throw new ApiError(detail, { status: response.status, code: 'http_error' });
  }

  return payload;
}

/** GET /api/health — optional connectivity probe. */
export async function getHealth() {
  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/health`);
  } catch {
    throw new ApiError('Backend unreachable.', { status: 0, code: 'unreachable' });
  }
  if (!response.ok) {
    throw new ApiError(`Health check failed (HTTP ${response.status}).`, {
      status: response.status,
      code: 'http_error',
    });
  }
  return readJson(response);
}

/** Maps an ApiError to a user-facing message. */
export function describeApiError(error) {
  if (!(error instanceof ApiError)) {
    return error?.message || 'Something went wrong while uploading the file.';
  }
  switch (error.status) {
    case 415:
      return `Unsupported file type. ${error.message}`;
    case 413:
      return error.message;
    case 400:
      return error.message;
    case 0:
      return error.message;
    default:
      return `Upload failed. ${error.message}`;
  }
}
