import { Panel, MetricCard, Button } from './ui'
import { runFileUrl } from '../api'

export default function MetricsDashboard({ result }) {
  if (!result || result.status !== 'ok') {
    return <div className="text-center text-[var(--color-text-faint)] py-24">No metrics yet — run a registration first.</div>
  }

  const sel = result.matcher_selection

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="RMSE (post-refinement)" value={result.rmse_post_refinement ?? '—'} unit="px" accent />
        <MetricCard label="Inlier count" value={result.inlier_count} />
        <MetricCard label="Inlier ratio" value={(result.inlier_ratio * 100).toFixed(1)} unit="%" />
        <MetricCard label="Total matches" value={result.total_matches} />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <MetricCard label="RMSE pre-refinement" value={result.rmse_pre_refinement ?? '—'} unit="px" />
        <MetricCard label="RMSE improvement" value={result.rmse_improvement_pct ?? '—'} unit="%" />
        <MetricCard label="Uniformity score" value={result.uniformity_score_selected ?? '—'} />
        <MetricCard label="Est. scale factor" value={result.estimated_scale_factor_from_homography} unit="x" />
      </div>

      {sel && (
        <Panel title="Classical vs Deep — matcher comparison (Auto mode)">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--color-text-faint)] text-xs uppercase">
                <th className="py-2">Matcher</th>
                <th className="py-2">Post-RANSAC inlier ratio</th>
                <th className="py-2">Chosen</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(sel).filter(([k]) => k !== 'chosen').map(([name, score]) => (
                <tr key={name} className="border-t border-[var(--color-border-soft)]">
                  <td className="py-2 mono">{name}</td>
                  <td className="py-2 mono">{(score * 100).toFixed(2)}%</td>
                  <td className="py-2">{sel.chosen === name ? <span className="text-[var(--color-green)]">✓ selected</span> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      <Panel title="Global Homography vs Piecewise/TPS — registration comparison">
        <div className="grid grid-cols-3 gap-3">
          {[
            ['Global homography', result.warps_computed?.global_homography],
            ['Piecewise affine (local)', result.warps_computed?.piecewise_affine],
            ['Thin-plate spline', result.warps_computed?.thin_plate_spline],
          ].map(([label, path]) => path && (
            <div key={label} className="flex flex-col gap-2">
              <span className="text-xs text-[var(--color-text-faint)]">{label}</span>
              <img src={runFileUrl(result.run_dir_id, path.split(/[\\/]/).pop())} alt={label}
                className="w-full rounded-md border border-[var(--color-border-soft)] bg-black" />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-[var(--color-text-faint)]">
          Quantitative RMSE ({result.rmse_post_refinement} px) is computed on the global-homography fit.
          Piecewise/TPS are shown for qualitative comparison — lunar relief (craters, ridges) violates
          the flat-scene assumption of a single global homography, and the local warp visibly better
          conforms to relief-driven local distortion.
        </p>
      </Panel>

      <Panel title="Export">
        <div className="flex gap-3">
          <a href={runFileUrl(result.run_dir_id, 'metrics.json')} target="_blank" rel="noreferrer">
            <Button variant="ghost">Metrics JSON</Button>
          </a>
          <a href={runFileUrl(result.run_dir_id, 'match_points.json')} target="_blank" rel="noreferrer">
            <Button variant="ghost">Match points JSON</Button>
          </a>
          <a href={runFileUrl(result.run_dir_id, 'match_points.csv')} target="_blank" rel="noreferrer">
            <Button variant="ghost">Match points CSV</Button>
          </a>
        </div>
      </Panel>
    </div>
  )
}
