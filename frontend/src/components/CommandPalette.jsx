import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getHistory, getCases } from '../services/api';

/**
 * CommandPalette — Quick navigation & investigation search overlay (Cmd/Ctrl+K).
 */
export default function CommandPalette({ isOpen, onClose, onNavigate }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Static navigation routes
  const staticRoutes = [
    { id: 'nav-dashboard', type: 'page', title: 'Dashboard & Analytics', action: () => onNavigate('dashboard') },
    { id: 'nav-analyze', type: 'page', title: 'Media Forensics Lab', action: () => onNavigate('analyze') },
    { id: 'nav-live', type: 'page', title: 'Live Stream Forensics (Webcam / WS)', action: () => onNavigate('live') },
    { id: 'nav-cases', type: 'page', title: 'Case Management', action: () => onNavigate('cases') },
    { id: 'nav-reports', type: 'page', title: 'Forensic Reporting Studio', action: () => onNavigate('reports') },
    { id: 'nav-assistant', type: 'page', title: 'AI Forensic Analyst', action: () => onNavigate('assistant') },
    { id: 'nav-eval', type: 'page', title: 'Evaluation Lab', action: () => onNavigate('eval') },
  ];

  // Fetch recent cases and history when opened
  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setSelectedIndex(0);
      return;
    }

    let isMounted = true;
    Promise.allSettled([
      getCases().catch(() => ({ cases: [] })),
      getHistory(15).catch(() => ({ items: [] })),
    ]).then(([casesRes, historyRes]) => {
      if (!isMounted) return;
      const loadedCases =
        casesRes.status === 'fulfilled' && Array.isArray(casesRes.value?.cases)
          ? casesRes.value.cases.map((c) => ({
              id: `case-${c.id}`,
              type: 'case',
              title: `Case #${c.id}: ${c.title || 'Untitled Case'}`,
              subtitle: `Status: ${c.status || 'open'} · Priority: ${c.priority || 'medium'}`,
              action: () => {
                onNavigate('cases');
              },
            }))
          : [];

      const loadedHistory =
        historyRes.status === 'fulfilled' && Array.isArray(historyRes.value?.items)
          ? historyRes.value.items.map((h) => ({
              id: `analysis-${h.id}`,
              type: 'analysis',
              title: `Analysis #${h.id}: ${h.original_name || h.stored_name || 'Uploaded Media'}`,
              subtitle: `${h.media_type || 'media'} · ${h.multimodal_classification || h.visual_classification || 'triage'}`,
              action: () => {
                onNavigate('dashboard');
              },
            }))
          : [];

      setItems([...staticRoutes, ...loadedCases, ...loadedHistory]);
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  // Global key listener for Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
        else onClose(true); // Toggle open
      }
      if (isOpen && e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter items based on user search query
  const filteredItems = items.filter((item) =>
    (item.title + ' ' + (item.subtitle || '')).toLowerCase().includes(query.toLowerCase())
  );

  // Keyboard navigation within list
  const handleKeyNavigation = (e) => {
    if (!filteredItems.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = filteredItems[selectedIndex];
      if (current) {
        current.action();
        onClose();
      }
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4">
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/80 backdrop-blur-md"
          />

          {/* Modal box */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.2 }}
            className="relative w-full max-w-xl bg-slate-950 border border-cyan-500/30 rounded-2xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[75vh]"
          >
            {/* Search Input bar */}
            <div className="flex items-center px-4 py-3.5 border-b border-white/10 gap-3">
              <span className="text-cyan-400 font-mono text-sm">⌘</span>
              <input
                autoFocus
                type="text"
                placeholder="Search commands, cases, or past analyses... (Esc to close)"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={handleKeyNavigation}
                className="w-full bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none font-sans"
              />
              <span className="px-1.5 py-0.5 rounded border border-white/10 text-[10px] font-mono text-slate-400 bg-slate-900">
                ESC
              </span>
            </div>

            {/* Results list */}
            <div className="overflow-y-auto p-2 space-y-1">
              {filteredItems.length > 0 ? (
                filteredItems.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      item.action();
                      onClose();
                    }}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center justify-between p-2.5 rounded-xl text-left transition ${
                      selectedIndex === idx
                        ? 'bg-cyan-500/20 border border-cyan-500/40 text-cyan-200'
                        : 'hover:bg-slate-900/60 text-slate-300 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-slate-900 border border-white/10 text-slate-400">
                        {item.type}
                      </span>
                      <div>
                        <div className="text-xs font-semibold text-white">{item.title}</div>
                        {item.subtitle && (
                          <div className="text-[11px] text-slate-400 font-mono mt-0.5">{item.subtitle}</div>
                        )}
                      </div>
                    </div>
                    {selectedIndex === idx && <span className="text-cyan-400 text-xs font-mono">↵ Jump</span>}
                  </button>
                ))
              ) : (
                <div className="p-8 text-center text-xs text-slate-500 font-mono">
                  No matching cases, analyses, or commands found for "{query}".
                </div>
              )}
            </div>

            {/* Footer keyhints */}
            <div className="flex items-center justify-between px-4 py-2 border-t border-white/5 bg-slate-900/40 text-[10px] font-mono text-slate-500">
              <div className="flex items-center gap-3">
                <span>↑↓ Navigate</span>
                <span>↵ Select</span>
                <span>ESC Close</span>
              </div>
              <span className="text-cyan-400">Clarity Mesh Command Palette</span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
