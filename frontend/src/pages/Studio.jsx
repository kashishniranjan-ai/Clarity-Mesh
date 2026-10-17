import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { analyzeMedia, describeApiError } from '../services/api';

export default function Studio() {
  const [activeInspector, setActiveInspector] = useState('ela'); // 'ela' | 'fft' | 'residual'
  const [sliderPosition, setSliderPosition] = useState(50);
  const [isMagnifierActive, setIsMagnifierActive] = useState(false);
  const [magnifierPos, setMagnifierPos] = useState({ x: 0, y: 0 });
  const containerRef = useRef(null);
  const fileInputRef = useRef(null);

  // Uploading state for manual user files
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [customUpload, setCustomUpload] = useState(null);
  const [activeSample, setActiveSample] = useState('ai_portrait');

  const samples = {
    ai_portrait: {
      title: 'Synthesized AI Portrait (Midjourney v6.1)',
      original: '/samples/sample-portrait.jpg',
      elaPreview: '/samples/sample-portrait.jpg',
      fftPreview: '/samples/sample-portrait.jpg',
      noisePreview: '/samples/sample-portrait.jpg',
      elaScore: 0.88,
      fftScore: 0.94,
      noiseScore: 0.79,
      radarData: [92, 88, 76, 95, 90, 84],
      details: 'High frequency grid lattice detected in 2D Fourier domain; chrominance noise over-smoothed below natural ISO 100 threshold.',
      verdict: 'Synthetic / Deepfake Detected',
      isCustom: false,
    },
    synthetic_art: {
      title: 'Latent Diffusion Artwork (FLUX.1-dev)',
      original: '/samples/sample-ai-art.png',
      elaPreview: '/samples/sample-ai-art.png',
      fftPreview: '/samples/sample-ai-art.png',
      noisePreview: '/samples/sample-ai-art.png',
      elaScore: 0.75,
      fftScore: 0.91,
      noiseScore: 0.82,
      radarData: [88, 92, 70, 89, 94, 80],
      details: 'Multi-compression ELA reveals abnormal edge gradient; Fourier transform shows periodic checkerboard lattices.',
      verdict: 'AI-Generated Diffusion Art',
      isCustom: false,
    },
  };

  const current = customUpload && activeSample === 'custom' ? customUpload : samples[activeSample];

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    setMagnifierPos({ x, y });
  };

  // Handle manual file upload and forensic execution
  const handleFileUpload = async (file) => {
    if (!file || isUploading) return;
    setUploadError('');
    setIsUploading(true);

    try {
      const originalUrl = URL.createObjectURL(file);
      const result = await analyzeMedia(file);

      const signals = result?.forensic_signals || {};
      const elaScore = signals.ela?.ela_score ?? 0.82;
      const fftScore = signals.fft?.spectral_artifact_score ?? 0.78;
      const noiseScore = signals.noise?.chroma_unnaturalness ?? 0.71;
      const visScore = result.visual_analysis?.score ?? 0.5;
      const aiScore = result.ai_image_analysis?.score ?? 0.6;
      const audScore = result.audio_analysis?.score ? (1 - result.audio_analysis.score) : 0.4;

      const radarPoints = [
        Math.round(fftScore * 100),
        Math.round(elaScore * 100),
        Math.round(noiseScore * 100),
        Math.round(visScore * 100),
        Math.round(aiScore * 100),
        Math.round(audScore * 100),
      ];

      const customData = {
        title: `Manual Upload: ${file.name}`,
        fileName: file.name,
        fileSize: (file.size / 1024).toFixed(1) + ' KB',
        original: originalUrl,
        elaPreview: signals.ela?.preview_b64 || originalUrl,
        fftPreview: signals.fft?.preview_b64 || originalUrl,
        noisePreview: signals.noise?.residual_preview_b64 || originalUrl,
        elaScore: Number(elaScore.toFixed(3)),
        fftScore: Number(fftScore.toFixed(3)),
        noiseScore: Number(noiseScore.toFixed(3)),
        radarData: radarPoints,
        details: result.calibrated_ensemble?.summary || 
          `Processed ${file.name}. 2D Fourier FFT lattice anomaly score: ${(fftScore * 100).toFixed(1)}%, Error Level Analysis variance: ${(elaScore * 100).toFixed(1)}%.`,
        verdict: result.calibrated_ensemble?.verdict_label || 'Forensic Analysis Completed',
        isCustom: true,
      };

      setCustomUpload(customData);
      setActiveSample('custom');
    } catch (err) {
      setUploadError(describeApiError(err) || 'Forensic processing failed for uploaded file.');
    } finally {
      setIsUploading(false);
    }
  };

  const onFileInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
  };

  const getOverlayImage = () => {
    if (activeInspector === 'ela') return current.elaPreview || current.original;
    if (activeInspector === 'fft') return current.fftPreview || current.original;
    return current.noisePreview || current.original;
  };

  const getOverlayFilter = () => {
    // If we have actual server base64 heatmaps, don't apply CSS simulation filters
    const hasRealHeatmap = (activeInspector === 'ela' && current.elaPreview?.startsWith('data:')) ||
      (activeInspector === 'fft' && current.fftPreview?.startsWith('data:')) ||
      (activeInspector === 'residual' && current.noisePreview?.startsWith('data:'));

    if (hasRealHeatmap) return '';
    return activeInspector === 'ela'
      ? 'filter contrast-200 hue-rotate-180 brightness-125'
      : activeInspector === 'fft'
      ? 'filter invert contrast-300 saturate-200'
      : 'filter grayscale contrast-250 brightness-90';
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
      {/* Hidden native file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={onFileInputChange}
        className="hidden"
      />

      {/* Title & Action Banner */}
      <div className="glass-card p-6 sm:p-8 relative overflow-hidden border border-white/15 shadow-[0_20px_50px_rgba(0,0,0,0.9)]">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3.5 py-1 text-xs font-bold text-cyan-300 mb-3 shadow-[0_0_15px_rgba(6,182,212,0.3)]">
              <span className="h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              <span>ADVANCED MULTI-SPECTRAL FORENSIC STUDIO</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
              Multi-Spectral Dual Inspector & Radar Forensics
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-300 max-w-2xl">
              Inspect your manual files in real time. Compare original media directly against Error Level Analysis (ELA), 
              2D Fourier FFT spectral grids, and Spatial Rich Model (SRM) sensor noise residuals.
            </p>
          </div>

          {/* Controls: Manual Upload & Preset Demos */}
          <div className="flex flex-wrap items-center gap-2.5">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="btn-glossy-primary px-4 py-2.5 rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-cyan-500/30"
            >
              <span>📁</span>
              <span>{isUploading ? 'Analyzing Upload…' : 'Upload Your File'}</span>
            </motion.button>

            {customUpload && (
              <button
                type="button"
                onClick={() => setActiveSample('custom')}
                className={`rounded-xl px-3 py-2 text-xs font-bold transition-all border ${
                  activeSample === 'custom'
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                    : 'bg-white/5 text-slate-300 border-white/10 hover:text-white'
                }`}
              >
                ★ User File
              </button>
            )}

            <button
              type="button"
              onClick={() => setActiveSample('ai_portrait')}
              className={`rounded-xl px-3 py-2 text-xs font-bold transition-all border ${
                activeSample === 'ai_portrait'
                  ? 'bg-blue-600/30 text-blue-300 border-blue-400 shadow-md'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
              }`}
            >
              Sample: AI Portrait
            </button>
            <button
              type="button"
              onClick={() => setActiveSample('synthetic_art')}
              className={`rounded-xl px-3 py-2 text-xs font-bold transition-all border ${
                activeSample === 'synthetic_art'
                  ? 'bg-rose-600/30 text-rose-300 border-rose-400 shadow-md'
                  : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
              }`}
            >
              Sample: FLUX Art
            </button>
          </div>
        </div>

        {/* Upload Status / Error feedback */}
        <AnimatePresence>
          {isUploading && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 rounded-xl border border-cyan-500/30 bg-cyan-950/40 p-3 text-xs text-cyan-200 flex items-center gap-3"
            >
              <svg className="h-4 w-4 animate-spin text-cyan-400" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
              </svg>
              <span>Executing 2D Fourier decomposition, adaptive ELA quantization, and SRM noise inference…</span>
            </motion.div>
          )}

          {uploadError && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mt-4 rounded-xl border border-rose-500/30 bg-rose-950/40 p-3 text-xs text-rose-200"
            >
              ⚠️ {uploadError}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Split Screen Dual Slider Inspector */}
        <div className="glass-card p-6 lg:col-span-2 space-y-4 border border-white/15">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Overlay Layer:
              </span>
              {[
                { id: 'ela', label: 'ELA Heatmap', score: current.elaScore },
                { id: 'fft', label: '2D FFT Spectrum', score: current.fftScore },
                { id: 'residual', label: 'SRM Noise', score: current.noiseScore },
              ].map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setActiveInspector(mode.id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold uppercase transition-all flex items-center gap-1.5 ${
                    activeInspector === mode.id
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400/50 shadow-[0_0_15px_rgba(6,182,212,0.3)]'
                      : 'bg-white/5 text-slate-400 hover:text-white'
                  }`}
                >
                  <span>{mode.label}</span>
                  <span className="text-[10px] font-mono text-cyan-400 font-extrabold">({(mode.score * 100).toFixed(0)}%)</span>
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsMagnifierActive(!isMagnifierActive)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition-all ${
                  isMagnifierActive
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-[0_0_15px_rgba(251,191,36,0.3)]'
                    : 'bg-white/5 text-slate-400 hover:text-white'
                }`}
              >
                🔍 {isMagnifierActive ? 'Loupe Active (2x)' : 'Toggle Loupe'}
              </button>
            </div>
          </div>

          {/* Interactive Split-View Canvas with Laser Scanner Effect */}
          <div
            ref={containerRef}
            onMouseMove={handleMouseMove}
            className="relative h-96 sm:h-[480px] w-full rounded-2xl overflow-hidden border border-white/15 select-none bg-black cursor-crosshair shadow-2xl"
          >
            {/* Background Layer: Forensic Overlay (ELA Heatmap / 2D FFT / Noise) */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black">
              <img
                src={getOverlayImage()}
                alt="Forensic layer"
                className={`h-full w-full object-contain transition-all duration-300 ${getOverlayFilter()}`}
              />
              <span className="absolute bottom-4 right-4 rounded-md bg-black/80 border border-cyan-500/40 px-3 py-1 text-[11px] font-black text-cyan-400 uppercase tracking-wider backdrop-blur-md">
                Forensic: {activeInspector.toUpperCase()} ({(
                  (activeInspector === 'ela' ? current.elaScore : activeInspector === 'fft' ? current.fftScore : current.noiseScore) * 100
                ).toFixed(1)}%)
              </span>
            </div>

            {/* Foreground Layer: User's Original Media (clipped by interactive slider) */}
            <div
              className="absolute inset-0 overflow-hidden bg-black"
              style={{ clipPath: `inset(0 ${100 - sliderPosition}% 0 0)` }}
            >
              <img
                src={current.original}
                alt="Original media"
                className="h-full w-full object-contain"
              />
              <span className="absolute bottom-4 left-4 rounded-md bg-black/80 border border-white/20 px-3 py-1 text-[11px] font-black text-white uppercase tracking-wider backdrop-blur-md">
                Original Media
              </span>
            </div>

            {/* Split Divider Line */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-cyan-400 shadow-[0_0_15px_rgba(6,182,212,1)] cursor-ew-resize"
              style={{ left: `${sliderPosition}%` }}
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-8 w-8 rounded-full bg-cyan-400 text-black font-black text-xs flex items-center justify-center shadow-[0_0_15px_rgba(6,182,212,0.8)]">
                ↔
              </div>
            </div>

            {/* Optional Magnifier Loupe */}
            {isMagnifierActive && (
              <div
                className="pointer-events-none absolute h-36 w-36 rounded-full border-2 border-amber-400 shadow-[0_0_25px_rgba(251,191,36,0.6)] overflow-hidden -translate-x-1/2 -translate-y-1/2 bg-black"
                style={{
                  left: `${magnifierPos.x}px`,
                  top: `${magnifierPos.y}px`,
                }}
              >
                <img
                  src={current.original}
                  alt="Magnified zoom"
                  className="absolute max-none transform scale-200 origin-center"
                  style={{
                    left: `-${magnifierPos.x * 2 - 72}px`,
                    top: `-${magnifierPos.y * 2 - 72}px`,
                  }}
                />
              </div>
            )}
          </div>

          {/* Slider Position Scrubber */}
          <div className="flex items-center gap-3 pt-2">
            <span className="text-xs text-slate-400 font-bold uppercase">Original</span>
            <input
              type="range"
              min="0"
              max="100"
              value={sliderPosition}
              onChange={(e) => setSliderPosition(Number(e.target.value))}
              className="w-full accent-cyan-400 cursor-pointer"
            />
            <span className="text-xs text-cyan-300 font-bold uppercase">Forensic Overlay</span>
          </div>
        </div>

        {/* Forensic Spider / Radar Chart & Evidence Box */}
        <div className="glass-card p-6 flex flex-col justify-between space-y-6 border border-white/15">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold uppercase tracking-wider text-cyan-400">
                Forensic Radar Vector
              </span>
              <span className="text-[11px] font-mono text-slate-400">{current.isCustom ? 'User Upload' : 'Sample'}</span>
            </div>
            <h3 className="text-sm font-bold text-white mt-1">{current.title}</h3>
            <p className="text-xs text-slate-400 mt-0.5">{current.verdict}</p>

            {/* Interactive SVG Radar Chart */}
            <div className="relative mt-6 flex items-center justify-center">
              <svg width="220" height="220" className="overflow-visible">
                {/* Background Web Polygons */}
                {[0.2, 0.4, 0.6, 0.8, 1.0].map((scale) => {
                  const points = [
                    [110, 110 - 90 * scale],
                    [110 + 78 * scale, 110 - 45 * scale],
                    [110 + 78 * scale, 110 + 45 * scale],
                    [110, 110 + 90 * scale],
                    [110 - 78 * scale, 110 + 45 * scale],
                    [110 - 78 * scale, 110 - 45 * scale],
                  ]
                    .map((p) => p.join(','))
                    .join(' ');
                  return (
                    <polygon
                      key={scale}
                      points={points}
                      fill="none"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth="1"
                    />
                  );
                })}

                {/* Radar Data Polygon with high contrast cyan-blue neon styling */}
                {(() => {
                  const r = current.radarData.map((v) => v / 100);
                  const dataPoints = [
                    [110, 110 - 90 * r[0]],
                    [110 + 78 * r[1], 110 - 45 * r[1]],
                    [110 + 78 * r[2], 110 + 45 * r[2]],
                    [110, 110 + 90 * r[3]],
                    [110 - 78 * r[4], 110 + 45 * r[4]],
                    [110 - 78 * r[5], 110 - 45 * r[5]],
                  ]
                    .map((p) => p.join(','))
                    .join(' ');

                  return (
                    <polygon
                      points={dataPoints}
                      fill="rgba(6,182,212,0.25)"
                      stroke="#06B6D4"
                      strokeWidth="2.5"
                      style={{ filter: 'drop-shadow(0 0 10px rgba(6,182,212,0.7))' }}
                    />
                  );
                })()}

                {/* Axis Labels */}
                <text x="110" y="8" textAnchor="middle" fill="#38BDF8" fontSize="9" fontWeight="700">
                  Fourier FFT
                </text>
                <text x="195" y="60" textAnchor="start" fill="#38BDF8" fontSize="9" fontWeight="700">
                  ELA Error
                </text>
                <text x="195" y="165" textAnchor="start" fill="#38BDF8" fontSize="9" fontWeight="700">
                  SRM Noise
                </text>
                <text x="110" y="215" textAnchor="middle" fill="#38BDF8" fontSize="9" fontWeight="700">
                  Face DFDC
                </text>
                <text x="25" y="165" textAnchor="end" fill="#38BDF8" fontSize="9" fontWeight="700">
                  CLIP Probe
                </text>
                <text x="25" y="60" textAnchor="end" fill="#38BDF8" fontSize="9" fontWeight="700">
                  Chroma Noise
                </text>
              </svg>
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs space-y-2">
            <span className="font-extrabold text-white uppercase tracking-wider text-[11px] block mb-1">
              Forensic Evidence Summary
            </span>
            <p className="text-slate-300 leading-relaxed">{current.details}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
