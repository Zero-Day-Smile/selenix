// workspace_components/CraterPinOverlay.tsx
//
// Real crater-catalog markers over an OpenSeadragon viewer, sized to each
// crater's REAL diameter (via the backend's real ground-sample-distance
// estimate) rather than a fixed, meaningless radius -- so the ring traces
// close to the crater's real rim size instead of just marking a point.
// We do NOT draw an elliptical/irregular outline: the catalogs give us a
// center + diameter, not a real boundary polygon or orientation, so a
// circle sized to the real diameter is the honest version of "trace the
// rim" -- anything more shaped would be inventing data we don't have.
// Position/size tracking uses imageToViewerElementCoordinates so markers
// stay correctly placed and sized as the pane pans/zooms.
import React, { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';
import type { CatalogCrater } from '../services/api';

// Conservative worst-case popup height (named crater with a Gazetteer link,
// the tallest variant) -- used to flip the popup above the marker instead
// of letting it clip past the pane's clipped bottom edge.
const POPUP_HEIGHT_ESTIMATE = 190;
// Usability floor so a genuinely tiny real crater (near the catalog's
// ~1km completeness limit) still has a clickable target -- never shrinks
// a marker below its real size, only ever grows small ones up to this.
const MIN_SCREEN_RADIUS = 5;

type ScreenCrater = CatalogCrater & { sx: number; sy: number; screenRadius: number };

export default function CraterPinOverlay({
  viewer,
  craters,
  gsdMPerPx,
}: {
  viewer: OpenSeadragon.Viewer | null;
  craters: CatalogCrater[];
  gsdMPerPx: number;
}) {
  const [screenPoints, setScreenPoints] = useState<ScreenCrater[]>([]);
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const cratersRef = useRef(craters);
  cratersRef.current = craters;
  const gsdRef = useRef(gsdMPerPx);
  gsdRef.current = gsdMPerPx;
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

  const recomputeRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!viewer) return;
    const recompute = () => {
      // Use the base image item's own transform, not viewport.imageToViewerElementCoordinates
      // -- that one is ambiguous (and OSD warns loudly) once a second layer
      // (e.g. the shadow overlay) is added to the same viewer's world.
      const baseItem = viewer.world.getItemAt(0);
      if (!baseItem) return;
      const gsd = gsdRef.current;
      const next = cratersRef.current.map((c) => {
        const centerPt = new OpenSeadragon.Point(c.pixel_x, c.pixel_y);
        const centerScreen = baseItem.imageToViewerElementCoordinates(centerPt);
        let screenRadius = MIN_SCREEN_RADIUS;
        if (c.diameter_km && gsd > 0) {
          const radiusImagePx = (c.diameter_km * 1000) / 2 / gsd;
          const edgeScreen = baseItem.imageToViewerElementCoordinates(
            new OpenSeadragon.Point(c.pixel_x + radiusImagePx, c.pixel_y)
          );
          screenRadius = Math.max(Math.hypot(edgeScreen.x - centerScreen.x, edgeScreen.y - centerScreen.y), MIN_SCREEN_RADIUS);
        }
        return { ...c, sx: centerScreen.x, sy: centerScreen.y, screenRadius };
      });
      setScreenPoints(next);
    };
    recomputeRef.current = recompute;
    recompute();
    // 'animation' fires on every frame WHILE the viewport is still moving (e.g.
    // the home "fly-in" transition on open); 'animation-finish' is the
    // reliable "it has now actually settled" signal. Relying on 'animation'
    // alone risks freezing on an intermediate, not-yet-settled zoom/pan if
    // the loop goes idle before another event happens to fire.
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
  }, [viewer, craters, gsdMPerPx]);

  // dismiss on any click outside the popup/markers
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

  // Real diameter-accurate rings can legitimately overlap (nearby craters
  // are nearby). Render largest-first so smaller rings stack on top and
  // stay clickable -- otherwise a big neighbor's ring can fully cover a
  // small crater's marker, making it un-clickable for anyone, not just tests.
  const renderOrder = [...screenPoints.keys()].sort((a, b) => screenPoints[b].screenRadius - screenPoints[a].screenRadius);

  return (
    <div ref={containerRef} className="absolute inset-0 pointer-events-none" style={{ zIndex: 10 }}>
      {renderOrder.map((i) => {
        const c = screenPoints[i];
        const named = !!c.name;
        const label = c.name || c.crater_id;
        const color = named ? '#2dd4bf' : '#c084fc';
        const r = c.screenRadius;
        return (
          <React.Fragment key={i}>
            {/* Ring sized to the crater's real diameter (via real GSD) --
                traces close to the actual rim instead of a fixed dot. */}
            <div
              onClick={() => {
                recomputeRef.current();
                setOpenIndex(openIndex === i ? null : i);
              }}
              className="absolute rounded-full pointer-events-auto cursor-pointer"
              style={{
                left: c.sx - r,
                top: c.sy - r,
                width: r * 2,
                height: r * 2,
                // Border-only, no fill: real diameters at real zoom can be
                // large and densely overlapping, and a semi-transparent
                // fill stacks into an opaque wash that hides the actual
                // image underneath. A boundary outline (like a real map
                // annotation) stays legible at any size or density.
                border: `${named ? 2 : 1.5}px solid ${color}`,
                boxShadow: named ? `0 0 4px ${color}` : 'none',
              }}
              title={c.name || `Robbins crater ${c.crater_id}, ${c.diameter_km?.toFixed(1)}km`}
            />
            {/* Always-visible label next to the ring -- named craters show
                their real name; unnamed (Robbins-only) craters show their
                real catalog ID instead of nothing, since that's still real,
                citable data even though it isn't an official name. */}
            {label && (
              <span
                className="absolute pointer-events-none text-[10px] font-semibold whitespace-nowrap"
                style={{
                  left: c.sx + r + 4,
                  top: c.sy - 7,
                  color: named ? '#ffffff' : '#e9d5ff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.9)',
                }}
              >
                {label}
              </span>
            )}
          </React.Fragment>
        );
      })}

      {open && (
        <div
          className="absolute pointer-events-auto bg-white border border-purple-300 rounded-sm shadow-lg text-xs w-64"
          style={{
            left: Math.min(Math.max(open.sx - 100, 4), Math.max(4, containerSize.w - 256 - 4)),
            top:
              open.sy + 14 + POPUP_HEIGHT_ESTIMATE > containerSize.h
                ? Math.max(4, open.sy - POPUP_HEIGHT_ESTIMATE - 6)
                : open.sy + 14,
          }}
        >
          <div className="flex items-start justify-between px-3 pt-2">
            <div>
              <div className="font-bold text-sm">{open.name || 'Unnamed'}</div>
              {!open.name && (
                <div className="text-[9px] text-gray-400 -mt-0.5">
                  Not one of the Moon's 1,615 IAU-named craters — cataloged by measurement only
                </div>
              )}
            </div>
            <button onClick={() => setOpenIndex(null)} className="text-gray-400 hover:text-black leading-none text-base shrink-0 ml-2">
              ×
            </button>
          </div>
          <div className="px-3 pb-3 pt-1 space-y-1">
            {open.crater_id && (
              <div>
                Catalog ID: <span className="font-mono">{open.crater_id}</span>
              </div>
            )}
            <div>
              Diameter:{' '}
              <span className="font-mono">{open.diameter_km != null ? `${open.diameter_km.toFixed(2)} km` : 'not recorded'}</span>
            </div>
            <div>
              Latitude: <span className="font-mono">{open.lat.toFixed(4)}°</span>
            </div>
            <div>
              Longitude: <span className="font-mono">{open.lon.toFixed(4)}°</span> <span className="text-gray-400">(0–360° convention)</span>
            </div>
            <div className="text-[9px] text-gray-500 pt-1 border-t border-gray-100 mt-1">Source: {open.source}</div>
            {open.gazetteer_link && (
              <a
                href={open.gazetteer_link}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-[10px] font-bold text-purple-600 underline hover:text-purple-800 pt-1"
              >
                USGS Gazetteer page →
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
