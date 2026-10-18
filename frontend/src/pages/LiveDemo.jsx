import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
// Inline SVGs matching Clarity Mesh design language (no external icon dependencies)
function IconVideo({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m22 8-6 4 6 4V8Z" /><rect width="14" height="12" x="2" y="6" rx="2" />
    </svg>
  );
}

function IconVideoOff({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.66 6H14a2 2 0 0 1 2 2v2.34l1 1L22 8v8" />
      <path d="M16 16a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2l10 10Z" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

function IconActivity({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
    </svg>
  );
}

function IconAlertTriangle({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" x2="12" y1="9" y2="13" />
      <line x1="12" x2="12.01" y1="17" y2="17" />
    </svg>
  );
}

function IconShieldAlert({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      <line x1="12" x2="12" y1="8" y2="12" />
      <line x1="12" x2="12.01" y1="16" y2="16" />
    </svg>
  );
}

function IconGauge({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </svg>
  );
}

function IconCamera({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

function IconInfo({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" x2="12" y1="16" y2="12" />
      <line x1="12" x2="12.01" y1="8" y2="8" />
    </svg>
  );
}

function IconRadio({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2" />
      <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M7.76 16.24a6 6 0 0 1 0-8.48" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.48" />
    </svg>
  );
}

function IconRefreshCw({ className = "w-4 h-4" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 21h5v-5" />
    </svg>
  );
}

export default function LiveDemo() {
  const [isStreaming, setIsStreaming] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [devices, setDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  
  // Real-time forensic telemetry
  const [currentScore, setCurrentScore] = useState(null);
  const [classification, setClassification] = useState(null);
  const [frameStatus, setFrameStatus] = useState('idle');
  const [faceCount, setFaceCount] = useState(0);
  const [faceBox, setFaceBox] = useState(null);
  const [runningMean, setRunningMean] = useState(null);
  const [runningCount, setRunningCount] = useState(0);
  const [latencyMs, setLatencyMs] = useState(null);
  const [frameCount, setFrameCount] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [sampleInterval, setSampleInterval] = useState(5);
  const [scoreHistory, setScoreHistory] = useState([]);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const wsRef = useRef(null);
  const streamRef = useRef(null);
  const timerRef = useRef(null);
  const captureLoopRef = useRef(null);

  // Discover video input devices
  useEffect(() => {
    async function getCameras() {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const allDevices = await navigator.mediaDevices.enumerateDevices();
        const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');
        setDevices(videoInputs);
        if (videoInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(videoInputs[0].deviceId);
        }
      } catch (err) {
        console.warn('Unable to list media devices:', err);
      }
    }
    getCameras();
  }, [selectedDeviceId]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopStreaming();
    };
  }, []);

  const stopStreaming = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (captureLoopRef.current) {
      clearInterval(captureLoopRef.current);
      captureLoopRef.current = null;
    }
    if (wsRef.current) {
      try {
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ action: 'stop' }));
          wsRef.current.close(1000, 'Client stopped stream');
        }
      } catch (_) {}
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
    setConnecting(false);
    setFrameStatus('stopped');
  }, []);

  const startStreaming = async () => {
    setErrorMsg(null);
    setConnecting(true);
    setFrameStatus('initializing');
    setScoreHistory([]);
    setFrameCount(0);
    setElapsedSeconds(0);
    setCurrentScore(null);
    setRunningMean(null);
    setRunningCount(0);
    setFaceBox(null);

    // 1. Request camera media stream
    try {
      const constraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 } },
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch (err) {
      setConnecting(false);
      setErrorMsg(`Camera access denied or unavailable: ${err.message}`);
      return;
    }

    // 2. Connect WebSocket
    const isHttps = window.location.protocol === 'https:';
    const host = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
      ? '127.0.0.1:8000'
      : window.location.host;
    const wsUrl = `${isHttps ? 'wss' : 'ws'}://${host}/ws/analyze/stream`;

    let ws;
    try {
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;
    } catch (err) {
      setConnecting(false);
      setErrorMsg(`Failed to initiate WebSocket connection: ${err.message}`);
      return;
    }

    ws.onopen = () => {
      setConnecting(false);
      setIsStreaming(true);
      setFrameStatus('connected');

      // Start elapsed timer
      const startTime = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - startTime) / 1000));
      }, 1000);

      // Start frame capture loop (captures ~10 frames per second; server subsamples every 5th)
      captureLoopRef.current = setInterval(() => {
        captureAndSendFrame();
      }, 100);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleWsMessage(data);
      } catch (err) {
        console.error('Error parsing WS message:', err);
      }
    };

    ws.onerror = (err) => {
      console.warn('WebSocket encountered error:', err);
      setErrorMsg('WebSocket connection encountered an error.');
    };

    ws.onclose = (event) => {
      if (event.code === 1013) {
        setErrorMsg('Server capacity reached: Maximum concurrent real-time streams active. Try again later.');
      } else if (event.code !== 1000 && event.code !== 1005) {
        setErrorMsg(`WebSocket closed unexpectedly (code ${event.code}).`);
      }
      stopStreaming();
    };
  };

  const captureAndSendFrame = () => {
    if (!videoRef.current || !canvasRef.current || !wsRef.current) return;
    if (wsRef.current.readyState !== WebSocket.OPEN) return;

    const video = videoRef.current;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    const canvas = canvasRef.current;
    canvas.width = 480;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to JPEG blob or base64 and send
    canvas.toBlob(
      (blob) => {
        if (blob && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          blob.arrayBuffer().then((buf) => {
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(buf);
            }
          });
        }
      },
      'image/jpeg',
      0.75
    );
  };

  const handleWsMessage = (data) => {
    if (data.type === 'session_init') {
      if (data.sample_interval) setSampleInterval(data.sample_interval);
    } else if (data.type === 'frame_skipped') {
      setFrameCount(data.frame_index);
      setFrameStatus('skipping (cadence)');
    } else if (data.type === 'frame_result') {
      setFrameCount(data.frame_index);
      setFrameStatus(data.status);
      setFaceCount(data.face_count || 0);
      setLatencyMs(data.latency_ms);
      if (data.face_box) {
        setFaceBox(data.face_box);
        drawFaceBoxOverlay(data.face_box);
      } else {
        clearFaceBoxOverlay();
      }

      if (data.running_mean !== undefined && data.running_mean !== null) {
        setRunningMean(data.running_mean);
        setRunningCount(data.running_count || 0);
      }

      if (data.status === 'ok') {
        setCurrentScore(data.score);
        setClassification(data.classification);
        setScoreHistory((prev) => [...prev.slice(-20), data.score]);
      } else if (data.status === 'no_face_detected') {
        setClassification('NO_FACE');
        clearFaceBoxOverlay();
      }
    } else if (data.type === 'session_timeout') {
      setErrorMsg(`Session completed: Duration limit reached (${data.total_frames} frames processed).`);
      stopStreaming();
    } else if (data.type === 'frame_cap_exceeded') {
      setErrorMsg(`Session completed: Maximum frame cap reached (${data.total_frames} frames processed).`);
      stopStreaming();
    } else if (data.type === 'error') {
      setErrorMsg(data.message || 'Server returned an error.');
      stopStreaming();
    }
  };

  const drawFaceBoxOverlay = (box) => {
    if (!overlayCanvasRef.current || !videoRef.current) return;
    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = 480;
    canvas.height = 360;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 2;
    ctx.shadowColor = '#06b6d4';
    ctx.shadowBlur = 8;
    ctx.strokeRect(box.x, box.y, box.width, box.height);

    // Corner brackets
    const bracketLen = 8;
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 3;
    // Top-left
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + bracketLen);
    ctx.lineTo(box.x, box.y);
    ctx.lineTo(box.x + bracketLen, box.y);
    ctx.stroke();
    // Top-right
    ctx.beginPath();
    ctx.moveTo(box.x + box.width - bracketLen, box.y);
    ctx.lineTo(box.x + box.width, box.y);
    ctx.lineTo(box.x + box.width, box.y + bracketLen);
    ctx.stroke();
    // Bottom-left
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + box.height - bracketLen);
    ctx.lineTo(box.x, box.y + box.height);
    ctx.lineTo(box.x + bracketLen, box.y + box.height);
    ctx.stroke();
    // Bottom-right
    ctx.beginPath();
    ctx.moveTo(box.x + box.width - bracketLen, box.y + box.height);
    ctx.lineTo(box.x + box.width, box.y + box.height);
    ctx.lineTo(box.x + box.width, box.y + box.height - bracketLen);
    ctx.stroke();
  };

  const clearFaceBoxOverlay = () => {
    if (!overlayCanvasRef.current) return;
    const canvas = overlayCanvasRef.current;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <div className="min-h-screen bg-[#030407] text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      {/* Hidden processing canvas */}
      <canvas ref={canvasRef} className="hidden" />

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Top Header & Breadcrumbs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/[0.08]">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-cyan-400 animate-pulse" />
              <span className="text-xs font-mono uppercase tracking-widest text-cyan-400">
                Live Forensic Stream
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mt-1">
              Real-Time Media Forensics
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl">
              Streams webcam feed directly over authenticated WebSocket to the Clarity Mesh EfficientNet-B7 visual classifier.
            </p>
          </div>

          {/* Connection / Status Badge */}
          <div className="flex items-center gap-3">
            <div
              className={`px-3 py-1.5 rounded-full border text-xs font-mono flex items-center gap-2 ${
                isStreaming
                  ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300'
                  : connecting
                  ? 'bg-amber-950/40 border-amber-500/40 text-amber-300'
                  : 'bg-slate-900 border-white/10 text-slate-400'
              }`}
            >
              <IconRadio className={`w-3.5 h-3.5 ${isStreaming ? 'animate-spin' : ''}`} />
              <span>
                {isStreaming ? 'STREAM ACTIVE' : connecting ? 'ESTABLISHING WS…' : 'STANDBY'}
              </span>
            </div>
          </div>
        </div>

        {/* Prominent Architectural Guardrail Banner */}
        <div className="rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 backdrop-blur-xl flex items-start gap-3.5">
          <IconAlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <span className="font-bold text-amber-300 uppercase tracking-wider block">
              Architectural Guardrail — CPU-Throttled Stream
            </span>
            <p className="text-slate-300 leading-relaxed">
              Real-time deepfake analysis operates on CPU-only server resources. To protect inference responsiveness,
              incoming video is subsampled (analyzing <strong>1 out of every {sampleInterval} frames</strong>).
              Hard session limits apply: maximum <strong>200 frames</strong> or <strong>120 seconds</strong> duration,
              and a server ceiling of <strong>2 concurrent active sessions</strong>.
            </p>
          </div>
        </div>

        {/* Error banner if present */}
        <AnimatePresence>
          {errorMsg && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-xl border border-rose-500/40 bg-rose-950/30 p-4 text-xs text-rose-200 flex items-center justify-between"
            >
              <div className="flex items-center gap-2.5">
                <IconShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
                <span>{errorMsg}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                className="text-slate-400 hover:text-white ml-3 underline"
              >
                Dismiss
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Interface Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Viewport (8 cols) */}
          <div className="lg:col-span-7 xl:col-span-8 space-y-4">
            <div className="relative rounded-2xl border border-white/10 bg-slate-950/80 overflow-hidden shadow-2xl aspect-[4/3] flex items-center justify-center">
              {/* Actual Video Element */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  isStreaming ? 'opacity-100' : 'opacity-0'
                }`}
              />

              {/* Bounding Box Canvas Overlay */}
              <canvas
                ref={overlayCanvasRef}
                className={`absolute inset-0 w-full h-full pointer-events-none object-cover transition-opacity duration-300 ${
                  isStreaming ? 'opacity-100' : 'opacity-0'
                }`}
              />

              {/* Standby / Placeholder Screen */}
              {!isStreaming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-slate-950/90 backdrop-blur-md">
                  <div className="h-16 w-16 rounded-2xl border border-cyan-500/20 bg-cyan-950/30 flex items-center justify-center mb-4 text-cyan-400 shadow-lg shadow-cyan-500/10">
                    <IconCamera className="w-8 h-8" />
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1">Live Camera Feed Offline</h3>
                  <p className="text-xs text-slate-400 max-w-sm mb-6">
                    Connect your webcam to test real-time facial manipulation detection with live latency and inference telemetry.
                  </p>
                  <button
                    type="button"
                    onClick={startStreaming}
                    disabled={connecting}
                    className="btn-glossy-primary px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-cyan-500/20 flex items-center gap-2 rounded-xl"
                  >
                    {connecting ? (
                      <>
                        <IconRefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Connecting WebSocket…</span>
                      </>
                    ) : (
                      <>
                        <IconVideo className="w-3.5 h-3.5" />
                        <span>Start Forensic Stream</span>
                      </>
                    )}
                  </button>
                </div>
              )}

              {/* Live HUD Overlays (when streaming) */}
              {isStreaming && (
                <>
                  {/* Top-left HUD badge */}
                  <div className="absolute top-3 left-3 flex items-center gap-2 pointer-events-none">
                    <div className="px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 text-[11px] font-mono text-cyan-300 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                      <span>LIVE FEED</span>
                    </div>
                    {latencyMs !== null && (
                      <div className="px-2.5 py-1 rounded-lg bg-black/70 backdrop-blur-md border border-white/10 text-[11px] font-mono text-slate-300">
                        {latencyMs}ms
                      </div>
                    )}
                  </div>

                  {/* Top-right Score pill */}
                  <div className="absolute top-3 right-3 pointer-events-none">
                    {currentScore !== null ? (
                      <div
                        className={`px-3 py-1 rounded-lg text-xs font-bold font-mono shadow-lg border backdrop-blur-md ${
                          currentScore >= 0.5
                            ? 'bg-rose-950/80 border-rose-500/60 text-rose-300'
                            : 'bg-emerald-950/80 border-emerald-500/60 text-emerald-300'
                        }`}
                      >
                        {classification || (currentScore >= 0.5 ? 'DEEPFAKE' : 'AUTHENTIC')} (
                        {(currentScore * 100).toFixed(1)}%)
                      </div>
                    ) : (
                      <div className="px-3 py-1 rounded-lg text-xs font-mono bg-black/70 border border-white/10 text-slate-400 backdrop-blur-md">
                        {frameStatus === 'no_face_detected' ? 'NO FACE DETECTED' : 'ANALYZING…'}
                      </div>
                    )}
                  </div>

                  {/* Bottom bar HUD */}
                  <div className="absolute bottom-3 inset-x-3 flex items-center justify-between text-[11px] font-mono text-slate-300 px-3 py-1.5 rounded-lg bg-black/70 border border-white/10 backdrop-blur-md pointer-events-none">
                    <div>F: {frameCount} (cadence: 1/{sampleInterval})</div>
                    <div>FACES: {faceCount}</div>
                    <div>TIME: {elapsedSeconds}s / 120s</div>
                  </div>
                </>
              )}
            </div>

            {/* Quick Stream Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-white/[0.08] bg-slate-900/40 backdrop-blur-md">
              <div className="flex items-center gap-2.5">
                <IconCamera className="w-4 h-4 text-slate-400" />
                <select
                  aria-label="Select Video Camera"
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  disabled={isStreaming}
                  className="bg-slate-950 border border-white/10 text-xs rounded-lg px-2.5 py-1.5 text-slate-300 focus:outline-none focus:border-cyan-500 disabled:opacity-50"
                >
                  {devices.length === 0 ? (
                    <option value="">Default Camera</option>
                  ) : (
                    devices.map((d, idx) => (
                      <option key={d.deviceId || idx} value={d.deviceId}>
                        {d.label || `Camera ${idx + 1}`}
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex items-center gap-2">
                {isStreaming ? (
                  <button
                    type="button"
                    onClick={stopStreaming}
                    className="px-4 py-1.5 rounded-lg border border-rose-500/50 bg-rose-950/40 text-rose-300 hover:bg-rose-900/60 transition text-xs font-bold flex items-center gap-1.5"
                  >
                    <IconVideoOff className="w-3.5 h-3.5" />
                    <span>Stop Stream</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={startStreaming}
                    disabled={connecting}
                    className="btn-glossy-primary px-4 py-1.5 rounded-lg text-xs font-bold text-white shadow-md shadow-cyan-500/20 flex items-center gap-1.5"
                  >
                    <IconVideo className="w-3.5 h-3.5" />
                    <span>Start Stream</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Right: Forensic Analytics & Telemetry (4 cols) */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-4">
            {/* Current Score Gauge Card */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-5 backdrop-blur-xl shadow-lg space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
                <div className="flex items-center gap-2">
                  <IconGauge className="w-4 h-4 text-cyan-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    Manipulation Probability
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">Model: B7 Visual</span>
              </div>

              {/* Large Score Indicator */}
              <div className="text-center py-2">
                <div className="text-4xl font-extrabold font-mono tracking-tight">
                  {currentScore !== null ? (
                    <span
                      className={
                        currentScore >= 0.5 ? 'text-rose-400' : 'text-emerald-400'
                      }
                    >
                      {(currentScore * 100).toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-slate-500">--.-%</span>
                  )}
                </div>
                <div className="text-xs font-semibold text-slate-400 mt-1 uppercase tracking-wider">
                  {classification ? (
                    <span
                      className={`inline-block px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                        currentScore >= 0.5
                          ? 'bg-rose-950/60 border-rose-500/40 text-rose-300'
                          : 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                      }`}
                    >
                      {classification}
                    </span>
                  ) : (
                    <span className="text-slate-500">No Assessment Active</span>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="space-y-1.5">
                <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden relative">
                  <div
                    className={`h-full transition-all duration-300 ${
                      (currentScore ?? 0) >= 0.5
                        ? 'bg-gradient-to-r from-amber-500 to-rose-500'
                        : 'bg-gradient-to-r from-teal-500 to-emerald-400'
                    }`}
                    style={{ width: `${Math.min(100, Math.max(0, (currentScore ?? 0) * 100))}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] font-mono text-slate-500">
                  <span>0% AUTHENTIC</span>
                  <span>50% THRESHOLD</span>
                  <span>100% DEEPFAKE</span>
                </div>
              </div>

              {/* Sparkline mini trail */}
              {scoreHistory.length > 1 && (
                <div className="pt-2">
                  <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mb-1">
                    Recent Score Trajectory (Last {scoreHistory.length} Samples)
                  </div>
                  <div className="flex items-end gap-1 h-10 w-full pt-1">
                    {scoreHistory.map((s, idx) => (
                      <div
                        key={idx}
                        className={`flex-1 rounded-t transition-all ${
                          s >= 0.5 ? 'bg-rose-500/80' : 'bg-emerald-400/80'
                        }`}
                        style={{ height: `${Math.max(10, s * 100)}%` }}
                        title={`Sample ${idx + 1}: ${(s * 100).toFixed(1)}%`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Session Running Aggregates */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/50 p-5 backdrop-blur-xl shadow-lg space-y-3.5">
              <div className="flex items-center gap-2 pb-2.5 border-b border-white/[0.08]">
                <IconActivity className="w-4 h-4 text-cyan-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  Session Aggregates
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono">
                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-[10px] text-slate-400 uppercase">Running Mean</div>
                  <div className="text-lg font-bold text-white mt-0.5">
                    {runningMean !== null ? `${(runningMean * 100).toFixed(1)}%` : '—'}
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-[10px] text-slate-400 uppercase">Analyzed Faces</div>
                  <div className="text-lg font-bold text-white mt-0.5">{runningCount}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-[10px] text-slate-400 uppercase">Total Captured</div>
                  <div className="text-lg font-bold text-white mt-0.5">{frameCount}</div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/60 border border-white/[0.06]">
                  <div className="text-[10px] text-slate-400 uppercase">Latency</div>
                  <div className="text-lg font-bold text-white mt-0.5">
                    {latencyMs !== null ? `${latencyMs}ms` : '—'}
                  </div>
                </div>
              </div>
            </div>

            {/* Forensic Methodology note */}
            <div className="rounded-2xl border border-white/10 bg-slate-900/30 p-4 backdrop-blur-xl space-y-2 text-xs text-slate-400">
              <div className="flex items-center gap-2 text-slate-300 font-bold">
                <IconInfo className="w-4 h-4 text-cyan-400" />
                <span>Forensic Pipeline Specification</span>
              </div>
              <p className="leading-relaxed text-[11px]">
                Each sampled frame is processed by OpenCV Haar Cascades for face localization, cropped with 15% edge padding,
                and passed to a DFDC-derived EfficientNet-B7 neural model. Results reflect frame-by-frame probability and do
                not include temporal LSTM smoothing.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
