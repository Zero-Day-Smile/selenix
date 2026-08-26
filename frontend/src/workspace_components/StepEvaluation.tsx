// workspace_components/StepEvaluation.tsx
import React, { useMemo, useRef } from 'react';
import type { WorkspaceData } from './types';
import { matchPointsToCsv } from '../services/api';
import { useOsdViewer } from './useOsdViewer';
import OsdPointOverlay from './OsdPointOverlay';
import SsimHeatmapPlot from './SsimHeatmapPlot';

export default function StepEvaluation({ data }: { data: WorkspaceData }) {
  const heatmapElRef = useRef<HTMLDivElement>(null);
  // Fallback static-image viewer only used when the real per-cell data isn't
  // available (e.g. an older cached run from before ssim_data was exposed).
  useOsdViewer(heatmapElRef, data.ssimHeatmapDataUrl ? null : data.ssimHeatmapUrl);

  const distributionElRef = useRef<HTMLDivElement>(null);
  const refImg = data.refProcessedUrl || data.refUrl;
  const distributionViewer = useOsdViewer(distributionElRef, refImg);

  // Real inlier match locations in reference-image pixel space -- the same
  // points the backend's uniformity score is computed over -- rather than a
  // coarse 4x4 count grid. uniform_selected points (the subset actually used
  // for the uniformity-selected metric) are highlighted; other inliers are
  // dimmer; outliers are omitted since the uniformity metric doesn't cover them.
  const distributionPoints = useMemo(
    () =>
      data.matchPoints
        .filter((p) => p.inlier)
        .map((p) => ({
          x: p.ref_x,
          y: p.ref_y,
          color: p.uniform_selected ? '#0F766E' : '#5EEAD4',
          opacity: p.uniform_selected ? 0.95 : 0.5,
        })),
    [data.matchPoints]
  );

  const metrics = [
    { label: 'RMSE (post-refinement)', value: data.metrics.rmse.toFixed(3), sub: 'sub-pixel accuracy target' },
    { label: 'Inlier count', value: data.metrics.inlierCount, sub: `of ${data.candidateMatches} candidates` },
    { label: 'Inlier ratio', value: `${(data.metrics.inlierRatio * 100).toFixed(1)}%`, sub: 'geometrically consistent' },
    { label: 'RMSE improvement', value: `${data.metrics.rmseImprovementPct.toFixed(1)}%`, sub: 'pre → post refinement' },
  ];

  const downloadBlob = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExport = (kind: 'image' | 'points' | 'metrics') => {
    if (!data.simulationMode) {
      const url = kind === 'image' ? data.registeredGlobalUrl : kind === 'points' ? data.matchPointsCsvUrl : data.metricsJsonUrl;
      if (url) window.open(url, '_blank');
      return;
    }
    // Simulation mode: no real raster/backend files exist — generate what we can client-side
    // and say so, rather than pretending a download link is real.
    if (kind === 'points') {
      downloadBlob(matchPointsToCsv(data.matchPoints), 'match_points_simulated.csv', 'text/csv');
    } else if (kind === 'metrics') {
      downloadBlob(JSON.stringify(data, null, 2), 'metrics_simulated.json', 'application/json');
    }
  };

  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {metrics.map((m) => (
          <div key={m.label} className="bg-white border border-gray-200 p-4 shadow-sm rounded-sm">
            <div className="font-mono text-2xl font-bold text-black">{m.value}</div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide">{m.label}</div>
            <div className="text-[9px] text-gray-400">{m.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        <div className="bg-white border border-gray-200 p-6 shadow-sm rounded-sm flex flex-col">
          <h3 className="text-xs font-bold tracking-wide uppercase mb-4">Match distribution (reference image)</h3>
          <div className="relative flex-1 min-h-[320px] overflow-hidden rounded-sm">
            <div ref={distributionElRef} className="w-full h-full border border-gray-300 bg-black" />
            <OsdPointOverlay viewer={distributionViewer} points={distributionPoints} />
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: '#0F766E' }}></span> Uniform-selected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: '#5EEAD4' }}></span> Other inliers
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-500 mt-2">
            <span>
              Uniformity (selected): <span className="font-mono text-black">{data.metrics.uniformityScore.toFixed(3)}</span>
            </span>
            <span>
              Uniformity (all inliers): <span className="font-mono text-black">{data.metrics.uniformityScoreAllInliers.toFixed(3)}</span>
            </span>
          </div>
          <div className="text-[10px] text-gray-500 mt-1">
            Uniform-selected matches: <span className="font-mono text-black">{data.metrics.nUniformSelected}</span>
          </div>
        </div>

        <div className="bg-white border border-gray-200 p-6 shadow-sm rounded-sm flex flex-col">
          <h3 className="text-xs font-bold tracking-wide uppercase mb-4">SSIM summary</h3>
          <div className="text-xs flex flex-col gap-1">
            <div>
              SSIM (valid region): <span className="font-mono">{data.ssim.validRegion.toFixed(3)}</span>
            </div>
            <div>
              Valid pixel fraction: <span className="font-mono">{(data.ssim.validFraction * 100).toFixed(1)}%</span>
            </div>
            <div>
              Overall SSIM: <span className="font-mono">{data.ssim.mean.toFixed(3)}</span>
            </div>
          </div>
          <div className="mt-4 text-xs text-gray-400 border-t border-gray-200 pt-2 pb-3">
            <span>
              Elapsed: {data.elapsedSeconds.toFixed(1)}s · Matcher: {data.matcherUsed} · Geometry: {data.geometryMethod}
            </span>
          </div>
          {(data.ssimHeatmapDataUrl || data.ssimHeatmapUrl) && (
            <div className="border-t border-gray-200 pt-3">
              <h4 className="text-[10px] font-bold tracking-wide uppercase mb-2 text-gray-500">Dissimilarity heatmap</h4>
              {data.ssimHeatmapDataUrl ? (
                <SsimHeatmapPlot
                  dataUrl={data.ssimHeatmapDataUrl}
                  matchPoints={data.matchPoints}
                  meanSsimValidRegion={data.ssim.validRegion}
                  height={420}
                />
              ) : (
                <>
                  <div ref={heatmapElRef} className="w-full h-[360px] border border-gray-200 rounded-sm overflow-hidden bg-black" />
                  <p className="text-[9px] text-gray-400 mt-1">
                    Per-cell SSIM data isn't available for this run (older cached run) — showing the static heatmap
                    image instead. Brightness encodes dissimilarity on a fixed 0–1 scale; fully transparent regions
                    fall outside the warped source's footprint.
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 bg-white border border-gray-200 p-6 shadow-sm rounded-sm">
        <h3 className="text-xs font-bold tracking-wide uppercase mb-4">Export</h3>
        {data.simulationMode && (
          <p className="text-[10px] text-amber-600 mb-3">
            Running in simulation mode — the registered raster and metrics.json below come from the real backend
            only when it's reachable. Here, "Match points" and "Metrics report" export the simulated data; "Registered
            image" is unavailable since no real warp was computed.
          </p>
        )}
        <div className="space-y-4">
          <ExportItem label="Registered image" ext=".PNG" onClick={() => handleExport('image')} disabled={data.simulationMode || !data.registeredGlobalUrl} />
          <ExportItem label="Match points" ext=".CSV" onClick={() => handleExport('points')} disabled={!data.matchPoints.length} />
          <ExportItem label="Metrics report" ext=".JSON" onClick={() => handleExport('metrics')} disabled={false} />
        </div>
      </div>
    </div>
  );
}

const ExportItem = ({
  label,
  ext,
  onClick,
  disabled,
}: {
  label: string;
  ext: string;
  onClick: () => void;
  disabled?: boolean;
}) => (
  <div className="flex justify-between items-center border-b border-gray-100 pb-2">
    <div>
      <span className="font-mono text-xs text-amber-600">{ext}</span>
      <div className="text-sm font-medium">{label}</div>
    </div>
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-xs border border-gray-300 px-4 py-1.5 rounded-sm hover:border-black transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      Download
    </button>
  </div>
);
