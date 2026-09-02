// workspace_components/OrbitalGeometryPanel.tsx
//
// Text-only panel: real Chandrayaan-2/LRO spacecraft position at each
// image's real acquisition time, real viewing-angle divergence, real sun
// angle (Chandrayaan-2 side; LRO has no real per-acquisition sun-angle
// telemetry in this project's archive, honestly shown as "not available").
// No Three.js/globe -- see backend/pipeline/orbital_geometry.py's module
// docstring for exactly what's real here and how it was verified (J2000
// Chandrayaan-2 .spm telemetry + real NAIF LRO SPK kernels, cross-checked
// against each product's own independently-derived ground truth -- never
// satellite.js/SGP4/TLE, which don't apply to lunar orbiters at all).
//
// Mounted at the Workspace level (not just the Upload stage), so it stays
// visible across every stage rather than being lost the moment the app
// auto-advances past Upload. Collapsed by default (a one-line summary) --
// the full detail (both positions, angles, the real context image) adds
// real vertical bulk that's unwelcome repeated on every single stage;
// expand on click when actually wanted. This component is a stable
// sibling in Workspace.tsx's JSX (not inside the per-step conditional), so
// it doesn't unmount between stage switches -- the collapsed/expanded
// state survives navigation naturally, no persistence needed for that.
import { useEffect, useState } from 'react';
import { fetchOrbitalGeometry, moonContextImageUrl, type OrbitalGeometryResult, type OrbitalPosition } from '../services/api';
import OrbitalFootprintMap from './OrbitalFootprintMap';
import AreaDetailsPanel from './AreaDetailsPanel';

// Real lunar surface imagery of this pair's real target location (ASU's
// public Lunaserv WMS, LRO WAC global mosaic -- see
// backend/app/main.py's /api/moon_context_image docstring). An <img> tag
// makes the request directly, so a real network failure just shows the
// honest "could not load" state below rather than a broken-image icon.
function MoonContextImage({ lat, lon }: { lat: number; lon: number }) {
  const [failed, setFailed] = useState(false);
  const url = moonContextImageUrl(lat, lon);

  return (
    <div className="mt-3 pt-3 border-t border-gray-200 dark:border-white/10">
      <h4 className="text-[9px] font-bold tracking-widest uppercase text-gray-500 mb-1.5">
        Real lunar surface at this target location
      </h4>
      {failed ? (
        <p className="text-xs italic text-amber-500">
          Could not load a real image for this location (public map service unreachable).
        </p>
      ) : (
        <>
          <img
            src={url}
            alt={`Real lunar surface near lat ${lat.toFixed(2)}, lon ${lon.toFixed(2)}`}
            className="rounded-sm border border-gray-200 dark:border-white/10 max-w-full"
            style={{ width: 160, height: 160 }}
            onError={() => setFailed(true)}
          />
          <p className="text-[9px] text-gray-500 mt-1">
            Real LRO WAC global mosaic (ASU Lunaserv, public), ~2° x 2° centered at lat {lat.toFixed(3)}°, lon{' '}
            {lon.toFixed(3)}° -- the real ground location this pair's viewing/sun geometry above refers to.
          </p>
        </>
      )}
    </div>
  );
}

function PositionRow({ label, pos }: { label: string; pos: OrbitalPosition }) {
  if (!pos.available) {
    return (
      <div className="text-xs">
        <span className="font-bold text-gray-500">{label}: </span>
        <span className="italic text-gray-400">not available -- {pos.reason ?? 'no real coverage for this run'}</span>
      </div>
    );
  }
  return (
    <div className="text-xs">
      <span className="font-bold text-gray-700 dark:text-gray-300">{label}: </span>
      <span className="font-mono text-gray-800 dark:text-gray-100">
        lat {pos.lat!.toFixed(3)}°, lon {pos.lon!.toFixed(3)}°, alt {pos.alt_km!.toFixed(1)}km
      </span>
      <div className="text-[9px] text-gray-500 mt-0.5">{pos.source}</div>
    </div>
  );
}

// Compact one-line summary shown when collapsed, so there's still real
// information visible without needing to expand.
function summaryLine(result: OrbitalGeometryResult | null, loading: boolean, fetchFailed: boolean): string {
  if (loading) return 'loading real orbital data…';
  if (fetchFailed) return 'could not reach backend for orbital data';
  if (!result) return 'not available';
  const ch2 = result.ch2.available ? `CH2 lat ${result.ch2.lat!.toFixed(1)}°, lon ${result.ch2.lon!.toFixed(1)}°` : 'CH2 not available';
  const lro = result.lro.available ? `LRO lat ${result.lro.lat!.toFixed(1)}°, lon ${result.lro.lon!.toFixed(1)}°` : 'LRO not available';
  return `${ch2}  •  ${lro}`;
}

export interface OrbitalGeometryPanelProps {
  runDirId: string | null;
  ssimMean?: number;
  ssimValidFraction?: number;
  elapsedSeconds?: number;
  matcherUsed?: string;
}

