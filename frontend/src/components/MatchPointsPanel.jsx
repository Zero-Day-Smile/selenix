import { useEffect, useRef, useState } from 'react'
import { Panel, MetricCard } from './ui'
import { runFileUrl, getMatchPoints } from '../api'
import { useImage } from '../lib/useImage'
import { viridis } from '../lib/colormap'

function ScatterCanvas({ refUrl, points, onlySelected }) {
  const refImg = useImage(refUrl)
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!refImg) return
    const canvas = canvasRef.current
    const w = refImg.width, h = refImg.height
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(refImg, 0, 0, w, h)
    ctx.globalAlpha = 0.9

    for (const p of points) {
      if (onlySelected && !p.uniform_selected) continue
      const [r, g, b] = viridis(p.confidence ?? 0.5)
      ctx.fillStyle = `rgb(${r},${g},${b})`
      ctx.strokeStyle = p.inlier ? 'rgba(255,255,255,0.8)' : 'rgba(232,93,93,0.5)'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(p.ref_x, p.ref_y, p.inlier ? 4 : 2.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
  }, [refImg, points, onlySelected])

  return <canvas ref={canvasRef} className="w-full rounded-md border border-[var(--color-border-soft)]" />
}

function CoverageHeatmap({ refUrl, points, gridN = 8 }) {
  const refImg = useImage(refUrl)
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!refImg) return
    const canvas = canvasRef.current
    const w = refImg.width, h = refImg.height
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(refImg, 0, 0, w, h)

    const counts = Array.from({ length: gridN }, () => new Array(gridN).fill(0))
    const cw = w / gridN, ch = h / gridN
    let maxC = 0
    for (const p of points) {
      if (!p.inlier) continue
      const gx = Math.min(Math.floor(p.ref_x / cw), gridN - 1)
      const gy = Math.min(Math.floor(p.ref_y / ch), gridN - 1)
      counts[gy][gx]++
      maxC = Math.max(maxC, counts[gy][gx])
    }
    ctx.globalAlpha = 0.55
    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        const t = maxC > 0 ? counts[gy][gx] / maxC : 0
        const [r, g, b] = viridis(t)
        ctx.fillStyle = `rgb(${r},${g},${b})`
        ctx.fillRect(gx * cw, gy * ch, cw, ch)
      }
    }
    ctx.globalAlpha = 1
    ctx.strokeStyle = 'rgba(0,0,0,0.4)'
    for (let gy = 0; gy < gridN; gy++) {
      for (let gx = 0; gx < gridN; gx++) {
        ctx.strokeRect(gx * cw, gy * ch, cw, ch)
      }
    }
  }, [refImg, points, gridN])

  return <canvas ref={canvasRef} className="w-full rounded-md border border-[var(--color-border-soft)]" />
}

export default function MatchPointsPanel({ result }) {
  const [points, setPoints] = useState([])
  const [onlySelected, setOnlySelected] = useState(false)

  useEffect(() => {
    if (!result || result.status !== 'ok') { setPoints([]); return }
    getMatchPoints(result.run_dir_id).then(setPoints).catch(() => setPoints([]))
  }, [result])

  if (!result || result.status !== 'ok') {
    return <div className="text-center text-[var(--color-text-faint)] py-24">No match data yet — run a registration first.</div>
  }

  const refUrl = runFileUrl(result.run_dir_id, 'ref_processed.png')

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="Total matches" value={result.total_matches} accent />
        <MetricCard label="Inliers" value={result.inlier_count} />
        <MetricCard label="Uniformly selected" value={result.n_uniform_selected} />
        <MetricCard label="Uniformity score" value={result.uniformity_score_selected ?? '—'} unit="(lower = more uniform)" />
      </div>

      <Panel title="Match Scatter — confidence gradient" right={
        <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2">
          <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} className="accent-[var(--color-cyan)]" />
          Show uniform-selected subset only
        </label>
      }>
        <ScatterCanvas refUrl={refUrl} points={points} onlySelected={onlySelected} />
        <p className="mt-2 text-xs text-[var(--color-text-faint)]">Color = match confidence (viridis, dark=low → yellow=high). White ring = geometric inlier, red ring = outlier.</p>
      </Panel>

      <Panel title="Coverage Heatmap — proof of uniform distribution">
        <CoverageHeatmap refUrl={refUrl} points={points} />
      </Panel>
    </div>
  )
}
