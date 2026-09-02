// workspace_components/AreaDetailsPanel.tsx
//
// Shows what's actually at the registered pair's real footprint location,
// next to OrbitalFootprintMap. Two independent real external lookups (see
// backend/pipeline/gazetteer.py's module docstring for the real, verified
// facts about both services -- queryable layer names, real request
// formats, the Gazetteer's real POST-only form and its real single-match-
// redirect quirk, all confirmed against live responses before any of this
// was wired up):
//   - ASU Lunaserv WMS GetFeatureInfo: nearest named feature at the
//     footprint's centroid.
//   - USGS Gazetteer of Planetary Nomenclature: every named crater inside
//     the footprint's bounding box (capped to the largest 20).
// Plus real pipeline metrics already in this run's own state (SSIM,
// matcher used, elapsed time) -- not re-fetched, just displayed.
import { useEffect, useState } from 'react';
import {
  fetchNearestNamedFeature, fetchNamedCraters,
  type NearestNamedFeature, type NamedCratersResult,
} from '../services/api';

export interface AreaDetailsPanelProps {
  footprint: [number, number][];
  ssimMean: number;
  ssimValidFraction: number;
  elapsedSeconds: number;
  matcherUsed: string;
}

function centroidOf(footprint: [number, number][]): [number, number] {
  const lat = footprint.reduce((s, p) => s + p[0], 0) / footprint.length;
  const lon = footprint.reduce((s, p) => s + p[1], 0) / footprint.length;
  return [lat, lon];
}

function bboxOf(footprint: [number, number][]) {
  const lats = footprint.map((p) => p[0]);
  const lons = footprint.map((p) => p[1]);
  return {
    latMin: Math.min(...lats), latMax: Math.max(...lats),
    lonMin: Math.min(...lons), lonMax: Math.max(...lons),
  };
}

export default function AreaDetailsPanel({
  footprint, ssimMean, ssimValidFraction, elapsedSeconds, matcherUsed,
}: AreaDetailsPanelProps) {
  const [nearest, setNearest] = useState<NearestNamedFeature | null>(null);
  const [craters, setCraters] = useState<NamedCratersResult | null>(null);
  const [loading, setLoading] = useState(false);

  const footprintKey = footprint && footprint.length ? JSON.stringify(footprint) : '';

  useEffect(() => {
    if (!footprint || footprint.length < 3) {
      setNearest(null);
      setCraters(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const [cLat, cLon] = centroidOf(footprint);
    const bbox = bboxOf(footprint);

    Promise.all([
      fetchNearestNamedFeature(cLat, cLon),
      fetchNamedCraters(bbox.latMin, bbox.latMax, bbox.lonMin, bbox.lonMax),
    ]).then(([n, c]) => {
      if (!cancelled) {
        setNearest(n);
        setCraters(c);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footprintKey]);

  if (!footprint || footprint.length < 3) return null;

  const [centroidLat, centroidLon] = centroidOf(footprint);

  return (
    <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 rounded-sm p-4 text-xs">
      <h4 className="text-[9px] font-bold tracking-widest uppercase text-gray-500 mb-2">Area details</h4>

      {loading && (
        <div className="space-y-1.5 animate-pulse">
          <div className="h-2.5 rounded-sm bg-gray-300/60 dark:bg-white/10 w-2/3" />
          <div className="h-2.5 rounded-sm bg-gray-300/60 dark:bg-white/10 w-1/2" />
        </div>
      )}

      {!loading && (
        <>
          <div className="mb-3">
            <div className="font-bold text-gray-700 dark:text-gray-300 mb-1">Nearest named feature</div>
            {nearest === null ? (
              <p className="italic text-amber-500">Could not reach the real feature lookup service.</p>
            ) : !nearest.available ? (
              <p className="italic text-gray-400">No named feature at this location.</p>
            ) : (
              <div className="font-mono text-gray-800 dark:text-gray-100">
                <div className="font-bold">{nearest.name}</div>
                {nearest.lat != null && nearest.lon != null && (
                  <div>lat {nearest.lat.toFixed(3)}°, lon {nearest.lon.toFixed(3)}°</div>
                )}
                {nearest.diameter_km != null && <div>diameter {nearest.diameter_km.toFixed(1)}km</div>}
              </div>
            )}
          </div>

          <div className="mb-3 pt-2 border-t border-gray-200 dark:border-white/10">
            <div className="font-bold text-gray-700 dark:text-gray-300 mb-1">Footprint centroid</div>
            <div className="font-mono text-gray-800 dark:text-gray-100">
              lat {centroidLat.toFixed(3)}°, lon {centroidLon.toFixed(3)}°
            </div>
          </div>

          <div className="mb-3 pt-2 border-t border-gray-200 dark:border-white/10">
            <div className="font-bold text-gray-700 dark:text-gray-300 mb-1">Pipeline metrics</div>
            <div className="font-mono text-gray-800 dark:text-gray-100 space-y-0.5">
              <div>SSIM (mean): {ssimMean.toFixed(3)}</div>
              <div>Valid pixel fraction: {(ssimValidFraction * 100).toFixed(1)}%</div>
              <div>Elapsed: {elapsedSeconds.toFixed(1)}s</div>
              <div>Matcher: {matcherUsed || 'n/a'}</div>
            </div>
          </div>

          <div className="pt-2 border-t border-gray-200 dark:border-white/10">
            <div className="font-bold text-gray-700 dark:text-gray-300 mb-1">Named craters in footprint</div>
            {craters === null ? (
              <p className="italic text-amber-500">Could not reach the real USGS Gazetteer.</p>
            ) : craters.craters.length === 0 ? (
              <p className="italic text-gray-400">No named craters in this footprint.</p>
            ) : (
              <>
                <ul className="space-y-0.5 font-mono text-gray-800 dark:text-gray-100 max-h-40 overflow-y-auto">
                  {craters.craters.map((c) => (
                    <li key={c.name} className="flex justify-between gap-2">
                      <span>{c.name}</span>
                      <span className="text-gray-500 shrink-0">
                        {c.lat.toFixed(2)}°, {c.lon.toFixed(2)}°{c.diameter_km != null ? ` — ${c.diameter_km.toFixed(1)}km` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {craters.count_total > craters.count_returned && (
                  <p className="text-[9px] text-gray-500 mt-1">
                    Showing largest {craters.count_returned} of {craters.count_total} real named craters found.
                  </p>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
