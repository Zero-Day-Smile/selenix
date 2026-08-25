import { useEffect, useRef } from 'react'
import { useImage } from '../lib/useImage'
import { viridis } from '../lib/colormap'
import { Panel } from './ui'

export default function DifferenceHeatmap({ refUrl, regUrl }) {
  const refImg = useImage(refUrl)
  const regImg = useImage(regUrl)
  const canvasRef = useRef(null)

  useEffect(() => {
    if (!refImg || !regImg) return
    const w = refImg.width, h = refImg.height
    const tmp = document.createElement('canvas')
    tmp.width = w; tmp.height = h
    const tctx = tmp.getContext('2d')

    tctx.drawImage(refImg, 0, 0, w, h)
    const refData = tctx.getImageData(0, 0, w, h).data

    tctx.clearRect(0, 0, w, h)
    tctx.drawImage(regImg, 0, 0, w, h)
    const regData = tctx.getImageData(0, 0, w, h).data

    const out = tctx.createImageData(w, h)
    for (let i = 0; i < refData.length; i += 4) {
      const d = Math.abs(refData[i] - regData[i]) / 255
      const [r, g, b] = viridis(d)
      out.data[i] = r; out.data[i + 1] = g; out.data[i + 2] = b; out.data[i + 3] = 255
    }
    const canvas = canvasRef.current
    canvas.width = w; canvas.height = h
    canvas.getContext('2d').putImageData(out, 0, 0)
  }, [refImg, regImg])

  return (
    <Panel title="Residual / Difference Heatmap">
      {!refImg || !regImg ? (
        <div className="h-48 flex items-center justify-center text-[var(--color-text-faint)] text-sm">Loading…</div>
      ) : (
        <>
          <canvas ref={canvasRef} className="w-full rounded-md border border-[var(--color-border-soft)]" />
          <p className="mt-2 text-xs text-[var(--color-text-faint)]">Viridis colormap — dark purple = well-aligned, yellow = high residual intensity difference.</p>
        </>
      )}
    </Panel>
  )
}
