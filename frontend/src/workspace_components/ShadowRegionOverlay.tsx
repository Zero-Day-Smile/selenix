// workspace_components/ShadowRegionOverlay.tsx
//
// Clickable markers over each real, connected shadow region (see
// backend/pipeline/shadow.py's find_shadow_regions -- real cv2 connected-
// component segmentation of the sparse dark-tail mask, not fabricated
// blobs). Click opens a small popup with the region's real area and the
// mandatory "not permanent shadow" disclaimer -- moved here from a
// permanent on-page text block so the honesty note is still one click
// away for anyone who wants it, without the page defaulting to a wall of
// text every time the shadow layer is on.
import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import type { ShadowRegion, SunAngleContext } from '../services/api';

const POPUP_HEIGHT_ESTIMATE = 210;
const MIN_SCREEN_RADIUS = 5;
const MAX_SCREEN_RADIUS = 22;

type ScreenRegion = ShadowRegion & { sx: number; sy: number; screenRadius: number };

export default function ShadowRegionOverlay({
  viewer,
  regions,
  sunAngleContext,
}: {
  viewer: OpenSeadragon.Viewer | null;
  regions: ShadowRegion[];
  sunAngleContext: SunAngleContext | null;
}) {
  const [screenPoints, setScreenPoints] = useState<ScreenRegion[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const regionsRef = useRef(regions);
  regionsRef.current = regions;
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!viewer) return;
    const recompute = () => {
      // Base image item's own transform, not viewport.imageToViewerElementCoordinates
      // -- ambiguous (and OSD warns loudly) once the shadow raster tint is
      // also loaded as a second image in the same viewer's world.
      const baseItem = viewer.world.getItemAt(0);
      if (!baseItem) return;
      const next = regionsRef.current.map((r) => {
        const centerScreen = baseItem.imageToViewerElementCoordinates(new OpenSeadragon.Point(r.pixel_x, r.pixel_y));
        const edgeScreen = baseItem.imageToViewerElementCoordinates(
          new OpenSeadragon.Point(r.pixel_x + Math.sqrt(r.area_px / Math.PI), r.pixel_y)
        );
        const screenRadius = Math.min(
          Math.max(Math.hypot(edgeScreen.x - centerScreen.x, edgeScreen.y - centerScreen.y), MIN_SCREEN_RADIUS),
          MAX_SCREEN_RADIUS
        );
        return { ...r, sx: centerScreen.x, sy: centerScreen.y, screenRadius };
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
  }, [viewer, regions]);

  useEffect(() => {
    if (openIndex === null) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpenIndex(null);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [openIndex]);

  const open = openIndex != null ? screenPoints[openIndex] : null;

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 11 }}>
      {screenPoints.map((r, i) => (
        <div
          key={i}
          onClick={() => setOpenIndex(openIndex === i ? null : i)}
          className="absolute rounded-full pointer-events-auto cursor-pointer"
          style={{
            left: r.sx - r.screenRadius,
            top: r.sy - r.screenRadius,
            width: r.screenRadius * 2,
            height: r.screenRadius * 2,
            border: `${openIndex === i ? 2.5 : 1.5}px solid #fb923c`,
            boxShadow: '0 0 3px rgba(251,146,60,0.9)',
          }}
          title={`Shadow region, ${r.area_px}px²`}
        />
      ))}

      {open && (
        <div
          className="absolute pointer-events-auto bg-white border border-orange-300 rounded-sm shadow-lg text-xs w-64"
          style={{
            left: Math.min(Math.max(open.sx - 100, 4), Math.max(4, containerSize.w - 256 - 4)),
            top:
              open.sy + 14 + POPUP_HEIGHT_ESTIMATE > containerSize.h
                ? Math.max(4, open.sy - POPUP_HEIGHT_ESTIMATE - 6)
                : open.sy + 14,
          }}
        >
          <div className="flex items-start justify-between px-3 pt-2">
            <div className="font-bold text-sm text-orange-700">Shadowed at time of capture</div>
            <button onClick={() => setOpenIndex(null)} className="text-gray-400 hover:text-black leading-none text-base shrink-0 ml-2">
              ×
            </button>
          </div>
          <div className="px-3 pb-3 pt-1 space-y-1.5">
            <div>
              Area: <span className="font-mono">{open.area_px.toLocaleString()} px²</span>
            </div>
            <div className="text-[9px] text-gray-400">
              Bounding box: {open.bbox.w}×{open.bbox.h}px at ({open.bbox.x}, {open.bbox.y})
            </div>
            {sunAngleContext && (
              <div className="text-[10px] text-gray-600">
                Real solar incidence: <span className="font-mono">{sunAngleContext.solar_incidence_mean_deg}°</span> (mean,{' '}
                {sunAngleContext.n_records} telemetry records)
              </div>
            )}
            <p className="text-[9px] text-gray-500 leading-relaxed pt-1.5 border-t border-gray-100">
              Not a permanent shadow (PSR) — a single image only shows what was dark at this specific capture. Real
              PSRs require modeling illumination over years (LOLA GDRPSR, Mazarico et al. 2011). This image's real
              latitude falls outside every published PSR product's coverage, so there's no PSR ground truth to
              cross-reference here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
