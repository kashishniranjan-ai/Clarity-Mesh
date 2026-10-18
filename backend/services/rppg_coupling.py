"""
Clarity Mesh — Physio-Acoustic Coupling (rPPG & Speech Synchronization)
========================================================================
EXPERIMENTAL triage signal:
  Extracts remote photoplethysmography (rPPG) pulse signal from face ROI
  using the CHROM (de Haan & Jeanne, 2013) chrominance method across video frames.
  Cross-correlates the inferred pulse waveform with the audio speech energy envelope.

DISCLAIMER:
  This is an EXPERIMENTAL triage signal. It NEVER overrides or modifies the
  primary visual or multimodal fusion score.
"""

from __future__ import annotations

import os
import tempfile
import wave
from pathlib import Path
from typing import Any

import cv2
import numpy as np

from services.audio_detector import _extract_to_wav, _probe_audio_stream
from services.face_processor import detect_faces

RPPG_DISCLAIMER = (
    "This is an EXPERIMENTAL triage signal. It NEVER overrides or modifies "
    "the primary fusion score. Treat with appropriate skepticism."
)


def is_rppg_enabled() -> bool:
    """Check if physio-acoustic coupling is enabled via environment."""
    return os.getenv("CLARITY_ENABLE_RPPG", "false").strip().lower() in ("1", "true", "yes")


def _bandpass_filter(signal: np.ndarray, fps: float, low_hz: float = 0.7, high_hz: float = 3.5) -> np.ndarray:
    """Zero-phase frequency domain bandpass filter between low_hz and high_hz."""
    n = len(signal)
    if n < 4:
        return signal

    # FFT
    freqs = np.fft.rfftfreq(n, d=1.0 / fps)
    fft_vals = np.fft.rfft(signal - np.mean(signal))

    # Mask frequencies outside [low_hz, high_hz]
    mask = (freqs >= low_hz) & (freqs <= high_hz)
    fft_vals[~mask] = 0.0

    filtered = np.fft.irfft(fft_vals, n=n)
    return filtered


def _extract_chrom_rppg(r_channel: np.ndarray, g_channel: np.ndarray, b_channel: np.ndarray, fps: float) -> tuple[np.ndarray, float | None]:
    """
    Compute CHROM rPPG signal and estimate pulse rate in BPM.
    Reference: de Haan & Jeanne (2013).
    """
    eps = 1e-6
    r_mean = np.mean(r_channel) + eps
    g_mean = np.mean(g_channel) + eps
    b_mean = np.mean(b_channel) + eps

    # 1. Normalize
    r_n = r_channel / r_mean
    g_n = g_channel / g_mean
    b_n = b_channel / b_mean

    # 2. Chrominance projection
    xs = 3.0 * r_n - 2.0 * g_n
    ys = 1.5 * r_n + g_n - 1.5 * b_n

    # 3. Bandpass filter 0.7 - 3.5 Hz (42 - 210 BPM)
    xf = _bandpass_filter(xs, fps, 0.7, 3.5)
    yf = _bandpass_filter(ys, fps, 0.7, 3.5)

    # 4. Standard deviation ratio
    std_x = np.std(xf)
    std_y = np.std(yf) + eps
    alpha = std_x / std_y

    pulse_signal = xf - alpha * yf

    # 5. Estimate dominant pulse frequency from power spectrum
    n = len(pulse_signal)
    freqs = np.fft.rfftfreq(n, d=1.0 / fps)
    fft_mag = np.abs(np.fft.rfft(pulse_signal))
    band_mask = (freqs >= 0.7) & (freqs <= 3.5)

    if np.any(band_mask) and np.max(fft_mag[band_mask]) > 0:
        peak_idx = np.argmax(fft_mag[band_mask])
        peak_freq = freqs[band_mask][peak_idx]
        pulse_bpm = float(peak_freq * 60.0)
    else:
        pulse_bpm = None

    return pulse_signal, pulse_bpm


