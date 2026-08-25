import { useEffect, useRef, useState } from 'react'
import { useImage } from '../lib/useImage'
import { Panel } from './ui'

export default function ZoomInspector({ refUrl, regUrl }) {
  const refImg = useImage(refUrl)
  const regImg = useImage(regUrl)
  const canvasRef = useRef(null)
  const [cx, setCx] = useState(0.5)
  const [cy, setCy] = useState(0.5)
  const [zoom, setZoom] = useState(6)
  const [showGrid, setShowGrid] = useState(true)

  useEffect(() => {
    if (!refImg || !regImg) return
    const canvas = canvasRef.current
    const size = 420
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false

    const w = refImg.width, h = refImg.height
    const cropW = size / zoom
    const cropH = size / zoom
    const sx = Math.min(Math.max(cx * w - cropW / 2, 0), w - cropW)
    const sy = Math.min(Math.max(cy * h - cropH / 2, 0), h - cropH)

    ctx.clearRect(0, 0, size, size)
    ctx.globalAlpha = 1
    ctx.drawImage(refImg, sx, sy, cropW, cropH, 0, 0, size, size)
    ctx.globalAlpha = 0.5
    ctx.drawImage(regImg, sx, sy, cropW, cropH, 0, 0, size, size)
    ctx.globalAlpha = 1

    if (showGrid && zoom >= 4) {
      ctx.strokeStyle = 'rgba(79, 209, 232, 0.25)'
      ctx.lineWidth = 1
      for (let x = 0; x <= size; x += zoom) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke()
      }
      for (let y = 0; y <= size; y += zoom) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke()
      }
    }
  }, [refImg, regImg, cx, cy, zoom, showGrid])

  return (
    <Panel title="Sub-pixel Inspection" right={
      <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2">
        <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="accent-[var(--color-cyan)]" />
        Pixel grid
      </label>
    }>
      {!refImg || !regImg ? (
        <div className="h-48 flex items-center justify-center text-[var(--color-text-faint)] text-sm">Loading…</div>
      ) : (
        <div className="flex gap-4">
          <canvas ref={canvasRef} className="rounded-md border border-[var(--color-border-soft)]" />
          <div className="flex flex-col gap-3 flex-1 justify-center">
            <label className="text-xs text-[var(--color-text-faint)] flex flex-col gap-1">
              X position
              <input type="range" min={0} max={1} step={0.005} value={cx} onChange={(e) => setCx(+e.target.value)} />
            </label>
            <label className="text-xs text-[var(--color-text-faint)] flex flex-col gap-1">
              Y position
              <input type="range" min={0} max={1} step={0.005} value={cy} onChange={(e) => setCy(+e.target.value)} />
            </label>
            <label className="text-xs text-[var(--color-text-faint)] flex flex-col gap-1">
              Zoom ({zoom}x)
              <input type="range" min={2} max={16} step={1} value={zoom} onChange={(e) => setZoom(+e.target.value)} />
            </label>
            <p className="text-xs text-[var(--color-text-faint)]">Overlay: reference (opaque) + registered (50% alpha) — misalignment shows as ghosting/double edges.</p>
          </div>
        </div>
      )}
    </Panel>
  )
}
