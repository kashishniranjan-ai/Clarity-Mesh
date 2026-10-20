import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Logo from './Logo';
import { useAuth } from '../context/AuthContext';

export default function Header({ onOpenCommandPalette }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [userDropdown, setUserDropdown] = useState(false);
  const { pathname, hash } = useLocation();
  const { user, isAdmin, logout } = useAuth();

  const closeMenu = () => {
    setMenuOpen(false);
    setUserDropdown(false);
  };

  const homeActive = pathname === '/' && hash !== '#how-it-works';
  const howActive = pathname === '/' && hash === '#how-it-works';

  const links = [
    { to: '/', label: 'Home', active: homeActive },
    { to: '/#how-it-works', label: 'How It Works', active: howActive },
    { to: '/studio', label: 'Forensic Studio', active: pathname === '/studio', highlight: true },
    { to: '/live', label: 'Live Stream', active: pathname === '/live' },
    { to: '/dashboard', label: 'Dashboard', active: pathname === '/dashboard' },
    { to: '/cases', label: 'Cases', active: pathname.startsWith('/cases') },
    { to: '/assistant', label: 'AI Analyst', active: pathname === '/assistant' || pathname === '/analyst' },
    { to: '/reports', label: 'Reports', active: pathname === '/reports' },
    { to: '/evaluation', label: 'Evaluation', active: pathname === '/evaluation' },
    { to: '/history', label: 'History', active: pathname === '/history' },
    ...(isAdmin ? [{ to: '/admin', label: '⚡ SecOps Admin', active: pathname === '/admin', admin: true }] : []),
  ];

  return (
    <header className="sticky top-0 z-40 w-full border-b border-white/[0.08] bg-canvas-bg/90 backdrop-blur-2xl transition-all shadow-[0_4px_30px_rgba(0,0,0,0.8)]">
      {/* Top Specular Reflection Highlight */}
      <div className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <Link
          to="/"
          onClick={closeMenu}
          aria-label="Clarity Mesh home"
          className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
        >
          <Logo />
        </Link>

        {/* Desktop Navigation with Smooth Floating Pill Selector */}
        <nav className="hidden items-center gap-1 rounded-full border border-white/[0.1] bg-white/[0.03] p-1.5 backdrop-blur-xl shadow-inner xl:flex" aria-label="Main navigation">
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              onClick={closeMenu}
              className={`relative rounded-full px-3 py-1.5 text-xs font-semibold tracking-wide transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                link.active
                  ? 'text-white'
                  : link.admin
                  ? 'text-amber-400 hover:text-amber-300'
                  : link.highlight
                  ? 'text-cyan-300 hover:text-cyan-200'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {link.active && (
                <motion.span
                  layoutId="activeNavPill"
                  transition={{ type: 'spring', stiffness: 450, damping: 32 }}
                  className={`absolute inset-0 rounded-full border shadow-lg ${
                    link.admin
                      ? 'bg-amber-600/30 border-amber-500/40 shadow-amber-500/20'
                      : link.highlight
                      ? 'bg-cyan-600/30 border-cyan-400/50 shadow-cyan-500/25'
                      : 'bg-gradient-to-r from-cyan-500/25 via-blue-500/20 to-teal-500/25 border-cyan-400/40 shadow-cyan-500/25'
                  }`}
                />
              )}
              <span className="relative z-10">{link.label}</span>
            </Link>
          ))}
        </nav>

        {/* Right Action & Authentication Controls */}
        <div className="hidden items-center gap-3 md:flex">
          {onOpenCommandPalette && (
            <button
              type="button"
              onClick={onOpenCommandPalette}
              className="flex items-center gap-2 rounded-xl border border-white/10 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white hover:border-cyan-500/40 transition-all font-mono shadow-sm"
              title="Search cases & analyses (Cmd/Ctrl+K)"
            >
              <span className="text-cyan-400 font-bold">⌘K</span>
              <span className="text-[11px] font-sans text-slate-400">Search</span>
            </button>
          )}

          {user ? (
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setUserDropdown(!userDropdown)}
                  className="flex items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] p-1.5 pr-3 text-xs font-bold text-white hover:bg-white/[0.1] transition-all shadow-sm"
                >
                  <img
                    src={user.avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100'}
                    alt={user.name}
                    className="h-6 w-6 rounded-full border border-cyan-400/50 object-cover"
                  />
                  <span className="max-w-[120px] truncate">{user.name.split(' ')[0]}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[9px] font-black ${
                      user.role === 'admin'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                        : 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                    }`}
                  >
                    {user.role === 'admin' ? 'ROOT' : 'AGENT'}
                  </span>
                </button>

                <AnimatePresence>
                  {userDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 6, scale: 0.95 }}
                      className="glass-card absolute right-0 mt-2 w-56 p-2 text-xs shadow-2xl z-50 border border-white/15 backdrop-blur-2xl"
                    >
                      <div className="p-2 border-b border-white/[0.08] mb-1">
                        <p className="font-bold text-white truncate">{user.name}</p>
                        <p className="text-[10px] text-slate-400 font-mono truncate">{user.email}</p>
                        <p className="text-[10px] text-cyan-300 font-semibold mt-1">{user.clearance}</p>
                      </div>

                      {user.role === 'admin' && (
                        <Link
                          to="/admin"
                          onClick={closeMenu}
                          className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-amber-300 hover:bg-amber-500/10 transition-colors"
                        >
                          <span>⚡</span>
                          <span>SecOps Admin Console</span>
                        </Link>
                      )}

                      <Link
                        to="/studio"
                        onClick={closeMenu}
                        className="flex items-center gap-2 rounded-lg px-2.5 py-2 text-cyan-300 hover:bg-cyan-500/10 transition-colors"
                      >
                        <span>🔬</span>
                        <span>Forensic Studio</span>
                      </Link>

                      <button
                        type="button"
                        onClick={() => {
                          logout();
                          closeMenu();
                        }}
                        className="w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-rose-300 hover:bg-rose-500/10 transition-colors mt-1"
                      >
                        <span>🚪</span>
                        <span>Terminate Session</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <button
                type="button"
                onClick={() => {
                  logout();
                  closeMenu();
                }}
                className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-slate-300 hover:text-rose-300 hover:border-rose-500/30 hover:bg-rose-500/10 transition-all"
                title="Log out and return to Login page"
              >
                Log Out
              </button>
            </div>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3.5 py-1.5 text-xs font-bold text-cyan-300 hover:bg-cyan-500/20 hover:text-white transition-all shadow-sm"
            >
              <span>🔏</span>
              <span>Sign In / Demo</span>
            </Link>
          )}

          <Link
            to="/#analyze"
            onClick={() => {
              const el = document.getElementById('analyze');
              if (el) el.scrollIntoView({ behavior: 'smooth' });
            }}
            className="btn-glossy-primary btn-shimmer relative rounded-full px-5 py-2 text-xs font-extrabold text-white transition-all inline-block tracking-wide"
          >
            Analyze Media
          </Link>
        </div>

        {/* Mobile menu trigger button */}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-xl p-2.5 text-slate-400 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 xl:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile Animated Dropdown */}
      <AnimatePresence>
        {menuOpen && (
          <motion.nav
            id="mobile-nav"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="flex flex-col gap-1.5 border-t border-white/[0.08] bg-canvas-bg/95 px-5 py-4 backdrop-blur-2xl xl:hidden overflow-hidden"
            aria-label="Mobile navigation"
          >
            {links.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={closeMenu}
                className={`rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
                  link.active
                    ? 'bg-cyan-500/15 text-cyan-200 border border-cyan-500/30'
                    : 'text-slate-400 hover:bg-white/5 hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}

            <div className="mt-3 pt-3 border-t border-white/10 flex items-center justify-between">
              {user ? (
                <div className="flex items-center justify-between w-full">
                  <span className="text-xs font-bold text-white">{user.name} ({user.role})</span>
                  <button
                    onClick={() => {
                      logout();
                      closeMenu();
                    }}
                    className="text-xs text-rose-400 font-semibold"
                  >
                    Log Out
                  </button>
                </div>
              ) : (
                <Link
                  to="/login"
                  onClick={closeMenu}
                  className="w-full text-center rounded-lg btn-glossy-primary py-2 text-xs font-bold text-white shadow-md shadow-cyan-500/20"
                >
                  Sign In / Demo Access
                </Link>
              )}
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
