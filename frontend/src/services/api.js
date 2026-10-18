/**
 * Clarity Mesh — Frontend API client
 * ==================================
 * Enterprise forensic client for the FastAPI backend.
 * Automatically injects Bearer JWT authorization headers, handles
 * 401 unauthenticated session expiry, and connects to the forensics endpoints.
 */

/** Base URL of the FastAPI backend. Override with VITE_API_BASE_URL. */
export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL === undefined
    ? 'http://127.0.0.1:8000'
    : import.meta.env.VITE_API_BASE_URL;

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

/** Retrieve active JWT token from sessionStorage or localStorage. */
export function getStoredToken() {
  try {
    return (
      sessionStorage.getItem('cm_token') ||
      localStorage.getItem('cm_token') ||
      null
    );
  } catch {
    return null;
  }
}

/** Clear only auth-related keys without destroying user preferences. */
export function clearStoredAuth() {
  try {
    sessionStorage.removeItem('cm_token');
    sessionStorage.removeItem('cm_refresh_token');
    sessionStorage.removeItem('cm_user');
    localStorage.removeItem('cm_token');
    localStorage.removeItem('cm_refresh_token');
    localStorage.removeItem('cm_user');
  } catch {}
}

/**
 * Handle 401 Unauthorized globally: clears tokens and notifies session listeners.
 */
function handleUnauthorized() {
  clearStoredAuth();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('cm_auth_unauthorized'));
  }
}

/**
 * Build standard headers with Bearer authorization if token exists.
 */
function buildAuthHeaders(existingHeaders = {}) {
  const token = getStoredToken();
  const headers = { ...existingHeaders };
  if (token && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * MIME types by extension.
 */
const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  webm: 'video/webm',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
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

/** Reads a JSON body safely. */
async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Central JSON request runner with auth injection and 401 interceptor.
 */
async function jsonApi(path, options = {}) {
  let response;
  const headers = buildAuthHeaders({
    ...(options.body && typeof options.body === 'string'
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...options.headers,
  });

  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers,
    });
  } catch {
    throw new ApiError('Could not reach the Clarity Mesh backend.', {
      status: 0,
      code: 'unreachable',
    });
  }

  if (response.status === 401 && !path.includes('/auth/login') && !path.includes('/auth/register')) {
    handleUnauthorized();
  }

  const payload = await readJson(response);
  if (!response.ok) {
    const detail =
      (typeof payload?.detail === 'string' && payload.detail) ||
      (Array.isArray(payload?.detail) && payload.detail.map((d) => d.msg || d).join('; ')) ||
      `Request failed (HTTP ${response.status}).`;
    throw new ApiError(detail, { status: response.status, code: 'http_error' });
  }
  return payload;
}

/**
 * POST a file to /api/analyze as multipart/form-data.
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

  const headers = buildAuthHeaders();

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/analyze`, {
      method: 'POST',
      headers,
      body: formData,
    });
  } catch {
    throw new ApiError(
      'Could not reach the backend. Make sure it is running at ' +
        `${API_BASE_URL} and try again.`,
      { status: 0, code: 'unreachable' },
    );
  }

  if (response.status === 401) {
    handleUnauthorized();
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

/**
 * POST /api/explain — generate a Grad-CAM / occlusion heatmap for a
 * previously analysed upload (referenced by its sanitized stored_name).
 */
export function requestExplainability(storedName, method = 'occlusion') {
  return jsonApi('/api/explain', {
    method: 'POST',
    body: JSON.stringify({ stored_name: storedName, method }),
  });
}

/**
 * GET /api/reports/{id}/pdf — download the chain-of-custody PDF report.
 * Returns a Blob; the caller triggers the browser download.
 */
