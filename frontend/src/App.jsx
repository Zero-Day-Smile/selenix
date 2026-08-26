import { useState } from 'react'
import UploadConfigure from './components/UploadConfigure'
import ResultsView from './components/ResultsView'
import MatchPointsPanel from './components/MatchPointsPanel'
import MetricsDashboard from './components/MetricsDashboard'
import HardCasePanel from './components/HardCasePanel'
import MultiSensorPanel from './components/MultiSensorPanel'
import HistoryPanel from './components/HistoryPanel'
import ManualSeedPanel from './components/ManualSeedPanel'

const TABS = [
  { id: 'upload', label: 'Upload & Configure' },
  { id: 'manual', label: 'Manual Seed-Point Mode' },
  { id: 'results', label: 'Results / Alignment' },
  { id: 'matches', label: 'Match Points' },
  { id: 'metrics', label: 'Metrics Dashboard' },
  { id: 'hardcase', label: 'Hard-Case / Robustness' },
  { id: 'multisensor', label: 'Multi-Sensor Proof' },
  { id: 'history', label: 'Registration History' },
]

export default function App() {
  const [tab, setTab] = useState('upload')
  const [result, setResult] = useState(null)

  function handleResult(r) {
    setResult(r)
    if (r.status === 'ok') setTab('results')
  }

  return (
    <div className="flex h-screen">
      <aside className="w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-panel)] flex flex-col">
        <div className="px-5 py-5 border-b border-[var(--color-border-soft)]">
          <h1 className="text-sm font-semibold tracking-wide">LUNAR CORRESPONDENCE</h1>
          <p className="mono text-[11px] text-[var(--color-text-faint)] mt-1">Chandrayaan-2 · OHRC/TMC/IIRS ↔ NAC</p>
        </div>
        <nav className="flex-1 py-3">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`w-full text-left px-5 py-2.5 text-sm border-l-2 transition-colors ${tab === t.id
                ? 'border-[var(--color-cyan)] text-[var(--color-cyan)] bg-[var(--color-cyan)]/5'
                : 'border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text)]'}`}>
              {t.label}
            </button>
          ))}
        </nav>
        {result && (
          <div className="px-5 py-4 border-t border-[var(--color-border-soft)] text-xs text-[var(--color-text-faint)]">
            Last run: <span className="mono text-[var(--color-text-dim)]">{result.run_dir_id?.slice(0, 12) || '—'}</span>
          </div>
        )}
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        {tab === 'upload' && <UploadConfigure onResult={handleResult} />}
        {tab === 'manual' && <ManualSeedPanel onResult={handleResult} />}
        {tab === 'results' && <ResultsView result={result} />}
        {tab === 'matches' && <MatchPointsPanel result={result} />}
        {tab === 'metrics' && <MetricsDashboard result={result} />}
        {tab === 'hardcase' && <HardCasePanel onResult={handleResult} />}
        {tab === 'multisensor' && <MultiSensorPanel />}
        {tab === 'history' && <HistoryPanel onSelect={handleResult} />}
      </main>
    </div>
  )
}
