import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { askAssistant, getAssistantStatus, getInsights } from '../services/api';

const starters = [
  'Summarize recent media investigation outcomes.',
  'Identify records with inconclusive scores.',
  'What are the calibrated limits of these detectors?',
  'Which high-risk media files require manual review?',
];

const toolLabels = {
  get_analytics_summary: 'Telemetry Aggregation',
  search_analyses: 'Record Search',
  get_analysis_details: 'Forensic Audit Inspection',
};

function timeLabel(value) {
  try {
    return new Date(value).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function Assistant() {
  const [messages, setMessages] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('clarity-assistant-history') || '[]');
    } catch {
      return [];
    }
  });
  const [status, setStatus] = useState(null);
  const [insights, setInsights] = useState(null);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const endRef = useRef(null);

  useEffect(() => {
    getAssistantStatus().then(setStatus).catch((err) => setError(err.message));
    getInsights().then(setInsights).catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem('clarity-assistant-history', JSON.stringify(messages.slice(-30)));
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const send = async (value = question) => {
    const prompt = value.trim();
    if (!prompt || loading) return;
    const context = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setMessages((old) => [...old, { role: 'user', content: prompt, created_at: new Date().toISOString() }]);
    setQuestion('');
    setLoading(true);
    setError('');

    try {
      const result = await askAssistant(prompt, context);
      setMessages((old) => [
        ...old,
        {
          role: 'assistant',
          content: result.answer,
          provider: result.provider,
          model: result.model,
          tools_used: result.tools_used || [],
          created_at: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      setError(err.message || 'Assistant request failed.');
    } finally {
      setLoading(false);
    }
  };

  const clear = () => {
    setMessages([]);
    localStorage.removeItem('clarity-assistant-history');
  };

  const isOpenAI = status?.provider === 'openai';
  const statRows = [
    ['Ingested Evidence', insights?.records_analyzed],
    ['Flagged Synthetics', insights?.verdicts?.flagged],
    ['Inconclusive Samples', insights?.verdicts?.inconclusive],
    ['Multimodal Scores', insights?.scored_records],
  ];

  return (
    <main className="mx-auto min-h-[80vh] max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs">
            <Link to="/dashboard" className="text-slate-400 hover:text-white transition-colors">
              Workspace
            </Link>
            <span className="text-slate-600">/</span>
            <span className="text-cyan-400 font-medium">AI Copilot</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Investigation Research Copilot
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-400 leading-relaxed">
            Query saved media analyses, probe cross-modal discrepancies, and retrieve evidence summaries.
          </p>
        </div>

        <motion.button
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          onClick={clear}
          disabled={!messages.length || loading}
          className="rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2 text-xs font-semibold text-slate-300 hover:bg-white/[0.08] hover:text-white transition-all disabled:opacity-40"
        >
          Clear Thread
        </motion.button>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        {/* Chat Studio */}
        <section className="flex min-h-[660px] flex-col overflow-hidden rounded-3xl border border-white/10 bg-[#06080E]/90 backdrop-blur-2xl shadow-2xl">
          {/* Top Bar */}
          <header className="flex items-center gap-3.5 border-b border-white/[0.08] bg-black/40 px-6 py-4">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-tr from-cyan-500 to-emerald-400 text-black shadow-md shadow-cyan-500/25">
              <span className="text-base font-bold">✦</span>
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-[#06080E] bg-emerald-400" />
            </div>

            <div>
              <p className="text-sm font-bold text-white tracking-tight">Clarity Research Copilot</p>
              <p className="text-[11px] text-slate-400">
                {isOpenAI ? `${status.model} · Tool-using Agent` : 'Local Deterministic Forensic Analyst'}
              </p>
            </div>

            <div className="ml-auto">
              <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold tracking-wider uppercase ${
                isOpenAI
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
              }`}>
                {isOpenAI ? 'OpenAI Agent' : 'Offline Forensic Mode'}
              </span>
            </div>
          </header>

          {/* Conversation Area */}
          <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
            {!messages.length && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="mx-auto mt-12 max-w-xl text-center"
              >
                <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 border border-cyan-500/30 text-2xl text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.2)]">
                  ✦
                </div>
                <h2 className="text-xl font-bold text-white tracking-tight">
                  How can I assist your investigation?
                </h2>
                <p className="mx-auto mt-2 text-xs sm:text-sm text-slate-400 leading-relaxed max-w-md">
                  Query local evidence records, cross-check model thresholds, or request executive synthesis. Media files never leave your environment.
                </p>

                <div className="mt-8 grid gap-2 sm:grid-cols-2">
                  {starters.map((text) => (
                    <motion.button
                      key={text}
                      whileHover={{ scale: 1.02, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={() => send(text)}
                      className="rounded-2xl border border-white/10 bg-white/[0.02] p-3.5 text-left text-xs font-medium text-slate-300 hover:border-cyan-500/40 hover:bg-cyan-500/[0.08] hover:text-white transition-all shadow-sm"
                    >
                      <span className="text-cyan-400 font-bold mr-1.5">↗</span>
                      {text}
                    </motion.button>
                  ))}
                </div>
              </motion.div>
            )}

            {messages.map((message, index) => (
              <motion.div
                key={`${message.created_at}-${index}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <article
                  className={`max-w-[90%] sm:max-w-[80%] rounded-3xl px-5 py-4 ${
                    message.role === 'user'
                      ? 'rounded-br-md border border-cyan-500/40 bg-gradient-to-r from-cyan-950/80 to-[#081827] text-white shadow-[0_4px_25px_rgba(6,182,212,0.18)]'
                      : 'rounded-bl-md border border-white/10 bg-black/60 backdrop-blur-md text-slate-200 shadow-lg'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${
                      message.role === 'user' ? 'text-cyan-300' : 'text-emerald-400'
                    }`}>
                      {message.role === 'user' ? 'You' : 'Clarity Analyst'}
                    </span>
                    {message.created_at && (
                      <span className="text-[10px] text-slate-400">
                        {timeLabel(message.created_at)}
                      </span>
                    )}
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {message.content}
                  </p>

                  {message.tools_used?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.08] pt-2.5">
                      {message.tools_used.map((tool) => (
                        <span
                          key={tool}
                          className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-300"
                        >
                          ⚡ {toolLabels[tool] || tool}
                        </span>
                      ))}
                    </div>
                  )}
                </article>
              </motion.div>
            ))}

            {loading && (
              <div className="flex items-center gap-3">
                <div className="rounded-3xl rounded-bl-md border border-white/10 bg-black/60 px-5 py-4 shadow-lg">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" />
                    <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:150ms]" />
                    <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce [animation-delay:300ms]" />
                    <span className="ml-2 text-xs font-medium text-slate-400">
                      Querying local telemetry…
                    </span>
                  </div>
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {error && (
            <div role="alert" className="mx-6 mb-2 rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          {/* Input Box */}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send();
            }}
            className="border-t border-white/[0.08] bg-black/40 p-4 sm:p-5"
          >
            <div className="flex items-end gap-2.5 rounded-2xl border border-white/10 bg-black/60 p-2 focus-within:border-cyan-400 focus-within:shadow-[0_0_20px_rgba(6,182,212,0.2)] transition-all">
              <textarea
                aria-label="Ask the Clarity analyst"
                rows={1}
                maxLength={1600}
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask about risk signals, records, or activity…"
                className="max-h-32 min-h-10 flex-1 resize-y bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500"
              />
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                type="submit"
                disabled={!question.trim() || loading}
                className="btn-shimmer rounded-xl bg-gradient-to-r from-cyan-500 via-sky-500 to-emerald-400 px-5 py-2.5 text-xs font-bold text-black shadow-md shadow-cyan-500/25 hover:shadow-cyan-500/40 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
              >
                Send ↗
              </motion.button>
            </div>
          </form>
        </section>

        {/* Sidebar Info */}
        <aside className="space-y-4">
          <section className="glass-card p-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Scope & Coverage
              </p>
              <Link to="/dashboard" className="text-xs font-semibold text-cyan-400 hover:text-white transition-colors">
                Dashboard ↗
              </Link>
            </div>
            <div className="space-y-2">
              {statRows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-xl border border-white/[0.04] bg-white/[0.02] px-3.5 py-2.5 text-xs"
                >
                  <span className="text-slate-400">{label}</span>
                  <span className="font-mono font-bold text-white">{value ?? '—'}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="glass-card p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-4">
              Tool Capabilities
            </p>
            <div className="space-y-3.5">
              {[
                ['📊', 'Telemetry Retrieval', 'Aggregate 7-day volume and outcome statistics'],
                ['🔍', 'Targeted Record Lookup', 'Filter analyses by score, media type, and status'],
                ['🔬', 'Modality Inspection', 'Examine facial, vocal, or diffusion artifacts'],
              ].map(([icon, title, detail]) => (
                <div key={title} className="flex gap-3 text-left">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-300">
                    {icon}
                  </span>
                  <div>
                    <p className="text-xs font-bold text-white">{title}</p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5 text-xs text-slate-400 leading-relaxed">
            <p className="font-semibold text-slate-300 mb-1">Forensic Guidance</p>
            AI responses cite records from your local database. Scores indicate model features, not guaranteed legal authenticity.
          </section>
        </aside>
      </div>
    </main>
  );
}
