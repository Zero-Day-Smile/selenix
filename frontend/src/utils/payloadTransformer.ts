// src/utils/payloadTransformer.ts
import { outputUrl, decomposeHomography, type RunResultOk } from '../services/api';
import type { WorkspaceData } from '../workspace_components/types';

// We define SavedRun here so it matches the exact shape we need to save to sessionStorage
export interface SavedRun {
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
  contrastRecovery: WorkspaceData['contrastRecovery'];
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

export function processPipelineResult(
  result: RunResultOk,
  currentData: WorkspaceData,
  matchPoints: any[],
  simulationMode: boolean,
  runDirId: string | null,
  srcDims: { w: number; h: number }
): Partial<WorkspaceData> {
  
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

  const payload: Partial<WorkspaceData> = {
    runDirId,
    simulationMode,
    srcShape: result.src_shape || null,
    refShape: result.ref_shape || null,
    srcProcessedUrl: runDirId ? outputUrl(runDirId, 'src_processed.png') : currentData.sourceUrl,
    refProcessedUrl: runDirId ? outputUrl(runDirId, 'ref_processed.png') : currentData.refUrl,
    registeredGlobalUrl: runDirId && result.warps_computed?.global_homography ? outputUrl(runDirId, 'registered_global.png') : null,
    ssimHeatmapUrl: runDirId && result.warps_computed?.ssim_heatmap ? outputUrl(runDirId, 'ssim_heatmap.png') : null,
    ssimHeatmapDataUrl: runDirId && result.warps_computed?.ssim_data ? outputUrl(runDirId, 'ssim_heatmap_data.json') : null,
    srcShadowOverlayUrl: runDirId && result.warps_computed?.src_shadow_overlay ? outputUrl(runDirId, 'src_shadow_overlay.png') : null,
    refShadowOverlayUrl: runDirId && result.warps_computed?.ref_shadow_overlay ? outputUrl(runDirId, 'ref_shadow_overlay.png') : null,
    shadowAnalysis: result.shadow_analysis ?? null,
    craterDetections: result.crater_detections ? { src: result.crater_detections.src.craters, ref: result.crater_detections.ref.craters } : null,
    srcGeometry: result.ingestion?.src_geometry ?? null,
    refGeometry: result.ingestion?.ref_geometry ?? null,
    contrastRecovery: result.contrast_recovery ?? null,
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
    homography: result.homography || currentData.homography,
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
    homographyQuality: result.homography_quality ? {
      conditionRatio: result.homography_quality.condition_ratio,
      degenerate: result.homography_quality.degenerate,
      threshold: result.homography_quality.threshold,
      scaleDisagreementRatio: result.homography_quality.scale_disagreement_ratio ?? null,
      scaleDisagreementThreshold: result.homography_quality.scale_disagreement_threshold ?? null,
      scaleDisagreementFlagged: result.homography_quality.scale_disagreement_flagged ?? false,
    } : null,
    rotationConsistency: result.rotation_consistency ? { stdDeg: result.rotation_consistency.std_deg, nPairs: result.rotation_consistency.n_pairs } : null,
    ssim: {
      mean: result.ssim?.mean_ssim || 0,
      validRegion: result.ssim?.mean_ssim_valid_region || 0,
      validFraction: result.ssim?.valid_pixel_fraction || 0,
    },
    elapsedSeconds: result.elapsed_seconds || 0,
    matcherUsed: result.matcher_used || '',
    sensorType: result.sensor_type || '',
  };

  if (!simulationMode && runDirId) {
    try {
      const saved: SavedRun = {
        runDirId,
        simulationMode: false,
        sourceMetadata: currentData.sourceMetadata,
        refMetadata: currentData.refMetadata,
        hasRegisteredGlobalUrl: !!result.warps_computed?.global_homography,
        hasSsimHeatmapUrl: !!result.warps_computed?.ssim_heatmap,
        hasSsimHeatmapDataUrl: !!result.warps_computed?.ssim_data,
        hasSrcShadowOverlayUrl: !!result.warps_computed?.src_shadow_overlay,
        hasRefShadowOverlayUrl: !!result.warps_computed?.ref_shadow_overlay,
        ...(payload as any)
      };
      
      sessionStorage.setItem('selenix:lastRun', JSON.stringify(saved));
    } catch (err) {
      console.warn('Could not persist run to sessionStorage:', err);
    }
  }

  return payload;
}