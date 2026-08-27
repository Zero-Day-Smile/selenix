import React, { useState, useRef } from 'react';
import Navbar from '../landing_components/Navbar';
import WorkspaceHeader from '../workspace_components/WorkspaceHeader';
import StepUpload from '../workspace_components/StepUpload';
import StepDetection from '../workspace_components/StepDetection';
import StepRANSAC from '../workspace_components/StepRANSAC';
import StepRegistration from '../workspace_components/StepRegistration';
import StepEvaluation from '../workspace_components/StepEvaluation';
import { emptyWorkspaceData, type WorkspaceData } from '../workspace_components/types';
import {
  runRegistration,
  runSimulatedPipeline,
  checkBackendHealth,
  fetchMatchPoints,
  outputUrl,
  decomposeHomography,
  isSuccessResult,
  PIPELINE_STAGES,
  type RunParams,
  type RunResultOk,
} from '../services/api';

const STEPS = ['Upload', 'Detection', 'RANSAC', 'Registration', 'Evaluation'];

function getImageDims(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ w: img.naturalWidth, h: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve({ w: 800, h: 600 });
    img.src = url;
  });
}

export default function Workspace({ onNavigate }: { onNavigate: (page: 'landing' | 'workspace') => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [backendAvailable, setBackendAvailable] = useState<boolean | null>(null);
  const [activeStageIndex, setActiveStageIndex] = useState(-1);
  const tickerRef = useRef<number | null>(null);

  const [data, setData] = useState<WorkspaceData>(emptyWorkspaceData());

  const isStepComplete = (step: number): boolean => {
    switch (step) {
      case 0: // Upload
        return !!data.sourceFile && !!data.refFile;
      case 1: // Detection
        // keypointsSource/keypointsRef legitimately report 0 for the deep_loftr
        // matcher (a dense/transformer matcher with no discrete keypoint-detection
        // stage the way SIFT has -- 0 is an honest backend value, not a failure).
        // Gating navigation on it stuck the user on this step forever for any
        // real pair that lands on LoFTR, which is most of our real Chandrayaan-2/
        // NAC pairs. candidateMatches > 0 is the actually meaningful signal.
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

  // Drives the "in progress" stage list while a real network call is in
  // flight. We don't get real granular progress from a single POST, so this
  // ticks through the named stages up to the second-to-last one and holds
  // there until the response actually arrives — it never claims completion
  // that hasn't happened.
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
    refDims: { w: number; h: number }
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
      // Only ever set from a real backend result -- the simulated fallback
      // pipeline never fabricates shadow analysis (it doesn't run real
      // pixel statistics on the actual uploaded image), so this stays null
      // in simulation mode rather than showing made-up shadow content.
      shadowAnalysis: result.shadow_analysis ?? null,
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
          }
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
    if (!data.sourceFile || !data.refFile) return;
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

  return (
    <div className="min-h-screen bg-[#f4f4f4] text-black font-sans flex flex-col">
      <Navbar onNavigate={onNavigate} />
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-12">
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
                  ? 'border-amber-400 text-amber-600 bg-amber-50'
                  : 'border-green-400 text-green-700 bg-green-50'
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

        <div className="flex justify-between mt-10 border-t border-gray-200 pt-6">
          <button
            onClick={prev}
            disabled={currentStep === 0}
            className="px-5 py-2.5 text-xs font-bold tracking-wide rounded-sm border border-gray-300 hover:border-black disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          >
            ← Back
          </button>
          <button
            onClick={next}
            disabled={!isStepComplete(currentStep) || currentStep === STEPS.length - 1}
            className="px-5 py-2.5 text-xs font-bold tracking-wide rounded-sm bg-black text-white hover:opacity-80 disabled:bg-gray-300 disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            {nextButtonLabel()}
          </button>
        </div>
      </main>
    </div>
  );
}