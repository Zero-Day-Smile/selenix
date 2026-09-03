// workspace_components/Match3DPlot.tsx
//
// Interactive 3D visualization of real matched points over the real
// reference image. Plotly.js has no true UV-mapped image texture on a 3D
// surface, so the standard, exact-for-grayscale-imagery workaround is used:
// the reference image is downsampled to a grid, its real per-pixel
// intensity becomes the `surfacecolor` of a flat (z=0) `surface` trace, and
// an explicit [0,255] linear black->white colorscale is pinned (not an
// auto-scaled named colorscale) so the plotted "photo floor" matches the
// image's own real absolute brightness, not a re-stretched approximation.
//
// Every real match with a real reprojection error is a real scatter3d
// point at its real (ref_x, ref_y) pixel position; height (z) is the real
// per-match reprojection error in pixels (backend/pipeline/metrics.py) --
// a point with no real reprojection error reported (matcher-dependent) is
// excluded from the plot entirely, never placed at a fabricated z=0, and
// the exact excluded count is reported honestly below the plot.
//
// Everything below this line in the module is presentation only -- color
// ramp, size scaling, reveal/camera animation, hover thumbnail, threshold
// plane, camera presets -- none of it changes a single real number; it all
// reads directly off the same real per-point data the flat version showed.
import { useEffect, useMemo, useRef, useState } from 'react';
import createPlotlyComponent from 'react-plotly.js/factory';
import Plotly from 'plotly.js-dist-min';
import ChartCard from './ChartCard';
import { useCurrentTheme } from './ThemeContext';
import type { MatchPoint } from '../services/api';

const Plot = createPlotlyComponent(Plotly);

const TEXTURE_GRID = 220;
const INLIER_DISPLAY_CAP = 250;
const REVEAL_MS = 1300;
const INTRO_ORBIT_MS = 1300;
const PRESET_TRANSITION_MS = 800;

// Default (isometric) + preset camera eyes. Same "eye" convention Plotly
// scene cameras already use; these are just named starting points, not
// new data.
const CAMERA_ISOMETRIC = { x: 1.4, y: -1.4, z: 1.1 };
const CAMERA_TOP_DOWN = { x: 0.0001, y: 0.0001, z: 2.6 }; // near-zero, not exactly 0 -- Plotly's gimbal breaks at an exact top-down eye
const CAMERA_SIDE_ON = { x: 2.4, y: 0.0001, z: 0.25 };

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpEye(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }, t: number) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}


interface TextureGrid {
  z: number[][];
  surfacecolor: number[][];
  x: number[];
  y: number[];
}

function useImageTexture(url: string | null, shape: [number, number] | null): { texture: TextureGrid | null; failed: boolean } {
  const [texture, setTexture] = useState<TextureGrid | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!url || !shape) return;
    let cancelled = false;
    setFailed(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const [h, w] = shape;
      const gridW = Math.min(TEXTURE_GRID, w);
      const gridH = Math.max(1, Math.round(gridW * (h / w)));
      const canvas = document.createElement('canvas');
      canvas.width = gridW;
      canvas.height = gridH;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setFailed(true);
        return;
      }
      ctx.drawImage(img, 0, 0, gridW, gridH);
      let imgData: ImageData;
      try {
        imgData = ctx.getImageData(0, 0, gridW, gridH);
      } catch {
        if (!cancelled) setFailed(true);
        return;
      }
      const surfacecolor: number[][] = [];
      const z: number[][] = [];
      for (let row = 0; row < gridH; row++) {
        const colorRow: number[] = [];
        const zRow: number[] = [];
        for (let col = 0; col < gridW; col++) {
          const idx = (row * gridW + col) * 4;
          colorRow.push(imgData.data[idx]);
          zRow.push(0);
        }
        surfacecolor.push(colorRow);
        z.push(zRow);
      }
      const x = Array.from({ length: gridW }, (_, i) => (i / Math.max(1, gridW - 1)) * w);
      const y = Array.from({ length: gridH }, (_, i) => (i / Math.max(1, gridH - 1)) * h);
      if (!cancelled) setTexture({ z, surfacecolor, x, y });
    };
    img.onerror = () => {
      if (!cancelled) setFailed(true);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url, shape]);

  return { texture, failed };
}

function evenlySample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr;
  const step = arr.length / n;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)]);
  return out;
}