export async function downloadAnalysisReport(analysisId) {
  const headers = buildAuthHeaders();
  let response;
  try {
    response = await fetch(
      `${API_BASE_URL}/api/reports/${encodeURIComponent(analysisId)}/pdf`,
      { headers },
    );
  } catch {
    throw new ApiError('Could not reach the backend for the PDF report.', {
      status: 0,
      code: 'unreachable',
    });
  }
  if (response.status === 401) {
    handleUnauthorized();
  }
  if (!response.ok) {
    let detail = `Report export failed (HTTP ${response.status}).`;
    try {
      const payload = await response.json();
      if (typeof payload?.detail === 'string') detail = payload.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(detail, { status: response.status, code: 'http_error' });
  }
  return response.blob();
}

// --- Explainability & Narrative APIs ---
export const getExplainability = (storedName, method = 'occlusion', frameIndex = null) =>
  jsonApi('/api/explain', {
    method: 'POST',
    body: JSON.stringify({ stored_name: storedName, method, frame_index: frameIndex }),
  });

export const getVisualExplainability = ({ analysisId, storedName, frameIndex, method = 'gradcam', imageB64 } = {}) =>
  jsonApi('/api/explain/visual', {
    method: 'POST',
    body: JSON.stringify({
      analysis_id: analysisId,
      stored_name: storedName,
      frame_index: frameIndex,
      method,
      image_b64: imageB64,
    }),
  });

export const getForensicNarrative = (payload) =>
  jsonApi('/api/v2/narrative', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** GET /api/history — recent stored analyses. */
export async function getHistory(limit = 50) {
  return jsonApi(`/api/history?limit=${limit}`);
}

/** GET /api/insights — aggregate metrics for the dashboard. */
export async function getInsights(days = 7) {
  return jsonApi(`/api/insights?days=${encodeURIComponent(days)}`);
}

/** DELETE /api/history — clear every stored analysis. Admin clearance required. */
export async function clearHistory() {
  return jsonApi('/api/history', { method: 'DELETE' });
}

// --- Case Management APIs ---
export const getCases = () => jsonApi('/api/cases');
export const getCase = (id) => jsonApi(`/api/cases/${encodeURIComponent(id)}`);
export const createCase = (body) =>
  jsonApi('/api/cases', { method: 'POST', body: JSON.stringify(body) });
export const updateCase = (id, body) =>
  jsonApi(`/api/cases/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
export const deleteCase = (id) =>
  jsonApi(`/api/cases/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const addAnalysisToCase = (caseId, analysisId) =>
  jsonApi(
    `/api/cases/${encodeURIComponent(caseId)}/analyses/${encodeURIComponent(analysisId)}`,
    { method: 'POST' },
  );
export const removeAnalysisFromCase = (caseId, analysisId) =>
  jsonApi(
    `/api/cases/${encodeURIComponent(caseId)}/analyses/${encodeURIComponent(analysisId)}`,
    { method: 'DELETE' },
  );

// --- Research Assistant APIs ---
export const getAssistantStatus = () => jsonApi('/api/assistant/status');
export const askAssistant = (question, history = []) =>
  jsonApi('/api/assistant/chat', { method: 'POST', body: JSON.stringify({ question, history }) });

// --- Authentication & Identity APIs ---
export const loginUser = (credentials) =>
  jsonApi('/api/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
export const registerUser = (userData) =>
  jsonApi('/api/auth/register', { method: 'POST', body: JSON.stringify(userData) });
export const refreshAuthToken = (refreshToken) =>
  jsonApi('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) });
export const getAuthMe = () => jsonApi('/api/auth/me');
export const logoutUser = () => jsonApi('/api/auth/logout', { method: 'POST' });

// --- Administrator APIs ---
export const getAdminTelemetry = () => jsonApi('/api/admin/telemetry');
export const getThreatMatrix = () => jsonApi('/api/admin/threat-matrix');
export const getAdminUsers = () => jsonApi('/api/admin/users');
export const updateUserRole = (userId, newRole) =>
  jsonApi(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role: newRole }),
  });
export const getAdminAuditLogs = (limit = 100, action = null) => {
  const query = action ? `?limit=${limit}&action=${encodeURIComponent(action)}` : `?limit=${limit}`;
  return jsonApi(`/api/admin/audit${query}`);
};
export const getCalibrationConfig = () => jsonApi('/api/admin/config');
export const updateCalibrationConfig = (cfg) =>
  jsonApi('/api/admin/calibrate', { method: 'POST', body: JSON.stringify(cfg) });

/** Maps an ApiError to a user-facing message. */
export function describeApiError(error) {
  if (!(error instanceof ApiError)) {
    return error?.message || 'Something went wrong while processing the request.';
  }
  switch (error.status) {
    case 401:
      return 'Session expired or unauthorized. Please verify your credentials.';
    case 403:
      return 'Access Denied: Insufficient operational clearance.';
    case 415:
      return `Unsupported file type. ${error.message}`;
    case 413:
      return error.message;
    case 400:
      return error.message;
    case 0:
      return error.message;
    default:
      return error.message || `Request failed (HTTP ${error.status}).`;
  }
}
