import { useState } from 'react'
import { Panel, Button, Spinner, ErrorNote } from './ui'
import { runRegistration } from '../api'

const SENSORS = ['ohrc', 'tmc', 'iirs', 'nac']
const MATCHERS = [
  { id: 'classical', label: 'Classical (SIFT + FLANN)' },
  { id: 'deep', label: 'Deep (LoFTR)' },
  { id: 'auto', label: 'Auto (best of both)' },
]
const ILLUM_MODES = [
  { id: 'gradient', label: 'Shading removal (recommended)' },
  { id: 'clahe', label: 'CLAHE only' },
  { id: 'both', label: 'Shading removal + CLAHE' },
  { id: 'none', label: 'None (raw, for comparison)' },
]

function previewUrlFor(files) {
  const img = files.find((f) => /\.(png|jpe?g|tif?f)$/i.test(f.name))
  return img ? URL.createObjectURL(img) : null
}

function FileDrop({ label, files, onFiles }) {
  const preview = previewUrlFor(files)
  return (
    <label className="flex-1 flex flex-col gap-2 cursor-pointer">
      <span className="text-xs uppercase tracking-wider text-[var(--color-text-faint)]">{label}</span>
      <div className="border-2 border-dashed border-[var(--color-border)] rounded-lg h-40 flex items-center justify-center overflow-hidden hover:border-[var(--color-cyan)]/60 transition-colors bg-[var(--color-panel-raised)]">
        {preview ? (
          <img src={preview} alt={label} className="max-h-full max-w-full object-contain" />
        ) : files.length ? (
          <span className="mono text-xs text-[var(--color-text-dim)] px-3 text-center">
            {files.length} file{files.length > 1 ? 's' : ''} selected — no preview for this format
          </span>
        ) : (
          <span className="text-sm text-[var(--color-text-faint)]">Click or drop file(s)</span>
        )}
      </div>
      <input type="file" multiple accept="image/*,.tif,.tiff,.img,.xml,.lbl,.IMG,.XML,.LBL" className="hidden"
        onChange={(e) => onFiles(Array.from(e.target.files || []))} />
      {files.length > 0 && (
        <div className="flex flex-col">
          {files.map((f) => (
            <span key={f.name} className="mono text-xs text-[var(--color-text-dim)] truncate">{f.name}</span>
          ))}
        </div>
      )}
    </label>
  )
}

export default function UploadConfigure({ onResult }) {
  const [source, setSource] = useState([])
  const [reference, setReference] = useState([])
  const [matcher, setMatcher] = useState('auto')
  const [illumMode, setIllumMode] = useState('gradient')
  const [sensorType, setSensorType] = useState('ohrc')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const canRun = source.length > 0 && reference.length > 0 && !loading

  async function handleRun() {
    setLoading(true)
    setError('')
    try {
      const result = await runRegistration({ source, reference, matcher, illumMode, sensorType })
      if (result.status !== 'ok') {
        setError(result.reason || 'Registration failed — try a different pair or matcher.')
      }
      onResult(result)
    } catch (e) {
      setError(e.message || 'Something went wrong contacting the pipeline.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-6">
      <Panel title="Upload & Configure">
        <div className="flex gap-4 mb-2">
          <FileDrop label="Source (moving)" files={source} onFiles={setSource} />
          <FileDrop label="Reference (fixed / LRO NAC)" files={reference} onFiles={setReference} />
        </div>
        <p className="text-xs text-[var(--color-text-faint)] mb-6">
          Accepts a single PNG/JPG/TIFF, a single attached-label PDS3 .IMG, or a detached-label
          product — select the .xml/.lbl label together with its companion .img/.IMG (multi-select)
          so the sibling-file reference resolves correctly.
        </p>

        <div className="grid grid-cols-2 gap-6 mb-6">
          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wider text-[var(--color-text-faint)]">Sensor type</span>
            <div className="flex gap-2 flex-wrap">
              {SENSORS.map((s) => (
                <button key={s} onClick={() => setSensorType(s)}
                  className={`mono text-xs px-3 py-1.5 rounded border uppercase ${sensorType === s
                    ? 'bg-[var(--color-cyan)]/15 border-[var(--color-cyan)] text-[var(--color-cyan)]'
                    : 'border-[var(--color-border)] text-[var(--color-text-dim)] hover:border-[var(--color-text-faint)]'}`}>
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wider text-[var(--color-text-faint)]">Matcher</span>
            <select value={matcher} onChange={(e) => setMatcher(e.target.value)}
              className="bg-[var(--color-panel-raised)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm">
              {MATCHERS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2 mb-6">
          <span className="text-xs uppercase tracking-wider text-[var(--color-text-faint)]">
            Illumination / sun-angle normalization
          </span>
          <select value={illumMode} onChange={(e) => setIllumMode(e.target.value)}
            className="bg-[var(--color-panel-raised)] border border-[var(--color-border)] rounded-md px-3 py-2 text-sm max-w-xs">
            {ILLUM_MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <p className="text-xs text-[var(--color-text-faint)]">
            Shading removal targets the low-frequency brightness gradient a different sun
            azimuth/elevation causes — measured to outperform CLAHE alone on every test pair.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <Button onClick={handleRun} disabled={!canRun}>
            {loading ? 'Running…' : 'Run Registration'}
          </Button>
          {loading && <Spinner label="Matching, verifying geometry, refining, warping…" />}
        </div>
        <div className="mt-3"><ErrorNote message={error} /></div>
      </Panel>
    </div>
  )
}
