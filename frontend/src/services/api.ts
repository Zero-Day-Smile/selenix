// services/api.ts
//
// Full client for the lunar image registration backend described in the API reference.
// Two things live here beyond plain fetch wrappers:
//  1. A faithful RunResult type that matches every field the backend actually returns
//     (the previous version was missing matcher_selection, geometry_method, run_dir_id,
//     rmse_improvement_pct, the scale-factor estimates, and used an inlier_ratio scale
//     that didn't match the backend's 0..1 fraction).
//  2. A staged SIMULATION engine (runSimulatedPipeline) that produces internally consistent,
//     clearly-labeled synthetic output when the backend is unreachable, walking through the
//     same named pipeline stages the real backend executes, instead of just swapping in a
//     static object instantly.

export const API_BASE =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
  'http://localhost:8000';

export interface RunParams {
  matcher?: 'classical' | 'deep' | 'auto';
  illum_mode?: 'none' | 'clahe' | 'gradient' | 'both';
  sensor_type?: 'ohrc' | 'tmc' | 'iirs' | 'nac';
}

export interface MatchPoint {
  src_x: number;
  src_y: number;
  ref_x: number;
  ref_y: number;
  confidence: number;
  inlier: boolean;
  uniform_selected: boolean;
  reproj_error_px: number | null;
  refined_src_x: number | null;
  refined_src_y: number | null;
  refinement_offset_px: number | null;
}

export interface ValidationResult {
  validated: boolean;
  label: string;
  reasons: string[];
  thresholds: {
    min_inliers: number;
    min_inlier_ratio: number;
    max_rotation_std_deg: number;
    max_rmse: number;
    [k: string]: any;
  };
}

export interface WarpsComputed {
  global_homography?: string | null;
  piecewise_affine?: string | null;
  thin_plate_spline?: string | null;
  ssim_heatmap?: string | null;
  ssim_data?: string | null;
  src_shadow_overlay?: string | null;
  ref_shadow_overlay?: string | null;
}

export interface SunAngleContext {
  source: string;
  sun_elevation_mean_deg: number;
  solar_incidence_mean_deg: number;
  n_records: number;
}

export interface ShadowRegion {
  pixel_x: number;
  pixel_y: number;
  area_px: number;
  bbox: { x: number; y: number; w: number; h: number };
}

export interface ShadowStats {
  threshold: number;
  shadow_pixel_count: number;
  shadow_fraction: number;
  method: string;
  sun_angle_context: SunAngleContext | null;
  regions: ShadowRegion[];
}

export interface ShadowAnalysis {
  src: ShadowStats;
  ref: ShadowStats;
}

export interface RunResultOk {
  status: 'ok';
  sensor_type: string;
  matcher_used: string;
  matcher_selection: Record<string, number> & { chosen?: string } | null;
  geometry_method: string;
  total_matches: number;
  inlier_count: number;
  inlier_ratio: number; // 0..1 fraction, NOT a percentage
  rmse_pre_refinement: number;
  rmse_post_refinement: number;
  rmse_improvement_pct: number;
  uniformity_score_all_inliers: number;
  uniformity_score_selected: number;
  n_uniform_selected: number;
  estimated_scale_factor_dimension_based: number;
  estimated_scale_factor_from_homography: number;
  src_keypoints: number;
  ref_keypoints: number;
  homography: number[][];
  warps_computed: WarpsComputed;
  rotation_consistency: { std_deg: number; n_pairs: number };
  ssim: { mean_ssim: number; mean_ssim_valid_region: number; valid_pixel_fraction: number };
  validation: ValidationResult;
  // Added: the backend's homography condition-number check (largest/smallest
  // singular value of the linear part). Threshold (5:1) was set from real
  // measured data, not a guess -- every legitimate result across this
  // project's synthetic/hard-case pairs lands at ~1:1, every confirmed-failed
  // real pair at 24.75:1 or 43.74:1. `degenerate: true` means the warp is
  // near-singular and must not be rendered without an explicit warning.
  homography_quality?: { condition_ratio: number; degenerate: boolean; threshold: number };
  // Layer A shadow analysis: pixels dark AT TIME OF CAPTURE only. Never
  // implies permanence -- see backend/pipeline/shadow.py's docstring. None
  // of our real images fall within any published PSR product's latitude
  // coverage (confirmed against real footprint geometry), so there is
  // currently no Layer B (real PSR ground truth) to cross-reference against.
  shadow_analysis?: ShadowAnalysis;
  elapsed_seconds: number;
  src_path?: string;
  ref_path?: string;
  out_dir?: string;
  run_dir_id?: string;
  refinement_stats?: { attempted: number; accepted: number; skipped_scale_guard: boolean };
  multi_scale_leveling?: any;
  ingestion?: any;
  src_shape?: [number, number];
  ref_shape?: [number, number];
}

