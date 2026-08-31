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

// 127.0.0.1, not 'localhost': uvicorn's default 0.0.0.0 bind is IPv4-only (no
// [::]:8000 listener), and on Windows a browser's `localhost` frequently
// resolves to ::1 (IPv6) first -- that connects to nothing and reads as
// "backend unreachable" even though the real IPv4 listener is healthy and a
// same-machine curl to `localhost` (which happens to resolve IPv4 first in a
// shell) succeeds. 127.0.0.1 is unambiguous and matches the real socket.
export const API_BASE =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_BASE_URL) ||
  'http://127.0.0.1:8000';

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
  homography_quality?: {
    condition_ratio: number;
    degenerate: boolean;
    threshold: number;
    // Second, independent cross-check: how far apart the homography-derived
    // and dimension-based scale estimates are. Threshold (3x) was set from
    // real measured data -- see backend/pipeline/metrics.py::scale_disagreement_ratio.
    // Absent for manual-seed runs, which have no independent dimension-based
    // scale estimate to compare against.
    scale_disagreement_ratio?: number;
    scale_disagreement_threshold?: number;
    scale_disagreement_flagged?: boolean;
  };
  // Layer A shadow analysis: pixels dark AT TIME OF CAPTURE only. Never
  // implies permanence -- see backend/pipeline/shadow.py's docstring. None
  // of our real images fall within any published PSR product's latitude
  // coverage (confirmed against real footprint geometry), so there is
  // currently no Layer B (real PSR ground truth) to cross-reference against.
  shadow_analysis?: ShadowAnalysis;
  // Real YOLOv8 crater-detector output (backend/pipeline/crater_detector.py),
  // run against the SAME processed image files match_points.json's src_x/
  // src_y and ref_x/ref_y are already in -- no coordinate rescale needed on
  // this side, unlike the catalog-crater overlay above. Distinct from that
  // catalog overlay: these are model detections on THIS pair's own pixels,
  // not a lookup against a pre-published crater catalog, and only exist for
  // images the model was actually run on (every uploaded pair, not just the
  // 4 real Chandrayaan-2 frames with known geometry). `error` is set (non-null)
  // if detection failed for this image -- reported as-is, not hidden.
  crater_detections?: {
    src: { craters: { cx: number; cy: number; radius_px: number; confidence: number }[]; count: number; error: string | null };
    ref: { craters: { cx: number; cy: number; radius_px: number; confidence: number }[]; count: number; error: string | null };
  };
  elapsed_seconds: number;
  src_path?: string;
  ref_path?: string;
  out_dir?: string;
  run_dir_id?: string;
  refinement_stats?: { attempted: number; accepted: number; skipped_scale_guard: boolean };
  multi_scale_leveling?: any;
  // src_geometry/ref_geometry are a best-effort, label-derived dict (raw
  // string values straight from whatever MAP_SCALE/MAP_RESOLUTION/
  // resolution keyword the source label happened to carry -- see
  // backend/pipeline/pds_readers.py). Frequently {} for plain-PNG preview
  // uploads (no label at all to read), and NOT normalized to a common
  // unit -- callers must not assume any particular key is present.
  // Simulation mode (no real backend) stubs this to { simulated: true } --
  // real fields are all optional so both shapes satisfy the same type
  // rather than needing a separate union callers have to narrow.
  ingestion?: {
    src_format?: string; ref_format?: string;
    src_original_shape?: [number, number]; ref_original_shape?: [number, number];
    src_geometry?: Record<string, string>; ref_geometry?: Record<string, string>;
    warnings?: string[];
    simulated?: boolean;
  };
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

