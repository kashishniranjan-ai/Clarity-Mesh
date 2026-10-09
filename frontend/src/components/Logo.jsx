export default function Logo({ className = '' }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <span
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 ring-1 ring-slate-700"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 text-cyan-400" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3l7 2.6v5.4c0 4.2-2.9 7.600-7 8.600-4.100-1-7-4.400-7-8.600V5.600L12 3z" />
          <path d="M9 12l2.200 2.200L15.500 10" />
        </svg>
      </span>
      <span className="text-lg font-semibold tracking-tight text-slate-900">
        Clarity<span className="text-cyan-600">Mesh</span>
      </span>
    </span>
  );
}