export interface RunResultFailed {
  status: 'failed';
  reason: string;
  total_matches: number;
  matcher_used: string;
  inlier_count: number;
}

export type RunResult = RunResultOk | RunResultFailed;

export function isSuccessResult(r: RunResult): r is RunResultOk {
  return r.status === 'ok';
}

// ---------------------------------------------------------------------------
// Named pipeline stages, in the exact order the backend executes them.
// Used both to drive the "in-flight" progress UI for real calls and as the
// script for the simulated fallback.
// ---------------------------------------------------------------------------
export const PIPELINE_STAGES = [
  'Ingestion',
  'Illumination normalization',
  'Multi-scale leveling',
  'Feature matching',
  'Geometric verification (MAGSAC++)',
  'Uniform-distribution selection',
  'Sub-pixel refinement',
  'Registration & warping',
  'Metrics & validation',
] as const;

// ---------------------------------------------------------------------------
// Real backend calls
// ---------------------------------------------------------------------------

export async function checkBackendHealth(timeoutMs = 3000): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${API_BASE}/api/health`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    const data = await res.json();
    return data?.status === 'ok';
  } catch {
    return false;
  }
}

export async function runRegistration(
  sourceFile: File,
  refFile: File,
  params: RunParams = {},
  timeoutMs = 120000
): Promise<RunResult> {
  const formData = new FormData();
  formData.append('source', sourceFile);
  formData.append('reference', refFile);
  if (params.matcher) formData.append('matcher', params.matcher);
  if (params.illum_mode) formData.append('illum_mode', params.illum_mode);
  if (params.sensor_type) formData.append('sensor_type', params.sensor_type);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/run`, {
      method: 'POST',
      body: formData,
      signal: ctrl.signal,
      // Do not set Content-Type manually — the browser sets the multipart boundary.
    });
  } finally {
    clearTimeout(t);
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Backend error (${response.status}): ${errorText || response.statusText}`);
  }

  const data: RunResult = await response.json();
  return data;
}

export async function fetchMatchPoints(runId: string): Promise<MatchPoint[]> {
  const res = await fetch(outputUrl(runId, 'match_points.json'));
  if (!res.ok) throw new Error(`Failed to fetch match points (${res.status})`);
  return res.json();
}

export function outputUrl(runId: string, filename: string): string {
  return `${API_BASE}/api/runs/${runId}/${filename}`;
}

// ---------------------------------------------------------------------------
// Real crater-catalog overlay (Robbins 2019 Lunar Crater Database + USGS
// Gazetteer of Planetary Nomenclature). See backend/pipeline/crater_catalog.py
// and tmc_geometry.py -- every field here traces to one of those two real,
// cited catalogs, queried and returned separately (never merged/matched by
// proximity), for the 4 real Chandrayaan-2 frames with real per-pixel geometry.

export interface Chandrayaan2ImageSummary {
  id: string;
  image_url: string;
  bbox: { lon_min: number; lon_max: number; lat_min: number; lat_max: number };
}

export interface CatalogCrater {
  name: string | null;
  crater_id: string | null;
  diameter_km: number | null;
  lat: number;
  lon: number;
  source: string;
  gazetteer_link: string | null;
  pixel_x: number;
  pixel_y: number;
}

export interface CatalogStatus {
  robbins_total_craters: number;
  gazetteer_named_craters: number;
  robbins_source: string;
  gazetteer_source: string;
}

export interface Chandrayaan2CratersResponse {
  image_id: string;
  image_width: number;
  image_height: number;
  bbox: { lon_min: number; lon_max: number; lat_min: number; lat_max: number };
  count: number;
  craters: CatalogCrater[];
  gsd_m_per_px: number;
  catalog_status: CatalogStatus;
}

export async function listChandrayaan2Images(): Promise<Chandrayaan2ImageSummary[]> {
  const res = await fetch(`${API_BASE}/api/chandrayaan2_images`);
  if (!res.ok) throw new Error(`Failed to list Chandrayaan-2 images (${res.status})`);
  const data = await res.json();
  return data.images;
}

export function chandrayaan2ImageUrl(imageId: string): string {
  return `${API_BASE}/api/chandrayaan2_images/${imageId}/image.png`;
}

export async function fetchChandrayaan2Craters(imageId: string): Promise<Chandrayaan2CratersResponse> {
  const res = await fetch(`${API_BASE}/api/chandrayaan2_images/${imageId}/craters`);
  if (!res.ok) throw new Error(`Failed to fetch craters for ${imageId} (${res.status})`);
  return res.json();
}

// Must match backend/app/main.py's CHANDRAYAAN2_IMAGE_IDS -- the only real
// frames we have real per-pixel geometry.csv for, and therefore the only
// ones the crater overlay can honestly attempt. An uploaded file that
// doesn't match one of these has no real geometry backing it, so the
// overlay correctly stays silent rather than guessing.
const CHANDRAYAAN2_IMAGE_IDS = ['tmc2_20260803_0049', 'tmc2_20260809_1606', 'tmc2_20260811_1856', 'tmc2_20260812_0506'];

export function chandrayaan2ImageIdForFilename(filename: string | null | undefined): string | null {
  if (!filename) return null;
  return CHANDRAYAAN2_IMAGE_IDS.find((id) => filename.includes(id)) ?? null;
}

// ---------------------------------------------------------------------------
// Homography decomposition — used to derive real rotation/scale for display,
// instead of (incorrectly) reusing rotation_consistency.std_deg, which is a
// pairwise-agreement metric, not the transform's rotation angle.
// ---------------------------------------------------------------------------
export function decomposeHomography(h: number[][]) {
  const a = h?.[0]?.[0] ?? 1;
  const b = h?.[1]?.[0] ?? 0;
  const tx = h?.[0]?.[2] ?? 0;
  const ty = h?.[1]?.[2] ?? 0;
  const scale = Math.sqrt(a * a + b * b);
  const rotationDeg = (Math.atan2(b, a) * 180) / Math.PI;
  return { rotationDeg, scale, tx, ty };
}

// Ratio of largest to smallest singular value of the homography's 2x2 linear
// part -- same metric and threshold (5:1) the backend uses. Closed-form for
// a 2x2 matrix, mirrors backend/pipeline/metrics.py::homography_condition_ratio
// exactly so the frontend never has to guess this independently.
export const DEGENERATE_HOMOGRAPHY_THRESHOLD = 5.0;
export function homographyConditionRatio(h: number[][]): number {
  const a = h?.[0]?.[0] ?? 1, b = h?.[0]?.[1] ?? 0;
  const c = h?.[1]?.[0] ?? 0, d = h?.[1]?.[1] ?? 1;
  const e = a * a + b * b + c * c + d * d;
  const f = (a * a + b * b - c * c - d * d) ** 2 + 4 * (a * c + b * d) ** 2;
  const s1 = Math.sqrt(Math.max(0, (e + Math.sqrt(Math.max(0, f))) / 2));
  const s2 = Math.sqrt(Math.max(0, (e - Math.sqrt(Math.max(0, f))) / 2));
  return s1 / Math.max(s2, 1e-9);
}

// ---------------------------------------------------------------------------
// SIMULATION ENGINE
//
// Produces a self-consistent synthetic result when the backend can't be
// reached, walking through the same named stages with realistic delays.
// It's deliberately calibrated to match what the backend docs say is
// currently true of real data (no real Chandrayaan-2/NAC pair clears the
// validation thresholds yet) rather than faking a "confirmed match" —
// the whole point is that the UI must stay honest about simulation vs. a
// real, backend-computed result.
// ---------------------------------------------------------------------------

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}
function randInt(min: number, max: number) {
  return Math.floor(rand(min, max + 1));
}

export interface SimulationImageDims {
  srcW: number;
  srcH: number;
  refW: number;
  refH: number;
}

export async function runSimulatedPipeline(
  params: RunParams,
  dims: SimulationImageDims,
  onStage: (stageIndex: number, stageName: string) => void
): Promise<RunResultOk> {
  const stageDelays = [420, 520, 380, 900, 620, 340, 700, 780, 300];
  for (let i = 0; i < PIPELINE_STAGES.length; i++) {
    onStage(i, PIPELINE_STAGES[i]);
    await new Promise((r) => setTimeout(r, stageDelays[i]));
  }

  const srcKeypoints = randInt(1400, 6200);
  const refKeypoints = randInt(1400, 6200);
  const totalMatches = randInt(180, 420);
  // Real Chandrayaan-2/NAC pairs currently sit well below the validation
  // thresholds — mirror that here rather than faking a clean result.
  const inlierRatio = rand(0.08, 0.42);
  const inlierCount = Math.round(totalMatches * inlierRatio);
  const rotationStd = rand(18, 70);
  const rmsePost = rand(0.15, 1.4);
  const rmsePre = rmsePost * rand(4, 12);
  const rmseImprovementPct = ((rmsePre - rmsePost) / rmsePre) * 100;

  const scale = rand(0.85, 1.6);
  const rotDeg = rand(-4, 4);
  const rad = (rotDeg * Math.PI) / 180;
  const tx = rand(-40, 40);
  const ty = rand(-30, 30);
  const homography = [
    [scale * Math.cos(rad), -Math.sin(rad), tx],
    [Math.sin(rad), scale * Math.cos(rad), ty],
    [rand(-0.0002, 0.0002), rand(-0.0002, 0.0002), 1],
  ];

  const uniformityAll = rand(0.35, 0.75);
  const uniformitySelected = Math.min(0.98, uniformityAll + rand(-0.1, 0.15));

  const thresholds = { min_inliers: 20, min_inlier_ratio: 0.5, max_rotation_std_deg: 15.0, max_rmse: 3.0 };
  const reasons: string[] = [];
  if (inlierCount < thresholds.min_inliers) {
    reasons.push(
      `only ${inlierCount} inliers (${totalMatches} total matches) -- need >=${thresholds.min_inliers} to rule out a statistically meaningless small-N fit`
    );
  }
  if (inlierRatio < thresholds.min_inlier_ratio) {
    reasons.push(`inlier ratio ${inlierRatio.toFixed(2)} below ${thresholds.min_inlier_ratio}`);
  }
  if (rotationStd > thresholds.max_rotation_std_deg) {
    reasons.push(
      `pairwise rotation-consistency std ${rotationStd.toFixed(1)}deg exceeds ${thresholds.max_rotation_std_deg}deg -- matches disagree on relative rotation, the signature of a spurious/random match set, not a real alignment`
    );
  }
  if (rmsePost > thresholds.max_rmse) {
    reasons.push(`post-refinement RMSE ${rmsePost.toFixed(2)}px exceeds ${thresholds.max_rmse}px`);
  }
  const validated = reasons.length === 0;

  const matchPoints: MatchPoint[] = [];
  const nPoints = Math.min(totalMatches, 60);
  for (let i = 0; i < nPoints; i++) {
    const isInlier = i < Math.round((inlierCount / totalMatches) * nPoints);
    const sx = rand(20, dims.srcW - 20);
    const sy = rand(20, dims.srcH - 20);
    const rx = rand(20, dims.refW - 20);
    const ry = rand(20, dims.refH - 20);
    matchPoints.push({
      src_x: sx,
      src_y: sy,
      ref_x: rx,
      ref_y: ry,
      confidence: rand(0.2, 0.95),
      inlier: isInlier,
      uniform_selected: isInlier && Math.random() > 0.3,
      reproj_error_px: isInlier ? rand(0.1, 1.5) : rand(2.0, 15.0),
      refined_src_x: isInlier ? sx + rand(-0.6, 0.6) : null,
      refined_src_y: isInlier ? sy + rand(-0.6, 0.6) : null,
      refinement_offset_px: isInlier ? rand(0.05, 0.6) : null,
    });
  }
  (globalThis as any).__lastSimulatedMatchPoints = matchPoints;

  const result: RunResultOk = {
    status: 'ok',
    sensor_type: params.sensor_type || 'ohrc',
    matcher_used:
      (params.matcher === 'deep' ? 'deep_loftr' : params.matcher === 'classical' ? 'classical_sift' : 'classical_sift') +
      ' (simulated)',
    matcher_selection:
      params.matcher === 'auto'
        ? { classical_sift: rand(0.1, 0.4), deep_loftr: rand(0.1, 0.4), chosen: 'classical_sift' }
        : null,
    geometry_method: 'MAGSAC++',
    total_matches: totalMatches,
    inlier_count: inlierCount,
    inlier_ratio: inlierRatio,
    rmse_pre_refinement: rmsePre,
    rmse_post_refinement: rmsePost,
    rmse_improvement_pct: rmseImprovementPct,
    uniformity_score_all_inliers: uniformityAll,
    uniformity_score_selected: uniformitySelected,
    n_uniform_selected: Math.round(inlierCount * rand(0.6, 0.95)),
    estimated_scale_factor_dimension_based: scale + rand(-0.02, 0.02),
    estimated_scale_factor_from_homography: scale,
    src_keypoints: srcKeypoints,
    ref_keypoints: refKeypoints,
    homography,
    warps_computed: {
      global_homography: null,
      piecewise_affine: null,
      thin_plate_spline: null,
      ssim_heatmap: null,
    },
    rotation_consistency: { std_deg: rotationStd, n_pairs: randInt(200, 900) },
    ssim: {
      mean_ssim: rand(0.03, 0.18),
      mean_ssim_valid_region: rand(0.05, 0.22),
      valid_pixel_fraction: rand(0.55, 0.92),
    },
    validation: {
      validated,
      label: validated ? 'VALIDATED (simulated)' : 'UNVALIDATED / EXPLORATORY — NOT A CONFIRMED MATCH (simulated)',
      reasons: validated ? ['all thresholds satisfied (simulated)'] : reasons,
      thresholds,
    },
    // Computed honestly from the homography actually generated above (a
    // similarity transform by construction), not an independently-guessed
    // value -- the simulation never currently generates a truly degenerate
    // matrix, so this will read ~1:1 even when other simulated metrics show
    // failure. That's an accurate description of what the simulation does,
    // not a claim that a real degenerate case looks like this.
    homography_quality: (() => {
      const ratio = homographyConditionRatio(homography);
      return { condition_ratio: ratio, degenerate: ratio > DEGENERATE_HOMOGRAPHY_THRESHOLD, threshold: DEGENERATE_HOMOGRAPHY_THRESHOLD };
    })(),
    elapsed_seconds: rand(1.8, 4.5),
    refinement_stats: { attempted: inlierCount, accepted: Math.round(inlierCount * 0.9), skipped_scale_guard: false },
    multi_scale_leveling: { simulated: true },
    ingestion: { simulated: true },
    src_shape: [dims.srcH, dims.srcW],
    ref_shape: [dims.refH, dims.refW],
  };

  return result;
}

export function matchPointsToCsv(points: MatchPoint[]): string {
  const header = 'src_x,src_y,ref_x,ref_y,confidence,inlier,uniform_selected,reproj_error_px,refined_src_x,refined_src_y,refinement_offset_px';
  const rows = points.map((p) =>
    [p.src_x, p.src_y, p.ref_x, p.ref_y, p.confidence, p.inlier, p.uniform_selected, p.reproj_error_px, p.refined_src_x, p.refined_src_y, p.refinement_offset_px].join(',')
  );
  return [header, ...rows].join('\n');
}