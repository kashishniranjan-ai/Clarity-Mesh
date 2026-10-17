import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { getInsights } from '../services/api';

const starters = ['Summarize my recent activity', 'How many analyses were flagged?', 'What should I investigate next?'];

function answerFor(question, data) {
  const q = question.toLowerCase();
  const total = data?.records_analyzed || 0;
  const flagged = data?.verdicts?.flagged || 0;
  const inconclusive = data?.verdicts?.inconclusive || 0;
  const scored = data?.scored_records || 0;
  const scoredPct = total ? Math.round(scored / total * 100) : 0;
  const flaggedPct = total ? Math.round(flagged / total * 100) : 0;
  const days = data?.daily_activity || [];
  const activeDays = days.filter((item) => item.count > 0).length;
  const strongestDay = [...days].sort((a, b) => b.count - a.count)[0];
  if (!total) return { title: 'No stored investigations yet', body: 'Run a media analysis first. Once records are saved locally, I can summarize volume, detector coverage, and recorded classifications.', evidence: 'Source: local analysis history · 0 records' };
  if (q.includes('flag') || q.includes('fake') || q.includes('deepfake') || q.includes('risk')) return { title: 'Recorded flagged outcomes', body: `${flagged} of ${total} recent records were classified as flagged (${flaggedPct}%). ${inconclusive} records were inconclusive. Treat this as a triage signal: model scores are uncalibrated, and a “real” result is not proof of authenticity.`, evidence: `Source: ${data.scope} · classifications from fused, AI image, or visual results` };
  if (q.includes('next') || q.includes('investigat') || q.includes('recommend') || q.includes('should')) return { title: 'Suggested review order', body: `${inconclusive} inconclusive records are the clearest candidates for a manual second look. Start with video records that have only one completed modality, then compare the original media and provenance outside this detector. ${scoredPct}% of the recent records have a usable fused or visual score.`, evidence: `Source: ${data.scope} · ${scored} records have comparable risk scores` };
  if (q.includes('score') || q.includes('average') || q.includes('mean')) return { title: 'Score coverage', body: scored ? `${scored} of ${total} records (${scoredPct}%) have a completed fused score or, when fusion is unavailable, a visual fake-oriented score. Their mean is ${Math.round(data.mean_fake_score * 100)}%. This is an uncalibrated model output, not a probability of deception.` : `There are ${total} records, but none has a completed fused or visual risk score. Check detector availability and media compatibility before drawing conclusions.`, evidence: 'Source: completed multimodal fusion, falling back to visual detector scores only' };
  return { title: 'Investigation summary', body: `${total} records in the recent history window. ${flagged} were flagged, ${inconclusive} were inconclusive, and ${scoredPct}% have a completed fused or visual risk score. Activity appeared on ${activeDays} of the last 7 days${strongestDay?.count ? `, with the busiest day showing ${strongestDay.count} analyses` : ''}.`, evidence: `Scope: ${data.scope} · ${data.methodology}` };
}

