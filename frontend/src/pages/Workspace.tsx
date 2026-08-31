import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Navbar, { type Page } from '../landing_components/Navbar';
import WorkspaceHeader from '../workspace_components/WorkspaceHeader';
import StepUpload from '../workspace_components/StepUpload';
import StepDetection from '../workspace_components/StepDetection';
import StepRANSAC from '../workspace_components/StepRANSAC';
import StepRegistration from '../workspace_components/StepRegistration';
import StepEvaluation from '../workspace_components/StepEvaluation';
import MissionStatusBar from '../workspace_components/MissionStatusBar';
import { useElapsedTimer } from '../workspace_components/useElapsedTimer';
import { useTheme } from '../workspace_components/useTheme';
import { ThemeProvider } from '../workspace_components/ThemeContext';
import { emptyWorkspaceData, type WorkspaceData } from '../workspace_components/types';
import {
  runRegistration,
  runSimulatedPipeline,
  checkBackendHealth,
  fetchMatchPoints,
  outputUrl,
  decomposeHomography,
  PIPELINE_STAGES,
  type RunParams,
  type RunResultOk,
} from '../services/api';

const STEPS = ['Upload', 'Detection', 'RANSAC', 'Registration', 'Evaluation'];

function getImageDims(files: File[]): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const imgFile = files.find((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(f.name));
    if (!imgFile) {
      resolve({ w: 800, h: 600 });
      return;
    }
    const url = URL.createObjectURL(imgFile);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({ w: 800, h: 600 });
    img.src = url;
  });
}

const SESSION_KEY = 'selenix:lastRun';

interface SavedRun {
  runDirId: string;
  simulationMode: false;
  srcShape: [number, number] | null;
  refShape: [number, number] | null;
  sourceMetadata: Record<string, any>;
  refMetadata: Record<string, any>;
  shadowAnalysis: WorkspaceData['shadowAnalysis'];
  craterDetections: WorkspaceData['craterDetections'];
  srcGeometry: WorkspaceData['srcGeometry'];
  refGeometry: WorkspaceData['refGeometry'];
  matchPoints: WorkspaceData['matchPoints'];
  keypointsSource: number;
  keypointsRef: number;
  candidateMatches: number;
  inliers: number;
  outliers: number;
  inlierRatio: number;
  geometryMethod: string;
  matcherSelection: WorkspaceData['matcherSelection'];
  homography: number[][];
  transformParams: WorkspaceData['transformParams'];
  metrics: WorkspaceData['metrics'];
  heatmapData: number[][];
  validation: WorkspaceData['validation'];
  homographyQuality: WorkspaceData['homographyQuality'];
  rotationConsistency: WorkspaceData['rotationConsistency'];
  ssim: WorkspaceData['ssim'];
  elapsedSeconds: number;
  matcherUsed: string;
  sensorType: string;
  hasRegisteredGlobalUrl: boolean;
  hasSsimHeatmapUrl: boolean;
  hasSsimHeatmapDataUrl: boolean;
  hasSrcShadowOverlayUrl: boolean;
  hasRefShadowOverlayUrl: boolean;
}