function StatBox({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-sm px-2 py-1.5">
      <div className="font-bold text-sm" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      <div className="text-gray-500 uppercase tracking-wide text-[9px]">{label}</div>
    </div>
  );
}

export default function Match3DPlot({
  refUrl,
  refShape,
  matchPoints,
  height = 520,
  srcUrl = null,
  srcShape = null,
  // Real per-point RANSAC/MAGSAC++ reprojection-error threshold that
  // actually decided inlier/outlier for this run -- pass the live
  // threshold when the caller has one (StepRANSAC's own adjustable
  // slider value), otherwise the backend's real configured default
  // (geometry.py::estimate_homography's reproj_thresh=3.0). Never a
  // cosmetic/made-up cutoff.
  reprojThresholdPx = 3.0,
}: {
  refUrl: string | null;
  refShape: [number, number] | null;
  matchPoints: MatchPoint[];
  height?: number;
  srcUrl?: string | null;
  srcShape?: [number, number] | null;
  reprojThresholdPx?: number;
}) {
  const theme = useCurrentTheme();
  const { texture, failed: textureFailed } = useImageTexture(refUrl, refShape);
  const [showAllInliers, setShowAllInliers] = useState(false);
  const [selected, setSelected] = useState<{ point: MatchPoint; index: number; trace: string } | null>(null);
  const [hovered, setHovered] = useState<MatchPoint | null>(null);

  // Reveal animation progress (0 -> 1, real z scaled by this during the
  // intro) and the intro camera drift. After the intro finishes, camera
  // control is released (layout stops passing `camera`) so drag-to-orbit
  // takes over from wherever the drift left off, undisturbed.
  const [revealProgress, setRevealProgress] = useState(0);
  const [introCamera, setIntroCamera] = useState<typeof CAMERA_ISOMETRIC | null>({ x: 0.05, y: -2.6, z: 2.2 });
  const [presetCamera, setPresetCamera] = useState<typeof CAMERA_ISOMETRIC | null>(null);
  const lastKnownCamera = useRef<typeof CAMERA_ISOMETRIC>(CAMERA_ISOMETRIC);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const t0 = performance.now();
    const introStartEye = { x: 0.05, y: -2.6, z: 2.2 };
    const tick = (now: number) => {
      const elapsed = now - t0;
      const revealT = Math.min(1, elapsed / REVEAL_MS);
      setRevealProgress(easeOutCubic(revealT));

      const orbitT = Math.min(1, elapsed / INTRO_ORBIT_MS);
      const eased = easeOutCubic(orbitT);
      setIntroCamera(lerpEye(introStartEye, CAMERA_ISOMETRIC, eased));

      if (revealT < 1 || orbitT < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        lastKnownCamera.current = CAMERA_ISOMETRIC;
        setIntroCamera(null); // release camera control to the user
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refUrl]);

  const animateCameraTo = (target: typeof CAMERA_ISOMETRIC) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const start = lastKnownCamera.current;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / PRESET_TRANSITION_MS);
      const eased = easeOutCubic(t);
      const eye = lerpEye(start, target, eased);
      setPresetCamera(eye);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        lastKnownCamera.current = target;
        // Keep presetCamera set (controlled) at the final resting
        // position -- react-plotly.js needs a stable camera value to not
        // snap back; the user can still drag from here, and onUpdate
        // below keeps lastKnownCamera in sync with whatever they do next.
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const withError = useMemo(() => matchPoints.filter((p) => p.reproj_error_px != null), [matchPoints]);
  const inliers = useMemo(() => withError.filter((p) => p.inlier), [withError]);
  const outliers = useMemo(() => withError.filter((p) => !p.inlier), [withError]);
  const excludedCount = matchPoints.length - withError.length;
  const inlierNeedsCap = inliers.length > INLIER_DISPLAY_CAP;
  const shownInliers = useMemo(
    () => (showAllInliers || !inlierNeedsCap ? inliers : evenlySample(inliers, INLIER_DISPLAY_CAP)),
    [inliers, showAllInliers, inlierNeedsCap]
  );

  // Real, live-recomputed stats off the actual rendered/underlying data --
  // never hardcoded. Uses the full real set (not the capped display
  // subset), since the capping is a rendering concession, not a change in
  // what's real.
  const stats = useMemo(() => {
    const errs = withError.map((p) => p.reproj_error_px as number);
    const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null;
    const max = errs.length ? Math.max(...errs) : null;
    return {
      total: matchPoints.length,
      inlierCount: inliers.length,
      outlierCount: outliers.length,
      inlierRatio: matchPoints.length ? inliers.length / matchPoints.length : 0,
      meanError: mean,
      maxError: max,
    };
  }, [matchPoints, withError, inliers, outliers]);

  // Shared color/size domain across BOTH traces (real min/max of the
  // actual plotted errors) so color is directly comparable between
  // inliers and outliers, not two independently-stretched scales.
  const { errMin, errMax } = useMemo(() => {
    const errs = withError.map((p) => p.reproj_error_px as number);
    if (!errs.length) return { errMin: 0, errMax: 1 };
    return { errMin: Math.min(...errs), errMax: Math.max(...errs, 1e-6) };
  }, [withError]);

  if (!refShape || !refUrl) {
    return (
      <ChartCard title="3D match visualization" height={160}>
        <p className="text-xs italic text-gray-400 py-8 text-center">
          Real reference image / shape not available for this run.
        </p>
      </ChartCard>
    );
  }

  const [refH, refW] = refShape;
  const isDark = theme === 'dark';
  const paperBg = isDark ? '#111318' : '#ffffff';
  const fontColor = isDark ? '#c4c9d4' : '#374151';
  const gridColor = isDark ? '#3a3f4c' : '#e5e7eb';

  const traces: Partial<Plotly.PlotData>[] = [];

  if (texture) {
    traces.push({
      type: 'surface',
      x: texture.x,
      y: texture.y.map((v) => refH - v),
      z: texture.z,
      surfacecolor: texture.surfacecolor,
      colorscale: [
        [0, 'rgb(0,0,0)'],
        [1, 'rgb(255,255,255)'],
      ],
      cmin: 0,
      cmax: 255,
      showscale: false,
      opacity: 1,
      hoverinfo: 'skip',
      lighting: { ambient: 1, diffuse: 0 },
    } as Partial<Plotly.PlotData>);
  }

  // Threshold plane: a flat translucent surface at the real
  // reprojection-error cutoff -- points below it are inliers, above it
  // are outliers, by the exact same real threshold the pipeline used.
  traces.push({
    type: 'surface',
    x: [0, refW],
    y: [0, refH],
    z: [
      [reprojThresholdPx, reprojThresholdPx],
      [reprojThresholdPx, reprojThresholdPx],
    ],
    colorscale: [
      [0, 'rgb(250,204,21)'],
      [1, 'rgb(250,204,21)'],
    ],
    showscale: false,
    opacity: 0.16,
    hoverinfo: 'skip',
    lighting: { ambient: 1, diffuse: 0 },
    name: `threshold (${reprojThresholdPx.toFixed(2)}px)`,
  } as Partial<Plotly.PlotData>);

  const pointTrace = (pts: MatchPoint[], name: string, symbol: string): Partial<Plotly.PlotData> => {
    const errs = pts.map((p) => p.reproj_error_px as number);
    const sizes = errs.map((e) => {
      const t = Math.min(1, Math.max(0, (e - errMin) / (errMax - errMin || 1)));
      return 2.5 + t * 6; // near-zero error -> tight small dot; near-max error -> larger
    });
    return {
      type: 'scatter3d',
      mode: 'markers',
      name,
      x: pts.map((p) => p.ref_x),
      y: pts.map((p) => refH - p.ref_y),
      // Reveal animation: real z scaled by revealProgress (0->1). Once the
      // intro finishes revealProgress is 1 and this is exactly the real
      // per-point value, nothing altered.
      z: errs.map((e) => e * revealProgress),
      marker: {
        size: sizes,
        color: errs,
        colorscale: 'Viridis',
        cmin: errMin,
        cmax: errMax,
        showscale: name === 'Outliers',
        colorbar: name === 'Outliers' ? { title: { text: 'reproj. error (px)' }, thickness: 12, len: 0.6, x: 1.02 } : undefined,
        symbol,
        opacity: name === 'Inliers' ? 0.75 : 0.85,
        line: { width: 0.5, color: isDark ? '#00000080' : '#ffffff80' },
      },
      customdata: pts as unknown as Plotly.Datum[],
      text: pts.map(
        (p, i) =>
          `match #${i}<br>reprojection error: ${(p.reproj_error_px as number).toFixed(2)}px<br>confidence: ${
            p.confidence != null ? p.confidence.toFixed(3) : 'n/a'
          }<br><i>click to pin details</i>`
      ),
      hovertemplate: `%{text}<extra>${name}</extra>`,
    } as Partial<Plotly.PlotData>;
  };

  traces.push(pointTrace(outliers, 'Outliers', 'diamond'));
  traces.push(pointTrace(shownInliers, 'Inliers', 'circle'));

  const activeCamera = introCamera ?? presetCamera ?? undefined;

  // Hover-highlighted point's position mapped into the small source-image
  // inset panel below, real coordinates scaled by the inset's own real
  // rendered size vs. the real srcShape.
  const INSET_SIZE = 130;
  const srcDot =
    hovered && srcShape
      ? {
          left: (hovered.src_x / srcShape[1]) * INSET_SIZE,
          top: (hovered.src_y / srcShape[0]) * INSET_SIZE,
        }
      : null;

  return (
    <>
      <ChartCard
        title="3D match visualization"
        subtitle="Real matches over the real reference image — color/size = real reprojection error, translucent plane = the real MAGSAC++ cutoff. Drag to rotate, click a legend entry to hide/show it, click a point to pin details."
        height={height}
      >
        <div className="relative w-full h-full">
          <Plot
            data={traces}
            layout={{
              autosize: true,
              margin: { l: 0, r: 0, t: 0, b: 0 },
              paper_bgcolor: paperBg,
              font: { color: fontColor, size: 11 },
              scene: {
                xaxis: { title: 'x (px)', range: [0, refW], gridcolor: gridColor, backgroundcolor: paperBg },
                yaxis: { title: 'y (px)', range: [0, refH], gridcolor: gridColor, backgroundcolor: paperBg },
                zaxis: { title: 'reproj. error (px)', gridcolor: gridColor, backgroundcolor: paperBg },
                aspectmode: 'data',
                ...(activeCamera ? { camera: { eye: activeCamera } } : {}),
              },
              legend: { x: 0, y: 1, font: { size: 11, color: fontColor } },
              transition: { duration: 0 },
            }}
            config={{ displaylogo: false, responsive: true }}
            style={{ width: '100%', height: '100%' }}
            useResizeHandler
            onClick={(e) => {
              const pt = e.points?.[0];
              if (!pt || !pt.data?.customdata) return;
              const idx = pt.pointNumber as number;
              const matchPoint = pt.data.customdata[idx] as unknown as MatchPoint;
              if (matchPoint) setSelected({ point: matchPoint, index: idx, trace: String(pt.data.name) });
            }}
            onHover={(e) => {
              const pt = e.points?.[0];
              if (!pt || !pt.data?.customdata) return;
              const idx = pt.pointNumber as number;
              const matchPoint = pt.data.customdata[idx] as unknown as MatchPoint;
              if (matchPoint) setHovered(matchPoint);
            }}
            onUnhover={() => setHovered(null)}
            onUpdate={(figure) => {
              const cam = (figure.layout as unknown as { scene?: { camera?: { eye?: typeof CAMERA_ISOMETRIC } } })
                ?.scene?.camera?.eye;
              if (cam && introCamera === null) lastKnownCamera.current = cam;
            }}
          />

          {/* Persistent corner stats overlay -- real, live-recomputed, not
              hardcoded (see `stats` above). */}
          <div className="absolute top-2 right-2 bg-white/85 dark:bg-black/70 backdrop-blur-sm border border-gray-200 dark:border-white/10 rounded-sm px-2.5 py-2 text-[10px] font-mono pointer-events-none space-y-0.5">
            <div>
              <span style={{ color: '#4ade80' }}>{stats.inlierCount} inliers</span>
              {' / '}
              <span style={{ color: '#f87171' }}>{stats.outlierCount} outliers</span>
            </div>
            <div className="text-gray-600 dark:text-gray-400">
              mean {stats.meanError != null ? stats.meanError.toFixed(2) : 'n/a'}px, max{' '}
              {stats.maxError != null ? stats.maxError.toFixed(1) : 'n/a'}px
            </div>
          </div>

          {/* Camera presets */}
          <div className="absolute bottom-2 left-2 flex gap-1 text-[9px] font-mono uppercase tracking-wide">
            {[
              { label: 'Isometric', eye: CAMERA_ISOMETRIC },
              { label: 'Top-down', eye: CAMERA_TOP_DOWN },
              { label: 'Side-on', eye: CAMERA_SIDE_ON },
            ].map((p) => (
              <button
                key={p.label}
                onClick={() => animateCameraTo(p.eye)}
                className="px-2 py-1 rounded-sm border border-gray-300 dark:border-white/15 bg-white/80 dark:bg-black/60 text-gray-600 dark:text-gray-300 hover:border-cyan-400/60 hover:text-cyan-600 dark:hover:text-cyan-300 backdrop-blur-sm transition-colors"
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Hover source-image inset -- shows where on the real SOURCE
              image the hovered reference-side point actually came from. */}
          {srcUrl && srcShape && (
            <div
              className="absolute bottom-2 right-2 border border-gray-300 dark:border-white/15 rounded-sm overflow-hidden bg-black/40 backdrop-blur-sm"
              style={{ width: INSET_SIZE, height: INSET_SIZE, opacity: hovered ? 1 : 0.35 }}
            >
              <img src={srcUrl} alt="Source (hover a point to locate it here)" className="w-full h-full object-cover" />
              {srcDot && (
                <span
                  className="absolute w-2.5 h-2.5 rounded-full border-2 border-white shadow"
                  style={{ left: srcDot.left - 5, top: srcDot.top - 5, background: '#facc15' }}
                />
              )}
              <span className="absolute bottom-0.5 left-1 text-[8px] text-white/80 font-mono">source</span>
            </div>
          )}
        </div>
      </ChartCard>

      {selected && (
        <div className="mt-3 bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 rounded-sm p-3 text-xs font-mono flex items-start justify-between gap-3">
          <div className="space-y-0.5">
            <div className="font-bold" style={{ color: selected.trace === 'Inliers' ? '#4ade80' : '#f87171' }}>
              {selected.trace === 'Inliers' ? 'Inlier' : 'Outlier'} match #{selected.index}
            </div>
            <div>ref position: ({selected.point.ref_x.toFixed(1)}, {selected.point.ref_y.toFixed(1)}) px</div>
            <div>src position: ({selected.point.src_x.toFixed(1)}, {selected.point.src_y.toFixed(1)}) px</div>
            <div>reprojection error: {selected.point.reproj_error_px?.toFixed(3) ?? 'n/a'} px</div>
            <div>confidence: {selected.point.confidence != null ? selected.point.confidence.toFixed(4) : 'n/a'}</div>
            {selected.point.refined_src_x != null && (
              <div>
                refined src position: ({selected.point.refined_src_x.toFixed(2)}, {selected.point.refined_src_y?.toFixed(2)}) px
                {selected.point.refinement_offset_px != null && ` (offset ${selected.point.refinement_offset_px.toFixed(3)}px)`}
              </div>
            )}
            {selected.point.uniform_selected && <div className="text-cyan-500 dark:text-cyan-400">part of the uniformity-selected inlier subset</div>}
          </div>
          <button
            onClick={() => setSelected(null)}
            aria-label="Close match details"
            className="text-gray-500 hover:text-black dark:hover:text-white leading-none text-base shrink-0"
          >
            ×
          </button>
        </div>
      )}

      {inlierNeedsCap && (
        <p className="text-[10px] text-gray-500 mt-1">
          Showing {shownInliers.length} of {inliers.length} real inliers, evenly sampled across all of them —{' '}
          <button className="text-cyan-500 dark:text-cyan-400 underline" onClick={() => setShowAllInliers((s) => !s)}>
            {showAllInliers ? 'show sampled subset' : 'show all'}
          </button>
          .
        </p>
      )}

      {textureFailed && (
        <p className="text-[10px] italic text-amber-500 mt-1">
          Could not load the real reference image as a texture (cross-origin or load failure) — points are still real, plotted without the photo floor.
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px] font-mono">
        <StatBox label="Total matches" value={String(stats.total)} />
        <StatBox label="Inliers" value={String(stats.inlierCount)} accent="#4ade80" />
        <StatBox label="Outliers" value={String(stats.outlierCount)} accent="#f87171" />
        <StatBox label="Inlier ratio" value={`${(stats.inlierRatio * 100).toFixed(1)}%`} />
      </div>
      {excludedCount > 0 && (
        <p className="text-[9px] text-gray-500 mt-1.5">
          {excludedCount} of {matchPoints.length} match{matchPoints.length === 1 ? '' : 'es'} excluded from this plot —
          no real per-point reprojection error reported for this run's matcher.
        </p>
      )}
    </>
  );
}
