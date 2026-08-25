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

export function ErrorNote({ message }) {
  if (!message) return null
  return (
    <div className="text-sm text-[var(--color-red)] bg-[var(--color-red)]/10 border border-[var(--color-red)]/30 rounded-md px-3 py-2">
      {message}
    </div>
  )
}
