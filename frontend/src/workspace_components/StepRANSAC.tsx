// workspace_components/StepRANSAC.tsx
import React, { useMemo, useRef, useState } from 'react';
import type { WorkspaceData } from './types';
import { useOsdViewer } from './useOsdViewer';
import OsdPointOverlay from './OsdPointOverlay';
import CorrespondenceCanvas, { type CorrespondencePoint } from './CorrespondenceCanvas';
import Match3DPlot from './Match3DPlot';
import { useCountUp } from './useCountUp';
import InterpretationCard from './InterpretationCard';
import RotationGauge from './RotationGauge';

const LOG_STEPS = 1000;
const INLIER_COLOR = '#4ade80'; // green-400 -- brighter than green-600, pops on the dark workspace background
const OUTLIER_COLOR = '#6b7280';

// Reprojection errors are frequently bimodal -- a tight cluster of genuine
// matches near 0px, then a cliff straight to tens or hundreds of pixels for
// spurious ones (real example: 4 points at ~0px, then a jump to 16px, up to
// 3630px). A fixed 0.5-3.0px linear slider is flat everywhere except right at
// that cliff, so most of the control does nothing observable. Scaling the
// slider log-2/inverse-mapped across the run's own real error range (instead
// of a fixed range) keeps every position meaningfully different.
function useLogThresholdSlider(errors: number[], fallbackDefault = 1.5) {
  const { sliderMin, sliderMax, logMin, logMax, defaultPos } = useMemo(() => {
    const dataMax = errors.length ? Math.max(...errors) : 0;
    const mn = 0.1;
    const mx = Math.max(3.0, dataMax * 1.05, mn * 10);
    const lMin = Math.log10(mn);
    const lMax = Math.log10(mx);
    const posFor = (v: number) => {
      const clamped = Math.min(mx, Math.max(mn, v));
      return Math.round((LOG_STEPS * (Math.log10(clamped) - lMin)) / (lMax - lMin));
    };
    return { sliderMin: mn, sliderMax: mx, logMin: lMin, logMax: lMax, defaultPos: posFor(fallbackDefault) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errors.length ? Math.max(...errors) : 0]);

  const [pos, setPos] = useState(defaultPos);
  const threshold = sliderMax > sliderMin ? Math.pow(10, logMin + (pos / LOG_STEPS) * (logMax - logMin)) : fallbackDefault;
  return { pos, setPos, threshold, sliderMin, sliderMax };
}

export default function StepRANSAC({ data }: { data: WorkspaceData }) {
  const [mode, setMode] = useState<'lines' | 'zoom' | '3d'>('3d');

  const errors = useMemo(
    () => data.matchPoints.map((p) => p.reproj_error_px).filter((e): e is number => e != null),
    [data.matchPoints]
  );
  const { pos: thresholdPos, setPos: setThresholdPos, threshold, sliderMin, sliderMax } = useLogThresholdSlider(errors);

  const srcImg = data.srcProcessedUrl || data.sourceUrl;
  const refImg = data.refProcessedUrl || data.refUrl;
  const srcShape = data.srcShape;
  const refShape = data.refShape;

  const srcElRef = useRef<HTMLDivElement>(null);
  const refElRef = useRef<HTMLDivElement>(null);
  const srcViewer = useOsdViewer(srcElRef, mode === 'zoom' ? srcImg : null);
  const refViewer = useOsdViewer(refElRef, mode === 'zoom' ? refImg : null);

  // Reclassifies each match against the real per-point reprojection error at the
  // chosen threshold. This re-runs the same pass/fail test RANSAC used, just at a
  // different cutoff -- it does NOT re-solve for a new homography, so the points'
  // positions and errors themselves are exactly what the backend computed.
  const hasLiveErrors = data.matchPoints.some((p) => p.reproj_error_px != null);
  const liveStats = useMemo(() => {
    if (!hasLiveErrors) return null;
    const withErr = data.matchPoints.filter((p) => p.reproj_error_px != null) as (typeof data.matchPoints[number] & { reproj_error_px: number })[];
    const inliers = withErr.filter((p) => p.reproj_error_px <= threshold);
    const outliers = withErr.filter((p) => p.reproj_error_px > threshold);
    const meanErr = inliers.length ? inliers.reduce((s, p) => s + p.reproj_error_px, 0) / inliers.length : 0;
    return {
      inlierCount: inliers.length,
      outlierCount: outliers.length,
      inlierRatio: withErr.length ? inliers.length / withErr.length : 0,
      meanReprojError: meanErr,
    };
  }, [data.matchPoints, threshold, hasLiveErrors]);

  const isInlier = (p: typeof data.matchPoints[number]) =>
    hasLiveErrors && p.reproj_error_px != null ? p.reproj_error_px <= threshold : p.inlier;

  // Step 3 styling: outliers recede (small, gray, faded, ~no line); inliers
  // pop forward (bigger, saturated green, full opacity, visible line + glow)
  // so the eye goes straight to the handful of real survivors.
  const dotStyle = (inlier: boolean) =>
    inlier
      ? { color: INLIER_COLOR, opacity: 1, dotRadius: 5 }
      : { color: OUTLIER_COLOR, opacity: 0.45, dotRadius: 2.5 };

  const srcOverlayPoints = useMemo(
    () => data.matchPoints.map((p) => ({ x: p.src_x, y: p.src_y, ...dotStyle(isInlier(p)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.matchPoints, threshold, hasLiveErrors]
  );
  const refOverlayPoints = useMemo(
    () => data.matchPoints.map((p) => ({ x: p.ref_x, y: p.ref_y, ...dotStyle(isInlier(p)) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.matchPoints, threshold, hasLiveErrors]
  );

  const linePoints: CorrespondencePoint[] = useMemo(
    () =>
      data.matchPoints.map((p) => {
        const inlier = isInlier(p);
        return {
          src_x: p.src_x,
          src_y: p.src_y,
          ref_x: p.ref_x,
          ref_y: p.ref_y,
          color: inlier ? INLIER_COLOR : OUTLIER_COLOR,
          opacity: inlier ? 1 : 0.45,
          dotRadius: inlier ? 5 : 2.5,
          lineWidth: inlier ? 1.5 : 0.5,
          lineOpacity: inlier ? 0.85 : 0.08,
          glow: inlier,
          sortWeight: inlier ? 1 : 0,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.matchPoints, threshold, hasLiveErrors]
  );

  const candidateCount = data.matchPoints.length;
  const inlierCount = liveStats ? liveStats.inlierCount : data.inliers;
  const outlierCount = liveStats ? liveStats.outlierCount : data.outliers;

  return (
    <div>
      {/* Step 4: headline funnel stat -- the actual finding of this stage,
          read first, not buried in a caption. */}
      <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm mb-6">
        <div className="font-mono text-2xl md:text-3xl font-bold flex flex-wrap items-baseline gap-x-2">
          <span className="text-black dark:text-white">{candidateCount} candidates</span>
          <span className="text-gray-600">→</span>
          <span style={{ color: INLIER_COLOR }}>{inlierCount} inliers</span>
          <span className="text-gray-500 text-lg md:text-xl">({outlierCount} rejected)</span>
        </div>
        <p className="text-[10px] text-gray-500 mt-1">
          MAGSAC++ geometric verification separates real, geometrically-consistent matches from spurious ones.
        </p>

        {data.rotationConsistency && (
          <div className="mt-2 flex flex-col items-center">
            <p className="text-[9px] text-gray-500 uppercase tracking-wide mb-1">Rotation consistency</p>
            <RotationGauge
              rotationDeg={data.rotationConsistency.stdDeg}
              greenMax={15}
              amberMax={30}
              maxDeg={180}
              greenLabel="consistent"
              amberLabel="caution"
              redLabel="inconsistent"
            />
          </div>
        )}

        <div className="mt-4">
          <InterpretationCard
            callType={2}
            fields={{
              candidate_matches: candidateCount,
              inlier_count: inlierCount,
              outlier_count: outlierCount,
              inlier_ratio: liveStats ? liveStats.inlierRatio : data.inlierRatio,
              rotation_consistency_std: data.rotationConsistency?.stdDeg ?? null,
              rotation_consistency_threshold: 15.0,
              condition_ratio: data.homographyQuality?.conditionRatio ?? null,
              condition_ratio_threshold: 5.0,
            }}
          />
        </div>
      </div>

      <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold tracking-wide uppercase text-gray-700 dark:text-gray-300">Inliers vs outliers</h3>
          <ModeToggle mode={mode} setMode={setMode} />
        </div>

        {mode === 'lines' && srcImg && refImg && srcShape && refShape ? (
          <CorrespondenceCanvas srcUrl={srcImg} refUrl={refImg} srcShape={srcShape} refShape={refShape} points={linePoints} capLabel="match" />
        ) : mode === '3d' ? (
          <Match3DPlot
            refUrl={refImg}
            refShape={refShape}
            matchPoints={data.matchPoints}
            srcUrl={srcImg}
            srcShape={srcShape}
            reprojThresholdPx={threshold}
          />
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Source</span>
              <div className="relative h-[380px] overflow-hidden rounded-sm">
                <div ref={srcElRef} className="w-full h-full border border-gray-200 dark:border-white/10 bg-black" />
                <OsdPointOverlay viewer={srcViewer} points={srcOverlayPoints} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Reference</span>
              <div className="relative h-[380px] overflow-hidden rounded-sm">
                <div ref={refElRef} className="w-full h-full border border-gray-200 dark:border-white/10 bg-black" />
                <OsdPointOverlay viewer={refViewer} points={refOverlayPoints} />
              </div>
            </div>
          </div>
        )}

        {mode !== '3d' && (
          <div className="flex justify-center gap-4 mt-4 text-xs text-gray-700 dark:text-gray-300">
            <span className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: INLIER_COLOR }}></span> Inlier
            </span>
            <span className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full opacity-45" style={{ background: OUTLIER_COLOR }}></span> Outlier
            </span>
          </div>
        )}
        {mode !== '3d' && (
          <p className="text-[10px] text-gray-500 mt-2 text-center">
            {mode === 'lines'
              ? 'Inliers are drawn bold and connected; outliers fade into the background.'
              : "Each pane pans/zooms independently — markers are drawn in each pane's own image-pixel space, so they stay correctly placed as you navigate."}
          </p>
        )}
      </div>

      <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm mt-6">
        <h3 className="text-xs font-bold tracking-wide uppercase mb-4 text-gray-700 dark:text-gray-300">
          {data.geometryMethod || 'Geometric verification'} settings
        </h3>
        <div className="flex flex-col md:flex-row gap-6">
          <div className="flex-1">
            <label className="text-xs text-gray-400 block mb-1">
              Reprojection threshold (px): {threshold < 1 ? threshold.toFixed(3) : threshold.toFixed(2)}
            </label>
            <input
              type="range"
              min="0"
              max={LOG_STEPS}
              step="1"
              value={thresholdPos}
              onChange={(e) => setThresholdPos(parseInt(e.target.value, 10))}
              className="w-full accent-cyan-400"
              disabled={!hasLiveErrors}
            />
            <div className="flex justify-between text-[9px] text-gray-500 font-mono mt-0.5">
              <span>{sliderMin.toFixed(1)}px</span>
              <span>{sliderMax.toFixed(1)}px</span>
            </div>
            <p className="text-[10px] text-gray-500 mt-1">
              {hasLiveErrors
                ? "Log-scaled to this run's actual error range so every position produces a visible change — reclassifies each match by its real per-point reprojection error at this cutoff. It doesn't re-solve for a new homography, only which matches count as inliers."
                : 'Disabled — per-point reprojection error is unavailable for this run, so the inlier/outlier split above reflects the threshold actually used by the backend.'}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
          <Stat label="Inliers" value={inlierCount} />
          <Stat label="Outliers" value={outlierCount} />
          <Stat label="Inlier ratio" value={`${((liveStats ? liveStats.inlierRatio : data.inlierRatio) * 100).toFixed(1)}%`} />
          <Stat
            label={liveStats ? 'Mean reproj. error (at cutoff)' : 'Mean reproj. error (pre-refine)'}
            value={`${(liveStats ? liveStats.meanReprojError : data.metrics.meanReprojectionError).toFixed(2)} px`}
          />
        </div>
      </div>
    </div>
  );
}

const ModeToggle = ({ mode, setMode }: { mode: 'lines' | 'zoom' | '3d'; setMode: (m: 'lines' | 'zoom' | '3d') => void }) => (
  <div className="flex text-[10px] font-mono uppercase tracking-wide border border-gray-300 dark:border-white/15 rounded-sm overflow-hidden">
    <button
      onClick={() => setMode('lines')}
      className={`px-3 py-1.5 ${mode === 'lines' ? 'bg-cyan-400 text-black' : 'bg-gray-50 dark:bg-white/[0.03] text-gray-400 hover:bg-white/10'}`}
    >
      Correspondence lines
    </button>
    <button
      onClick={() => setMode('zoom')}
      className={`px-3 py-1.5 border-l border-gray-300 dark:border-white/15 ${mode === 'zoom' ? 'bg-cyan-400 text-black' : 'bg-gray-50 dark:bg-white/[0.03] text-gray-400 hover:bg-white/10'}`}
    >
      Zoom &amp; pan
    </button>
    <button
      onClick={() => setMode('3d')}
      className={`px-3 py-1.5 border-l border-gray-300 dark:border-white/15 ${mode === '3d' ? 'bg-cyan-400 text-black' : 'bg-gray-50 dark:bg-white/[0.03] text-gray-400 hover:bg-white/10'}`}
    >
      3D
    </button>
  </div>
);

const Stat = ({ label, value }: { label: string; value: string | number }) => {
  const isNumeric = typeof value === 'number';
  const animated = useCountUp(isNumeric ? value : 0);
  return (
    <div className="bg-gray-50 dark:bg-white/[0.03] p-3 border border-gray-200 dark:border-white/10 rounded-sm">
      <div className="font-mono text-xl font-bold text-black dark:text-white tabular-nums">{isNumeric ? animated : value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
    </div>
  );
};
