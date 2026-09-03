// workspace_components/StepEvaluation.tsx
import React, { useMemo, useRef } from 'react';
import type { WorkspaceData } from './types';
import { matchPointsToCsv } from '../services/api';
import { useOsdViewer } from './useOsdViewer';
import OsdPointOverlay from './OsdPointOverlay';
import SsimHeatmapPlot from './SsimHeatmapPlot';
import InterpretationCard from './InterpretationCard';
import ValidationRadarChart from './ValidationRadarChart';
import ConfidenceHistogram from './ConfidenceHistogram';
import MatchDistributionHeatmap from './MatchDistributionHeatmap';
import { sensorLabelForFilename, INVARIANCE_FINDINGS } from '../services/api';

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

  const validated = data.validation.validated;
  const sunAngleSource = data.shadowAnalysis?.src.sun_angle_context?.solar_incidence_mean_deg ?? null;
  const sunAngleReference = data.shadowAnalysis?.ref.sun_angle_context?.solar_incidence_mean_deg ?? null;

  // Real per-match confidence split, for Groq Call 5 (Chart 4). Honestly
  // null when this run's matcher doesn't report per-match confidence at
  // all, matching ConfidenceHistogram's own "not available" handling.
  const confidenceSplit = useMemo(() => {
    const inliersWithConf = data.matchPoints.filter((p) => p.inlier && p.confidence != null);
    const outliersWithConf = data.matchPoints.filter((p) => !p.inlier && p.confidence != null);
    const mean = (arr: typeof inliersWithConf) => (arr.length ? arr.reduce((s, p) => s + p.confidence, 0) / arr.length : null);
    return {
      inlier_count: inliersWithConf.length,
      outlier_count: outliersWithConf.length,
      mean_inlier_confidence: mean(inliersWithConf),
      mean_outlier_confidence: mean(outliersWithConf),
    };
  }, [data.matchPoints]);

  return (
    <div>
      {/* Real VALIDATED/UNVALIDATED verdict -- backend/pipeline/metrics.py's
          assess_validation() has computed this all along, but no panel in
          this app actually displayed it until now. Never softened: the
          banner's label and color come directly from data.validation,
          the same real object the Groq interpretation below is grounded in. */}
      <div
        className={`mb-6 p-4 rounded-sm border flex items-center justify-between gap-4 flex-wrap ${
          validated
            ? 'bg-green-50 border-green-300 dark:bg-green-400/10 dark:border-green-400/40'
            : 'bg-red-50 border-red-300 dark:bg-red-400/10 dark:border-red-400/40'
        }`}
      >
        <div>
          <span
            className={`text-lg font-bold tracking-wide ${
              validated ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
            }`}
          >
            {validated ? '✅ VALIDATED' : '⚠ UNVALIDATED'}
          </span>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
            {validated
              ? 'This alignment passes every real validation threshold.'
              : 'This alignment does not pass real validation thresholds -- exploratory only, not a confirmed match.'}
          </p>
        </div>
      </div>

      <div className="mb-6">
        <ValidationRadarChart
          inlierCount={data.metrics.inlierCount}
          inlierRatio={data.metrics.inlierRatio}
          rotationConsistencyStd={data.rotationConsistency?.stdDeg ?? null}
          rmsePx={data.metrics.rmse}
          conditionRatio={data.homographyQuality?.conditionRatio ?? null}
          validated={validated}
        />
      </div>

      <div className="mb-8">
        <InterpretationCard
          callType={3}
          prominent
          fields={{
            validated,
            inlier_count: data.metrics.inlierCount,
            inlier_ratio: data.metrics.inlierRatio,
            rotation_consistency_std: data.rotationConsistency?.stdDeg ?? null,
            condition_ratio: data.homographyQuality?.conditionRatio ?? null,
            rmse_px: data.metrics.rmse,
            // Real GSD isn't reliably wired to this stage for an arbitrary
            // pair (see StepEvaluation.tsx comment) -- honestly null rather
            // than a fabricated/wrong-unit estimate.
            positional_uncertainty_metres: null,
            source_sensor: sensorLabelForFilename(data.sourceFile.find((f) => f.name.toLowerCase().endsWith('.img') || f.type.startsWith('image/'))?.name || data.sourceFile[0]?.name) ?? 'unknown sensor',
            reference_sensor: sensorLabelForFilename(data.refFile.find((f) => f.name.toLowerCase().endsWith('.img') || f.type.startsWith('image/'))?.name || data.refFile[0]?.name) ?? 'unknown sensor',
            sun_angle_source: sunAngleSource,
            sun_angle_reference: sunAngleReference,
            failing_thresholds: validated ? [] : data.validation.reasons,
          }}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm flex flex-col">
          <h3 className="text-xs font-bold tracking-wide uppercase mb-4 text-gray-700 dark:text-gray-300">Match distribution (reference image)</h3>
          <div className="relative flex-1 min-h-[320px] overflow-hidden rounded-sm">
            <div ref={distributionElRef} className="w-full h-full border border-gray-200 dark:border-white/10 bg-black" />
            <OsdPointOverlay viewer={distributionViewer} points={distributionPoints} />
          </div>
          <div className="flex items-center gap-4 mt-3 text-[10px] text-gray-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: '#2dd4bf' }}></span> Uniform-selected
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: '#5EEAD4' }}></span> Other inliers
            </span>
          </div>
          <div className="flex justify-between text-[10px] text-gray-400 mt-2">
            <span>
              Uniformity (selected): <span className="font-mono text-gray-800 dark:text-gray-200">{data.metrics.uniformityScore.toFixed(3)}</span>
            </span>
            <span>
              Uniformity (all inliers): <span className="font-mono text-gray-800 dark:text-gray-200">{data.metrics.uniformityScoreAllInliers.toFixed(3)}</span>
            </span>
          </div>
          <div className="text-[10px] text-gray-400 mt-1">
            Uniform-selected matches: <span className="font-mono text-gray-800 dark:text-gray-200">{data.metrics.nUniformSelected}</span>
          </div>

          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-white/10">
            <p className="text-[9px] text-gray-500 uppercase tracking-wide mb-2">
              Same data, color-scaled grid (cell color = match density)
            </p>
            <MatchDistributionHeatmap heatmapData={data.heatmapData} />
          </div>
        </div>

        <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm flex flex-col">
          <h3 className="text-xs font-bold tracking-wide uppercase mb-4 text-gray-700 dark:text-gray-300">SSIM summary</h3>
          <div className="text-xs flex flex-col gap-1 text-gray-700 dark:text-gray-300">
            <div>
              SSIM (valid region): <span className="font-mono text-gray-900 dark:text-gray-100">{data.ssim.validRegion.toFixed(3)}</span>
            </div>
            <div>
              Valid pixel fraction: <span className="font-mono text-gray-900 dark:text-gray-100">{(data.ssim.validFraction * 100).toFixed(1)}%</span>
            </div>
            <div>
              Overall SSIM: <span className="font-mono text-gray-900 dark:text-gray-100">{data.ssim.mean.toFixed(3)}</span>
            </div>
          </div>
          <div className="mt-4 text-xs text-gray-500 border-t border-gray-200 dark:border-white/10 pt-2 pb-3">
            <span>
              Elapsed: {data.elapsedSeconds.toFixed(1)}s · Matcher: {data.matcherUsed} · Geometry: {data.geometryMethod}
            </span>
          </div>
          {(data.ssimHeatmapDataUrl || data.ssimHeatmapUrl) && (
            <div className="border-t border-gray-200 dark:border-white/10 pt-3">
              <h4 className="text-[10px] font-bold tracking-wide uppercase mb-2 text-gray-400">Dissimilarity heatmap</h4>
              {data.ssimHeatmapDataUrl ? (
                <SsimHeatmapPlot
                  dataUrl={data.ssimHeatmapDataUrl}
                  matchPoints={data.matchPoints}
                  meanSsimValidRegion={data.ssim.validRegion}
                  height={420}
                />
              ) : (
                <>
                  <div ref={heatmapElRef} className="w-full h-[360px] border border-gray-200 dark:border-white/10 rounded-sm overflow-hidden bg-black" />
                  <p className="text-[9px] text-gray-500 mt-1">
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

      <div className="mt-8">
        <ConfidenceHistogram matchPoints={data.matchPoints} />
        <div className="mt-4">
          <InterpretationCard
            callType={5}
            fields={confidenceSplit}
          />
        </div>
      </div>

      {/* Real, previously-measured aggregate invariance findings (see the
          separate Invariance Analysis page's own 4 charts, which apply
          across the whole tested dataset, not a single run) cross-
          referenced against this specific pair's own real sun-angle
          delta / scale ratio. */}
      <div className="mt-8 bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm">
        <h3 className="text-xs font-bold tracking-wide uppercase mb-1 text-gray-700 dark:text-gray-300">
          What this means for your pair
        </h3>
        <p className="text-[10px] text-gray-500 mb-4">
          Cross-references this pair's real sun-angle/scale values against the aggregate invariance limits measured
          across this project's dataset (see the Invariance Analysis page for the full 4-chart breakdown).
        </p>
        <InterpretationCard
          callType={4}
          fields={{
            sun_angle_invariance_limit: INVARIANCE_FINDINGS.sunAngleInvarianceLimitDeg,
            scale_invariance_range: INVARIANCE_FINDINGS.scaleInvarianceRange,
            rotation_result: INVARIANCE_FINDINGS.rotationResult,
            this_pair_sun_delta:
              sunAngleSource != null && sunAngleReference != null ? Math.abs(sunAngleSource - sunAngleReference) : null,
            this_pair_scale_ratio: data.metrics.scaleFactorDimensionBased,
            // Real actual verdict for this pair, so Call 4 can never
            // contradict Call 3's real VALIDATED/UNVALIDATED result --
            // the task's own Call 4 field list omitted this, which let
            // Groq guess "expected to be valid" from invariance limits
            // alone in a real test, independent of the actual outcome.
            actual_validated: validated,
          }}
        />
      </div>

      <div className="mt-8 bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm">
        <h3 className="text-xs font-bold tracking-wide uppercase mb-4 text-gray-700 dark:text-gray-300">Export</h3>
        {data.simulationMode && (
          <p className="text-[10px] text-amber-400 mb-3">
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
  <div className="flex justify-between items-center border-b border-gray-200 dark:border-white/10 pb-2">
    <div>
      <span className="font-mono text-xs text-amber-400">{ext}</span>
      <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{label}</div>
    </div>
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-xs border border-gray-300 dark:border-white/15 text-gray-700 dark:text-gray-300 px-4 py-1.5 rounded-sm hover:border-cyan-400/60 hover:text-cyan-300 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      Download
    </button>
  </div>
);