def _extract_audio_envelope(wav_path: Path, target_samples: int) -> np.ndarray | None:
    """Extract RMS energy envelope from audio wav, downsampled to target_samples."""
    try:
        with wave.open(str(wav_path), "rb") as wf:
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            n_frames = wf.getnframes()
            if n_frames == 0 or target_samples == 0:
                return None

            raw_bytes = wf.readframes(n_frames)
            dtype = np.int16 if sampwidth == 2 else np.int8
            audio_data = np.frombuffer(raw_bytes, dtype=dtype)
            if n_channels > 1:
                audio_data = audio_data[::n_channels]

        # Calculate chunk-wise RMS
        chunk_size = max(1, len(audio_data) // target_samples)
        envelope = []
        for i in range(target_samples):
            chunk = audio_data[i * chunk_size : (i + 1) * chunk_size]
            if len(chunk) > 0:
                rms = float(np.sqrt(np.mean(chunk.astype(np.float64) ** 2)))
                envelope.append(rms)
            else:
                envelope.append(0.0)

        env_arr = np.array(envelope, dtype=np.float64)
        std = np.std(env_arr)
        if std > 1e-6:
            env_arr = (env_arr - np.mean(env_arr)) / std
        return env_arr
    except Exception:
        return None


def extract_rppg_coupling(
    video_path: str | Path,
    max_frames: int = 120,
    force_enable: bool = False,
) -> dict[str, Any]:
    """
    Extract rPPG pulse signal from video and correlate with speech audio energy.
    """
    if not force_enable and not is_rppg_enabled():
        return {
            "status": "disabled",
            "reason": "Physio-acoustic coupling is disabled (CLARITY_ENABLE_RPPG=false).",
            "disclaimer": RPPG_DISCLAIMER,
        }

    p = Path(video_path)
    if not p.is_file():
        return {
            "status": "file_not_found",
            "error": f"Video file not found: {p}",
            "disclaimer": RPPG_DISCLAIMER,
        }

    cap = cv2.VideoCapture(str(p))
    if not cap.isOpened():
        return {
            "status": "open_failed",
            "error": "Failed to open video file.",
            "disclaimer": RPPG_DISCLAIMER,
        }

    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    if fps <= 0 or fps > 120:
        fps = 25.0

    r_vals: list[float] = []
    g_vals: list[float] = []
    b_vals: list[float] = []

    last_box: dict[str, int] | None = None
    frame_idx = 0

    while frame_idx < max_frames:
        ret, frame = cap.read()
        if not ret or frame is None:
            break

        # Detect face every 5 frames or track previous
        if frame_idx % 5 == 0 or last_box is None:
            boxes = detect_faces(frame)
            if boxes:
                last_box = boxes[0]

        if last_box:
            # Cheek / central face region (avoid eyes and beard)
            x, y, w, h = last_box["x"], last_box["y"], last_box["width"], last_box["height"]
            roi_y1 = int(y + 0.35 * h)
            roi_y2 = int(y + 0.65 * h)
            roi_x1 = int(x + 0.25 * w)
            roi_x2 = int(x + 0.75 * w)

            roi = frame[max(0, roi_y1) : min(frame.shape[0], roi_y2), max(0, roi_x1) : min(frame.shape[1], roi_x2)]
            if roi.size > 0:
                # OpenCV uses BGR
                b_mean = float(np.mean(roi[:, :, 0]))
                g_mean = float(np.mean(roi[:, :, 1]))
                r_mean = float(np.mean(roi[:, :, 2]))
                r_vals.append(r_mean)
                g_vals.append(g_mean)
                b_vals.append(b_mean)

        frame_idx += 1

    cap.release()

    if len(r_vals) < 20:
        return {
            "status": "insufficient_face_frames",
            "frames_analyzed": len(r_vals),
            "reason": "At least 20 continuous face frames are required for rPPG pulse extraction.",
            "disclaimer": RPPG_DISCLAIMER,
        }

    r_arr = np.array(r_vals, dtype=np.float64)
    g_arr = np.array(g_vals, dtype=np.float64)
    b_arr = np.array(b_vals, dtype=np.float64)

    pulse_signal, pulse_bpm = _extract_chrom_rppg(r_arr, g_arr, b_arr, fps)

    # Audio cross-correlation
    audio_present = False
    corr_coef: float | None = None
    lag_frames: int | None = None

    probe_status, _ = _probe_audio_stream(p)
    if probe_status == "ok":
        audio_present = True
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            tmp_wav = Path(tmp.name)
        try:
            err = _extract_to_wav(p, tmp_wav)
            if err is None and tmp_wav.is_file():
                envelope = _extract_audio_envelope(tmp_wav, len(pulse_signal))
                if envelope is not None and len(envelope) == len(pulse_signal):
                    # Pearson correlation
                    std_p = np.std(pulse_signal)
                    std_e = np.std(envelope)
                    if std_p > 1e-6 and std_e > 1e-6:
                        p_norm = (pulse_signal - np.mean(pulse_signal)) / std_p
                        e_norm = (envelope - np.mean(envelope)) / std_e
                        r_matrix = np.corrcoef(p_norm, e_norm)
                        corr_coef = float(r_matrix[0, 1])

                        # Cross-correlation lag
                        xcorr = np.correlate(p_norm, e_norm, mode="full")
                        lag_frames = int(np.argmax(xcorr) - (len(p_norm) - 1))
        finally:
            try:
                tmp_wav.unlink(missing_ok=True)
            except Exception:
                pass

    return {
        "status": "experimental",
        "method": "CHROM",
        "pulse_rate_bpm": round(pulse_bpm, 1) if pulse_bpm else None,
        "correlation_coefficient": round(corr_coef, 4) if corr_coef is not None else None,
        "lag_frames": lag_frames,
        "audio_envelope_present": audio_present,
        "frames_analyzed": len(r_vals),
        "sampling_fps": round(fps, 2),
        "disclaimer": RPPG_DISCLAIMER,
    }
