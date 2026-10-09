const STEPS = [
  {
    title: 'Upload Media',
    description: 'Choose an image or a video. Supported formats include JPG, PNG, MP4, MOV, AVI, MKV and WEBM.',
  },
  {
    title: 'Visual Analysis',
    description: 'Faces and frames are examined for visual artifacts such as blending edges and unnatural textures.',
  },
  {
    title: 'Audio Analysis',
    description: 'For videos, the audio track is checked for signs of synthetic or cloned speech.',
  },
  {
    title: 'AI Detection',
    description: 'Visual and audio signals are combined by a multimodal model to judge the media as a whole.',
  },
  {
    title: 'Confidence Score',
    description: 'The system reports how likely the media is real or AI-generated, as a percentage.',
  },
  {
    title: 'Explainable Result',
    description: 'You see the reasons behind the verdict, not just a label, so the result is easier to trust.',
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" className="border-y border-slate-200 bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">How It Works</h2>
          <p className="mt-3 text-slate-600">
            Clarity Mesh follows a clear, step-by-step pipeline from your upload to an explained result.
          </p>
        </div>

        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="relative">
              <div className="h-full rounded-xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-cyan-300">
                    {index + 1}
                  </span>
                  <h3 className="font-semibold text-slate-900">{step.title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-slate-600">{step.description}</p>
              </div>

              {/* Downward arrow between steps on single-column (mobile) layout */}
              {index < STEPS.length - 1 && (
                <span
                  className="mx-auto mt-4 flex h-4 w-4 items-center justify-center text-slate-400 sm:hidden"
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M6 13l6 6 6-6" />
                  </svg>
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
