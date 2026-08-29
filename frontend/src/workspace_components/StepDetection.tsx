// workspace_components/StepDetection.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkspaceData } from './types';
import { useOsdViewer } from './useOsdViewer';
import OsdPointOverlay from './OsdPointOverlay';
import CraterPinOverlay from './CraterPinOverlay';
import DetectedCraterOverlay from './DetectedCraterOverlay';
import CorrespondenceCanvas, { type CorrespondencePoint } from './CorrespondenceCanvas';
import { chandrayaan2ImageIdForFilename, fetchChandrayaan2Craters, type Chandrayaan2CratersResponse } from '../services/api';
import { useShadowOverlayLayer } from './useShadowOverlayLayer';
import ShadowRegionOverlay from './ShadowRegionOverlay';

// Real crater-catalog overlay for whichever pane(s) happen to be one of our
// 4 real Chandrayaan-2 frames with real per-pixel geometry (matched by
// filename against backend/app/main.py's CHANDRAYAAN2_IMAGE_IDS). An
// uploaded pair that isn't one of those 4 frames has no real geometry
// backing it, so this intentionally stays silent for that pane rather than
// guessing -- no crater markers is the honest behavior there, not a bug.
function useChandrayaan2Craters(filename: string | null | undefined) {
  const imageId = useMemo(() => chandrayaan2ImageIdForFilename(filename), [filename]);
  const [resp, setResp] = useState<Chandrayaan2CratersResponse | null>(null);
  useEffect(() => {
    setResp(null);
    if (!imageId) return;
    let cancelled = false;
    fetchChandrayaan2Craters(imageId).then((r) => {
      if (!cancelled) setResp(r);
    }).catch(() => {
      if (!cancelled) setResp(null);
    });
    return () => {
      cancelled = true;
    };
  }, [imageId]);
  return { imageId, resp };
}