export default function OrbitalGeometryPanel({
  runDirId, ssimMean = 0, ssimValidFraction = 0, elapsedSeconds = 0, matcherUsed = '',
}: OrbitalGeometryPanelProps) {
  const [result, setResult] = useState<OrbitalGeometryResult | null>(null);
  const [loading, setLoading] = useState(false);
  // Distinct from "no run yet" (runDirId is null): a real run_dir_id
  // exists but the fetch itself failed (backend unreachable, 404 --
  // e.g. a simulated/offline run with no real backend run behind it,
  // or the backend genuinely down at the moment this fired). Silently
  // returning null for both cases (the earlier version of this
  // component) made a real backend failure indistinguishable from
  // "nothing to show here", which is exactly what made this
  // undiagnosable from the outside -- now shown honestly instead.
  const [fetchFailed, setFetchFailed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!runDirId) {
      setResult(null);
      setFetchFailed(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFetchFailed(false);
    fetchOrbitalGeometry(runDirId).then((r) => {
      if (!cancelled) {
        setResult(r);
        setFetchFailed(r === null);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runDirId]);

  // No run yet -- render nothing (this stage simply hasn't produced a real
  // run_dir_id yet: simulation mode, backend unreachable, or before any
  // run at all).
  if (!runDirId) return null;

  return (
    <div className="mt-4 bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 shadow-sm rounded-sm">
      <button
        onClick={() => setExpanded((e) => !e)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <h3 className="text-[10px] font-bold tracking-widest uppercase text-gray-400 shrink-0">Orbital geometry</h3>
          <span className="text-[10px] font-mono text-gray-500 truncate">{summaryLine(result, loading, fetchFailed)}</span>
        </div>
        <span className="text-[10px] text-gray-400 shrink-0">{expanded ? '▲ hide' : '▼ show'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 pt-1 border-t border-gray-200 dark:border-white/10">
          {loading && (
            <div className="space-y-1.5 animate-pulse mt-2">
              <div className="h-2.5 rounded-sm bg-gray-300/60 dark:bg-white/10 w-2/3" />
              <div className="h-2.5 rounded-sm bg-gray-300/60 dark:bg-white/10 w-1/2" />
            </div>
          )}

          {fetchFailed && !loading && (
            <p className="text-xs italic text-amber-500 mt-2">
              Could not reach the backend for this run's orbital geometry (backend unreachable, or this
              was a simulated run with no real run behind it) -- not the same as "no real position data
              for this pair", which would show as "not available" below instead.
            </p>
          )}

          {result && !loading && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                <PositionRow label="Chandrayaan-2 position at capture" pos={result.ch2} />
                <PositionRow label="LRO position at capture" pos={result.lro} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3 pt-3 border-t border-gray-200 dark:border-white/10">
                <div className="text-xs">
                  <span className="font-bold text-gray-700 dark:text-gray-300">Viewing angle divergence: </span>
                  <span className="font-mono text-gray-800 dark:text-gray-100">
                    {result.viewing_angle_divergence_deg != null ? `${result.viewing_angle_divergence_deg.toFixed(1)}°` : 'not available'}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="font-bold text-gray-700 dark:text-gray-300">Sun angle (Chandrayaan-2): </span>
                  <span className="font-mono text-gray-800 dark:text-gray-100">
                    {result.sun_angle_ch2_deg != null ? `${result.sun_angle_ch2_deg.toFixed(1)}°` : 'not available'}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="font-bold text-gray-700 dark:text-gray-300">Sun angle (LRO): </span>
                  <span className="font-mono text-gray-800 dark:text-gray-100">
                    {result.sun_angle_lro_deg != null ? `${result.sun_angle_lro_deg.toFixed(1)}°` : 'not available -- no real per-acquisition telemetry for LRO in this archive'}
                  </span>
                </div>
              </div>

              <p className="text-[10px] text-gray-400 mt-3">
                These different viewing angles and sun positions are exactly why the two images look
                different and registration is challenging.
              </p>
              <p className="text-[9px] text-gray-500 mt-2 italic">{result.coverage_note}</p>

              {result.target_lat != null && result.target_lon != null && (
                <MoonContextImage lat={result.target_lat} lon={result.target_lon} />
              )}

              {result.footprint && result.footprint.length >= 3 && (
                <div className="mt-3 pt-3 border-t border-gray-200 dark:border-white/10">
                  <h4 className="text-[9px] font-bold tracking-widest uppercase text-gray-500 mb-1.5">
                    Footprint on the global Moon map
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <OrbitalFootprintMap footprint={result.footprint} height={240} />
                    <AreaDetailsPanel
                      footprint={result.footprint}
                      ssimMean={ssimMean}
                      ssimValidFraction={ssimValidFraction}
                      elapsedSeconds={elapsedSeconds}
                      matcherUsed={matcherUsed}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
