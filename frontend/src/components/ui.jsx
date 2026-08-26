import { useState } from 'react'

// TEMPORARY presentation toggle — set back to true after the demo. When
// false, ValidationBanner renders nothing and DegenerateWarpGuard shows
// content directly with no warning, so panels display images only. Real
// validation data/logic is untouched; this only hides the UI presentation
// of it. See conversation: explicitly requested for a same-day presentation,
// with the tradeoff (a broken/degenerate result then displays with no
// indication it's unvalidated) flagged and acknowledged before this was set.
export const SHOW_VALIDATION_UI = false

// Display-only contrast/brightness boost for lunar imagery, which is
// genuinely low-contrast at native stretch (see TASKS.md's stretch-range
// bug writeup). Purely a CSS filter on the rendered pixels -- does not
// touch the underlying image data, so matching/SSIM/validation are
// computed on the real unmodified images exactly as before; this only
// affects what a viewer's eye sees.
export const IMAGE_ENHANCE_FILTER = 'contrast(1.3) brightness(1.15) saturate(1.05)'

export function Panel({ title, right, children, className = '' }) {
  return (
    <div className={`bg-[var(--color-panel)] border border-[var(--color-border)] rounded-lg ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-soft)]">
          <h3 className="text-sm font-medium tracking-wide text-[var(--color-text-dim)] uppercase">{title}</h3>
          {right}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  )
}

export function MetricCard({ label, value, unit = '', accent = false }) {
  return (
    <div className="bg-[var(--color-panel-raised)] border border-[var(--color-border)] rounded-lg px-4 py-3 flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
      <span className={`mono text-2xl font-semibold ${accent ? 'text-[var(--color-cyan)]' : 'text-[var(--color-text)]'}`}>
        {value}
        {unit && <span className="text-sm text-[var(--color-text-dim)] ml-1">{unit}</span>}
      </span>
    </div>
  )
}

export function ConfidenceBadge({ status }) {
  const map = {
    verified: { label: 'Verified', cls: 'bg-[var(--color-green)]/15 text-[var(--color-green)] border-[var(--color-green)]/40' },
    unverified: { label: 'Unverified', cls: 'bg-[var(--color-amber)]/15 text-[var(--color-amber)] border-[var(--color-amber)]/40' },
    failed: { label: 'Failed', cls: 'bg-[var(--color-red)]/15 text-[var(--color-red)] border-[var(--color-red)]/40' },
  }
  const s = map[status] || map.unverified
  return (
    <span className={`mono text-xs px-2 py-1 rounded border ${s.cls}`}>{s.label}</span>
  )
}

export function Button({ children, onClick, disabled, variant = 'primary', className = '', type = 'button' }) {
  const base = 'px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed'
  const variants = {
    primary: 'bg-[var(--color-cyan)] text-[#04171B] hover:brightness-110',
    ghost: 'bg-transparent border border-[var(--color-border)] text-[var(--color-text-dim)] hover:text-[var(--color-text)] hover:border-[var(--color-text-faint)]',
    amber: 'bg-[var(--color-amber)] text-[#241705] hover:brightness-110',
  }
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${base} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function Spinner({ label = 'Processing…' }) {
  return (
    <div className="flex items-center gap-3 text-[var(--color-text-dim)] text-sm">
      <span className="w-4 h-4 border-2 border-[var(--color-cyan)] border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  )
}

export function ValidationBanner({ result }) {
  if (!SHOW_VALIDATION_UI) return null
  const v = result?.validation
  if (!v) {
    return (
      <div className="mb-3 px-3 py-2 rounded-md border text-xs font-semibold uppercase tracking-wide
                       bg-[var(--color-red)]/15 border-[var(--color-red)]/40 text-[var(--color-red)]">
        UNVALIDATED / EXPLORATORY — NOT A CONFIRMED MATCH
        <span className="block mt-0.5 font-normal normal-case text-[var(--color-text-dim)]">
          No validation metadata on this result — treat any visualization below as exploratory only.
        </span>
      </div>
    )
  }
  const ok = v.validated
  return (
    <div className={`mb-3 px-3 py-2 rounded-md border text-xs font-semibold uppercase tracking-wide ${
      ok ? 'bg-[var(--color-green)]/15 border-[var(--color-green)]/40 text-[var(--color-green)]'
         : 'bg-[var(--color-red)]/15 border-[var(--color-red)]/40 text-[var(--color-red)]'}`}>
      {v.label}
      <ul className="mt-1 font-normal normal-case text-[var(--color-text-dim)] list-disc list-inside space-y-0.5">
        {v.reasons.map((r, i) => <li key={i}>{r}</li>)}
      </ul>
    </div>
  )
}

export function DegenerateWarpGuard({ result, children }) {
  const hq = result?.homography_quality
  const [revealed, setRevealed] = useState(false)
  if (!SHOW_VALIDATION_UI || !hq?.degenerate) return children

  const rc = result?.rotation_consistency
  return (
    <div className="flex flex-col gap-3">
      <div className="px-4 py-4 rounded-md border bg-[var(--color-red)]/15 border-[var(--color-red)]/40">
        <div className="flex items-start justify-between gap-4">
          <p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-red)]">
            DEGENERATE HOMOGRAPHY — matching failed, transform is not geometrically valid
          </p>
          <button onClick={() => setRevealed((r) => !r)}
            className="shrink-0 mono text-xs px-2 py-1 rounded border border-[var(--color-red)]/50 text-[var(--color-red)] hover:bg-[var(--color-red)]/10 whitespace-nowrap">
            {revealed ? 'Hide' : 'Show anyway'}
          </button>
        </div>
        <p className="mt-1 text-xs text-[var(--color-text-dim)]">
          The estimated transform is near-singular — warping the source image through it produces a
          split, radiating-streak pattern (parts of the image thrown toward the projective line at
          infinity), not a real alignment. Rendering it here would be indistinguishable from a
          rendering bug, so this panel is suppressed by default. This is a data-driven verdict, not
          a vague error:
        </p>
        <ul className="mt-2 text-xs mono text-[var(--color-text-dim)] list-disc list-inside space-y-0.5">
          <li>homography condition ratio (largest/smallest singular value): <span className="text-[var(--color-red)]">{hq.condition_ratio}:1</span> (threshold: {hq.threshold}:1)</li>
          <li>inlier count: {result.inlier_count} / {result.total_matches} total matches</li>
          {rc && <li>pairwise rotation-consistency std: {Number.isFinite(rc.std_deg) ? `${rc.std_deg.toFixed(1)}°` : 'n/a'} (n={rc.n_pairs})</li>}
        </ul>
      </div>
      {/* Always mounted (not conditionally rendered) so the panel's own
          viewers/canvases initialize normally and stay alive -- only
          visibility toggles here. Conditionally mounting/unmounting would
          mean the panel's OpenSeadragon-creation effect never gets a chance
          to re-run against a freshly-appeared DOM node. */}
      <div style={{ display: revealed ? 'block' : 'none' }}>
        <div className="border border-dashed border-[var(--color-red)]/40 rounded-md p-3">
          <p className="mb-2 text-xs text-[var(--color-red)]">
            Shown on request — this is the degenerate/garbage warp described above, not a real alignment.
          </p>
          {children}
        </div>
      </div>
    </div>
  )
}

export function ErrorNote({ message }) {
  if (!message) return null
  return (
    <div className="text-sm text-[var(--color-red)] bg-[var(--color-red)]/10 border border-[var(--color-red)]/30 rounded-md px-3 py-2">
      {message}
    </div>
  )
}
