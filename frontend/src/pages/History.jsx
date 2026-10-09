import { Link } from 'react-router-dom';

export default function History() {
  return (
    <section className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Analysis History</h1>
        <p className="mt-2 text-slate-600">Your past media analyses will appear here.</p>
      </div>

      {/* Empty state: no analyses exist yet, and none are fabricated. */}
      <div className="mt-8 flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        </span>
        <h2 className="mt-5 text-lg font-semibold text-slate-900">No analyses yet.</h2>
        <p className="mt-2 max-w-md text-sm text-slate-600">
          Once you analyze an image or video, a record of it will be listed on this page.
        </p>
        <Link
          to="/#upload"
          className="mt-6 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-2"
        >
          Upload Media
        </Link>
      </div>
    </section>
  );
}
