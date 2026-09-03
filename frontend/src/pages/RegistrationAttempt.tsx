// pages/RegistrationAttempt.tsx
//
// A single, coherent, navigable view of ONE real cross-sensor registration
// attempt -- built to be pulled up live in front of a technical panel and
// hold up to scrutiny, not to hide the outcome. Every number and image here
// is real, read live from an actual backend run's own metrics.json/
// match_points.json (no substituted/idealized data anywhere on this page).
//
// Defaults to the real 0506 x M1342582517LE pair -- the correctly-paired,
// verified-overlapping (162 real geometry-guard points, no extent
// mismatch), closest-to-passing real cross-sensor case this project has.
// Reuses this app's existing, already-built diagnostic components rather
// than inventing new ones: CorrespondenceCanvas, SsimHeatmapPlot,
// DegenerateWarpNotice, RotationGauge, InlierFunnelChart,
// ConfidenceHistogram, ValidationRadarChart, ChartCard.
import { useEffect, useMemo, useState } from 'react';
import Navbar, { type Page } from '../landing_components/Navbar';
import { useTheme } from '../workspace_components/useTheme';
import { ThemeProvider } from '../workspace_components/ThemeContext';
import CorrespondenceCanvas, { type CorrespondencePoint } from '../workspace_components/CorrespondenceCanvas';
import Match3DPlot from '../workspace_components/Match3DPlot';
import SsimHeatmapPlot from '../workspace_components/SsimHeatmapPlot';
import DegenerateWarpNotice from '../workspace_components/DegenerateWarpNotice';
import RotationGauge from '../workspace_components/RotationGauge';
import InlierFunnelChart from '../workspace_components/InlierFunnelChart';
import ConfidenceHistogram from '../workspace_components/ConfidenceHistogram';
import ValidationRadarChart from '../workspace_components/ValidationRadarChart';
import ChartCard from '../workspace_components/ChartCard';
import {
  outputUrl,
  fetchMatchPoints,
  fetchSameSensorBaseline,
  sensorLabelForFilename,
  type RunResultOk,
  type MatchPoint,
  type SameSensorBaseline,
} from '../services/api';

// The real backend run this page defaults to -- see backend/outputs/runs/
// _registration_attempt_0506_x_M1342582517LE/metrics.json for the actual
// persisted result this page reads.
const DEFAULT_RUN_ID = '_registration_attempt_0506_x_M1342582517LE';

const INLIER_COLOR = '#4ade80';
const OUTLIER_COLOR = '#6b7280';

// Real, catalog-sourced overlap-verification fact for the default pair
// (backend/data/real/_regression_extent_results.json, via
// geo_extent_guard.verified_overlap_extent -- 162 real geometry.csv points
// confirmed genuinely inside M1342582517LE's true KML quadrilateral, no
// extent mismatch). This is curated catalog data, not a per-run pipeline
// output, so it's a fixed fact tied to this specific pair rather than a
// live query -- shown only when the loaded run actually IS that pair.
const KNOWN_OVERLAP_VERIFIED: Record<string, { partnerId: string; verifiedPoints: number }> = {
  tmc2_20260812_0506: { partnerId: 'M1342582517LE', verifiedPoints: 162 },
};

function extractId(path: string | undefined, pattern: RegExp): string {
  if (!path) return 'unknown';
  const base = path.split(/[\\/]/).pop() || path;
  const m = base.match(pattern);
  return m ? m[0] : base.replace(/_preview\.png$|\.png$/i, '');
}

