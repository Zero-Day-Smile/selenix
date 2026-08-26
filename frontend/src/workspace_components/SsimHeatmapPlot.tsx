// workspace_components/SsimHeatmapPlot.tsx
//
// Interactive SSIM heatmap: real per-cell dissimilarity values (not a static
// PNG) rendered with Plotly -- fixed [0,1] color scale (SSIM is bounded by
// definition, so no per-image auto-scaling), a real colorbar, and per-cell
// hover values. Same rendering approach as the other frontend's
// DifferenceHeatmap.jsx, ported to this app's real match-point data.
import React, { useEffect, useState } from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
import type { WorkspaceData } from './types';

const Plot = createPlotlyComponent(Plotly);

interface SsimHeatmapData {
  ssim: number[][];
  valid_mask: number[][] | boolean[][];
  x_coords: number[];
  y_coords: number[];
  orig_shape: [number, number];
  downsampled_shape: [number, number];
  downsample_factor: number;
}

export default function SsimHeatmapPlot({
  dataUrl,
  matchPoints,
  meanSsimValidRegion,
  height = 620,
}: {
  dataUrl: string;
  matchPoints: WorkspaceData['matchPoints'];
  meanSsimValidRegion: number;
  height?: number;
}) {
  const [data, setData] = useState<SsimHeatmapData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setData(null);
    setError('');
    fetch(dataUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(`Failed to load SSIM data: ${e.message}`));
  }, [dataUrl]);

  if (error) {
    return <p className="text-sm text-red-600">{error}</p>;
  }
  if (!data) {
    return <div className="h-48 flex items-center justify-center text-gray-400 text-sm">Loading…</div>;
  }

  // Cells outside the warped source's footprint are set to null so Plotly
  // renders them as a gap (no color value) rather than a colored SSIM
  // reading -- filled with the panel's own dark background so "no data"
  // reads unambiguously as neither good nor bad.
  const zMasked = data.ssim.map((row, yi) => row.map((v, xi) => (data.valid_mask[yi][xi] ? v : null)));

  const inliers = matchPoints.filter((p) => p.inlier);
  const outliers = matchPoints.filter((p) => !p.inlier);

  return (
    <>
      <div style={{ background: '#28282c', borderRadius: 6 }} className="border border-gray-300 overflow-hidden">
        <Plot
          data={[
            {
              type: 'heatmap',
              z: zMasked,
              x: data.x_coords,
              y: data.y_coords,
              zmin: 0,
              zmax: 1,
              colorscale: 'Viridis',
              zsmooth: 'best',
              hovertemplate: 'SSIM: %{z:.3f}<br>x: %{x:.0f}px, y: %{y:.0f}px<extra></extra>',
              showscale: true,
              colorbar: {
                title: { text: 'SSIM', font: { size: 12 } },
                tickvals: [0, 0.25, 0.5, 0.75, 1],
                tickfont: { size: 11 },
                thickness: 18,
                len: 0.85,
                outlinewidth: 0,
              },
            } as any,
            {
              type: 'scattergl',
              mode: 'markers',
              name: 'inlier',
              x: inliers.map((p) => p.ref_x),
              y: inliers.map((p) => p.ref_y),
              marker: { color: '#5eead4', size: 8, line: { color: 'black', width: 1.2 } },
              hovertemplate: 'inlier match<br>x: %{x:.1f}, y: %{y:.1f}<extra></extra>',
            } as any,
            {
              type: 'scattergl',
              mode: 'markers',
              name: 'outlier',
              x: outliers.map((p) => p.ref_x),
              y: outliers.map((p) => p.ref_y),
              marker: { color: '#f87171', size: 8, line: { color: 'black', width: 1.2 } },
              hovertemplate: 'outlier match<br>x: %{x:.1f}, y: %{y:.1f}<extra></extra>',
            } as any,
          ]}
          layout={{
            autosize: true,
            height,
            margin: { l: 55, r: 20, t: 20, b: 65 },
            paper_bgcolor: '#28282c',
            plot_bgcolor: '#28282c',
            font: { color: '#c4c9d4', size: 12 },
            xaxis: { title: { text: 'x (px)' }, gridcolor: '#3a3f4c', zeroline: false },
            yaxis: { title: { text: 'y (px)' }, gridcolor: '#3a3f4c', autorange: 'reversed', zeroline: false },
            legend: { orientation: 'h', y: -0.22, font: { size: 12 } },
            dragmode: 'zoom',
          }}
          config={{ displaylogo: false, scrollZoom: true }}
          style={{ width: '100%' }}
          useResizeHandler
        />
      </div>
      <div className="mt-2 flex items-center gap-4 text-[10px] text-gray-400 flex-wrap">
        <span>Viridis, fixed 0–1 scale (not auto-scaled per image). Hover any cell for its exact SSIM value. Scroll/drag to zoom and pan.</span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#5eead4' }} /> inlier
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full" style={{ background: '#f87171' }} /> outlier
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded" style={{ background: '#28282c', border: '1px solid #555' }} /> outside
          warped footprint (no data)
        </span>
      </div>
      <p className="mt-1 text-[10px] text-gray-400">
        Downsampled to {data.downsampled_shape[1]}x{data.downsampled_shape[0]} cells (factor {data.downsample_factor}x) from
        the full {data.orig_shape[1]}x{data.orig_shape[0]} SSIM map for interactive load — full-resolution JSON would be
        several MB. Mean SSIM (valid region): <span className="font-mono text-gray-600">{meanSsimValidRegion.toFixed(3)}</span>
      </p>
    </>
  );
}
