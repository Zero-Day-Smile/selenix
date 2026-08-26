import { useEffect, useRef, useState } from 'react'
import OpenSeadragon from 'openseadragon'
import { Panel, ValidationBanner, DegenerateWarpGuard, IMAGE_ENHANCE_FILTER } from './ui'
import { getMatchPoints } from '../api'

// Two independent OpenSeadragon viewers kept in sync on pan/zoom. Each
// viewer fires its own 'zoom'/'pan' events (including when we programmatically
// set the other one's viewport, since OSD doesn't distinguish user vs
// programmatic changes) -- so without a leading/following guard, syncing A->B
// would trigger B->A would trigger A->B... an infinite feedback loop. This is
// OpenSeadragon's own documented solution for synced multi-viewer setups.
function useSyncedViewers(leftRef, rightRef, leftUrl, rightUrl) {
  const [viewers, setViewers] = useState({ left: null, right: null })
  const syncing = useRef(false)

  useEffect(() => {
    // DegenerateWarpGuard keeps this panel's container mounted (just
    // CSS-hidden) even for a degenerate result, so refs are always attached
    // by the time this runs -- still guard defensively against a null ref.
    if (!leftUrl || !rightUrl || !leftRef.current || !rightRef.current) return
    const left = OpenSeadragon({
      element: leftRef.current, tileSources: { type: 'image', url: leftUrl },
      showNavigationControl: false, gestureSettingsMouse: { clickToZoom: false }, drawer: 'canvas',
    })
    const right = OpenSeadragon({
      element: rightRef.current, tileSources: { type: 'image', url: rightUrl },
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
    const syncLeftToRight = makeSync(left, right)
    const syncRightToLeft = makeSync(right, left)
    left.addHandler('zoom', syncLeftToRight)
    left.addHandler('pan', syncLeftToRight)
    right.addHandler('zoom', syncRightToLeft)
    right.addHandler('pan', syncRightToLeft)

    setViewers({ left, right })
    return () => { left.destroy(); right.destroy(); setViewers({ left: null, right: null }) }
  }, [leftUrl, rightUrl])

  return viewers
}

export default function ZoomInspector({ refUrl, regUrl, runId, result }) {
  const leftRef = useRef(null)
  const rightRef = useRef(null)
  const { left, right } = useSyncedViewers(leftRef, rightRef, refUrl, regUrl)
  const [points, setPoints] = useState([])
  const [cursor, setCursor] = useState(null) // {x, y} in reference-image pixel space

  useEffect(() => {
    if (!runId) return
    getMatchPoints(runId).then(setPoints).catch(() => setPoints([]))
  }, [runId])

  useEffect(() => {
    if (!left) return
    const handler = (e) => {
      // viewport-to-image-coordinate conversion via OpenSeadragon, replacing
      // the old hand-rolled canvas crop-math
      const viewportPoint = left.viewport.pointFromPixel(e.position)
      const imagePoint = left.viewport.viewportToImageCoordinates(viewportPoint)
      setCursor({ x: imagePoint.x, y: imagePoint.y })
    }
    left.addHandler('canvas-click', handler)
    left.addHandler('canvas-drag', handler)
    return () => { left.removeHandler('canvas-click', handler); left.removeHandler('canvas-drag', handler) }
  }, [left])

  let nearest = null, nearestDist = Infinity
  if (cursor) {
    for (const p of points) {
      const d = Math.hypot(p.ref_x - cursor.x, p.ref_y - cursor.y)
      if (d < nearestDist) { nearestDist = d; nearest = p }
    }
  }
  const zoom = left?.viewport?.getZoom() || 1
  const nearMatch = nearest && nearestDist < Math.max(15, 60 / zoom) ? nearest : null

  return (
    <Panel title="Sub-pixel Inspection (OpenSeadragon, synced dual viewer)">
      <ValidationBanner result={result} />
      <DegenerateWarpGuard result={result}>
      {!refUrl || !regUrl ? (
        <div className="h-48 flex items-center justify-center text-[var(--color-text-faint)] text-sm">Loading…</div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-4">
            <div className="flex flex-col gap-1 flex-1">
              <span className="text-xs text-[var(--color-text-faint)]">Reference (fixed) — click to inspect</span>
              <div ref={leftRef} className="rounded-md border border-[var(--color-border-soft)] bg-black" style={{ width: '100%', height: 420, filter: IMAGE_ENHANCE_FILTER }} />
            </div>
            <div className="flex flex-col gap-1 flex-1">
              <span className="text-xs text-[var(--color-text-faint)]">Registered (warped source) — synced pan/zoom</span>
              <div ref={rightRef} className="rounded-md border border-[var(--color-border-soft)] bg-black" style={{ width: '100%', height: 420, filter: IMAGE_ENHANCE_FILTER }} />
            </div>
          </div>

          <div className="mono text-xs text-[var(--color-text-dim)] bg-[var(--color-panel-raised)] border border-[var(--color-border)] rounded-md px-3 py-2 flex flex-col gap-1">
            {cursor ? (
              <>
                <span>coordinate (reference pixel space): x={cursor.x.toFixed(1)}, y={cursor.y.toFixed(1)}</span>
                {nearMatch ? (
                  <span>
                    nearest match point ({nearestDist.toFixed(1)}px away): {nearMatch.inlier ? 'inlier' : 'outlier'}
                    {nearMatch.refinement_offset_px != null
                      ? ` — sub-pixel refinement shift: ${nearMatch.refinement_offset_px.toFixed(3)}px`
                      : ' — no refinement applied at this point'}
                  </span>
                ) : (
                  <span>no matched point within range of this coordinate</span>
                )}
              </>
            ) : (
              <span>click the reference panel to inspect a coordinate</span>
            )}
          </div>
          <p className="text-xs text-[var(--color-text-faint)]">
            Pan/zoom either panel — both stay synced. Click the reference panel to read off a
            coordinate and its refinement offset, if any.
          </p>
        </div>
      )}
      </DegenerateWarpGuard>
    </Panel>
  )
}
