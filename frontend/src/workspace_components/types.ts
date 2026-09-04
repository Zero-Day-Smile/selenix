// workspace_components/types.ts
import type { MatchPoint, ShadowAnalysis } from '../services/api';

export interface WorkspaceData {
  sourceFile: File[];
  refFile: File[];
  sourceUrl: string | null; // local preview (object URL) of the raw upload
  refUrl: string | null;
  sourceMetadata: Record<string, any>;
  refMetadata: Record<string, any>;

  // run identity / provenance
  runDirId: string | null;
  simulationMode: boolean;

  // backend-processed images (post ingestion + illumination normalization).
  // These are what match-point coordinates are actually expressed against —
  // prefer them over the raw upload preview whenever available.
  srcProcessedUrl: string | null;
  refProcessedUrl: string | null;
  srcShape: [number, number] | null; // [h, w]
  refShape: [number, number] | null;

  // output artifacts
  registeredGlobalUrl: string | null;
  ssimHeatmapUrl: string | null;
  ssimHeatmapDataUrl: string | null;
  matchPointsCsvUrl: string | null;
  metricsJsonUrl: string | null;

  // Layer A shadow analysis (transient, "at time of capture" only -- see
  // ShadowOverlay.tsx for why this must never be labeled PSR/permanent)
  srcShadowOverlayUrl: string | null;
  refShadowOverlayUrl: string | null;
  shadowAnalysis: ShadowAnalysis | null;

  // Real, best-effort label-derived ground-sample-distance info (see
  // services/api.ts's RunResultOk.ingestion) -- frequently empty, never
  // normalized to a common unit. Used only for real-metadata display
  // (e.g. CrossSensorCompare), never for any actual pixel-space math.
  srcGeometry: Record<string, string> | null;
  refGeometry: Record<string, string> | null;

  // Real std(after)/std(before) global-contrast ratio (backend/pipeline/
  // preprocessing.py::contrast_recovery_ratio), computed on the same
  // src/ref arrays illumination_normalize() processed for this run.
  // Absent (null) for runs made before this field existed or in
  // simulation mode -- never fabricate a figure when this is null.
  contrastRecovery: { src: number; ref: number } | null;

  // Real YOLOv8 crater detections (backend/pipeline/crater_detector.py),
  // in the SAME processed-image pixel space as matchPoints below -- distinct
  // from the catalog-crater lookup (CraterPinOverlay), which only covers the
  // 4 real Chandrayaan-2 frames with known geometry. This runs on every pair.
  craterDetections: {
    src: { cx: number; cy: number; radius_px: number; confidence: number }[];
    ref: { cx: number; cy: number; radius_px: number; confidence: number }[];
  } | null;

  // raw match points (all matches, inlier + outlier), in processed-image pixel space
  matchPoints: MatchPoint[];

  // detection
  keypointsSource: number;
  keypointsRef: number;
  candidateMatches: number;

  // RANSAC / geometric verification
  inliers: number;
  outliers: number;
  inlierRatio: number; // 0..1 fraction
  geometryMethod: string;
  matcherSelection: (Record<string, number | string> & { chosen?: string }) | null;

  // registration
  homography: number[][];
  transformParams: {
    rotation: number; // degrees, decomposed from homography
    scale: number; // decomposed from homography
    tx: number;
    ty: number;
    residualRMS: number;
  };

  // evaluation
  metrics: {
    rmse: number;
    inlierCount: number;
    inlierRatio: number; // 0..1 fraction
    meanReprojectionError: number;
    uniformityScore: number;
    uniformityScoreAllInliers: number;
    nUniformSelected: number;
    rmseImprovementPct: number;
    scaleFactorFromHomography: number;
    scaleFactorDimensionBased: number;
  };
  heatmapData: number[][];
  validation: {
    validated: boolean;
    label: string;
    reasons: string[];
  };
  // Separate from `validation` on purpose: a homography can be near-singular
  // (warps the source into a split radiating-streak pattern -- parts thrown
  // toward the projective line at infinity) even when other metrics don't
  // immediately flag it. Rendering that raw warp/heatmap would be
  // indistinguishable from a rendering bug, so any panel showing the warped
  // image or SSIM heatmap must check this first and show an explicit
  // degenerate-state message instead of the image when true.
  homographyQuality: {
    conditionRatio: number;
    degenerate: boolean;
    threshold: number;
    // Second, independent cross-check (see backend/pipeline/metrics.py::
    // scale_disagreement_ratio) -- absent for manual-seed runs, which have
    // no dimension-based scale estimate to compare against.
    scaleDisagreementRatio: number | null;
    scaleDisagreementThreshold: number | null;
    scaleDisagreementFlagged: boolean;
  } | null;
  // Real pairwise rotation-consistency diagnostic (backend/pipeline/
  // metrics.py::pairwise_rotation_consistency) -- this project's own
  // primary, load-bearing signal for distinguishing a real alignment from
  // a spurious match set (see rotation_consistency in services/api.ts).
  // Was computed by the backend all along but never previously
  // propagated into WorkspaceData -- added for the Groq interpretation
  // cards (Calls 2 and 3), which both need it.
  rotationConsistency: { stdDeg: number; nPairs: number } | null;
  ssim: {
    mean: number;
    validRegion: number;
    validFraction: number;
  };
  elapsedSeconds: number;
  matcherUsed: string;
  sensorType: string;
}

export const emptyWorkspaceData = (): WorkspaceData => ({
  sourceFile: [],
  refFile: [],
  sourceUrl: null,
  refUrl: null,
  sourceMetadata: { sensor: 'OHRC', date: '2026-03-18', sunElevation: 31.8, resolution: 0.32 },
  refMetadata: { sensor: 'LRO NAC', date: '2023-11-02', sunElevation: 46.1, resolution: 0.5 },
  runDirId: null,
  simulationMode: false,
  srcProcessedUrl: null,
  refProcessedUrl: null,
  srcShape: null,
  refShape: null,
  registeredGlobalUrl: null,
  ssimHeatmapUrl: null,
  ssimHeatmapDataUrl: null,
  srcShadowOverlayUrl: null,
  refShadowOverlayUrl: null,
  shadowAnalysis: null,
  srcGeometry: null,
  refGeometry: null,
  contrastRecovery: null,
  craterDetections: null,
  matchPointsCsvUrl: null,
  metricsJsonUrl: null,
  matchPoints: [],
  keypointsSource: 0,
  keypointsRef: 0,
  candidateMatches: 0,
  inliers: 0,
  outliers: 0,
  inlierRatio: 0,
  geometryMethod: '',
  matcherSelection: null,
  homography: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  transformParams: { rotation: 0, scale: 1, tx: 0, ty: 0, residualRMS: 0 },
  metrics: {
    rmse: 0,
    inlierCount: 0,
    inlierRatio: 0,
    meanReprojectionError: 0,
    uniformityScore: 0,
    uniformityScoreAllInliers: 0,
    nUniformSelected: 0,
    rmseImprovementPct: 0,
    scaleFactorFromHomography: 1,
    scaleFactorDimensionBased: 1,
  },
  heatmapData: Array.from({ length: 4 }, () => Array(4).fill(0)),
  validation: { validated: false, label: '', reasons: [] },
  homographyQuality: null,
  rotationConsistency: null,
  ssim: { mean: 0, validRegion: 0, validFraction: 0 },
  elapsedSeconds: 0,
  matcherUsed: '',
  sensorType: '',
});