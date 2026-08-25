import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { Panel } from './ui'
import { getHistory } from '../api'

const SENSOR_COLORS = { ohrc: '#4FD1E8', tmc: '#E8A33D', iirs: '#4FE0A0', nac: '#E85D5D', unknown: '#8A90A2' }

export default function HistoryPanel({ onSelect }) {
  const [rows, setRows] = useState([])

  useEffect(() => {
    const load = () => getHistory(null, 100).then(setRows).catch(() => {})
    load()
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  const chartData = [...rows].reverse().map((r, i) => ({
    idx: i + 1,
    [r.sensor_type]: r.rmse,
  }))

  const sensors = [...new Set(rows.map((r) => r.sensor_type))]

  function reload(row) {
    if (!row.run_dir) return
    let parsed = {}
    try { parsed = JSON.parse(row.result_json) } catch { /* noop */ }
    onSelect({ ...parsed, status: 'ok', run_dir_id: row.run_dir })
  }

  return (
    <div className="flex flex-col gap-5">
      <Panel title="RMSE Trend per Sensor">
        {rows.length === 0 ? (
          <p className="text-sm text-[var(--color-text-faint)]">No history yet.</p>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData}>
              <CartesianGrid stroke="#232838" strokeDasharray="3 3" />
              <XAxis dataKey="idx" stroke="#565D70" fontSize={12} />
              <YAxis stroke="#565D70" fontSize={12} />
              <Tooltip contentStyle={{ background: '#171B24', border: '1px solid #232838' }} />
              <Legend />
              {sensors.map((s) => (
                <Line key={s} type="monotone" dataKey={s} stroke={SENSOR_COLORS[s] || '#8A90A2'}
                  dot={false} connectNulls strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </Panel>

      <Panel title="Registration History (Memory)">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[var(--color-text-faint)] text-xs uppercase">
              <th className="py-2">Time</th>
              <th className="py-2">Sensor</th>
              <th className="py-2">Matcher</th>
              <th className="py-2">RMSE</th>
              <th className="py-2">Inlier ratio</th>
              <th className="py-2">Flagged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} onClick={() => reload(r)}
                className="border-t border-[var(--color-border-soft)] cursor-pointer hover:bg-[var(--color-panel-raised)]">
                <td className="py-2 mono text-xs">{new Date(r.timestamp * 1000).toLocaleTimeString()}</td>
                <td className="py-2 mono uppercase">{r.sensor_type}</td>
                <td className="py-2 mono text-xs">{r.matcher_used}</td>
                <td className="py-2 mono text-[var(--color-cyan)]">{r.rmse?.toFixed(3)}</td>
                <td className="py-2 mono">{(r.inlier_ratio * 100).toFixed(1)}%</td>
                <td className="py-2">{r.anomalous ? <span className="text-[var(--color-amber)]">⚠ anomalous</span> : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-[var(--color-text-faint)]">Click a row to reload that run's results (only runs made through this UI/API have viewable imagery).</p>
      </Panel>
    </div>
  )
}