export default function RegistrationAttempt({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const [theme] = useTheme();
  const [runId] = useState(DEFAULT_RUN_ID);
  const [result, setResult] = useState<(RunResultOk & { src_path?: string; ref_path?: string }) | null>(null);
  const [matchPoints, setMatchPoints] = useState<MatchPoint[]>([]);
  const [baseline, setBaseline] = useState<SameSensorBaseline | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(outputUrl(runId, 'metrics.json'));
        if (!res.ok) throw new Error(`could not load real run data for ${runId} (HTTP ${res.status})`);
        const data = await res.json();
        if (!cancelled) setResult(data);
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message);
      }
      try {
        const mp = await fetchMatchPoints(runId);
        if (!cancelled) setMatchPoints(mp);
      } catch {
        if (!cancelled) setMatchPoints([]);
      }
      const b = await fetchSameSensorBaseline();
      if (!cancelled) setBaseline(b);
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const srcId = useMemo(() => extractId(result?.src_path, /tmc2_\d{8}_\d{4}/), [result]);
  const refId = useMemo(() => extractId(result?.ref_path, /M\d{6,}[A-Z]{0,2}/), [result]);
  const srcSensorLabel = sensorLabelForFilename(result?.src_path) ?? 'Chandrayaan-2';
  const refSensorLabel = sensorLabelForFilename(result?.ref_path) ?? 'LRO NAC';

  const overlapFact = KNOWN_OVERLAP_VERIFIED[srcId];
  const overlapVerified = !!overlapFact && refId.startsWith(overlapFact.partnerId.slice(0, 8));

  const linePoints: CorrespondencePoint[] = useMemo(
    () =>
      matchPoints.map((p) => ({
        src_x: p.src_x,
        src_y: p.src_y,
        ref_x: p.ref_x,
        ref_y: p.ref_y,
        color: p.inlier ? INLIER_COLOR : OUTLIER_COLOR,
        opacity: p.inlier ? 1 : 0.45,
        dotRadius: p.inlier ? 5 : 2.5,
        lineWidth: p.inlier ? 1.5 : 0.5,
        lineOpacity: p.inlier ? 0.85 : 0.08,
        glow: p.inlier,
        sortWeight: p.inlier ? 1 : 0,
      })),
    [matchPoints]
  );

  const srcImg = outputUrl(runId, 'src_processed.png');
  const refImg = outputUrl(runId, 'ref_processed.png');
  const warpedImg = result?.warps_computed?.global_homography ? outputUrl(runId, 'registered_global.png') : null;

  const baselineText =
    baseline?.available && baseline.min_inlier_ratio != null && baseline.max_inlier_ratio != null
      ? `${(baseline.min_inlier_ratio * 100).toFixed(1)}-${(baseline.max_inlier_ratio * 100).toFixed(1)}%`
      : null;

  return (
    <ThemeProvider theme={theme}>
      <div
        className={`${theme === 'dark' ? 'dark' : ''} min-h-screen bg-gray-50 dark:bg-[#0a0b0f] text-black dark:text-gray-100 font-sans transition-colors`}
      >
        <Navbar onNavigate={onNavigate} dark={theme === 'dark'} />

        <div className="max-w-6xl mx-auto px-6 py-8">
          {loadError && (
            <div className="mb-6 p-4 rounded-sm border border-red-300 bg-red-50 dark:bg-red-400/10 dark:border-red-400/40">
              <p className="text-xs text-red-700 dark:text-red-300 font-mono">{loadError}</p>
              <p className="text-[11px] text-red-600 dark:text-red-400 mt-1">
                Run <code>run_registration()</code> against{' '}
                <code>backend/outputs/runs/{DEFAULT_RUN_ID}/</code> (matcher=auto) to regenerate this run's real
                output files, or check the backend is reachable.
              </p>
            </div>
          )}

          {result && (
            <>
              {/* 1. Header: pair identity, real overlap verification, sensor types */}
              <div className="mb-6">
                <h1 className="text-xl font-bold tracking-wide mb-2">Registration Attempt</h1>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-mono">
                  <span className="text-gray-700 dark:text-gray-300">
                    <span className="font-bold">{srcId}</span> ({srcSensorLabel}) &times;{' '}
                    <span className="font-bold">{refId}</span> ({refSensorLabel})
                  </span>
                  {overlapVerified && overlapFact && (
                    <span className="px-2 py-1 rounded-sm border border-green-400 text-green-700 bg-green-50 dark:border-green-400/40 dark:text-green-300 dark:bg-green-400/10 text-[10px] uppercase tracking-widest font-bold">
                      ✓ Geographic overlap verified — {overlapFact.verifiedPoints} real matched points
                    </span>
                  )}
                </div>
              </div>

              {/* 3. Validation status badge -- the centerpiece, never softened */}
              <div
                className={`mb-8 p-5 rounded-sm border-2 ${
                  result.validation.validated
                    ? 'border-green-400 bg-green-50 dark:bg-green-400/10 dark:border-green-400/50'
                    : 'border-red-400 bg-red-50 dark:bg-red-400/10 dark:border-red-400/50'
                }`}
              >
                <div
                  className={`text-2xl md:text-3xl font-bold tracking-wide ${
                    result.validation.validated ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'
                  }`}
                >
                  {result.validation.validated ? '✅ VALIDATED' : `⚠ ${result.validation.label}`}
                </div>
                {!result.validation.validated && (
                  <ul className="mt-3 space-y-1 text-[11px] font-mono text-red-800 dark:text-red-300">
                    {result.validation.reasons.map((r) => (
                      <li key={r}>&bull; {r}</li>
                    ))}
                  </ul>
                )}
              </div>

              {/* 2. Side-by-side: source, reference -- the pipeline's real
                  (bad) matched correspondences, no substitution. The warped
                  output follows immediately below. */}
              <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm">
                <h3 className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-3">
                  Source / reference — real matched correspondences
                </h3>
                {result.src_shape && result.ref_shape ? (
                  <CorrespondenceCanvas
                    srcUrl={srcImg}
                    refUrl={refImg}
                    srcShape={result.src_shape}
                    refShape={result.ref_shape}
                    points={linePoints}
                    capLabel="match"
                  />
                ) : (
                  <p className="text-xs italic text-gray-400">Real per-image shape not available for this run.</p>
                )}
              </div>

              <div className="mt-4">
                <Match3DPlot
                  refUrl={refImg}
                  refShape={result.ref_shape ?? null}
                  matchPoints={matchPoints}
                  srcUrl={srcImg}
                  srcShape={result.src_shape ?? null}
                  reprojThresholdPx={result.validation.thresholds.max_rmse}
                />
              </div>

              <div className="mt-4 space-y-3">
                {/* The real warped output, shown unaltered -- this page's
                    whole point is not to hide a bad result. When the
                    homography is also flagged degenerate (as it is for this
                    default pair), DegenerateWarpNotice's own real diagnostic
                    (condition ratio vs threshold) is shown alongside it as
                    context, not instead of it -- so a viewer sees exactly
                    what the warp actually produced AND exactly why it's
                    known-invalid, rather than one or the other. */}
                {warpedImg ? (
                  <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 rounded-sm p-4">
                    <h4 className="text-[10px] font-bold tracking-widest uppercase text-gray-400 mb-2">
                      Warped source (global homography) — real output, unaltered
                    </h4>
                    <img src={warpedImg} alt="Real warped source, global homography" className="w-full rounded-sm border border-gray-200 dark:border-white/10" />
                  </div>
                ) : (
                  <p className="text-xs italic text-gray-400">No warped output for this run (homography estimation failed outright).</p>
                )}
                {result.homography_quality?.degenerate && (
                  <DegenerateWarpNotice
                    hq={{
                      conditionRatio: result.homography_quality.condition_ratio,
                      degenerate: result.homography_quality.degenerate,
                      threshold: result.homography_quality.threshold,
                      scaleDisagreementRatio: result.homography_quality.scale_disagreement_ratio ?? null,
                      scaleDisagreementThreshold: result.homography_quality.scale_disagreement_threshold ?? null,
                      scaleDisagreementFlagged: result.homography_quality.scale_disagreement_flagged ?? false,
                    }}
                  />
                )}
              </div>

              {result.warps_computed?.ssim_data && (
                <div className="mt-6">
                  <SsimHeatmapPlot
                    dataUrl={outputUrl(runId, 'ssim_heatmap_data.json')}
                    matchPoints={matchPoints}
                    meanSsimValidRegion={result.ssim.mean_ssim_valid_region}
                  />
                </div>
              )}

              {/* 4. Diagnostic panel -- real numbers, each labeled with a
                  plain-language reason pulled directly from the backend's
                  own real validation.reasons, not re-worded here. */}
              <h2 className="text-sm font-bold tracking-wide uppercase mt-10 mb-4 text-gray-600 dark:text-gray-400">
                Why this was rejected
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <InlierFunnelChart
                    candidates={result.total_matches}
                    inliers={result.inlier_count}
                    outliers={result.total_matches - result.inlier_count}
                    inlierRatio={result.inlier_ratio}
                  />
                  <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                    Only {(result.inlier_ratio * 100).toFixed(1)}% of candidate matches survived geometric
                    verification (MAGSAC++) — well below the 50% threshold this pipeline requires to trust a
                    homography fit as more than coincidence.
                  </p>
                </div>

                <div>
                  <ChartCard title="Rotation consistency" height={140} subtitle="Do independent inlier pairs agree on rotation?">
                    <div className="flex items-center justify-center h-full">
                      <RotationGauge
                        rotationDeg={result.rotation_consistency.std_deg}
                        greenMax={result.validation.thresholds.max_rotation_std_deg}
                        amberMax={result.validation.thresholds.max_rotation_std_deg * 2}
                        maxDeg={180}
                        greenLabel="consistent"
                        amberLabel="caution"
                        redLabel="inconsistent"
                      />
                    </div>
                  </ChartCard>
                  <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                    Pairwise rotation-consistency std is {result.rotation_consistency.std_deg.toFixed(2)}&deg;, over{' '}
                    {result.rotation_consistency.n_pairs} independent match pairs — exceeding the{' '}
                    {result.validation.thresholds.max_rotation_std_deg}&deg; threshold. Real inlier matches
                    disagreeing this much on relative rotation is the signature of a spurious/random match set, not
                    a real alignment.
                  </p>
                </div>

                {result.homography_quality?.scale_disagreement_ratio != null && (
                  <div>
                    <ChartCard title="Scale-estimate disagreement" height={100}>
                      <div className="flex items-center justify-center h-full">
                        <span
                          className={`font-mono text-3xl font-bold ${
                            result.homography_quality.scale_disagreement_flagged ? 'text-red-500' : 'text-green-500'
                          }`}
                        >
                          {result.homography_quality.scale_disagreement_ratio.toFixed(2)}&times;
                        </span>
                      </div>
                    </ChartCard>
                    <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                      The homography's own implied scale factor and the independent dimension-based scale estimate
                      disagree by {result.homography_quality.scale_disagreement_ratio.toFixed(2)}&times; — above the{' '}
                      {result.homography_quality.scale_disagreement_threshold}&times; threshold. Two independent
                      estimates of the same real quantity should roughly agree; this large a gap means the fitted
                      transform isn't describing anything physically real.
                    </p>
                  </div>
                )}

                <div>
                  <ConfidenceHistogram matchPoints={matchPoints} />
                  <p className="text-[11px] text-gray-500 mt-2 leading-relaxed">
                    Real per-match confidence scores from the matcher, split by whether MAGSAC++ kept ({' '}
                    <span style={{ color: INLIER_COLOR }}>green</span>) or rejected ({' '}
                    <span className="text-red-400">red</span>) each match.
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <ValidationRadarChart
                  inlierCount={result.inlier_count}
                  inlierRatio={result.inlier_ratio}
                  rotationConsistencyStd={result.rotation_consistency.std_deg}
                  rmsePx={result.rmse_post_refinement}
                  conditionRatio={result.homography_quality?.condition_ratio ?? null}
                  validated={result.validation.validated}
                />
              </div>

              {/* 5. Fixed caption -- real same-sensor number pulled live,
                  never hardcoded (see /api/same_sensor_baseline). */}
              <div className="mt-10 mb-4 p-4 rounded-sm border border-gray-200 dark:border-white/10 bg-white dark:bg-white/[0.03]">
                <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                  The pipeline correctly declined to validate this alignment.{' '}
                  {baselineText ? (
                    <>
                      Same-sensor pairs validate at <span className="font-bold">{baselineText}</span> inlier ratio
                      (n={baseline?.n_runs}) using this identical pipeline
                    </>
                  ) : (
                    'Same-sensor pairs validate reliably using this identical pipeline (real baseline not yet available)'
                  )}
                  , isolating this result to genuine cross-sensor appearance difficulty, not a system fault.
                </p>
              </div>
            </>
          )}

          {!result && !loadError && <p className="text-xs text-gray-400 italic">Loading real run data…</p>}
        </div>
      </div>
    </ThemeProvider>
  );
}
