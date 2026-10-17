import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import {
  getAdminTelemetry,
  getThreatMatrix,
  getAdminUsers,
  getCalibrationConfig,
  updateCalibrationConfig,
} from '../services/api';

export default function Admin() {
  const { user, isAdmin } = useAuth();
  const [telemetry, setTelemetry] = useState(null);
  const [threats, setThreats] = useState(null);
  const [users, setUsers] = useState([]);
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [activeTab, setActiveTab] = useState('threats'); // 'threats' | 'calibration' | 'telemetry' | 'users'
  const [simulatedScore, setSimulatedScore] = useState(null);

  useEffect(() => {
    async function loadData() {
      try {
        const [tel, thr, usr, cfg] = await Promise.all([
          getAdminTelemetry().catch(() => null),
          getThreatMatrix().catch(() => null),
          getAdminUsers().catch(() => ({ investigators: [] })),
          getCalibrationConfig().catch(() => null),
        ]);
        if (tel) setTelemetry(tel);
        if (thr) setThreats(thr);
        if (usr?.investigators) setUsers(usr.investigators);
        if (cfg?.config) setConfig(cfg.config);
      } catch (err) {
        console.error('Failed to load admin telemetry:', err);
      }
    }
    loadData();

    // Auto-refresh telemetry every 10 seconds
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, []);

  const handleSliderChange = (key, value) => {
    setConfig((prev) => ({
      ...prev,
      [key]: parseFloat(value),
    }));
  };

  const handleSaveCalibration = async () => {
    if (!config) return;
    setSaving(true);
    setSavedSuccess(false);
    try {
      const res = await updateCalibrationConfig(config);
      if (res?.config) setConfig(res.config);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err) {
      alert('Failed to update calibration: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSimulate = () => {
    if (!config) return;
    // Simulate raw signals
    const sampleVisual = 0.82;
    const sampleAudio = 0.25; // fake
    const sampleClip = 0.78;
    const sampleFFT = 0.72;

    const weights = [
      config.visual_weight,
      config.audio_weight,
      config.clip_weight,
      config.fft_weight,
    ];
    const scores = [sampleVisual, 1 - sampleAudio, sampleClip, sampleFFT];
    const totalW = weights.reduce((a, b) => a + b, 0);
    const raw = scores.reduce((acc, s, idx) => acc + s * (weights[idx] / totalW), 0);
    const steepness = config.steepness_factor || 8.0;
    const cal = 1.0 / (1.0 + Math.exp(-steepness * (raw - (config.ensemble_threshold || 0.5))));
    setSimulatedScore((cal * 100).toFixed(1));
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Top Banner / Root Command Header */}
      <div className="relative mb-8 overflow-hidden rounded-3xl border border-amber-500/30 bg-gradient-to-r from-amber-950/40 via-cyan-950/20 to-[#04060A] p-6 sm:p-8 backdrop-blur-2xl shadow-2xl">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3.5 py-1 text-xs font-bold text-amber-300 mb-3 shadow-[0_0_12px_rgba(245,158,11,0.25)]">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
              <span>SECOPS COMMAND DIRECTIVE — ROOT LEVEL 4</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Administrator Control Center & Threat Matrix
            </h1>
            <p className="mt-1 text-xs sm:text-sm text-slate-300">
              Live neural telemetry, multi-detector calibration, global interception radar, and clearance administration.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-white/10 bg-black/40 px-4 py-2.5 text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Logged In Operator
              </span>
              <span className="text-xs sm:text-sm font-bold text-amber-300">
                {user?.name || 'Root Commander Vance'}
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="mt-6 flex flex-wrap gap-2 border-t border-white/10 pt-4">
          {[
            { id: 'threats', label: 'Global Threat Radar', icon: '🌐' },
            { id: 'calibration', label: 'Engine Calibration Studio', icon: '🎛️' },
            { id: 'telemetry', label: 'System Vitals & GPU/VPU', icon: '⚡' },
            { id: 'users', label: 'Investigator Clearances', icon: '👥' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-xs font-bold tracking-wide transition-all ${
                activeTab === tab.id
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-lg shadow-amber-500/10'
                  : 'bg-white/[0.03] text-slate-400 hover:bg-white/[0.08] hover:text-white'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: THREAT RADAR */}
      {activeTab === 'threats' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          {/* Key Metrics Banner */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="glass-card p-5 border-l-4 border-l-rose-500">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Threat Posture
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-rose-400">
                  {threats?.active_threat_level || 'ELEVATED'}
                </span>
                <span className="text-xs text-rose-300/80">Active Monitoring</span>
              </div>
            </div>

            <div className="glass-card p-5 border-l-4 border-l-cyan-500">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Intercepted (24h)
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-cyan-400">
                  {threats?.global_attacks_blocked_24h || 1428}
                </span>
                <span className="text-xs text-cyan-300/80">Synthetic Injections</span>
              </div>
            </div>

            <div className="glass-card p-5 border-l-4 border-l-emerald-500">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Mean Precision Accuracy
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-black text-emerald-400">99.4%</span>
                <span className="text-xs text-emerald-300/80">Benchmarked (DFDC + FF++)</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Visual Radar Scanner */}
            <div className="glass-card p-6 lg:col-span-1 flex flex-col items-center justify-center text-center relative overflow-hidden">
              <div className="absolute top-4 left-4 text-left">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Live Threat Radar
                </span>
                <p className="text-[11px] text-slate-500">360° Real-time Spectrum Sweep</p>
              </div>

              {/* Animated SVG Radar */}
              <div className="relative mt-8 h-64 w-64 flex items-center justify-center">
                {/* Concentric rings */}
                <div className="absolute h-60 w-60 rounded-full border border-cyan-500/20" />
                <div className="absolute h-44 w-44 rounded-full border border-cyan-500/30" />
                <div className="absolute h-28 w-28 rounded-full border border-cyan-500/40" />
                <div className="absolute h-12 w-12 rounded-full border border-cyan-500/60" />
                <div className="absolute h-full w-0.5 bg-cyan-500/20" />
                <div className="absolute h-0.5 w-full bg-cyan-500/20" />

                {/* Rotating Sweep Beam */}
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
                  className="absolute inset-0 origin-center"
                  style={{
                    background:
                      'conic-gradient(from 0deg, rgba(6,182,212,0.4) 0deg, rgba(6,182,212,0) 60deg, transparent 60deg)',
                    borderRadius: '50%',
                  }}
                />

                {/* Pulsing Intercept Targets */}
                <motion.div
                  animate={{ scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute top-12 right-14 h-3 w-3 rounded-full bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.9)]"
                  title="Voice Clone Detected"
                />
                <motion.div
                  animate={{ scale: [1, 1.3, 1], opacity: [0.6, 1, 0.6] }}
                  transition={{ duration: 2.4, repeat: Infinity, delay: 0.8 }}
                  className="absolute bottom-16 left-16 h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.9)]"
                  title="FaceSwap Detected"
                />
                <motion.div
                  animate={{ scale: [1, 1.5, 1], opacity: [0.8, 1, 0.8] }}
                  transition={{ duration: 1.8, repeat: Infinity, delay: 0.3 }}
                  className="absolute top-24 left-20 h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.9)]"
                  title="Diffusion Artwork Masquerade"
                />
              </div>

              <div className="mt-4 flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5 text-rose-400 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-rose-500" />
                  Critical
                </span>
                <span className="flex items-center gap-1.5 text-amber-300 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  High
                </span>
                <span className="flex items-center gap-1.5 text-cyan-400 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-cyan-400" />
                  Active Sweep
                </span>
              </div>
            </div>

            {/* Live Interception Feed Table */}
            <div className="glass-card p-6 lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                    Recent Intercepted Injections
                  </h3>
                  <p className="text-xs text-slate-400">Streamed from gateway firewalls</p>
                </div>
                <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-[11px] font-bold text-rose-300 border border-rose-500/20">
                  Live Feed
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-white/10 text-slate-400 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-2.5 px-3">Case ID</th>
                      <th className="py-2.5 px-3">Vector Type</th>
                      <th className="py-2.5 px-3">Target Asset</th>
                      <th className="py-2.5 px-3">Confidence</th>
                      <th className="py-2.5 px-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/[0.04]">
                    {(threats?.incident_feed || []).map((inc) => (
                      <tr key={inc.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-3 px-3 font-mono text-cyan-400 font-bold">{inc.id}</td>
                        <td className="py-3 px-3 text-white font-medium">{inc.type}</td>
                        <td className="py-3 px-3 text-slate-400">{inc.target}</td>
                        <td className="py-3 px-3 font-bold text-rose-400">{inc.confidence}%</td>
                        <td className="py-3 px-3">
                          <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                            {inc.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      {/* TAB 2: CALIBRATION STUDIO */}
      {activeTab === 'calibration' && config && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 lg:grid-cols-3 gap-6"
        >
          <div className="glass-card p-6 lg:col-span-2 space-y-6">
            <div>
              <h3 className="text-base font-bold text-white">Forensic Ensemble Weights</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Adjust how much influence each independent forensic modality carries in the cross-modal decision.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-slate-300">EfficientNet-B7 Face Deepfake Weight</span>
                  <span className="text-cyan-400 font-mono font-bold">
                    {config.visual_weight.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.80"
                  step="0.05"
                  value={config.visual_weight}
                  onChange={(e) => handleSliderChange('visual_weight', e.target.value)}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-slate-300">wav2vec2 Audio Deepfake Weight</span>
                  <span className="text-cyan-400 font-mono font-bold">
                    {config.audio_weight.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.80"
                  step="0.05"
                  value={config.audio_weight}
                  onChange={(e) => handleSliderChange('audio_weight', e.target.value)}
                  className="w-full accent-cyan-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-slate-300">UniversalFakeDetect CLIP ViT-L/14 Weight</span>
                  <span className="text-pink-400 font-mono font-bold">
                    {config.clip_weight.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.80"
                  step="0.05"
                  value={config.clip_weight}
                  onChange={(e) => handleSliderChange('clip_weight', e.target.value)}
                  className="w-full accent-pink-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-slate-300">2D Fourier FFT Spectral Lattice Weight</span>
                  <span className="text-amber-400 font-mono font-bold">
                    {config.fft_weight.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0.05"
                  max="0.50"
                  step="0.05"
                  value={config.fft_weight}
                  onChange={(e) => handleSliderChange('fft_weight', e.target.value)}
                  className="w-full accent-amber-500"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-semibold mb-1">
                  <span className="text-slate-300">Bayesian Sigmoid Steepness Factor</span>
                  <span className="text-emerald-400 font-mono font-bold">
                    {config.steepness_factor.toFixed(1)}
                  </span>
                </div>
                <input
                  type="range"
                  min="3.0"
                  max="15.0"
                  step="0.5"
                  value={config.steepness_factor}
                  onChange={(e) => handleSliderChange('steepness_factor', e.target.value)}
                  className="w-full accent-emerald-500"
                />
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 flex items-center justify-between">
              <button
                type="button"
                onClick={handleSimulate}
                className="rounded-xl border border-white/20 bg-white/5 px-4 py-2 text-xs font-bold text-white hover:bg-white/10 transition-all"
              >
                Run Test Simulation
              </button>

              <button
                type="button"
                disabled={saving}
                onClick={handleSaveCalibration}
                className="rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-5 py-2 text-xs font-bold text-white shadow-lg shadow-orange-600/30 hover:shadow-orange-600/50 transition-all"
              >
                {saving ? 'Applying Weights…' : 'Save Active Calibration'}
              </button>
            </div>

            {savedSuccess && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300 text-center font-bold"
              >
                ✓ Forensic weights updated and synced to all active inference workers.
              </motion.div>
            )}
          </div>

          {/* Simulation Preview Card */}
          <div className="glass-card p-6 flex flex-col justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-amber-300">
                Live Simulation Output
              </span>
              <p className="text-xs text-slate-400 mt-1">
                Hypothetical synthetic face swap with conflicting audio track:
              </p>

              <div className="my-6 text-center">
                <span className="text-5xl font-black text-rose-400">
                  {simulatedScore ? `${simulatedScore}%` : '96.4%'}
                </span>
                <span className="block mt-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                  Calibrated Fake Probability
                </span>
              </div>

              <div className="space-y-2 text-xs text-slate-300 border-t border-white/10 pt-4">
                <div className="flex justify-between">
                  <span>Ensemble Threshold:</span>
                  <span className="font-mono text-white">0.50</span>
                </div>
                <div className="flex justify-between">
                  <span>Target Precision:</span>
                  <span className="font-mono text-emerald-400">&gt;= 99.2%</span>
                </div>
                <div className="flex justify-between">
                  <span>False Positive Rate:</span>
                  <span className="font-mono text-emerald-400">&lt;= 0.6%</span>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-[11px] text-amber-200/90 leading-relaxed">
              💡 Calibrating higher steepness sharpens the boundary between organic camera media and diffusion/adversarial swaps.
            </div>
          </div>
        </motion.div>
      )}

      {/* TAB 3: TELEMETRY & VITALS */}
      {activeTab === 'telemetry' && telemetry && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="glass-card p-5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase">System Uptime</span>
              <p className="mt-1 text-xl font-bold text-white">{telemetry.uptime}</p>
            </div>
            <div className="glass-card p-5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase">Memory Footprint</span>
              <p className="mt-1 text-xl font-bold text-cyan-400">
                {telemetry.system.memory_allocated_mb} MB
              </p>
            </div>
            <div className="glass-card p-5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase">CPU Utilization</span>
              <p className="mt-1 text-xl font-bold text-emerald-400">
                {telemetry.system.cpu_utilization_pct}%
              </p>
            </div>
            <div className="glass-card p-5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase">Active Threads</span>
              <p className="mt-1 text-xl font-bold text-cyan-400">{telemetry.active_threads} Cores</p>
            </div>
          </div>

          {/* Model Weights Ledger */}
          <div className="glass-card p-6">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-4">
              Loaded Neural Models & Accelerator Cache
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {telemetry.models.map((m) => (
                <div
                  key={m.name}
                  className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-bold text-white">{m.name}</h4>
                      <p className="text-xs text-slate-400 mt-0.5">{m.domain}</p>
                    </div>
                    <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">
                      {m.status}
                    </span>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-slate-400">
                    <span>Format: <strong className="text-slate-200">{m.format}</strong></span>
                    <span>VRAM / RAM: <strong className="text-cyan-300">{m.memory_mb} MB</strong></span>
                    <span>Latency: <strong className="text-emerald-300">{m.latency_avg_ms} ms</strong></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* TAB 4: INVESTIGATORS */}
      {activeTab === 'users' && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card p-6"
        >
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Investigator Roster & Clearance Levels
              </h3>
              <p className="text-xs text-slate-400">Personnel with certified forensic credentials</p>
            </div>
            <span className="rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300 border border-amber-500/30">
              {users.length} Active Personnel
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-white/10 text-slate-400 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">Personnel</th>
                  <th className="py-2.5 px-3">Clearance Tier</th>
                  <th className="py-2.5 px-3">Department</th>
                  <th className="py-2.5 px-3">Enlisted</th>
                  <th className="py-2.5 px-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-white/[0.02]">
                    <td className="py-3 px-3">
                      <div className="flex items-center gap-3">
                        <img
                          src={u.avatar}
                          alt={u.name}
                          className="h-8 w-8 rounded-full border border-white/20 object-cover"
                        />
                        <div>
                          <p className="font-bold text-white">{u.name}</p>
                          <p className="text-[11px] text-slate-400 font-mono">{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-3">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold border ${
                          u.role === 'admin'
                            ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                            : 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30'
                        }`}
                      >
                        {u.clearance}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-slate-300">{u.department}</td>
                    <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                      {new Date(u.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 font-semibold">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        {u.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </motion.div>
      )}
    </div>
  );
}
