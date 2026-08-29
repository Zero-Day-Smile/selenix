// workspace_components/DetectedCraterOverlay.tsx
//
// Real YOLOv8 crater-detector markers (backend/pipeline/crater_detector.py,
// Step 7 of the crater-detector task) over an OpenSeadragon viewer. These
// are model detections on THIS pair's own pixels -- distinct from
// CraterPinOverlay's real crater-CATALOG lookup (which only covers the 4
// Chandrayaan-2 frames with known per-pixel geometry, and only shows
// craters ≥1-2km already published in Robbins/USGS). Styled distinctly
// from both that overlay (purple, diameter-accurate rings) and the
// SIFT/LoFTR match markers on this same panel (amber dots/lines): cyan
// dashed circles, sized to the model's own detected radius_px, with
// confidence/radius shown on click/hover.
//
// This model's real, measured generalization is uneven across this
// project's own dataset (2/27 real images ≥100 detections, 59% <20 --
// see TASKS.md) -- shown as-is here, including runs where it finds
// nothing or very little, rather than hidden or padded.
import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';

export type DetectedCrater = { cx: number; cy: number; radius_px: number; confidence: number };
type ScreenCrater = DetectedCrater & { sx: number; sy: number; screenRadius: number };

// A real 13-20px detection at this panel's typical overview zoom (whole
// ~1000px-wide image in a 380px pane) reduces to only a few screen pixels
// -- a thin dashed ring at that size is imperceptible next to the much
// bolder amber match dots on the same panel. A fixed-size solid center dot
// guarantees visibility at any zoom regardless of the crater's real size;
// the dashed ring (sized to the real radius, when big enough to read) adds
// the size context on top of that once zoomed in.
const CENTER_DOT_RADIUS = 4;
const MIN_RING_RADIUS = 7;

export default function DetectedCraterOverlay({
  viewer,
  craters,
}: {
  viewer: OpenSeadragon.Viewer | null;
  craters: DetectedCrater[];
}) {
  const [screenPoints, setScreenPoints] = useState<ScreenCrater[]>([]);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const cratersRef = useRef(craters);
  cratersRef.current = craters;

  useEffect(() => {
    if (!viewer) return;
    const recompute = () => {
      const baseItem = viewer.world.getItemAt(0);
      if (!baseItem) return;
      const next = cratersRef.current.map((c) => {
        const centerScreen = baseItem.imageToViewerElementCoordinates(new OpenSeadragon.Point(c.cx, c.cy));
        const edgeScreen = baseItem.imageToViewerElementCoordinates(new OpenSeadragon.Point(c.cx + c.radius_px, c.cy));
        const screenRadius = Math.max(Math.hypot(edgeScreen.x - centerScreen.x, edgeScreen.y - centerScreen.y), MIN_RING_RADIUS);
        return { ...c, sx: centerScreen.x, sy: centerScreen.y, screenRadius };
      });
      setScreenPoints(next);
    };
    recompute();
    viewer.addHandler('animation', recompute);
    viewer.addHandler('animation-finish', recompute);
    viewer.addHandler('open', recompute);
    viewer.addHandler('resize', recompute);
    return () => {
      viewer.removeHandler('animation', recompute);
      viewer.removeHandler('animation-finish', recompute);
      viewer.removeHandler('open', recompute);
      viewer.removeHandler('resize', recompute);
    };
  }, [viewer, craters]);

  if (screenPoints.length === 0) return null;

  const hovered = hoverIndex != null ? screenPoints[hoverIndex] : null;

  return (
    <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 9 }}>
      {screenPoints.map((c, i) => {
        const alpha = 0.5 + 0.5 * Math.max(0, Math.min(1, c.confidence));
        return (
          <React.Fragment key={i}>
            {/* Dashed ring, sized to the model's real detected radius --
                the size cue, once zoomed in enough to read it. */}
            <div
              className="absolute rounded-full pointer-events-none"
              style={{
                left: c.sx - c.screenRadius,
                top: c.sy - c.screenRadius,
                width: c.screenRadius * 2,
                height: c.screenRadius * 2,
                border: `2px dashed rgba(34, 211, 238, ${alpha})`,
              }}
            />
            {/* Solid center dot, fixed size -- the always-visible cue,
                independent of zoom or how small the real radius is. */}
            <div
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex((h) => (h === i ? null : h))}
              onClick={() => setHoverIndex((h) => (h === i ? null : i))}
              className="absolute rounded-full pointer-events-auto cursor-pointer"
              style={{
                left: c.sx - CENTER_DOT_RADIUS,
                top: c.sy - CENTER_DOT_RADIUS,
                width: CENTER_DOT_RADIUS * 2,
                height: CENTER_DOT_RADIUS * 2,
                backgroundColor: `rgba(34, 211, 238, ${alpha})`,
                boxShadow: '0 0 4px rgba(34, 211, 238, 0.9), 0 0 1px rgba(0,0,0,0.6)',
              }}
              title={`Detected crater — confidence ${c.confidence.toFixed(2)}, radius ${c.radius_px.toFixed(1)}px`}
            />
          </React.Fragment>
        );
      })}

      {hovered && (
        <div
          className="absolute pointer-events-none bg-black/85 text-white text-[10px] font-mono px-2 py-1 rounded-sm"
          style={{ left: hovered.sx + hovered.screenRadius + 4, top: hovered.sy - hovered.screenRadius - 4 }}
        >
          conf {hovered.confidence.toFixed(2)} · r {hovered.radius_px.toFixed(1)}px
        </div>
      )}
    </div>
  );
}