export default function StepDetection({ data }: { data: WorkspaceData }) {
  const [mode, setMode] = useState<'lines' | 'zoom'>('zoom');
  // Layer A only (see useShadowOverlayLayer / shadow.py): pixels dark AT THE
  // MOMENT OF CAPTURE, never labeled "permanent" or "PSR" anywhere below.
  // Off by default since this panel is already dense with match/crater
  // content -- an explicit, deliberate toggle rather than always-on.
  const [showShadow, setShowShadow] = useState(false);
  // Off by default for the same reason as showShadow -- this panel is
  // already dense; an explicit toggle rather than always-on.
  const [showDetectedCraters, setShowDetectedCraters] = useState(false);
  // The backend returns real detections down to confidence 0.02 (see
  // run_pipeline.py::_detect_craters_safe) rather than a single hardcoded
  // cutoff -- this project's own measured data shows the "right" threshold
  // is genuinely image-dependent (one real frame needed ~0.01 to surface
  // anything, another was already dense at 0.15). 0.15 as the default
  // matches this model's originally-calibrated value; the slider lets a
  // user reveal the model's lower-confidence candidates on request instead
  // of us silently guessing one threshold that's wrong for most images.
  const [craterConfThreshold, setCraterConfThreshold] = useState(0.15);
  const craterDetectionsFiltered = useMemo(() => {
    if (!data.craterDetections) return null;
    return {
      src: data.craterDetections.src.filter((c) => c.confidence >= craterConfThreshold),
      ref: data.craterDetections.ref.filter((c) => c.confidence >= craterConfThreshold),
    };
  }, [data.craterDetections, craterConfThreshold]);
  const hasDetectedCraters = !!(craterDetectionsFiltered && (craterDetectionsFiltered.src.length > 0 || craterDetectionsFiltered.ref.length > 0));

  const srcImg = data.srcProcessedUrl || data.sourceUrl;
  const refImg = data.refProcessedUrl || data.refUrl;
  const srcShape = data.srcShape;
  const refShape = data.refShape;

  const srcElRef = useRef<HTMLDivElement>(null);
  const refElRef = useRef<HTMLDivElement>(null);
  const srcViewer = useOsdViewer(srcElRef, mode === 'zoom' ? srcImg : null);
  const refViewer = useOsdViewer(refElRef, mode === 'zoom' ? refImg : null);

  useShadowOverlayLayer(srcViewer, mode === 'zoom' ? data.srcShadowOverlayUrl : null, showShadow ? 0.85 : 0);
  useShadowOverlayLayer(refViewer, mode === 'zoom' ? data.refShadowOverlayUrl : null, showShadow ? 0.85 : 0);
  const hasShadowData = !!(data.srcShadowOverlayUrl || data.refShadowOverlayUrl);

  const { imageId: srcCraterImageId, resp: srcCraterResp } = useChandrayaan2Craters(data.sourceFile?.name);
  const { imageId: refCraterImageId, resp: refCraterResp } = useChandrayaan2Craters(data.refFile?.name);

  // Real catalog crater pixel positions are computed by the backend against
  // the RAW uploaded preview image's dimensions. The pane here displays the
  // PROCESSED image (illumination-normalized, possibly uniformly rescaled by
  // multi-scale leveling -- a pure resize, never a crop, confirmed in
  // preprocessing.level_for_matching). So positions are rescaled by the
  // exact ratio between the two, not re-derived or approximated.
  // When there's no real processed image (backend unreachable / simulation
  // fallback, or a real pair the backend rejected e.g. non-overlapping
  // frames), the pane displays the RAW uploaded image directly -- which is
  // exactly what the crater endpoint's pixel positions were computed
  // against, so the correct scale there is 1:1, not "no markers."
  // gsd_m_per_px (real meters-per-pixel, from the backend's real lon/lat
  // span and native pixel dimensions) is in NATIVE-raw-image space; rescale
  // it by the same factor as the pixel positions so a crater's real
  // diameter converts correctly into whichever pixel space is displayed.
  const srcCraters = useMemo(() => {
    if (!srcCraterResp) return { points: [], gsdMPerPx: 0 };
    let w = srcCraterResp.image_width;
    let h = srcCraterResp.image_height;
    if (srcShape && data.srcProcessedUrl) [h, w] = srcShape;
    const sx = w / srcCraterResp.image_width;
    const sy = h / srcCraterResp.image_height;
    return {
      points: srcCraterResp.craters.map((c) => ({ ...c, pixel_x: c.pixel_x * sx, pixel_y: c.pixel_y * sy })),
      gsdMPerPx: srcCraterResp.gsd_m_per_px / sx,
    };
  }, [srcCraterResp, srcShape, data.srcProcessedUrl]);
  const refCraters = useMemo(() => {
    if (!refCraterResp) return { points: [], gsdMPerPx: 0 };
    let w = refCraterResp.image_width;
    let h = refCraterResp.image_height;
    if (refShape && data.refProcessedUrl) [h, w] = refShape;
    const sx = w / refCraterResp.image_width;
    const sy = h / refCraterResp.image_height;
    return {
      points: refCraterResp.craters.map((c) => ({ ...c, pixel_x: c.pixel_x * sx, pixel_y: c.pixel_y * sy })),
      gsdMPerPx: refCraterResp.gsd_m_per_px / sx,
    };
  }, [refCraterResp, refShape, data.refProcessedUrl]);

  // Detection shows the matcher's raw output, BEFORE geometric verification --
  // colored by match confidence only, never by inlier/outlier. That verdict
  // doesn't exist yet at this stage; it's what the next step (RANSAC) computes.
  // Coloring these by p.inlier would show the RANSAC step's answer one step
  // early and make the two panels look like duplicates of each other.
  const confidences = data.matchPoints.map((p) => p.confidence).filter((c): c is number => c != null);
  const hasConfidence = confidences.length > 0;
  const colorForConfidence = (c: number | null) => {
    if (c == null) return { color: '#f59e0b', opacity: 0.75 };
    return { color: '#f59e0b', opacity: 0.3 + 0.6 * Math.max(0, Math.min(1, c)) };
  };
  const srcOverlayPoints = useMemo(
    () => data.matchPoints.map((p) => ({ x: p.src_x, y: p.src_y, ...colorForConfidence(p.confidence) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.matchPoints]
  );
  const refOverlayPoints = useMemo(
    () => data.matchPoints.map((p) => ({ x: p.ref_x, y: p.ref_y, ...colorForConfidence(p.confidence) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.matchPoints]
  );

  const linePoints: CorrespondencePoint[] = useMemo(
    () =>
      data.matchPoints.map((p) => {
        const c = p.confidence ?? 0.6;
        const { color, opacity } = colorForConfidence(p.confidence);
        return {
          src_x: p.src_x,
          src_y: p.src_y,
          ref_x: p.ref_x,
          ref_y: p.ref_y,
          color,
          opacity,
          dotRadius: 3,
          lineWidth: 1,
          lineOpacity: 0.15 + 0.45 * Math.max(0, Math.min(1, c)),
          sortWeight: c,
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.matchPoints]
  );

  return (
    <div>
      <div className="bg-white border border-gray-200 p-6 shadow-sm rounded-sm">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h3 className="text-xs font-bold tracking-wide uppercase text-gray-700">Candidate matches (pre-verification)</h3>
          <div className="flex items-center gap-2">
            {hasShadowData && mode === 'zoom' && (
              <button
                onClick={() => setShowShadow((s) => !s)}
                className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide border rounded-sm ${
                  showShadow ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-gray-500 border-gray-300 hover:border-black'
                }`}
              >
                Shadow (at capture)
              </button>
            )}
            {data.craterDetections && mode === 'zoom' && (
              <button
                onClick={() => setShowDetectedCraters((s) => !s)}
                className={`px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide border rounded-sm ${
                  showDetectedCraters ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-gray-500 border-gray-300 hover:border-black'
                }`}
              >
                Detected craters (YOLOv8)
              </button>
            )}
            <ModeToggle mode={mode} setMode={setMode} />
          </div>
        </div>

        {showDetectedCraters && data.craterDetections && mode === 'zoom' && (
          <div className="flex items-center gap-2 mb-4 -mt-2">
            <span className="text-[9px] text-gray-500 uppercase tracking-wide whitespace-nowrap">Min confidence</span>
            <input
              type="range"
              min={0.02}
              max={0.9}
              step={0.01}
              value={craterConfThreshold}
              onChange={(e) => setCraterConfThreshold(parseFloat(e.target.value))}
              className="w-40 accent-cyan-600"
            />
            <span className="text-[9px] font-mono text-cyan-700 w-10">{craterConfThreshold.toFixed(2)}</span>
            <span className="text-[9px] text-gray-400">
              Lower reveals more of the model's real (lower-confidence) detections — also more false positives.
            </span>
          </div>
        )}

        {mode === 'lines' && srcImg && refImg && srcShape && refShape ? (
          <CorrespondenceCanvas srcUrl={srcImg} refUrl={refImg} srcShape={srcShape} refShape={refShape} points={linePoints} capLabel="match" />
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Source</span>
              <div className="relative h-[380px] overflow-hidden rounded-sm">
                <div ref={srcElRef} className="w-full h-full border border-gray-300 bg-black" />
                <OsdPointOverlay viewer={srcViewer} points={srcOverlayPoints} />
                {srcCraterImageId && (
                  <CraterPinOverlay viewer={srcViewer} craters={srcCraters.points} gsdMPerPx={srcCraters.gsdMPerPx} />
                )}
                {showShadow && data.shadowAnalysis?.src.regions && (
                  <ShadowRegionOverlay
                    viewer={srcViewer}
                    regions={data.shadowAnalysis.src.regions}
                    sunAngleContext={data.shadowAnalysis.src.sun_angle_context}
                  />
                )}
                {showDetectedCraters && craterDetectionsFiltered && (
                  <DetectedCraterOverlay viewer={srcViewer} craters={craterDetectionsFiltered.src} />
                )}
              </div>
              {srcCraterImageId && srcCraterResp && srcCraterResp.count === 0 && (
                <p className="text-[9px] text-purple-600">
                  No catalog-listed craters (≥1–2km) fall within this image's real footprint.
                </p>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[10px] text-gray-500 uppercase tracking-wide">Reference</span>
              <div className="relative h-[380px] overflow-hidden rounded-sm">
                <div ref={refElRef} className="w-full h-full border border-gray-300 bg-black" />
                <OsdPointOverlay viewer={refViewer} points={refOverlayPoints} />
                {refCraterImageId && (
                  <CraterPinOverlay viewer={refViewer} craters={refCraters.points} gsdMPerPx={refCraters.gsdMPerPx} />
                )}
                {showShadow && data.shadowAnalysis?.ref.regions && (
                  <ShadowRegionOverlay
                    viewer={refViewer}
                    regions={data.shadowAnalysis.ref.regions}
                    sunAngleContext={data.shadowAnalysis.ref.sun_angle_context}
                  />
                )}
                {showDetectedCraters && craterDetectionsFiltered && (
                  <DetectedCraterOverlay viewer={refViewer} craters={craterDetectionsFiltered.ref} />
                )}
              </div>
              {refCraterImageId && refCraterResp && refCraterResp.count === 0 && (
                <p className="text-[9px] text-purple-600">
                  No catalog-listed craters (≥1–2km) fall within this image's real footprint.
                </p>
              )}
            </div>
          </div>
        )}

        {(srcCraterImageId || refCraterImageId) && (
          <p className="text-[10px] text-purple-600 mt-2 flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-purple-500" /> Real crater-catalog
            markers (Robbins 2019 / USGS Gazetteer) — click a marker for details. Catalogs are complete only to
            ~1–2km diameter; smaller craters visible here are not individually cataloged.
          </p>
        )}

        {showShadow && hasShadowData && (
          <p className="text-[10px] text-orange-600 mt-2 flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-orange-500" /> Shadow regions (at time
            of capture) — click a marker for details, including why this is not a permanent shadow (PSR).
          </p>
        )}

        {showDetectedCraters && data.craterDetections && (
          <p className="text-[10px] text-cyan-600 mt-2 flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full border-2 border-dashed border-cyan-500" /> YOLOv8
            model detections on this pair's own pixels (hover/click for confidence and radius) — distinct from the
            purple catalog markers above, which are a pre-published crater catalog lookup available only for the 4
            real Chandrayaan-2 frames. This model's real detection density varies a lot from image to image; a run
            with few or no markers here is a real, reported result, not a bug.
            {!hasDetectedCraters && ' No detections above the confidence threshold for this pair.'}
            {hasDetectedCraters && ' Detections are spread across the full image — zoom out or use the home button if a pane\'s default crop is hiding some of them.'}
          </p>
        )}

        <div className="flex justify-between mt-4 text-xs text-gray-500">
          <span>Keypoints (source): {data.keypointsSource}</span>
          <span>Keypoints (reference): {data.keypointsRef}</span>
          <span>Candidate matches: {data.candidateMatches}</span>
        </div>
        <p className="text-[10px] text-gray-400 mt-2">
          {mode === 'lines'
            ? 'Lines connect each candidate match across the two images; brightness/opacity encode match confidence.'
            : 'Both panes fill the frame at the same height by default — zoom out or use the home button to see the whole image, pan/zoom either pane independently.'}{' '}
          {hasConfidence
            ? ''
            : "This run's matcher doesn't report per-match confidence, so all points/lines show at a fixed brightness. "}
          Before geometric verification — which of these are inliers vs outliers is what the next step, RANSAC, determines, not shown here.
        </p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
        <Stat label="Keypoints (source)" value={data.keypointsSource} />
        <Stat label="Keypoints (ref)" value={data.keypointsRef} />
        <Stat label="Candidate matches" value={data.candidateMatches} />
        <Stat
          label="Mean match confidence"
          value={hasConfidence ? (confidences.reduce((s, c) => s + c, 0) / confidences.length).toFixed(2) : 'n/a'}
        />
      </div>
    </div>
  );
}

const ModeToggle = ({ mode, setMode }: { mode: 'lines' | 'zoom'; setMode: (m: 'lines' | 'zoom') => void }) => (
  <div className="flex text-[10px] font-mono uppercase tracking-wide border border-gray-300 rounded-sm overflow-hidden">
    <button
      onClick={() => setMode('lines')}
      className={`px-3 py-1.5 ${mode === 'lines' ? 'bg-black text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
    >
      Correspondence lines
    </button>
    <button
      onClick={() => setMode('zoom')}
      className={`px-3 py-1.5 border-l border-gray-300 ${mode === 'zoom' ? 'bg-black text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}
    >
      Zoom &amp; pan
    </button>
  </div>
);

const Stat = ({ label, value }: { label: string; value: number | string }) => (
  <div className="bg-white border border-gray-200 p-4 shadow-sm rounded-sm">
    <div className="font-mono text-2xl font-bold text-black">{value}</div>
    <div className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</div>
  </div>
);
