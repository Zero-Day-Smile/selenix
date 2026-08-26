import { useEffect, useState } from 'react'
import createPlotlyComponent from 'react-plotly.js/factory'
import Plotly from 'plotly.js-dist-min'
import { Panel, ValidationBanner, DegenerateWarpGuard } from './ui'
import { getMatchPoints, runFileUrl } from '../api'

const Plot = createPlotlyComponent(Plotly)

export default function DifferenceHeatmap({ runId, result }) {
  const [data, setData] = useState(null)
  const [points, setPoints] = useState([])
  const [error, setError] = useState('')

  useEffect(() => {
    if (!runId) return
    fetch(runFileUrl(runId, 'ssim_heatmap_data.json'))
      .then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then(setData)
      .catch((e) => setError(`Failed to load SSIM data: ${e.message}`))
    getMatchPoints(runId).then(setPoints).catch(() => setPoints([]))
  }, [runId])

  if (error) {
    return (
      <Panel title="Residual / Structural-Similarity Heatmap (interactive)">
        <ValidationBanner result={result} />
        <p className="text-sm text-[var(--color-red)]">{error}</p>
      </Panel>
    )
  }
  if (!data) {
    return (
      <Panel title="Residual / Structural-Similarity Heatmap (interactive)">
        <ValidationBanner result={result} />
        <div className="h-48 flex items-center justify-center text-[var(--color-text-faint)] text-sm">Loading…</div>
      </Panel>
    )
  }

  // Cells outside the warped source's footprint are set to null so Plotly
  // renders them as a gap (no color value at all) rather than a colored SSIM
  // reading -- they are then filled with the same dark neutral tone used in
  // the earlier static-image version, so "no data" reads unambiguously as
  // neither good nor bad, not as a blank/broken cell.
  const zMasked = data.ssim.map((row, yi) =>
    row.map((v, xi) => (data.valid_mask[yi][xi] ? v : null))
  )

  const inliers = points.filter((p) => p.inlier)
  const outliers = points.filter((p) => !p.inlier)

  return (
    <Panel title="Residual / Structural-Similarity Heatmap (interactive)">
      <ValidationBanner result={result} />
      <DegenerateWarpGuard result={result}>
      <>
      <div style={{ background: '#28282c', borderRadius: 6 }} className="border border-[var(--color-border-soft)] overflow-hidden">
        <Plot
          data={[
            {
              type: 'heatmap',
              z: zMasked,
              x: data.x_coords,
              y: data.y_coords,
              zmin: 0, zmax: 1, // fixed [0,1] scale -- NOT auto-scaled per image, so heatmaps
              colorscale: 'Viridis', // stay visually comparable across different pairs, unchanged from before
              zsmooth: 'best', // bicubic-style interpolation between cells -- much less blocky
              hovertemplate: 'SSIM: %{z:.3f}<br>x: %{x:.0f}px, y: %{y:.0f}px<extra></extra>',
              showscale: true,
              colorbar: {
                title: { text: 'SSIM', font: { size: 12 } },
                tickvals: [0, 0.25, 0.5, 0.75, 1], tickfont: { size: 11 },
                thickness: 18, len: 0.85, outlinewidth: 0,
              },
            },
            {
              type: 'scattergl', mode: 'markers', name: 'inlier',
              x: inliers.map((p) => p.ref_x), y: inliers.map((p) => p.ref_y),
              marker: { color: '#5eead4', size: 8, line: { color: 'black', width: 1.2 } },
              hovertemplate: 'inlier match<br>x: %{x:.1f}, y: %{y:.1f}<extra></extra>',
            },
            {
              type: 'scattergl', mode: 'markers', name: 'outlier',
              x: outliers.map((p) => p.ref_x), y: outliers.map((p) => p.ref_y),
              marker: { color: '#f87171', size: 8, line: { color: 'black', width: 1.2 } },
              hovertemplate: 'outlier match<br>x: %{x:.1f}, y: %{y:.1f}<extra></extra>',
            },
          ]}
          layout={{
            autosize: true,
            height: 620,
            margin: { l: 55, r: 20, t: 20, b: 45 },
            paper_bgcolor: '#28282c',
            plot_bgcolor: '#28282c',
            font: { color: '#c4c9d4', size: 12 },
            xaxis: { title: 'x (px)', gridcolor: '#3a3f4c', zeroline: false },
            yaxis: { title: 'y (px)', gridcolor: '#3a3f4c', autorange: 'reversed', zeroline: false }, // image row 0 at top
            legend: { orientation: 'h', y: -0.1, font: { size: 12 } },
            dragmode: 'zoom',
          }}
          config={{ displaylogo: false, scrollZoom: true }}
          style={{ width: '100%' }}
          useResizeHandler
        />
      </div>
      <div className="mt-2 flex items-center gap-4 text-xs text-[var(--color-text-faint)] flex-wrap">
        <span>Viridis, fixed 0-1 scale (not auto-scaled per image). Hover any cell for its exact SSIM value. Scroll/drag to zoom and pan.</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ background: '#5eead4' }} /> inlier</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-full" style={{ background: '#f87171' }} /> outlier</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded" style={{ background: '#28282c', border: '1px solid #555' }} /> outside warped footprint (no data)</span>
      </div>
      <p className="mt-1 text-xs text-[var(--color-text-faint)]">
        Downsampled to {data.downsampled_shape[1]}x{data.downsampled_shape[0]} cells (factor {data.downsample_factor}x)
        from the full {data.orig_shape[1]}x{data.orig_shape[0]} SSIM map for interactive load — full-resolution
        JSON would be several MB. {result?.ssim && (
          <>mean SSIM (valid region): <span className="mono text-[var(--color-text)]">{result.ssim.mean_ssim_valid_region?.toFixed(3)}</span></>
        )}
      </p>
      </>
      </DegenerateWarpGuard>
    </Panel>
  )
}