// Real, previously-measured aggregate findings from the sun-angle/scale/
// rotation invariance test suite (backend/scripts/invariance_sweep.py,
// see TASKS.md and pages/InvarianceAnalysis.tsx's own captions -- kept in
// sync with those, not re-derived independently). These are aggregate,
// cross-pair findings, not per-run data -- used only as fixed context for
// the Groq Call 4 interpretation ("does THIS pair fall within limits
// already measured across the dataset").
export const INVARIANCE_FINDINGS = {
  sunAngleInvarianceLimitDeg: 45, // 100% pass through 30 deg; first degradation (drops to 50%) at 45 deg
  scaleInvarianceRange: '0.5x-2.0x, 100% pass rate',
  rotationResult: 'terrain-dependent split: 2/3 source images tolerate rotation up to 90°, 1/3 fails at every nonzero rotation',
};

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
  // 120s was too tight and a real cause of false "Simulation mode" --
  // matcher='auto' (the UI default) runs classical SIFT AND deep LoFTR
  // sequentially; LoFTR's real pretrained model has to be (re)loaded on
  // the first request after every backend restart (~10s alone) plus real
  // CPU inference on top of it. The backend was actually finishing fine
  // and returning 200 -- the client just aborted first and silently
  // treated a slow-but-working backend as an unreachable one. 600s is
  // generous enough to cover a cold LoFTR load + full auto-mode run on a
  // real multi-megapixel image on CPU.
  timeoutMs = 600000,
  // Real detached-label PDS3/PDS4 products need their companion binary
  // (.img/.IMG) uploaded alongside the label (.xml/.lbl) in the SAME
  // request -- the backend's /api/run already accepts multiple files per
  // side (list[UploadFile]) for exactly this; appending each companion
  // under the same 'source'/'reference' field name is how FastAPI/Starlette
  // expects a list of files from one multipart field.
  sourceCompanionFiles: File[] = [],
  refCompanionFiles: File[] = []
): Promise<RunResult> {
  const formData = new FormData();
  formData.append('source', sourceFile);
  for (const f of sourceCompanionFiles) formData.append('source', f);
  formData.append('reference', refFile);
  for (const f of refCompanionFiles) formData.append('reference', f);
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
// Real-time Groq (llama-3.3-70b-versatile) plain-language interpretation of
// real pipeline metrics -- backend/pipeline/groq_interpret.py is the only
// place GROQ_API_KEY is read; this frontend call never sees it, only the
// resulting text (or an "unavailable" flag). See InterpretationCard.tsx for
// how callers use this -- every failure mode (no key, network error, rate
// limit) degrades to a quiet placeholder, never a thrown error surfaced to
// the user.
export interface InterpretResult {
  available: boolean;
  text?: string;
}

// In-memory cache, keyed by call_type + exact field payload -- a real run's
// metrics don't change once computed, so re-rendering/remounting the same
// InterpretationCard (step navigation, React re-render, dev-mode double
// mount) reused to hit Groq again for the identical question. That's what
// was actually driving the 429 "Too Many Requests" responses seen in the
// backend log and the slow/failed cards on screen -- not a single call
// being slow, but N redundant identical calls competing for the same
// per-minute quota. Caches the in-flight promise too, so two cards that
// mount in the same tick collapse into one real network call.
const interpretCache = new Map<string, Promise<InterpretResult>>();

export async function interpretMetrics(callType: 1 | 2 | 3 | 4 | 5, fields: Record<string, unknown>): Promise<InterpretResult> {
  const cacheKey = `${callType}:${JSON.stringify(fields)}`;
  const cached = interpretCache.get(cacheKey);
  if (cached) return cached;

  const promise = (async (): Promise<InterpretResult> => {
    try {
      const res = await fetch(`${API_BASE}/api/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_type: callType, ...fields }),
      });
      if (!res.ok) return { available: false };
      return await res.json();
    } catch (err) {
      console.warn('Groq interpretation request failed:', err);
      return { available: false };
    }
  })();
  interpretCache.set(cacheKey, promise);
  // A failed/unavailable result isn't cached beyond this run -- if Groq
  // recovers (rate limit resets, key gets fixed) the next real run's fresh
  // fields naturally bypass the cache anyway since the key changes with
  // any metric change; but explicitly evict a failure so a transient 429
  // doesn't stick as a false "unavailable" for the rest of this session.
  promise.then((r) => {
    if (!r.available) interpretCache.delete(cacheKey);
  });
  return promise;
}

// ---------------------------------------------------------------------------
// Real orbital-geometry panel: real Chandrayaan-2/LRO spacecraft position at
// each image's real acquisition time. See
// backend/pipeline/orbital_geometry.py's module docstring for the real data
// sources (verified .spm telemetry + real NAIF SPK kernels -- NOT
// satellite.js/SGP4/TLE, which don't apply to lunar orbiters at all). Only
// ever real numbers or an honest available:false, never estimated.

export interface OrbitalPosition {
  available: boolean;
  lat?: number;
  lon?: number;
  alt_km?: number;
  source?: string;
  reason?: string;
}

export interface OrbitalGeometryResult {
  ch2: OrbitalPosition;
  lro: OrbitalPosition;
  viewing_angle_divergence_deg: number | null;
  sun_angle_ch2_deg: number | null;
  sun_angle_lro_deg: number | null;
  coverage_note: string;
  target_lat: number | null;
  target_lon: number | null;
}

export async function fetchOrbitalGeometry(runId: string): Promise<OrbitalGeometryResult | null> {
  try {
    const res = await fetch(`${API_BASE}/api/orbital_geometry/${runId}`);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Real lunar surface imagery (ASU's public Lunaserv WMS, LRO WAC global
// mosaic) centered on a real lat/lon -- see backend/app/main.py's
// _fetch_moon_context_image docstring. Just a URL (the <img> tag itself
// makes the request) rather than a fetch wrapper, same pattern as
// outputUrl() elsewhere in this file.
export function moonContextImageUrl(lat: number, lon: number, spanDeg = 2.0): string {
  return `${API_BASE}/api/moon_context_image?lat=${lat}&lon=${lon}&span_deg=${spanDeg}`;
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

// Real, deterministic filename-pattern sensor label -- NOT derived from any
// per-file metadata (this project's own real NAC/PDS4 labels don't carry a
// human-readable sensor name field), but from the same real, already-
// established naming conventions this app's own real datasets use
// (backend/data/real/chandrayaan2/tmc2_* and backend/data/real/lro_nac/M*LE|RE).
// Returns null rather than guessing for anything that matches neither --
// callers must show "sensor unknown", never fabricate one.
export function sensorLabelForFilename(filename: string | null | undefined): string | null {
  if (!filename) return null;
  if (/tmc2_/i.test(filename)) return 'Chandrayaan-2 TMC-2';
  if (/^M\d+(LE|RE)/i.test(filename) || /\bM\d+(LE|RE)\b/i.test(filename)) return 'LRO NAC';
  return null;
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

// Same metric and threshold (3x) the backend uses -- mirrors
// backend/pipeline/metrics.py::scale_disagreement_ratio exactly. See that
// docstring for the real measured data behind the threshold.
export const SCALE_DISAGREEMENT_THRESHOLD = 3.0;
export function scaleDisagreementRatio(scaleFromHomography: number, scaleFromDimensions: number): number {
  if (!scaleFromHomography || !scaleFromDimensions) return Infinity;
  const a = Math.abs(scaleFromHomography), b = Math.abs(scaleFromDimensions);
  return Math.max(a / b, b / a);
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
  const dimensionBasedScale = scale + rand(-0.02, 0.02);

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
    estimated_scale_factor_dimension_based: dimensionBasedScale,
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
      const scaleRatio = scaleDisagreementRatio(scale, dimensionBasedScale);
      return {
        condition_ratio: ratio,
        degenerate: ratio > DEGENERATE_HOMOGRAPHY_THRESHOLD,
        threshold: DEGENERATE_HOMOGRAPHY_THRESHOLD,
        scale_disagreement_ratio: scaleRatio,
        scale_disagreement_threshold: SCALE_DISAGREEMENT_THRESHOLD,
        scale_disagreement_flagged: scaleRatio > SCALE_DISAGREEMENT_THRESHOLD,
      };
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