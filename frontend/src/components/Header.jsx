import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import Logo from './Logo';

const linkBase =
  'rounded-md px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500';
const linkIdle = 'text-slate-600 hover:bg-slate-100 hover:text-slate-900';
const linkActive = 'bg-slate-100 text-slate-900';

export default function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const { pathname, hash } = useLocation();

  const closeMenu = () => setMenuOpen(false);

  const homeActive = pathname === '/' && hash !== '#how-it-works';
  const howActive = pathname === '/' && hash === '#how-it-works';

  const navItems = (
    <>
      <Link
        to="/"
        onClick={closeMenu}
        className={`${linkBase} ${homeActive ? linkActive : linkIdle}`}
        aria-current={homeActive ? 'page' : undefined}
      >
        Home
      </Link>
      <Link
        to="/#how-it-works"
        onClick={closeMenu}
        className={`${linkBase} ${howActive ? linkActive : linkIdle}`}
      >
        How It Works
      </Link>
      <NavLink
        to="/history"
        onClick={closeMenu}
        className={({ isActive }) => `${linkBase} ${isActive ? linkActive : linkIdle}`}
      >
        Analysis History
      </NavLink>
    </>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          onClick={closeMenu}
          aria-label="Clarity Mesh home"
          className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
        >
          <Logo />
        </Link>

        {/* Desktop / tablet navigation */}
        <nav className="hidden items-center gap-1 md:flex" aria-label="Main navigation">
          {navItems}
        </nav>

        {/* Mobile menu button */}
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            {menuOpen ? (
              <path d="M6 6l12 12M18 6L6 18" />
            ) : (
              <path d="M4 7h16M4 12h16M4 17h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile navigation */}
      {menuOpen && (
        <nav
          id="mobile-nav"
          className="flex flex-col gap-1 border-t border-slate-200 bg-white px-4 py-3 md:hidden"
          aria-label="Mobile navigation"
        >
          {navItems}
        </nav>
      )}
    </header>
  );
}
