import { useEffect, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import { Panel, Button, ValidationBanner, DegenerateWarpGuard, IMAGE_ENHANCE_FILTER } from './ui'

// Two OSD viewers stacked exactly on top of each other (same container size),
// kept in sync the same leading/following way as ZoomInspector. The top
// viewer (registered/source B) is clipped via CSS/SVG clip-path in
// CONTAINER-relative (0-1) coordinates -- since both viewers always show the
// same crop at the same screen position when synced, a container-relative
// clip region reveals the correct portion of the underlying image regardless
// of current pan/zoom, with no per-frame recomputation needed.
export default function GridAnimateReveal({ refUrl, regUrl, result }) {
  const bottomRef = useRef(null)
  const topRef = useRef(null)
  const containerRef = useRef(null)
  const viewersRef = useRef({ bottom: null, top: null })
  const syncing = useRef(false)
  const [ready, setReady] = useState(false)
  const [mode, setMode] = useState('wipe') // 'wipe' | 'grid'
  const [reveal, setReveal] = useState(0.5)
  const [cells, setCells] = useState(8)
  const [animating, setAnimating] = useState(false)
  const dragging = useRef(false)

  useEffect(() => {
    // DegenerateWarpGuard keeps this panel's container mounted (just
    // CSS-hidden) even for a degenerate result, so refs are always attached
    // by the time this runs -- still guard defensively against a null ref.
    if (!refUrl || !regUrl || !bottomRef.current || !topRef.current) return
    const bottom = OpenSeadragon({
      element: bottomRef.current, tileSources: { type: 'image', url: refUrl },
      showNavigationControl: false, gestureSettingsMouse: { clickToZoom: false }, drawer: 'canvas',
    })
    const top = OpenSeadragon({
      element: topRef.current, tileSources: { type: 'image', url: regUrl },
      showNavigationControl: false, gestureSettingsMouse: { clickToZoom: false }, drawer: 'canvas',
    })
    function makeSync(source, target) {
      return () => {
        if (syncing.current) return
        syncing.current = true
        target.viewport.zoomTo(source.viewport.getZoom())
        target.viewport.panTo(source.viewport.getCenter())
        syncing.current = false
      }
    }
    bottom.addHandler('zoom', makeSync(bottom, top))
    bottom.addHandler('pan', makeSync(bottom, top))
    top.addHandler('zoom', makeSync(top, bottom))
    top.addHandler('pan', makeSync(top, bottom))
    viewersRef.current = { bottom, top }
    setReady(true)
    return () => { bottom.destroy(); top.destroy(); viewersRef.current = { bottom: null, top: null }; setReady(false) }
  }, [refUrl, regUrl])

  // clip-path on the top (registered) viewer's element. Grid mode needs to
  // clip several DISJOINT rectangles at once, which the CSS polygon()
  // function cannot express (it's one continuous vertex list, not multiple
  // sub-paths) -- an SVG <clipPath> with one <rect> per cell is the correct,
  // well-supported way to do this. `clipPathUnits="objectBoundingBox"` means
  // each rect's x/y/width/height are in 0-1 fractions of the clipped
  // element's own box, so no pixel/resize math is needed.
  const [gridRects, setGridRects] = useState([])

  useEffect(() => {
    const topEl = topRef.current
    if (!topEl) return
    if (mode === 'wipe') {
      topEl.style.clipPath = `inset(0 ${(1 - reveal) * 100}% 0 0)`
      setGridRects([])
      return
    }
    const cols = cells, rows = cells
    const cw = 1 / cols, ch = 1 / rows
    const total = cols * rows
    const revealCount = Math.floor(total * reveal)
    const rects = []
    let n = 0
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if (n < revealCount) rects.push({ x: gx * cw, y: gy * ch, w: cw, h: ch, key: `${gx}-${gy}` })
        n++
      }
    }
    setGridRects(rects)
    topEl.style.clipPath = rects.length ? 'url(#grid-reveal-clip)' : 'inset(0 100% 0 0)'
  }, [mode, reveal, cells, ready])

  function handlePointer(e) {
    if (!dragging.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    setReveal(frac)
  }

  function playAutoplay() {
    setAnimating(true)
    setReveal(0)
    let r = 0
    const step = () => {
      r += 0.015
      setReveal(Math.min(1, r))
      if (r < 1) requestAnimationFrame(step)
      else setAnimating(false)
    }
    requestAnimationFrame(step)
  }

  return (
    <Panel title="Animated Reveal — Source vs. Registered (OpenSeadragon, synced)" right={
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button onClick={() => setMode('wipe')}
            className={`mono text-xs px-2 py-1 rounded border ${mode === 'wipe'
              ? 'bg-[var(--color-cyan)]/15 border-[var(--color-cyan)] text-[var(--color-cyan)]'
              : 'border-[var(--color-border)] text-[var(--color-text-dim)]'}`}>Wipe</button>
          <button onClick={() => setMode('grid')}
            className={`mono text-xs px-2 py-1 rounded border ${mode === 'grid'
              ? 'bg-[var(--color-cyan)]/15 border-[var(--color-cyan)] text-[var(--color-cyan)]'
              : 'border-[var(--color-border)] text-[var(--color-text-dim)]'}`}>Grid reveal</button>
        </div>
        {mode === 'grid' && (
          <label className="text-xs text-[var(--color-text-dim)] flex items-center gap-2">
            Cells
            <input type="range" min={4} max={20} value={cells} onChange={(e) => setCells(+e.target.value)} />
          </label>
        )}
        <Button variant="ghost" onClick={playAutoplay} disabled={animating}>Autoplay</Button>
      </div>
    }>
      <ValidationBanner result={result} />
      <DegenerateWarpGuard result={result}>
      {!refUrl || !regUrl ? (
        <div className="h-64 flex items-center justify-center text-[var(--color-text-faint)] text-sm">Loading imagery…</div>
      ) : (
        <>
          <div ref={containerRef}
               onMouseDown={(e) => { dragging.current = true; handlePointer(e) }}
               onMouseMove={handlePointer}
               onMouseUp={() => { dragging.current = false }}
               onMouseLeave={() => { dragging.current = false }}
               className="relative cursor-ew-resize select-none rounded-md border border-[var(--color-border-soft)] overflow-hidden"
               style={{ width: '100%', height: 480 }}>
            <svg width="0" height="0" style={{ position: 'absolute' }}>
              <clipPath id="grid-reveal-clip" clipPathUnits="objectBoundingBox">
                {gridRects.map((r) => (
                  <rect key={r.key} x={r.x} y={r.y} width={r.w} height={r.h} />
                ))}
              </clipPath>
            </svg>
            <div ref={bottomRef} className="absolute inset-0 bg-black" style={{ filter: IMAGE_ENHANCE_FILTER }} />
            <div ref={topRef} className="absolute inset-0 bg-black" style={{ filter: IMAGE_ENHANCE_FILTER }} />
            {mode === 'wipe' && (
              <div className="absolute top-0 bottom-0 bg-[var(--color-cyan)] pointer-events-none" style={{ left: `${reveal * 100}%`, width: 2 }} />
            )}
          </div>
          <input type="range" min={0} max={1} step={0.002} value={reveal}
                 onChange={(e) => setReveal(+e.target.value)} className="w-full mt-3" />
          <p className="mt-2 text-xs text-[var(--color-text-faint)]">
            {mode === 'wipe'
              ? 'Left of the cyan line: reference. Right: registered source. Drag the image or the slider. Pan/zoom either panel — both stay synced.'
              : 'Cells fill in sequence as you drag the slider — local misalignment in one region shows as a discontinuity within a single revealed cell.'}
          </p>
        </>
      )}
      </DegenerateWarpGuard>
    </Panel>
  )
}
