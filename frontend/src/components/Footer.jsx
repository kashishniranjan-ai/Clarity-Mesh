import Logo from './Logo';

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <div className="space-y-2">
          <Logo />
          <p className="text-sm text-slate-500">AI-Powered Multimodal Deepfake Detection</p>
        </div>
        <div className="space-y-1 text-sm text-slate-500 md:text-right">
          <p>Final-year college project &middot; &copy; {year} Clarity Mesh</p>
          <p className="text-xs text-slate-400">
            Detection results will be probabilistic estimates, not proof of authenticity.
          </p>
        </div>
      </div>
    </footer>
  );
}
