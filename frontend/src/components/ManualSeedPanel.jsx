import { useRef, useState } from 'react'
import { Panel, Button, Spinner, ErrorNote } from './ui'
import { prepareManual, runManual } from '../api'

const ILLUM_MODES = [
  { id: 'gradient', label: 'Shading removal (recommended)' },
  { id: 'clahe', label: 'CLAHE only' },
  { id: 'both', label: 'Shading removal + CLAHE' },
  { id: 'none', label: 'None (raw, for comparison)' },
]

function ClickableImage({ label, src, natShape, onPick, points, pendingIndex, side }) {
  const imgRef = useRef(null)
  if (!src) {
    return (
      <div className="flex-1 flex flex-col gap-2">
        <span className="text-xs uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
        <div className="border border-[var(--color-border)] rounded-lg h-96 flex items-center justify-center text-sm text-[var(--color-text-faint)]">
          Prepare a pair to enable point picking
        </div>
      </div>
    )
  }

  function handleClick(e) {
    const img = imgRef.current
    const rect = img.getBoundingClientRect()
    const xFrac = (e.clientX - rect.left) / rect.width
    const yFrac = (e.clientY - rect.top) / rect.height
    const x = xFrac * natShape[1]
    const y = yFrac * natShape[0]
    onPick(side, [x, y])
  }

  return (
    <div className="flex-1 flex flex-col gap-2 min-w-0">
      <span className="text-xs uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
      <div className="relative border border-[var(--color-border)] rounded-lg overflow-hidden bg-black/20"
           style={{ maxHeight: '520px', overflowY: 'auto' }}>
        <div className="relative inline-block">
          <img ref={imgRef} src={src} onClick={handleClick}
               className="block cursor-crosshair select-none" style={{ maxWidth: 'none', width: '600px' }} />
          {points.map((p, i) => {
            const pt = p[side]
            if (!pt) return null
            const leftPct = (pt[0] / natShape[1]) * 100
            const topPct = (pt[1] / natShape[0]) * 100
            const isPending = i === pendingIndex
            return (
              <div key={i}
                   className={`absolute -translate-x-1/2 -translate-y-1/2 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold border-2 ${
                     isPending ? 'border-[var(--color-amber)] bg-[var(--color-amber)]/30 text-[var(--color-amber)]'
                                : 'border-[var(--color-cyan)] bg-[var(--color-cyan)]/30 text-[var(--color-cyan)]'}`}
                   style={{ left: `${leftPct}%`, top: `${topPct}%` }}>
                {i + 1}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default function ManualSeedPanel({ onResult }) {
  const [source, setSource] = useState([])
  const [reference, setReference] = useState([])
  const [illumMode, setIllumMode] = useState('gradient')
  const [sensorType, setSensorType] = useState('ohrc')
  const [preparing, setPreparing] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [prep, setPrep] = useState(null) // { prepId, srcUrl, refUrl, srcShape, refShape }
  const [points, setPoints] = useState([]) // [{src:[x,y]|null, ref:[x,y]|null}]

  const completePairs = points.filter((p) => p.src && p.ref).length
  const canRun = completePairs >= 4 && !running

  async function handlePrepare() {
    setError('')
    setPreparing(true)
    try {
      const r = await prepareManual({ source, reference, illumMode })
      setPrep({ prepId: r.prep_id, srcUrl: r.src_url, refUrl: r.ref_url, srcShape: r.src_shape, refShape: r.ref_shape })
      setPoints([])
    } catch (e) {
      setError(e.message || 'Failed to prepare images.')
    } finally {
      setPreparing(false)
    }
  }

  function handlePick(side, coord) {
    setPoints((prev) => {
      const next = [...prev]
      const idx = next.findIndex((p) => !p[side])
      if (idx === -1) {
        next.push({ [side]: coord })
      } else {
        next[idx] = { ...next[idx], [side]: coord }
      }
      return next
    })
  }

  function removePair(i) {
    setPoints((prev) => prev.filter((_, idx) => idx !== i))
  }

  function reset() {
    setPrep(null)
    setPoints([])
    setError('')
  }

  async function handleRun() {
    setError('')
    setRunning(true)
    try {
      const seedPoints = points.filter((p) => p.src && p.ref).map((p) => ({ src: p.src, ref: p.ref }))
      const result = await runManual({ prepId: prep.prepId, seedPoints, sensorType })
      if (result.status !== 'ok') {
        setError(result.reason || 'Manual registration failed.')
      }
      onResult(result)
    } catch (e) {
      setError(e.message || 'Something went wrong running manual registration.')
    } finally {
      setRunning(false)
    }
  }

  const pendingIndex = points.findIndex((p) => !p.src || !p.ref)

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <Panel title="Manual Seed-Point Registration">
        <p className="text-xs text-[var(--color-text-faint)] mb-4">
          For terrain where automated matching fails (repetitive crater fields — see TASKS.md):
          click 4+ corresponding features on the two processed images below, and the pipeline
          fits a homography from your points, auto-verifies it (MAGSAC++), and auto-refines each
          click to sub-pixel precision (phase correlation) — same downstream pipeline as automated
          mode, only the disambiguation step is manual. Click a feature on the source image, then
          the same physical feature on the reference image, to form one pair; repeat for at least 4
          well-spread features.
        </p>

        {!prep && (
          <>
            <div className="flex gap-4 mb-4">
              <label className="flex-1 flex flex-col gap-2 cursor-pointer">
                <span className="text-xs uppercase tracking-wider text-[var(--color-text-faint)]">Source</span>
                <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg h-24 flex items-center justify-center text-sm text-[var(--color-text-faint)]">
                  {source.length ? `${source.length} file(s) selected` : 'Click or drop file(s)'}
                </div>
                <input type="file" multiple className="hidden" onChange={(e) => setSource(Array.from(e.target.files || []))} />
              </label>
              <label className="flex-1 flex flex-col gap-2 cursor-pointer">
                <span className="text-xs uppercase tracking-wider text-[var(--color-text-faint)]">Reference</span>
                <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg h-24 flex items-center justify-center text-sm text-[var(--color-text-faint)]">
                  {reference.length ? `${reference.length} file(s) selected` : 'Click or drop file(s)'}
                </div>
                <input type="file" multiple className="hidden" onChange={(e) => setReference(Array.from(e.target.files || []))} />
              </label>
            </div>
            <div className="flex items-end gap-4 mb-4">
              <div className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wider text-[var(--color-text-faint)]">Illumination normalization</span>
                <select value={illumMode} onChange={(e) => setIllumMode(e.target.value)}
                  className="bg-[var(--color-panel-raised)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm">
                  {ILLUM_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <Button onClick={handlePrepare} disabled={!source.length || !reference.length || preparing}>
                {preparing ? 'Preparing…' : 'Prepare for point picking'}
              </Button>
              {preparing && <Spinner label="Ingesting + normalizing…" />}
            </div>
          </>
        )}

        {prep && (
          <>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-[var(--color-text-faint)]">
                {completePairs} complete pair{completePairs === 1 ? '' : 's'} (need 4+) ·
                {' '}{prep.srcShape[1]}×{prep.srcShape[0]} → {prep.refShape[1]}×{prep.refShape[0]}
              </span>
              <Button variant="ghost" onClick={reset}>Start over</Button>
            </div>
            <div className="flex gap-4 mb-4">
              <ClickableImage label="Source (click here first)" src={prep.srcUrl} natShape={prep.srcShape}
                               onPick={handlePick} points={points} pendingIndex={pendingIndex} side="src" />
              <ClickableImage label="Reference (click matching feature)" src={prep.refUrl} natShape={prep.refShape}
                               onPick={handlePick} points={points} pendingIndex={pendingIndex} side="ref" />
            </div>

            {points.length > 0 && (
              <div className="mb-4 flex flex-col gap-1">
                {points.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs mono text-[var(--color-text-dim)]">
                    <span className={p.src && p.ref ? 'text-[var(--color-cyan)]' : 'text-[var(--color-amber)]'}>#{i + 1}</span>
                    <span>src: {p.src ? `${p.src[0].toFixed(0)}, ${p.src[1].toFixed(0)}` : '—'}</span>
                    <span>ref: {p.ref ? `${p.ref[0].toFixed(0)}, ${p.ref[1].toFixed(0)}` : '—'}</span>
                    <button onClick={() => removePair(i)} className="text-[var(--color-red)] hover:underline">remove</button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-4">
              <Button onClick={handleRun} disabled={!canRun}>
                {running ? 'Registering…' : 'Run Manual Registration'}
              </Button>
              {running && <Spinner label="Fitting homography, verifying, refining, warping…" />}
            </div>
          </>
        )}
        <div className="mt-3"><ErrorNote message={error} /></div>
      </Panel>
    </div>
  )
}
