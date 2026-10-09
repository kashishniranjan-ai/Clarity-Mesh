const HIGHLIGHTS = [
  { title: 'Images & Videos', text: 'One place to check photos and video clips.' },
  { title: 'Multimodal', text: 'Looks at both what you see and what you hear.' },
  { title: 'Explainable', text: 'Results come with a confidence score and reasons.' },
];

export default function Hero() {
  return (
    <section className="relative overflow-hidden bg-slate-900">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.15) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.15) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8 lg:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/70 px-3 py-1 text-xs font-medium text-cyan-300">
            <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" aria-hidden="true" />
            AI-Powered Multimodal Deepfake Detection
          </p>
          <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Detect Deepfakes with <span className="text-cyan-400">AI</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-slate-300 sm:text-lg">
            Clarity Mesh helps you check whether an image or video is likely real or AI-generated.
            It is designed to combine visual and audio analysis and explain its findings in plain language.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <a
              href="#upload"
              className="w-full rounded-lg bg-cyan-400 px-6 py-3 text-sm font-semibold text-slate-900 transition-colors hover:bg-cyan-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900 sm:w-auto"
            >
              Upload Media
            </a>
            <a
              href="#how-it-works"
              className="w-full rounded-lg border border-slate-600 px-6 py-3 text-sm font-semibold text-slate-100 transition-colors hover:bg-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 sm:w-auto"
            >
              See How It Works
            </a>
          </div>
        </div>

        <ul className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-3">
          {HIGHLIGHTS.map((item) => (
            <li key={item.title} className="rounded-xl border border-slate-700 bg-slate-800/60 p-4 text-left">
              <p className="text-sm font-semibold text-white">{item.title}</p>
              <p className="mt-1 text-sm text-slate-400">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