export default function Workspace({ onNavigate }: { onNavigate?: (page: Page) => void }) {
  const { stepIndex } = useParams();
  const navigate = useNavigate();
  const parsedStep = parseInt(stepIndex || '0', 10);
  const currentStep = isNaN(parsedStep) ? 0 : Math.min(STEPS.length - 1, Math.max(0, parsedStep));
  const setCurrentStep = (step: number) => {
    navigate(`/workspace/step/${step}`);
  };
  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState(-1);
  const [restorableRun, setRestorableRun] = useState<SavedRun | null>(null);
  const tickerRef = useRef<number | null>(null);

  const [data, setData] = useState<WorkspaceData>(emptyWorkspaceData());

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (raw) {
        const saved: SavedRun = JSON.parse(raw);
        if (saved && !saved.simulationMode && saved.runDirId) {
          setRestorableRun(saved);
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }, []);

  const handleRestoreRun = () => {
    if (!restorableRun) return;
    const runDirId = restorableRun.runDirId;
    setData((prev) => ({
      ...prev,
      ...restorableRun,
      sourceFile: [],
      refFile: [],
      sourceUrl: null,
      refUrl: null,
      srcProcessedUrl: outputUrl(runDirId, 'src_processed.png'),
      refProcessedUrl: outputUrl(runDirId, 'ref_processed.png'),
      registeredGlobalUrl: restorableRun.hasRegisteredGlobalUrl ? outputUrl(runDirId, 'registered_global.png') : null,
      ssimHeatmapUrl: restorableRun.hasSsimHeatmapUrl ? outputUrl(runDirId, 'ssim_heatmap.png') : null,
      ssimHeatmapDataUrl: restorableRun.hasSsimHeatmapDataUrl ? outputUrl(runDirId, 'ssim_heatmap_data.json') : null,
      srcShadowOverlayUrl: restorableRun.hasSrcShadowOverlayUrl ? outputUrl(runDirId, 'src_shadow_overlay.png') : null,
      refShadowOverlayUrl: restorableRun.hasRefShadowOverlayUrl ? outputUrl(runDirId, 'ref_shadow_overlay.png') : null,
      matchPointsCsvUrl: outputUrl(runDirId, 'match_points.csv'),
      metricsJsonUrl: outputUrl(runDirId, 'metrics.json'),
    }));
    setRestorableRun(null);
  };

  const handleDiscardRun = () => {
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {}
    setRestorableRun(null);
  };

  const isStepComplete = (step: number): boolean => {
    switch (step) {
      case 0: // Upload
        return (data.sourceFile.length > 0 && data.refFile.length > 0) || !!data.runDirId;
      case 1: // Detection
        return data.candidateMatches > 0;
      case 2: // RANSAC
        return data.inliers > 0 && data.inlierRatio > 0;
      case 3: { // Registration
        const h = data.homography;
        return (
          h[0][0] !== 1 || h[0][1] !== 0 || h[0][2] !== 0 ||
          h[1][0] !== 0 || h[1][1] !== 1 || h[1][2] !== 0 ||
          h[2][0] !== 0 || h[2][1] !== 0 || h[2][2] !== 1
        );
      }
      case 4: // Evaluation
        return data.metrics.rmse > 0 || data.ssim.mean > 0;
      default:
        return false;
    }
  };

  const startOptimisticTicker = () => {
    let i = 0;
    setActiveStageIndex(0);
    tickerRef.current = window.setInterval(() => {
      i += 1;
      if (i >= PIPELINE_STAGES.length - 1) {
        if (tickerRef.current) clearInterval(tickerRef.current);
        return;
      }
      setActiveStageIndex(i);
    }, 700);
  };
  const stopTicker = () => {
    if (tickerRef.current) {
      clearInterval(tickerRef.current);
      tickerRef.current = null;
    }
  };

  const applyResult = (
    result: RunResultOk,
    matchPoints: WorkspaceData['matchPoints'],
    simulationMode: boolean,
    runDirId: string | null,
    srcDims: { w: number; h: number },
    _refDims: { w: number; h: number }
  ) => {
    const { rotationDeg, scale, tx, ty } = decomposeHomography(result.homography);
    const gridN = 4;
    const heatmapData = Array.from({ length: gridN }, () => Array(gridN).fill(0));
    const srcW = result.src_shape?.[1] || srcDims.w;
    const srcH = result.src_shape?.[0] || srcDims.h;
    for (const p of matchPoints) {
      const gx = Math.min(gridN - 1, Math.max(0, Math.floor((p.src_x / srcW) * gridN)));
      const gy = Math.min(gridN - 1, Math.max(0, Math.floor((p.src_y / srcH) * gridN)));
      heatmapData[gy][gx] += 1;
    }

    if (!simulationMode && runDirId) {
      try {
        const saved: SavedRun = {
          runDirId,
          simulationMode: false,
          srcShape: result.src_shape || null,
          refShape: result.ref_shape || null,
          sourceMetadata: data.sourceMetadata,
          refMetadata: data.refMetadata,
          shadowAnalysis: result.shadow_analysis ?? null,
          craterDetections: result.crater_detections
            ? { src: result.crater_detections.src.craters, ref: result.crater_detections.ref.craters }
            : null,
          srcGeometry: result.ingestion?.src_geometry ?? null,
          refGeometry: result.ingestion?.ref_geometry ?? null,
          matchPoints,
          keypointsSource: result.src_keypoints || 0,
          keypointsRef: result.ref_keypoints || 0,
          candidateMatches: result.total_matches || 0,
          inliers: result.inlier_count || 0,
          outliers: (result.total_matches || 0) - (result.inlier_count || 0),
          inlierRatio: result.inlier_ratio || 0,
          geometryMethod: result.geometry_method || 'MAGSAC++',
          matcherSelection: result.matcher_selection || null,
          homography: result.homography || data.homography,
          transformParams: { rotation: rotationDeg, scale, tx, ty, residualRMS: result.rmse_post_refinement || 0 },
          metrics: {
            rmse: result.rmse_post_refinement || 0,
            inlierCount: result.inlier_count || 0,
            inlierRatio: result.inlier_ratio || 0,
            meanReprojectionError: result.rmse_pre_refinement || 0,
            uniformityScore: result.uniformity_score_selected || 0,
            uniformityScoreAllInliers: result.uniformity_score_all_inliers || 0,
            nUniformSelected: result.n_uniform_selected || 0,
            rmseImprovementPct: result.rmse_improvement_pct || 0,
            scaleFactorFromHomography: result.estimated_scale_factor_from_homography || scale,
            scaleFactorDimensionBased: result.estimated_scale_factor_dimension_based || scale,
          },
          heatmapData,
          validation: result.validation || { validated: false, label: '', reasons: [] },
          homographyQuality: result.homography_quality
            ? {
                conditionRatio: result.homography_quality.condition_ratio,
                degenerate: result.homography_quality.degenerate,
                threshold: result.homography_quality.threshold,
                scaleDisagreementRatio: result.homography_quality.scale_disagreement_ratio ?? null,
                scaleDisagreementThreshold: result.homography_quality.scale_disagreement_threshold ?? null,
                scaleDisagreementFlagged: result.homography_quality.scale_disagreement_flagged ?? false,
              }
            : null,
          rotationConsistency: result.rotation_consistency
            ? { stdDeg: result.rotation_consistency.std_deg, nPairs: result.rotation_consistency.n_pairs }
            : null,
          ssim: {
            mean: result.ssim?.mean_ssim || 0,
            validRegion: result.ssim?.mean_ssim_valid_region || 0,
            validFraction: result.ssim?.valid_pixel_fraction || 0,
          },
          elapsedSeconds: result.elapsed_seconds || 0,
          matcherUsed: result.matcher_used || '',
          sensorType: result.sensor_type || '',
          hasRegisteredGlobalUrl: !!result.warps_computed?.global_homography,
          hasSsimHeatmapUrl: !!result.warps_computed?.ssim_heatmap,
          hasSsimHeatmapDataUrl: !!result.warps_computed?.ssim_data,
          hasSrcShadowOverlayUrl: !!result.warps_computed?.src_shadow_overlay,
          hasRefShadowOverlayUrl: !!result.warps_computed?.ref_shadow_overlay,
        };
        sessionStorage.setItem(SESSION_KEY, JSON.stringify(saved));
      } catch (err) {
        console.warn('Could not persist run to sessionStorage:', err);
      }
    }

    setData((prev) => ({
      ...prev,
      runDirId,
      simulationMode,
      srcProcessedUrl: runDirId ? outputUrl(runDirId, 'src_processed.png') : prev.sourceUrl,
      refProcessedUrl: runDirId ? outputUrl(runDirId, 'ref_processed.png') : prev.refUrl,
      srcShape: result.src_shape || null,
      refShape: result.ref_shape || null,
      registeredGlobalUrl:
        runDirId && result.warps_computed?.global_homography ? outputUrl(runDirId, 'registered_global.png') : null,
      ssimHeatmapUrl: runDirId && result.warps_computed?.ssim_heatmap ? outputUrl(runDirId, 'ssim_heatmap.png') : null,
      ssimHeatmapDataUrl: runDirId && result.warps_computed?.ssim_data ? outputUrl(runDirId, 'ssim_heatmap_data.json') : null,
      srcShadowOverlayUrl: runDirId && result.warps_computed?.src_shadow_overlay ? outputUrl(runDirId, 'src_shadow_overlay.png') : null,
      refShadowOverlayUrl: runDirId && result.warps_computed?.ref_shadow_overlay ? outputUrl(runDirId, 'ref_shadow_overlay.png') : null,
      shadowAnalysis: result.shadow_analysis ?? null,
      craterDetections: result.crater_detections
        ? { src: result.crater_detections.src.craters, ref: result.crater_detections.ref.craters }
        : null,
      srcGeometry: result.ingestion?.src_geometry ?? null,
      refGeometry: result.ingestion?.ref_geometry ?? null,
      matchPointsCsvUrl: runDirId ? outputUrl(runDirId, 'match_points.csv') : null,
      metricsJsonUrl: runDirId ? outputUrl(runDirId, 'metrics.json') : null,
      matchPoints,
      keypointsSource: result.src_keypoints || 0,
      keypointsRef: result.ref_keypoints || 0,
      candidateMatches: result.total_matches || 0,
      inliers: result.inlier_count || 0,
      outliers: (result.total_matches || 0) - (result.inlier_count || 0),
      inlierRatio: result.inlier_ratio || 0,
      geometryMethod: result.geometry_method || 'MAGSAC++',
      matcherSelection: result.matcher_selection || null,
      homography: result.homography || prev.homography,
      transformParams: {
        rotation: rotationDeg,
        scale,
        tx,
        ty,
        residualRMS: result.rmse_post_refinement || 0,
      },
      metrics: {
        rmse: result.rmse_post_refinement || 0,
        inlierCount: result.inlier_count || 0,
        inlierRatio: result.inlier_ratio || 0,
        meanReprojectionError: result.rmse_pre_refinement || 0,
        uniformityScore: result.uniformity_score_selected || 0,
        uniformityScoreAllInliers: result.uniformity_score_all_inliers || 0,
        nUniformSelected: result.n_uniform_selected || 0,
        rmseImprovementPct: result.rmse_improvement_pct || 0,
        scaleFactorFromHomography: result.estimated_scale_factor_from_homography || scale,
        scaleFactorDimensionBased: result.estimated_scale_factor_dimension_based || scale,
      },
      heatmapData,
      validation: result.validation || { validated: false, label: '', reasons: [] },
      homographyQuality: result.homography_quality
        ? {
            conditionRatio: result.homography_quality.condition_ratio,
            degenerate: result.homography_quality.degenerate,
            threshold: result.homography_quality.threshold,
            scaleDisagreementRatio: result.homography_quality.scale_disagreement_ratio ?? null,
            scaleDisagreementThreshold: result.homography_quality.scale_disagreement_threshold ?? null,
            scaleDisagreementFlagged: result.homography_quality.scale_disagreement_flagged ?? false,
          }
        : null,
      rotationConsistency: result.rotation_consistency
        ? { stdDeg: result.rotation_consistency.std_deg, nPairs: result.rotation_consistency.n_pairs }
        : null,
      ssim: {
        mean: result.ssim?.mean_ssim || 0,
        validRegion: result.ssim?.mean_ssim_valid_region || 0,
        validFraction: result.ssim?.valid_pixel_fraction || 0,
      },
      elapsedSeconds: result.elapsed_seconds || 0,
      matcherUsed: result.matcher_used || '',
      sensorType: result.sensor_type || '',
    }));
  };

  const runPipeline = async (params: RunParams) => {
    if (data.sourceFile.length === 0 || data.refFile.length === 0) return;
    setLoading(true);
    setRunError(null);
    setBackendAvailable(null);
    setActiveStageIndex(-1);

    const [srcDims, refDims] = await Promise.all([getImageDims(data.sourceFile), getImageDims(data.refFile)]);

    try {
      startOptimisticTicker();
      let result;
      let simulationMode = false;
      let runDirId: string | null = null;
      let matchPoints: WorkspaceData['matchPoints'] = [];

      try {
        result = await runRegistration(data.sourceFile, data.refFile, params);
        stopTicker();
        setActiveStageIndex(PIPELINE_STAGES.length - 1);
        setBackendAvailable(true);

        if (result.status === 'failed') {
          throw new Error(`Pipeline failed: ${result.reason || 'unknown reason'}`);
        }
        runDirId = (result as any).run_dir_id || null;
        if (runDirId) {
          try {
            matchPoints = await fetchMatchPoints(runDirId);
          } catch {
            matchPoints = [];
          }
        }
      } catch (err) {
        console.warn('Backend unavailable, switching to simulation:', err);
        stopTicker();
        setBackendAvailable(false);
        simulationMode = true;
        result = await runSimulatedPipeline(
          params,
          { srcW: srcDims.w, srcH: srcDims.h, refW: refDims.w, refH: refDims.h },
          (idx) => setActiveStageIndex(idx)
        );
        matchPoints = (globalThis as any).__lastSimulatedMatchPoints || [];
      }

      applyResult(result as RunResultOk, matchPoints, simulationMode, runDirId, srcDims, refDims);
      setCurrentStep(1);
    } catch (err) {
      setRunError((err as Error).message || 'Unknown error');
    } finally {
      stopTicker();
      setLoading(false);
    }
  };

  const next = () => {
    if (currentStep < STEPS.length - 1 && isStepComplete(currentStep)) setCurrentStep(currentStep + 1);
  };
  const prev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };
  const nextButtonLabel = () => (currentStep === STEPS.length - 1 ? 'Completed' : `Go to ${STEPS[currentStep + 1]} →`);

  const elapsedMs = useElapsedTimer(loading || currentStep > 0);
  const [theme, toggleTheme] = useTheme();

  return (
    <ThemeProvider theme={theme}>
    <div
      className={`${theme === 'dark' ? 'dark' : ''} relative min-h-screen bg-white dark:bg-[#0a0b0f] text-black dark:text-gray-100 font-sans flex flex-col transition-colors`}
    >
      {/* Real lunar background: a real Chandrayaan-2 TMC-2 orbital strip
          (backend/data/real/chandrayaan2/tmc2_20260803_0049 -- one of this
          project's own real frames, rotated into a wide panorama and tiled
          horizontally), slowly panning left to feel alive without competing
          with the foreground content. Fixed behind everything, low opacity,
          and faded via a gradient overlay so text stays readable in both
          themes. `pointer-events-none` + `aria-hidden` since it's decorative. */}
      <style>{`
        @keyframes moon-bg-pan {
          from { background-position-x: 0; }
          to { background-position-x: -3600px; }
        }
      `}</style>
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none opacity-[0.22] dark:opacity-[0.4]"
        style={{
          backgroundImage: 'url(/assets/moon-bg.jpg)',
          backgroundRepeat: 'repeat-x',
          backgroundSize: 'auto 100%',
          animation: 'moon-bg-pan 90s linear infinite',
          filter: 'grayscale(1)',
        }}
      />
      {/* A light vignette, not a full wash -- just enough to soften the tiled
          strip's top/bottom repeat seams. The real content sits in opaque/
          glass cards above this, so the page canvas itself can stay clearly
          visible without hurting text legibility. */}
      <div
        aria-hidden="true"
        className="fixed inset-0 pointer-events-none bg-gradient-to-b from-white/70 via-transparent to-white/70 dark:from-[#0a0b0f]/70 dark:via-transparent dark:to-[#0a0b0f]/70"
      />
      <div className="relative z-10 flex flex-col min-h-screen">
      <Navbar onNavigate={onNavigate} dark={theme === 'dark'} theme={theme} onToggleTheme={toggleTheme} />
      <MissionStatusBar
        steps={STEPS}
        currentStep={currentStep}
        completedUpTo={[0, 1, 2, 3, 4].filter((s) => s < currentStep || (s === currentStep && isStepComplete(s)))}
        elapsedMs={elapsedMs}
      />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-12">
        {restorableRun && (
          <div className="mb-6 bg-cyan-950/40 border border-cyan-400/40 rounded-sm px-4 py-3 flex flex-wrap items-center justify-between gap-4 text-xs font-mono text-cyan-200 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-cyan-400 font-bold text-sm">↺</span>
              <span>
                A previous backend run (<code className="text-cyan-300 font-semibold">{restorableRun.runDirId}</code>) is available from your session.
              </span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={handleRestoreRun}
                className="px-3 py-1 bg-cyan-400 text-black font-bold rounded-sm hover:bg-cyan-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Restore Run
              </button>
              <button
                onClick={handleDiscardRun}
                className="px-3 py-1 bg-white/10 text-gray-300 font-semibold rounded-sm hover:bg-white/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              >
                Discard
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          <WorkspaceHeader
            stage={`0${currentStep + 1}/05`}
            title={STEPS[currentStep]}
            description={
              currentStep === 0
                ? 'Upload the Source and Reference images. Then run the pipeline to get results.'
                : currentStep === 1
                ? 'Keypoints detected on both images (illumination-normalized). Candidate matches shown.'
                : currentStep === 2
                ? 'MAGSAC++ geometric verification separates inliers (green) from outliers (red).'
                : currentStep === 3
                ? 'Estimated homography warps the source. Use the slider to blend with the reference.'
                : 'Evaluation metrics, validation status, SSIM, and export options.'
            }
          />
          {data.runDirId !== null || data.simulationMode ? (
            <span
              className={`text-[10px] font-mono uppercase tracking-widest px-2 py-1 rounded-sm border h-fit ${
                data.simulationMode
                  ? 'border-amber-400 text-amber-700 bg-amber-50 dark:border-amber-400/40 dark:text-amber-300 dark:bg-amber-400/10'
                  : 'border-green-400 text-green-700 bg-green-50 dark:border-green-400/40 dark:text-green-300 dark:bg-green-400/10'
              }`}
            >
              {data.simulationMode ? '⚡ Simulation mode' : '✅ Backend result'}
            </span>
          ) : null}
        </div>

        <div className="mt-8">
          {currentStep === 0 && (
            <StepUpload
              data={data}
              setData={setData}
              loading={loading}
              onRun={runPipeline}
              runError={runError}
              backendAvailable={backendAvailable}
              activeStageIndex={activeStageIndex}
              checkBackendHealth={checkBackendHealth}
            />
          )}
          {currentStep === 1 && <StepDetection data={data} />}
          {currentStep === 2 && <StepRANSAC data={data} />}
          {currentStep === 3 && <StepRegistration data={data} />}
          {currentStep === 4 && <StepEvaluation data={data} />}
        </div>

        <div className="flex justify-between mt-10 border-t border-gray-200 dark:border-white/10 pt-6">
          <button
            onClick={prev}
            disabled={currentStep === 0}
            aria-label="Navigate to previous step"
            className="px-5 py-2.5 text-xs font-bold tracking-wide rounded-sm border border-gray-300 dark:border-white/15 text-gray-700 dark:text-gray-200 hover:border-cyan-500 dark:hover:border-cyan-400/60 hover:text-cyan-600 dark:hover:text-cyan-300 disabled:bg-gray-100 dark:disabled:bg-white/[0.02] disabled:text-gray-400 dark:disabled:text-gray-600 disabled:border-gray-200 dark:disabled:border-white/5 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            ← Back
          </button>
          <button
            onClick={next}
            disabled={!isStepComplete(currentStep) || currentStep === STEPS.length - 1}
            aria-label={nextButtonLabel()}
            className="px-5 py-2.5 text-xs font-bold tracking-wide rounded-sm bg-cyan-500 dark:bg-cyan-400 text-white dark:text-black hover:bg-cyan-400 dark:hover:bg-cyan-300 disabled:bg-gray-200 dark:disabled:bg-white/10 disabled:text-gray-400 dark:disabled:text-gray-500 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {nextButtonLabel()}
          </button>
        </div>
      </main>
      </div>
    </div>
    </ThemeProvider>
  );
}