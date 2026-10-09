/** Formats the app accepts, grouped by media kind. */
export const SUPPORTED_FORMATS = [
  { ext: 'jpg', label: 'JPG', kind: 'image' },
  { ext: 'jpeg', label: 'JPEG', kind: 'image' },
  { ext: 'png', label: 'PNG', kind: 'image' },
  { ext: 'mp4', label: 'MP4', kind: 'video' },
  { ext: 'mov', label: 'MOV', kind: 'video' },
  { ext: 'avi', label: 'AVI', kind: 'video' },
  { ext: 'mkv', label: 'MKV', kind: 'video' },
  { ext: 'webm', label: 'WEBM', kind: 'video' },
];

/** Value for the <input accept="..."> attribute. */
export const ACCEPT_ATTRIBUTE = SUPPORTED_FORMATS.map((f) => `.${f.ext}`).join(',');

/** Video containers that browsers can usually play back for a preview. */
const PREVIEWABLE_VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov'];

export function getExtension(fileName = '') {
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex === -1 ? '' : fileName.slice(dotIndex + 1).toLowerCase();
}

/** Returns 'image', 'video' or null. Uses the extension because MIME types are unreliable (e.g. MKV). */
export function getMediaKind(file) {
  const ext = getExtension(file?.name);
  const match = SUPPORTED_FORMATS.find((f) => f.ext === ext);
  return match ? match.kind : null;
}

export function canPreviewInBrowser(file) {
  const kind = getMediaKind(file);
  if (kind === 'image') return true;
  if (kind === 'video') return PREVIEWABLE_VIDEO_EXTENSIONS.includes(getExtension(file.name));
  return false;
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
}

/** Validates a selected file. Returns { valid: true } or { valid: false, error }. */
export function validateFile(file) {
  if (!file) {
    return { valid: false, error: 'No file was selected.' };
  }
  if (!getMediaKind(file)) {
    const allowed = SUPPORTED_FORMATS.map((f) => f.label).join(', ');
    return {
      valid: false,
      error: `"${file.name}" is not a supported format. Please upload one of: ${allowed}.`,
    };
  }
  if (file.size === 0) {
    return { valid: false, error: `"${file.name}" is empty. Please choose a different file.` };
  }
  return { valid: true };
}
