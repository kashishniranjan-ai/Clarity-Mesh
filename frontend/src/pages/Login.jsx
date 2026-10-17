import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();

  const [isRegister, setIsRegister] = useState(false);
  const [role, setRole] = useState('analyst'); // 'analyst' | 'admin'
  const [name, setName] = useState('');
  const [emailOrPhone, setEmailOrPhone] = useState('analyst@claritymesh.ai');
  const [password, setPassword] = useState('clarity2026');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    setError('');
    setInfoMessage('');
    setLoading(true);

    const credential = emailOrPhone.trim();
    if (!credential) {
      setError('Please provide an email or phone number.');
      setLoading(false);
      return;
    }

    if (!password) {
      setError('Please enter your password.');
      setLoading(false);
      return;
    }

    try {
      if (isRegister) {
        if (!name.trim()) {
          throw new Error('Please enter your name.');
        }
        await register(name, credential, password, role);
      } else {
        await login(credential, password, role);
      }
      navigate('/');
    } catch (err) {
      setError(err?.message || 'Authentication failed. Please verify your credentials.');
      setLoading(false);
    }
  };

  const handleQuickAnalyst = async () => {
    setError('');
    setInfoMessage('');
    setEmailOrPhone('analyst@claritymesh.ai');
    setPassword('clarity2026');
    setRole('analyst');
    setLoading(true);
    try {
      await login('analyst@claritymesh.ai', 'clarity2026', 'analyst');
      navigate('/');
    } catch (err) {
      setError(err?.message || 'Quick sign in failed.');
      setLoading(false);
    }
  };

  const handleQuickAdmin = async () => {
    setError('');
    setInfoMessage('');
    setEmailOrPhone('admin@claritymesh.ai');
    setPassword('rootmesh2026');
    setRole('admin');
    setLoading(true);
    try {
      await login('admin@claritymesh.ai', 'rootmesh2026', 'admin');
      navigate('/admin');
    } catch (err) {
      setError(err?.message || 'Quick admin sign in failed.');
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    setError('');
    setInfoMessage('Password recovery dispatched to verified identity channels.');
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#06070D] px-4 py-12">
      {/* ── Twinkling Cosmic Stars (Hardware-Accelerated CSS) ──── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '12%', left: '15%', width: '2px', height: '2px', animationDuration: '3s', boxShadow: '0 0 6px rgba(255, 255, 255, 0.9)' }}
        />
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '25%', left: '28%', width: '1.5px', height: '1.5px', animationDuration: '4.5s', boxShadow: '0 0 5px rgba(255, 255, 255, 0.8)' }}
        />
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '18%', left: '72%', width: '2px', height: '2px', animationDuration: '3.8s', boxShadow: '0 0 6px rgba(255, 255, 255, 0.9)' }}
        />
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '38%', left: '85%', width: '1.5px', height: '1.5px', animationDuration: '5.2s', boxShadow: '0 0 5px rgba(255, 255, 255, 0.8)' }}
        />
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '75%', left: '18%', width: '2px', height: '2px', animationDuration: '4.2s', boxShadow: '0 0 6px rgba(255, 255, 255, 0.9)' }}
        />
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '82%', left: '65%', width: '1.5px', height: '1.5px', animationDuration: '3.5s', boxShadow: '0 0 5px rgba(255, 255, 255, 0.8)' }}
        />
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '60%', left: '8%', width: '1px', height: '1px', animationDuration: '4.8s', boxShadow: '0 0 4px rgba(255, 255, 255, 0.8)' }}
        />
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '48%', left: '34%', width: '1.5px', height: '1.5px', animationDuration: '5s', boxShadow: '0 0 5px rgba(255, 255, 255, 0.8)' }}
        />
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '88%', left: '88%', width: '2px', height: '2px', animationDuration: '3.2s', boxShadow: '0 0 6px rgba(255, 255, 255, 0.9)' }}
        />
        <div
          className="absolute rounded-full bg-white animate-pulse"
          style={{ top: '8%', left: '45%', width: '1px', height: '1px', animationDuration: '4.1s', boxShadow: '0 0 4px rgba(255, 255, 255, 0.8)' }}
        />

        {/* Ambient Nebula Fog */}
        <div className="absolute -top-32 left-1/4 h-[420px] w-[420px] rounded-full bg-cyan-950/20 blur-[130px]" />
        <div className="absolute bottom-10 left-10 h-[300px] w-[300px] rounded-full bg-sky-950/25 blur-[110px]" />
      </div>

      {/* ── Giant Animated Celestial Planet with Glowing Neon Cyan Crescent ── */}
      <div className="pointer-events-none absolute right-[-140px] sm:right-[-90px] md:right-[-40px] lg:right-[4%] top-[-80px] sm:top-[-40px] md:top-[2%] z-0">
        <div
          className="relative h-[340px] w-[340px] sm:h-[460px] sm:w-[460px] md:h-[540px] md:w-[540px] lg:h-[620px] lg:w-[620px] rounded-full transition-transform duration-1000"
          style={{
            animation: 'celestialFloat 12s ease-in-out infinite',
          }}
        >
          {/* Outer Radiant Atmospheric Glow */}
          <div
            className="absolute inset-[-18px] rounded-full blur-[42px]"
            style={{
              background:
                'radial-gradient(circle at 28% 52%, rgba(6, 182, 212, 0.6) 0%, rgba(14, 165, 233, 0.45) 32%, rgba(2, 132, 199, 0.25) 60%, transparent 80%)',
            }}
          />

          {/* Planet Spherical Body */}
          <div
            className="relative h-full w-full rounded-full overflow-hidden"
            style={{
              background:
                'radial-gradient(circle at 24% 48%, #081726 0%, #040d16 35%, #02060b 72%, #010204 100%)',
              boxShadow:
                'inset 18px -4px 34px -4px rgba(16, 185, 129, 0.45), inset 38px 0 65px 0 rgba(6, 182, 212, 0.85), inset 70px 10px 100px -10px rgba(14, 165, 233, 0.6), inset 120px 20px 140px -20px rgba(3, 105, 161, 0.35)',
            }}
          >
            {/* Luminous Crescent Arc Edge */}
            <div
              className="absolute inset-0 rounded-full"
              style={{
                boxShadow:
                  'inset 14px 2px 28px rgba(255, 255, 255, 0.85), inset 32px 6px 52px rgba(6, 182, 212, 0.75), inset 65px 12px 90px rgba(16, 185, 129, 0.6)',
              }}
            />

            {/* Internal Surface Shadow Band */}
            <div
              className="absolute inset-0 opacity-55"
              style={{
                background:
                  'radial-gradient(circle at 75% 50%, rgba(1, 2, 4, 0.98) 0%, rgba(1, 2, 4, 0.92) 48%, transparent 78%)',
              }}
            />
          </div>

          {/* Intense Light Flare / Corona where crescent aligns with card */}
          <div
            className="pointer-events-none absolute left-[4%] top-[34%] h-[160px] w-[160px] sm:h-[220px] sm:w-[220px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[48px] animate-pulse"
            style={{
              animationDuration: '4s',
              background:
                'radial-gradient(circle, rgba(255, 255, 255, 0.9) 0%, rgba(6, 182, 212, 0.75) 25%, rgba(16, 185, 129, 0.45) 55%, transparent 75%)',
            }}
          />
        </div>
      </div>

      {/* ── Centered Glassmorphic Sign In Card (Instant Visible, Zero Freeze) ── */}
      <div className="relative z-10 w-full max-w-[390px] sm:max-w-[410px]">
        <div
          className="relative overflow-hidden rounded-3xl p-7 sm:p-8"
          style={{
            background: 'linear-gradient(145deg, rgba(10, 14, 22, 0.88) 0%, rgba(4, 6, 10, 0.94) 100%)',
            backdropFilter: 'blur(32px)',
            WebkitBackdropFilter: 'blur(32px)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            boxShadow:
              '0 32px 80px -15px rgba(0, 0, 0, 0.95), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
          }}
        >
          {/* Soft ambient inner light at the top-right of card reflecting the planet */}
          <div
            className="pointer-events-none absolute -top-16 -right-16 h-48 w-48 rounded-full blur-[45px] opacity-35"
            style={{
              background: 'radial-gradient(circle, #06b6d4 0%, #0369a1 60%, transparent 80%)',
            }}
          />

          {/* Heading & Subtitle */}
          <div className="mb-6">
            <h1 className="text-2xl sm:text-[26px] font-semibold tracking-tight text-white">
              {isRegister ? 'Sign Up' : 'Sign In'}
            </h1>
            <p className="mt-1 text-xs sm:text-[13px] text-slate-400 font-normal">
              Keep it all together and you'll be fine
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-3.5">
            {isRegister && (
              <div className="overflow-hidden">
                <input
                  type="text"
                  required={isRegister}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Full Name"
                  className="w-full rounded-xl bg-black/70 px-4 py-3 text-sm text-white placeholder-slate-500 border border-white/[0.12] focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 outline-none transition-all shadow-inner"
                />
              </div>
            )}

            {/* Email or Phone Input */}
            <div>
              <input
                type="text"
                required
                value={emailOrPhone}
                onChange={(e) => setEmailOrPhone(e.target.value)}
                placeholder="Email or Phone"
                className="w-full rounded-xl bg-black/70 px-4 py-3 text-sm text-white placeholder-slate-500 border border-white/[0.12] focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 outline-none transition-all shadow-inner"
              />
            </div>

            {/* Password Input with Pure Text "Show" / "Hide" Toggle */}
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="w-full rounded-xl bg-black/70 px-4 py-3 pr-16 text-sm text-white placeholder-slate-500 border border-white/[0.12] focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/40 outline-none transition-all shadow-inner"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-cyan-400 hover:text-cyan-300 transition-colors py-1 px-1 focus:outline-none"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>

            {/* Forgot Password Link */}
            <div className="pt-0.5">
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-xs text-slate-400 hover:text-cyan-300 transition-colors focus:outline-none"
              >
                Forgot Password
              </button>
            </div>

            {/* Feedback / Error Banners (Clean typography only - no icons, no emojis) */}
            {error && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-300 text-center font-medium">
                {error}
              </div>
            )}

            {infoMessage && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-2.5 text-xs text-cyan-300 text-center font-medium">
                {infoMessage}
              </div>
            )}

            {/* Primary Sign In Button (Animated glossy cyan/emerald gradient) */}
            <button
              type="submit"
              disabled={loading}
              className="btn-shimmer relative w-full mt-2 rounded-xl py-3 text-sm font-bold text-black transition-all shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/45 hover:brightness-105 active:scale-[0.99] overflow-hidden"
              style={{
                background: 'linear-gradient(90deg, #00F2FE 0%, #06B6D4 50%, #10B981 100%)',
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3.5 w-3.5 rounded-full border-2 border-black/40 border-t-black animate-spin" />
                  <span>Signing In...</span>
                </span>
              ) : isRegister ? (
                'Create Account'
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Minimalist Divider */}
          <div className="relative my-4 flex items-center justify-center">
            <div className="w-full border-t border-white/[0.08]" />
            <span className="absolute bg-[#06080E] px-3 text-[11px] font-normal text-slate-500">
              or
            </span>
          </div>

          {/* Secondary Action Options (Pure Typography, Zero Emojis, Zero Icons) */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={handleQuickAnalyst}
              disabled={loading}
              className="w-full rounded-xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.08] hover:border-cyan-500/30 py-2.5 px-3 text-xs font-medium text-slate-300 transition-all text-center hover:text-white"
            >
              Sign In with One-Click Access
            </button>

            <button
              type="button"
              onClick={handleQuickAdmin}
              disabled={loading}
              className="w-full text-center text-[11px] text-slate-400 hover:text-amber-300 transition-colors pt-1"
            >
              Sign In with Root Admin Credentials
            </button>
          </div>

          {/* Bottom Switcher: "New to Clarity Mesh? Join Now" */}
          <div className="mt-6 text-center text-xs text-slate-400">
            <span>{isRegister ? 'Already registered? ' : 'New to Clarity Mesh? '}</span>
            <button
              type="button"
              onClick={() => {
                setIsRegister(!isRegister);
                setError('');
                setInfoMessage('');
              }}
              className="font-medium text-cyan-400 hover:text-cyan-300 transition-colors focus:outline-none"
            >
              {isRegister ? 'Sign In' : 'Join Now'}
            </button>
          </div>
        </div>
      </div>

      {/* Embedded Celestial CSS Animation */}
      <style>{`
        @keyframes celestialFloat {
          0%, 100% { transform: translateY(0px) rotate(0deg) scale(1); }
          50% { transform: translateY(-8px) rotate(1deg) scale(1.015); }
        }
      `}</style>
    </div>
  );
}
