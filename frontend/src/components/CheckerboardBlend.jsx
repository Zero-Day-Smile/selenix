import { useEffect, useRef, useState } from 'react'
import { useImage } from '../lib/useImage'
import { Panel, ValidationBanner, DegenerateWarpGuard, IMAGE_ENHANCE_FILTER } from './ui'

const TILE_SIZES = [16, 32, 64]

export default function CheckerboardBlend({ refUrl, regUrl, result }) {
  const refImg = useImage(refUrl)
  const regImg = useImage(regUrl)
  const canvasRef = useRef(null)
  const [tile, setTile] = useState(32)
  const [showLines, setShowLines] = useState(true)

  useEffect(() => {
    // DegenerateWarpGuard keeps this panel's container mounted (just
    // CSS-hidden) even for a degenerate result, so the canvas is always
    // attached by the time this runs -- still guard defensively against a
    // null ref.
    if (!refImg || !regImg || !canvasRef.current) return
    const canvas = canvasRef.current
    // native resolution of the processed pair — not a downsampled preview —
    // so sub-pixel misalignment near tile boundaries is actually visible
    const w = refImg.naturalWidth || refImg.width
    const h = refImg.naturalHeight || refImg.height
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(refImg, 0, 0, w, h)

    const cols = Math.ceil(w / tile)
    const rows = Math.ceil(h / tile)
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if ((gx + gy) % 2 !== 0) continue
        const x = gx * tile, y = gy * tile
        const cw = Math.min(tile, w - x), ch = Math.min(tile, h - y)
        ctx.drawImage(regImg, x, y, cw, ch, x, y, cw, ch)
      }
    }

    if (showLines) {
      ctx.strokeStyle = 'rgba(79, 209, 232, 0.35)'
      ctx.lineWidth = 1
      for (let x = 0; x <= w; x += tile) {
        ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke()
      }
      for (let y = 0; y <= h; y += tile) {
        ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke()
      }
    }
  }, [refImg, regImg, tile, showLines])

  return (
    <Panel title="Checkerboard Blend — Alignment Proof" right={
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1">
          {TILE_SIZES.map((t) => (
            <button key={t} onClick={() => setTile(t)}
              className={`mono text-xs px-2 py-1 rounded border ${tile === t
                ? 'bg-[var(--color-cyan)]/15 border-[var(--color-cyan)] text-[var(--color-cyan)]'
                : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-text-faint)]'}`}>
              {t}px
            </button>
          ))}
        </div>
        <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2">
          <input type="checkbox" checked={showLines} onChange={(e) => setShowLines(e.target.checked)}
                 className="accent-[var(--color-cyan)]" />
          Tile boundaries
        </label>
      </div>
    }>
      <ValidationBanner result={result} />
      <DegenerateWarpGuard result={result}>
        <>
          {!refImg || !regImg ? (
            <div className="h-64 flex items-center justify-center text-[var(--color-text-faint)] text-sm">Loading imagery…</div>
          ) : (
            <div className="overflow-auto max-h-[600px]">
              <canvas ref={canvasRef} className="rounded-md border border-[var(--color-border-soft)]"
                      style={{ imageRendering: 'pixelated', filter: IMAGE_ENHANCE_FILTER }} />
            </div>
          )}
          <p className="mt-2 text-xs text-[var(--color-text-faint)]">
            Alternating {tile}px tiles from the reference (even) and registered (odd) images at native
            processed resolution — a real crater/ridge should form one continuous shape across a tile
            boundary; a visible seam or offset there is misalignment, not a rendering artifact.
          </p>
        </>
      </DegenerateWarpGuard>
    </Panel>
  )
}
