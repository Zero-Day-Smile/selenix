// workspace_components/RegionIdentityCard.tsx
//
// Single compact "mission-passport-style" summary card. Purely
// presentation -- every value here is already computed elsewhere in the
// project (gazetteer.py's nearest-named-feature lookup, orbital_geometry.py's
// real footprint centroid + per-side sensor/acquisition-time resolution,
// ancillary_readers.py's real solar incidence, pds_readers.py's best-effort
// label-derived ground scale). No new backend logic here beyond fetching
// what already exists. Any field without real data for this pair shows
// "not available" rather than being dropped -- a consistent card layout
// matters more here than hiding gaps.
import { useEffect, useState } from 'react';
import { fetchNearestNamedFeature, type NearestNamedFeature, type OrbitalGeometryResult } from '../services/api';

function centroidOf(footprint: [number, number][]): [number, number] {
  const lat = footprint.reduce((s, p) => s + p[0], 0) / footprint.length;
  const lon = footprint.reduce((s, p) => s + p[1], 0) / footprint.length;
  return [lat, lon];
}

function formatAcquisition(iso: string | undefined): string {
  if (!iso) return 'not available';
  const d = new Date(iso);
  // Fall back to the raw real string rather than hide it if it doesn't
  // parse cleanly as a JS Date -- never silently drop a real value.
  if (isNaN(d.getTime())) return iso;
  return `${d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC').replace(/Z$/, ' UTC')}`;
}

function firstGeometryValue(geom: Record<string, string> | null | undefined): string {
  if (!geom) return 'not available';
  const keys = Object.keys(geom);
  if (keys.length === 0) return 'not available';
  return `${keys[0]}: ${geom[keys[0]]}`;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 py-1 border-b border-gray-100 dark:border-white/5 last:border-0">
      <span className="font-bold text-gray-500 shrink-0">{label}</span>
      <span className="font-mono text-gray-800 dark:text-gray-100 text-right truncate">{value}</span>
    </div>
  );
}

export interface RegionIdentityCardProps {
  footprint: [number, number][] | null;
  orbital: OrbitalGeometryResult | null;
  srcGeometry: Record<string, string> | null;
  refGeometry: Record<string, string> | null;
}

export default function RegionIdentityCard({ footprint, orbital, srcGeometry, refGeometry }: RegionIdentityCardProps) {
  const [nearest, setNearest] = useState<NearestNamedFeature | null>(null);
  const [loading, setLoading] = useState(false);
  const footprintKey = footprint && footprint.length ? JSON.stringify(footprint) : '';

  useEffect(() => {
    if (!footprint || footprint.length < 3) {
      setNearest(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const [lat, lon] = centroidOf(footprint);
    fetchNearestNamedFeature(lat, lon).then((n) => {
      if (!cancelled) {
        setNearest(n);
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
  const nearestLabel =
    nearest === null
      ? loading
        ? 'looking up…'
        : 'not available'
      : !nearest.available
        ? 'none found'
        : nearest.name ?? 'not available';

  const sunIncidence = orbital?.sun_angle_ch2_deg ?? null;
  const srcAcq = orbital?.src_acquisition ?? null;
  const refAcq = orbital?.ref_acquisition ?? null;

  return (
    <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 rounded-sm p-4 text-xs">
      <h4 className="text-[9px] font-bold tracking-widest uppercase text-gray-500 mb-2">Region identity</h4>
      <div>
        <Row label="Footprint centroid" value={`lat ${centroidLat.toFixed(3)}°, lon ${centroidLon.toFixed(3)}°`} />
        <Row label="Nearest named feature" value={nearestLabel} />
        <Row label="Source sensor" value={srcAcq ? srcAcq.sensor : 'not available'} />
        <Row label="Source acquired" value={srcAcq ? formatAcquisition(srcAcq.start_time) : 'not available'} />
        <Row label="Reference sensor" value={refAcq ? refAcq.sensor : 'not available'} />
        <Row label="Reference acquired" value={refAcq ? formatAcquisition(refAcq.start_time) : 'not available'} />
        <Row label="Solar incidence at capture" value={sunIncidence != null ? `${sunIncidence.toFixed(1)}°` : 'not available'} />
        <Row label="Source ground scale" value={firstGeometryValue(srcGeometry)} />
        <Row label="Reference ground scale" value={firstGeometryValue(refGeometry)} />
      </div>
    </div>
  );
}
