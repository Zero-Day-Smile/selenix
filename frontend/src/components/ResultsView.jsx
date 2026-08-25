import { Panel, ConfidenceBadge } from './ui'
import { runFileUrl } from '../api'
import CheckerboardBlend from './CheckerboardBlend'
import DifferenceHeatmap from './DifferenceHeatmap'
import ZoomInspector from './ZoomInspector'

function confidenceFor(result) {
  if (!result || result.status !== 'ok') return 'failed'
  if (result.rmse_post_refinement != null && result.rmse_post_refinement < 1.0 && result.inlier_ratio > 0.5) return 'verified'
  return 'unverified'
}

export default function ResultsView({ result }) {
  if (!result) {
    return <div className="text-center text-[var(--color-text-faint)] py-24">Run a registration from Upload &amp; Configure to see results here.</div>
  }
  if (result.status !== 'ok') {
    return (
      <Panel title="Registration Failed">
        <p className="text-sm text-[var(--color-red)]">{result.reason || 'Unknown error.'}</p>
      </Panel>
    )
  }

  const runId = result.run_dir_id
  const srcUrl = runFileUrl(runId, 'src_processed.png')
  const refUrl = runFileUrl(runId, 'ref_processed.png')
  const regUrl = runFileUrl(runId, 'registered_global.png')

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <ConfidenceBadge status={confidenceFor(result)} />
        <span className="text-sm text-[var(--color-text-dim)]">
          {result.matcher_used} · {result.geometry_method} · {result.elapsed_seconds}s
        </span>
      </div>

      <Panel title="Source / Reference / Registered">
        <div className="grid grid-cols-3 gap-3">
          {[['Source (moving)', srcUrl], ['Reference (fixed)', refUrl], ['Registered output', regUrl]].map(([label, url]) => (
            <div key={label} className="flex flex-col gap-2">
              <span className="text-xs text-[var(--color-text-faint)]">{label}</span>
              <img src={url} alt={label} className="w-full rounded-md border border-[var(--color-border-soft)] bg-black" />
            </div>
          ))}
        </div>
      </Panel>

      <CheckerboardBlend refUrl={refUrl} regUrl={regUrl} />

      <div className="grid grid-cols-2 gap-5">
        <ZoomInspector refUrl={refUrl} regUrl={regUrl} />
        <DifferenceHeatmap refUrl={refUrl} regUrl={regUrl} />
      </div>
    </div>
  )
}
