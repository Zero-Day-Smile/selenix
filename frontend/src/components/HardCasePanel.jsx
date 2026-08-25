import { useEffect, useState } from 'react'
import { Panel, Button, Spinner, MetricCard } from './ui'
import { getHardcases, runHardcase } from '../api'

export default function HardCasePanel({ onResult }) {
  const [cases, setCases] = useState([])
  const [runningId, setRunningId] = useState(null)
  const [results, setResults] = useState({})

  useEffect(() => { getHardcases().then(setCases).catch(() => setCases([])) }, [])

  async function handleRun(c) {
    setRunningId(c.id)
    try {
      const result = await runHardcase(c.id)
      setResults((r) => ({ ...r, [c.id]: result }))
      onResult(result)
    } finally {
      setRunningId(null)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-[var(--color-text-dim)]">
        Pre-curated difficult pairs (large sun-angle delta, extreme scale ratio, large rotation + noise) —
        run one-click and see the honest, possibly degraded metrics. A result is flagged if it falls
        outside this sensor's running RMSE baseline (real computation, see Registration History).
      </p>
      {cases.map((c) => {
        const r = results[c.id]
        const anomalous = r?.memory?.anomalous
        return (
          <Panel key={c.id} title={c.label} right={
            <Button onClick={() => handleRun(c)} disabled={runningId === c.id}>
              {runningId === c.id ? 'Running…' : 'Run'}
            </Button>
          }>
            {runningId === c.id && <Spinner />}
            {r && r.status === 'ok' && (
              <>
                {anomalous && (
                  <div className="mb-3 text-sm px-3 py-2 rounded-md bg-[var(--color-amber)]/15 border border-[var(--color-amber)]/40 text-[var(--color-amber)]">
                    ⚠ Flagged: RMSE falls outside this sensor's running baseline (mean {r.memory.baseline_mean?.toFixed(3)}, std {r.memory.baseline_std?.toFixed(3)}).
                  </div>
                )}
                <div className="grid grid-cols-4 gap-3">
                  <MetricCard label="RMSE" value={r.rmse_post_refinement ?? '—'} unit="px" accent />
                  <MetricCard label="Inlier ratio" value={(r.inlier_ratio * 100).toFixed(1)} unit="%" />
                  <MetricCard label="Matches" value={r.total_matches} />
                  <MetricCard label="Uniformity" value={r.uniformity_score_selected ?? '—'} />
                </div>
              </>
            )}
            {r && r.status !== 'ok' && (
              <p className="text-sm text-[var(--color-red)]">{r.reason || 'Registration failed on this hard case.'}</p>
            )}
          </Panel>
        )
      })}
    </div>
  )
}
