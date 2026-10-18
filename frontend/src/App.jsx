import React, { Suspense, lazy, useEffect, useState } from 'react';
import { Route, Routes, useLocation, useNavigate, Navigate } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';
import CommandPalette from './components/CommandPalette';
import { AuthProvider, useAuth } from './context/AuthContext';
import { clearStoredAuth } from './services/api';

const Home = lazy(() => import('./pages/Home'));
const History = lazy(() => import('./pages/History'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Cases = lazy(() => import('./pages/Cases'));
const Reports = lazy(() => import('./pages/Reports'));
const Evaluation = lazy(() => import('./pages/Evaluation'));
const Admin = lazy(() => import('./pages/Admin'));
const Studio = lazy(() => import('./pages/Studio'));

/**
 * Robust ErrorBoundary to guarantee the screen NEVER freezes black.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Clarity Mesh Runtime Boundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#030407] flex items-center justify-center p-6 text-white text-center">
          <div className="glass-card max-w-md p-8 border border-cyan-500/30">
            <h2 className="text-xl font-bold text-white mb-2">Workspace Reset</h2>
            <p className="text-xs text-slate-400 mb-6">
              A temporary runtime exception occurred. Click below to refresh your session.
            </p>
            <button
              type="button"
              onClick={() => {
                clearStoredAuth();
                window.location.href = '/';
              }}
              className="btn-glossy-primary px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-cyan-500/25"
            >
              Reset Session & Continue
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/**
 * Smoothly scrolls to target hash on navigation or hashchange
 */
function ScrollManager() {
  const { hash, pathname } = useLocation();

  useEffect(() => {
    if (hash) {
      const id = hash.replace('#', '');
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth' });
        return;
      }
      const timeout = setTimeout(() => {
        const delayedEl = document.getElementById(id);
        if (delayedEl) {
          delayedEl.scrollIntoView({ behavior: 'smooth' });
        }
      }, 100);
      return () => clearTimeout(timeout);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [hash, pathname]);

  return null;
}

/**
 * Main application shell with Authentication Gating:
 * When NOT logged in, Login page renders immediately.
 * When logged in, full website experience (Header, Routes, Footer) is displayed.
 */
function AppShell() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [cmdOpen, setCmdOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#030407]">
        <div className="h-9 w-9 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
      </div>
    );
  }

  // Not logged in: Show the Login page immediately
  if (!user) {
    return <Login />;
  }

  // Authenticated: Render full website experience with role-guarded routes
  return (
    <div className="flex min-h-screen flex-col bg-[#030407]">
      <ScrollManager />
      <CommandPalette
        isOpen={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNavigate={(dest) => {
          navigate(dest === 'home' || dest === 'analyze' ? '/' : `/${dest}`);
        }}
      />
      <Header onOpenCommandPalette={() => setCmdOpen(true)} />
      <main className="flex-1">
        <Suspense
          fallback={
            <div className="mx-auto flex min-h-[60vh] max-w-7xl flex-col items-center justify-center px-6 text-sm text-slate-300">
              <div className="relative flex items-center justify-center">
                <div className="h-10 w-10 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
                <div className="absolute h-4 w-4 rounded-full bg-cyan-400/20 animate-ping" />
              </div>
              <span className="mt-4 font-medium text-slate-400">Loading neural experience…</span>
            </div>
          }
        >
          <Routes location={location}>
            <Route path="/" element={<Home />} />
            <Route path="/login" element={<Navigate to="/" replace />} />
            <Route path="/studio" element={<Studio />} />
            <Route
              path="/admin"
              element={
                <ProtectedRoute requireAdmin={true}>
                  <Admin />
                </ProtectedRoute>
              }
            />
            <Route
              path="/history"
              element={
                <ProtectedRoute>
                  <History />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <Dashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/analyst"
              element={
                <ProtectedRoute>
                  <Assistant />
                </ProtectedRoute>
              }
            />
            <Route
              path="/assistant"
              element={
                <ProtectedRoute>
                  <Assistant />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cases"
              element={
                <ProtectedRoute>
                  <Cases />
                </ProtectedRoute>
              }
            />
            <Route
              path="/cases/:caseId"
              element={
                <ProtectedRoute>
                  <Cases />
                </ProtectedRoute>
              }
            />
            <Route
              path="/reports"
              element={
                <ProtectedRoute>
                  <Reports />
                </ProtectedRoute>
              }
            />
            <Route
              path="/evaluation"
              element={
                <ProtectedRoute>
                  <Evaluation />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Home />} />
          </Routes>
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </ErrorBoundary>
  );
}
