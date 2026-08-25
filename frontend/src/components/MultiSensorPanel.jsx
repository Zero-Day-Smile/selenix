import { useEffect, useState } from 'react'
import { Panel } from './ui'
import { getSensorSummary } from '../api'

export default function MultiSensorPanel() {
  const [rows, setRows] = useState([])

  useEffect(() => {
    const load = () => getSensorSummary().then(setRows).catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <Panel title="Multi-Sensor Proof — generic across OHRC / TMC-2 / IIRS × NAC">
      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-text-faint)]">No runs recorded yet for any sensor. Run registrations from Upload &amp; Configure or Hard-Case panels.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-text-faint)] text-xs uppercase">
              <th className="py-2">Sensor</th>
              <th className="py-2">Runs</th>
              <th className="py-2">Mean RMSE (px)</th>
              <th className="py-2">Mean inlier ratio</th>
              <th className="py-2">Mean uniformity</th>
              <th className="py-2">Anomalous</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sensor_type} className="border-t border-[var(--color-border-soft)]">
                <td className="py-2 mono uppercase">{r.sensor_type}</td>
                <td className="py-2 mono">{r.n_runs}</td>
                <td className="py-2 mono text-[var(--color-cyan)]">{r.mean_rmse?.toFixed(3)}</td>
                <td className="py-2 mono">{(r.mean_inlier_ratio * 100).toFixed(1)}%</td>
                <td className="py-2 mono">{r.mean_uniformity?.toFixed(3)}</td>
                <td className="py-2 mono">{r.n_anomalous > 0 ? <span className="text-[var(--color-amber)]">{r.n_anomalous}</span> : '0'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  )
}
