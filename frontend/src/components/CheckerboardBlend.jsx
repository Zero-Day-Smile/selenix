import { useEffect, useRef, useState } from 'react'
import { useImage } from '../lib/useImage'
import { Panel, Button } from './ui'

export default function CheckerboardBlend({ refUrl, regUrl }) {
  const refImg = useImage(refUrl)
  const regImg = useImage(regUrl)
  const canvasRef = useRef(null)
  const [cells, setCells] = useState(10)
  const [reveal, setReveal] = useState(1) // 0..1 wipe progress
  const [animating, setAnimating] = useState(false)

  useEffect(() => {
    if (!refImg || !regImg) return
    const canvas = canvasRef.current
    const w = refImg.width, h = refImg.height
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.drawImage(refImg, 0, 0, w, h)

    const cw = w / cells, ch = h / cells
    const revealCount = Math.floor(cells * cells * reveal)
    let n = 0
    for (let gy = 0; gy < cells; gy++) {
      for (let gx = 0; gx < cells; gx++) {
        const checker = (gx + gy) % 2 === 0
        if (checker && n < revealCount) {
          ctx.drawImage(regImg, gx * cw, gy * ch, cw, ch, gx * cw, gy * ch, cw, ch)
        }
        if (checker) n++
      }
    }
  }, [refImg, regImg, cells, reveal])

  function playReveal() {
    setAnimating(true)
    setReveal(0)
    let r = 0
    const step = () => {
      r += 0.04
      setReveal(Math.min(1, r))
      if (r < 1) requestAnimationFrame(step)
      else setAnimating(false)
    }
    requestAnimationFrame(step)
  }

  return (
    <Panel title="Checkerboard Blend — Alignment Proof" right={
      <div className="flex items-center gap-3">
        <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2">
          Grid
          <input type="range" min={4} max={24} value={cells} onChange={(e) => setCells(+e.target.value)} />
        </label>
        <Button variant="ghost" onClick={playReveal} disabled={animating}>Animate reveal</Button>
      </div>
    }>
      {!refImg || !regImg ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-faint)] text-sm">Loading imagery…</div>
      ) : (
        <canvas ref={canvasRef} className="w-full rounded-md border border-[var(--color-border-soft)]" style={{ imageRendering: 'pixelated' }} />
      )}
    </Panel>
  )
}
