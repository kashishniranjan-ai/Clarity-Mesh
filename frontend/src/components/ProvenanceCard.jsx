/**
 * Clarity Mesh — Provenance & Integrity Card.
 *
 * Renders the chain-of-custody anchors produced by the backend
 * (`provenance` block: SHA-256, EXIF, container, C2PA markers) together
 * with the raw byte-signature scan (`forensic_signals.metadata`).
 * Every section renders its honest status — absent EXIF or an
 * unvalidated C2PA marker are shown as such, never dressed up.
 */

function Row({ label, value, mono = false }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-start gap-3 py-1">
      <span className="w-36 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </span>
      <span
        className={`min-w-0 flex-1 break-all text-xs text-slate-200 ${
          mono ? 'font-mono text-[10px] leading-relaxed text-cyan-200' : ''
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function SectionStatus({ status }) {
  const map = {
    extracted: { text: 'EXTRACTED', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
    completed: { text: 'COMPLETED', cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' },
    absent: { text: 'ABSENT', cls: 'border-slate-500/30 bg-slate-500/10 text-slate-300' },
    not_applicable: { text: 'N/A', cls: 'border-white/10 bg-white/5 text-slate-400' },
    present_unreadable: { text: 'UNREADABLE', cls: 'border-amber-500/30 bg-amber-500/10 text-amber-300' },
    failed: { text: 'FAILED', cls: 'border-rose-500/30 bg-rose-500/10 text-rose-300' },
  };
  const entry = map[status] || { text: String(status || '—').toUpperCase(), cls: 'border-white/10 bg-white/5 text-slate-300' };
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${entry.cls}`}>
      {entry.text}
    </span>
  );
}

export default function ProvenanceCard({ provenance, metadata }) {
  if (!provenance && !metadata) return null;

  const p = provenance || {};
  const exif = p.exif || {};
  const container = p.container || {};
  const pngText = p.png_text || {};
  const c2pa = p.c2pa || {};
  const signatures = metadata?.detected_signatures || [];

  return (
    <div className="glass-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-white uppercase tracking-wider">
          🪪 Provenance & Integrity
        </h4>
        {p.status && <SectionStatus status={p.status} />}
      </div>

      {/* Integrity */}
      <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-cyan-300 uppercase tracking-wider">
            Integrity (chain of custody)
          </span>
          {p.hash_algorithm && (
            <span className="font-mono text-[10px] text-slate-400">{p.hash_algorithm}</span>
          )}
        </div>
        {p.status === 'completed' ? (
          <>
            <Row label="SHA-256" value={p.sha256} mono />
            <Row
              label="Size"
              value={p.size_bytes !== undefined ? `${p.size_bytes.toLocaleString()} bytes` : null}
            />
            <Row label="Media kind" value={p.media_kind} />
          </>
        ) : (
          <p className="py-2 text-xs text-amber-200">
            {p.error || 'Integrity hash could not be computed for this record.'}
          </p>
        )}
      </div>

      {/* EXIF */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Camera EXIF
          </span>
          <SectionStatus status={exif.status} />
        </div>
        {exif.status === 'extracted' ? (
          <>
            <Row label="Make" value={exif.tags?.make} />
            <Row label="Model" value={exif.tags?.model} />
            <Row label="Software" value={exif.tags?.software} />
            <Row label="Date/Time" value={exif.tags?.datetime} />
            <Row label="Artist" value={exif.tags?.artist} />
          </>
        ) : (
          <p className="py-1 text-[11px] text-slate-400">
            {exif.reason || 'No readable EXIF tags for this format.'}
          </p>
        )}
        <Row label="XMP CreatorTool" value={p.xmp_creator_tool} />
        {pngText.status === 'extracted' && (
          <>
            <div className="pt-1 text-[11px] font-bold text-slate-300 uppercase">PNG text chunks</div>
            {Object.entries(pngText.tags || {}).map(([key, value]) => (
              <Row key={key} label={key} value={value} />
            ))}
          </>
        )}
      </div>

      {/* Container */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Container
          </span>
          <SectionStatus status={container.status} />
        </div>
        <Row label="Major brand" value={container.major_brand} mono />
        <Row
          label="Compatible"
          value={
            Array.isArray(container.compatible_brands) && container.compatible_brands.length
              ? container.compatible_brands.join(', ')
              : null
          }
          mono
        />
        <Row label="Created (UTC)" value={container.creation_time_utc} mono />
        {container.status !== 'extracted' && (
          <p className="py-1 text-[11px] text-slate-400">
            {container.reason || 'No container facts for this format.'}
          </p>
        )}
      </div>

      {/* C2PA */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            C2PA / Content Credentials
          </span>
          <div className="flex items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                c2pa.marker_found
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-500/30 bg-slate-500/10 text-slate-300'
              }`}
            >
              {c2pa.marker_found ? 'Marker found' : 'No marker'}
            </span>
            {p.c2pa_verification?.status && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ${
                  p.c2pa_verification.status === 'verified'
                    ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-300'
                    : p.c2pa_verification.status === 'invalid'
                    ? 'border-rose-500/40 bg-rose-500/20 text-rose-300'
                    : 'border-white/10 bg-white/5 text-slate-400'
                }`}
              >
                {p.c2pa_verification.status}
              </span>
            )}
          </div>
        </div>

        {p.c2pa_verification && p.c2pa_verification.status !== 'unavailable' && (
          <div className="space-y-1 pt-1 border-t border-white/[0.06]">
            <Row label="Signer / Issuer" value={p.c2pa_verification.signer} />
            <Row label="Claim generator" value={p.c2pa_verification.claim_generator} />
            {p.c2pa_verification.validation_errors?.length > 0 && (
              <div className="py-1">
                <span className="text-[10px] uppercase font-bold text-rose-400 block">Validation Errors:</span>
                <ul className="text-[11px] text-rose-300 list-disc list-inside">
                  {p.c2pa_verification.validation_errors.map((e, idx) => (
                    <li key={idx}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <p className="py-1 text-[11px] leading-relaxed text-slate-400">
          {p.c2pa_verification?.disclaimer ||
            c2pa.note ||
            'Byte-marker presence only — this is not a signature or manifest validation.'}
        </p>
      </div>

      {/* Byte-signature scan (from forensic_signals.metadata) */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-white uppercase tracking-wider">
            Generator & Hardware Signatures
          </span>
          <SectionStatus status={metadata?.status || 'not_applicable'} />
        </div>
        {signatures.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {signatures.map((sig) => (
              <span
                key={sig}
                className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-semibold text-rose-200"
              >
                {sig}
              </span>
            ))}
          </div>
        ) : (
          <p className="py-1 text-[11px] text-slate-400">
            No known AI-generator tokens observed in the header/trailer scan.
          </p>
        )}
        <Row
          label="Camera hardware"
          value={
            metadata?.camera_hardware
              ? metadata.camera_model || 'Observed (maker string found)'
              : null
          }
        />
        {metadata?.has_ai_metadata && (
          <p className="pt-1 text-[11px] font-semibold text-amber-300">
            ⚠️ AI generator metadata tokens were observed in this file.
          </p>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-slate-500">
        Provenance facts are extracted from the stored bytes at analysis time.
        Absent metadata is neither proof of manipulation nor of authenticity.
      </p>
    </div>
  );
}