export default function Analyst() {
  const [data, setData] = useState(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [error, setError] = useState('');
  const endRef = useRef(null);
  useEffect(() => { getInsights().then(setData).catch((err) => setError(err.message)); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);
  const submit = (question = input) => {
    const clean = question.trim();
    if (!clean || !data) return;
    setMessages((prev) => [...prev, { role: 'user', text: clean }, { role: 'assistant', ...answerFor(clean, data) }]);
    setInput('');
  };

  return <main className="mx-auto min-h-[75vh] max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><Link to="/dashboard" className="mb-3 inline-flex text-xs text-cyan-300 hover:text-cyan-200">← Back to workspace</Link><h1 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl">Mesh Analyst</h1><p className="mt-2 text-sm text-slate-400">Ask about your local investigation history.</p></div><div className="rounded-full border border-emerald-400/15 bg-emerald-400/[.06] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">● Grounded · local data</div></div>
    <section className="grid min-h-[580px] overflow-hidden rounded-3xl border border-white/[.07] bg-[#05060A]/90 backdrop-blur-xl shadow-2xl shadow-black/20 lg:grid-cols-[1fr_280px]">
      <div className="flex min-h-[580px] flex-col">
        <div className="flex items-center gap-3 border-b border-white/[.06] px-5 py-4"><div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-300/[.08] text-lg text-cyan-200">✳</div><div><p className="text-sm font-semibold text-white">Clarity research assistant</p><p className="mt-0.5 text-[10px] text-slate-500">Answers cite local aggregates · no external upload</p></div><span className="ml-auto h-2 w-2 animate-pulse rounded-full bg-emerald-400"/></div>
        <div className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7">
          {!messages.length && <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mx-auto mt-12 max-w-xl text-center"><div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-cyan-300/15 bg-gradient-to-br from-cyan-300/10 to-emerald-400/10 text-2xl text-cyan-200">✳</div><h2 className="text-xl font-semibold text-white">Your evidence, in plain language.</h2><p className="mt-2 text-sm leading-6 text-slate-400">Ask for a history summary, score coverage, flagged outcomes, or a review suggestion. Responses are computed from stored records and include their scope.</p><div className="mt-7 flex flex-wrap justify-center gap-2">{starters.map((text) => <button key={text} onClick={() => submit(text)} disabled={!data} className="rounded-full border border-white/10 bg-white/[.025] px-3 py-2 text-xs text-slate-300 transition hover:border-cyan-300/25 hover:text-cyan-200 disabled:opacity-50">{text}</button>)}</div></motion.div>}
          {messages.map((message, index) => <motion.div key={index} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[88%] rounded-2xl px-4 py-3 ${message.role === 'user' ? 'rounded-br-md border border-cyan-300/15 bg-cyan-300/[.09]' : 'rounded-bl-md border border-white/[.07] bg-white/[.025]'}`}><p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-300">{message.role === 'user' ? 'You' : message.title}</p><p className="mt-2 whitespace-pre-line text-sm leading-6 text-slate-200">{message.text || message.body}</p>{message.evidence && <p className="mt-3 border-t border-white/[.06] pt-2 text-[10px] leading-5 text-slate-500">{message.evidence}</p>}</div></motion.div>)}
          {error && <p role="alert" className="rounded-xl border border-amber-500/20 bg-amber-500/[.06] p-3 text-xs text-amber-200">{error} Start the backend to connect the analyst.</p>}
          <div ref={endRef}/>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); submit(); }} className="border-t border-white/[.06] p-4 sm:p-5"><div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-2 transition focus-within:border-cyan-300/30"><input aria-label="Ask about your history" value={input} onChange={(event) => setInput(event.target.value)} placeholder={data ? 'Ask about your history…' : 'Connecting to local records…'} className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-slate-600"/><button type="submit" disabled={!data || !input.trim()} className="rounded-xl bg-cyan-400 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">Ask ↗</button></div><p className="mt-2 px-2 text-[10px] text-slate-600">This analyst summarizes stored metrics; it does not run external generative AI or make forensic determinations.</p></form>
      </div>
      <aside className="border-t border-white/[.06] bg-white/[.015] p-5 lg:border-l lg:border-t-0"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-slate-500">Context window</p><p className="mt-1 text-xs text-slate-600">Latest stored records</p><div className="mt-5 space-y-3">{[['Records', data?.records_analyzed], ['Flagged', data?.verdicts?.flagged], ['Inconclusive', data?.verdicts?.inconclusive], ['Scored', data?.scored_records]].map(([label, value]) => <div key={label} className="flex items-center justify-between rounded-xl border border-white/[.05] bg-black/10 px-3 py-2.5"><span className="text-xs text-slate-400">{label}</span><span className="font-mono text-sm text-white">{value ?? '—'}</span></div>)}</div><div className="mt-6 rounded-xl border border-amber-300/10 bg-amber-300/[.04] p-3"><p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">Score caveat</p><p className="mt-2 text-[11px] leading-5 text-slate-500">Detector outputs are uncalibrated. A low score is not proof that media is authentic.</p></div><Link to="/history" className="mt-5 inline-flex text-xs text-cyan-300 hover:text-cyan-200">Review individual records →</Link></aside>
    </section>
  </main>;
}
