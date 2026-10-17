import { motion } from 'framer-motion';

export default function Logo({ className = '' }) {
  return (
    <motion.span 
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
      className={`inline-flex items-center gap-3 cursor-pointer ${className}`}
    >
      <span
        className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-400 via-teal-300 to-blue-500 p-[1.5px] shadow-lg shadow-cyan-500/30"
        aria-hidden="true"
      >
        <span className="flex h-full w-full items-center justify-center rounded-[10px] bg-[#05070B] backdrop-blur-sm">
          <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <defs>
              <linearGradient id="logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#00F2FE" />
                <stop offset="50%" stopColor="#38BDF8" />
                <stop offset="100%" stopColor="#10B981" />
              </linearGradient>
            </defs>
            {/* Elegant obsidian prism geometry */}
            <polygon points="12 2 20 8 16 20 8 20 4 8" stroke="url(#logo-grad)" fill="rgba(6, 182, 212, 0.15)" />
            <circle cx="12" cy="12" r="2.5" fill="url(#logo-grad)" />
          </svg>
        </span>
      </span>

      <span className="flex flex-col text-left">
        <span className="text-base font-black tracking-tight text-white flex items-center gap-1">
          Clarity<span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">Mesh</span>
        </span>
        <span className="text-[10px] font-bold tracking-widest uppercase text-slate-400">Media Intelligence</span>
      </span>
    </motion.span>
  );
}
