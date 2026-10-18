import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-9 w-9 rounded-full border-2 border-cyan-500/20 border-t-cyan-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (requireAdmin && !isAdmin) {
    return (
      <div className="min-h-[70vh] flex items-center justify-center p-6 text-center">
        <div className="glass-card max-w-lg p-8 border border-rose-500/30 bg-rose-950/10">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center mx-auto mb-4 text-rose-400">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m11-3.5a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Access Denied: Tier 4 Required</h2>
          <p className="text-xs text-slate-300 leading-relaxed mb-6">
            Your investigator identity (<strong>{user.email}</strong>) has <strong>{user.clearance}</strong>.
            The Administrator Command Center requires Tier 4 SecOps Root clearance.
          </p>
          <a
            href="/"
            className="inline-block btn-glossy-primary px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-cyan-500/25"
          >
            Return to Forensics Workbench
          </a>
        </div>
      </div>
    );
  }

  return children;
}
