// workspace_components/TerrainRoughnessMap.tsx
//
// Real-data terrain roughness map: real Robbins (2019) crater-catalog
// points, spatially binned into a real grid over this run's real
// footprint via genuine geospatial libraries on the backend
// (geopandas + shapely for the spatial join, rasterio for the real
// LOLA DEM coverage check -- see backend/pipeline/terrain_roughness.py).
// This component only renders what /api/terrain_roughness/{run_id}
// already computed; no binning/scoring math happens here.
//
// Rendered as a real interactive choropleth via Leaflet's own
// L.geoJSON() (the standard Leaflet choropleth pattern -- a style
// callback keyed on each real feature's real `score` property), laid
// over the exact same NASA Moon Trek WMTS base layer
// OrbitalFootprintMap.tsx already uses, for visual consistency with the
// rest of the app.
//
// Labeling is non-negotiable: title is always exactly "Relative Terrain
// Roughness (crater density-based)", the formula is shown on-screen,
// and the mandatory caveat paragraph is always visible (never behind a
// toggle). Never use "suitability", "landing", "safe", or "hazard"
// anywhere in this file's UI copy.
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchTerrainRoughness, type TerrainRoughnessResult } from '../services/api';

const TILE_URL = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg';
const MAX_REAL_ZOOM = 8; // same real confirmed TileMatrix range as OrbitalFootprintMap.tsx

// Small, self-contained sequential ramp (light amber -> dark red) --
// no new charting dependency for what's just a handful of interpolated
// stops. Purely a rendering choice; every score value it's applied to
// is real.
const RAMP: [number, number, number][] = [
  [254, 240, 217],
  [253, 204, 138],
  [252, 141, 89],
  [227, 74, 51],
  [153, 0, 13],
];

function rampColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  const scaled = clamped * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(scaled));
  const f = scaled - i;
  const [r0, g0, b0] = RAMP[i];
  const [r1, g1, b1] = RAMP[i + 1];
  const r = Math.round(r0 + (r1 - r0) * f);
  const g = Math.round(g0 + (g1 - g0) * f);
  const b = Math.round(b0 + (b1 - b0) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

function Legend({ maxScore }: { maxScore: number }) {
  const stops = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="flex items-center gap-1 mt-2">
      <span className="text-[9px] text-gray-500 mr-1">0</span>
      <div className="flex h-3 flex-1 rounded-sm overflow-hidden border border-[#0E0E0E]/15 dark:border-white/10">
        {stops.map((t, i) => (
          <div key={i} className="flex-1" style={{ backgroundColor: rampColor(t) }} />
        ))}
      </div>
      <span className="text-[9px] text-gray-500 ml-1">{maxScore.toFixed(2)}</span>
    </div>
  );
}

export interface TerrainRoughnessMapProps {
  runDirId: string | null;
  height?: number;
}

export default function TerrainRoughnessMap({ runDirId, height = 320 }: TerrainRoughnessMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.Layer[]>([]);
  const [data, setData] = useState<TerrainRoughnessResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!runDirId) {
      setData(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchTerrainRoughness(runDirId).then((r) => {
      if (!cancelled) {
        setData(r);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [runDirId]);

  // Mount the map once real cell data is available.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    if (!data || !data.available || !data.cells_geojson) return;

    const map = L.map(containerRef.current, {
      crs: L.CRS.EPSG4326,
      center: [0, 0],
      zoom: 1,
      minZoom: 0,
      maxZoom: MAX_REAL_ZOOM,
      attributionControl: true,
      zoomControl: true,
    });

    L.tileLayer(TILE_URL, {
      tileSize: 256,
      minZoom: 0,
      maxZoom: MAX_REAL_ZOOM,
      maxNativeZoom: MAX_REAL_ZOOM,
      noWrap: true,
      bounds: [[-90, -180], [90, 180]],
      attribution: 'NASA Moon Trek / LRO WAC Global Mosaic (303ppd)',
    }).addTo(map);

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!data?.available]);

  // Draw/update the real choropleth grid + real crater points + real
  // footprint outline whenever the fetched data changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || !data.available) return;

    layersRef.current.forEach((l) => l.remove());
    layersRef.current = [];

    const maxScore = data.max_score && data.max_score > 0 ? data.max_score : 1;

    // Real choropleth: Leaflet's standard L.geoJSON + style-callback
    // pattern, keyed on each real feature's real `score` property.
    if (data.cells_geojson) {
      const cellsLayer = L.geoJSON(data.cells_geojson, {
        style: (feature) => ({
          color: '#ffffff',
          weight: 1,
          fillColor: rampColor((feature?.properties?.score ?? 0) / maxScore),
          fillOpacity: 0.6,
        }),
        onEachFeature: (feature, layer) => {
          const p = feature.properties || {};
          layer.bindPopup(
            `<div style="font-size:11px">` +
              `<b>Cell (${p.row}, ${p.col})</b><br/>` +
              `Craters: ${p.count}<br/>` +
              `Sum diameter&sup2;: ${Number(p.weighted_sum_km2).toFixed(2)} km&sup2;<br/>` +
              `Area: ${Number(p.area_km2).toFixed(2)} km&sup2;<br/>` +
              `<b>Score: ${Number(p.score).toFixed(4)}</b>` +
            `</div>`
          );
        },
      }).addTo(map);
      layersRef.current.push(cellsLayer);
    }

    // Real catalogued crater positions -- white dot with a black outline
    // so it stays legible against every ramp color from light amber to
    // dark red.
    if (data.craters_geojson) {
      const cratersLayer = L.geoJSON(data.craters_geojson, {
        pointToLayer: (_feature, latlng) =>
          L.circleMarker(latlng, { radius: 2.5, color: '#0E0E0E', weight: 1, fillColor: '#ffffff', fillOpacity: 0.95 }),
      }).addTo(map);
      layersRef.current.push(cratersLayer);
    }

    // Real footprint outline, black & white themed (was cyan, matching
    // OrbitalFootprintMap.tsx's older convention before this refactor).
    if (data.footprint && data.footprint.length >= 3) {
      const footprintLayer = L.polygon(data.footprint, {
        color: '#0E0E0E',
        weight: 2,
        fill: false,
      }).addTo(map);
      layersRef.current.push(footprintLayer);
      map.flyToBounds(footprintLayer.getBounds(), { padding: [30, 30], duration: 1.0 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="bg-white border border-[#0E0E0E]/15 dark:bg-[#0E0E0E] dark:backdrop-blur-md dark:border-white/10 rounded-sm p-4 text-xs">
      <h4 className="text-[10px] font-bold tracking-widest uppercase text-gray-500 mb-1">
        Relative Terrain Roughness (crater density-based)
      </h4>
      <p className="text-[9px] font-mono text-gray-500 mb-2">
        {data?.formula || 'score = sum(crater diameter_km²) / cell_area_km²'}
      </p>

      {loading && (
        <div className="space-y-1.5 animate-pulse">
          <div className="h-2.5 rounded-sm bg-gray-300/60 dark:bg-white/10 w-2/3" />
          <div className="h-2.5 rounded-sm bg-gray-300/60 dark:bg-white/10 w-1/2" />
        </div>
      )}

      {!loading && !runDirId && <p className="italic text-gray-400">No run yet.</p>}

      {!loading && runDirId && data === null && (
        <p className="italic text-amber-500">Could not reach the backend for this run's terrain roughness data.</p>
      )}

      {!loading && data && !data.available && (
        <p className="italic text-gray-400">{data.reason || 'No real footprint geometry available for this run.'}</p>
      )}

      {!loading && data && data.available && (
        <>
          <div ref={containerRef} style={{ height, width: '100%' }} className="rounded-sm overflow-hidden" />
          <Legend maxScore={data.max_score ?? 0} />
          <p className="text-[9px] text-gray-500 mt-2">
            {data.crater_count ?? 0} real catalogued craters (Robbins 2019) in a real {data.grid_n}x{data.grid_n} grid over
            this run's real footprint. White dots: real crater positions. Click a cell for its real numbers.
          </p>
          {data.dem_note?.note && (
            <p className="text-[9px] text-gray-500 mt-1 italic">{data.dem_note.note}</p>
          )}
          <p className="text-[9px] text-gray-600 dark:text-gray-400 leading-relaxed mt-3 pt-2 border-t border-[#0E0E0E]/15 dark:border-white/10">
            {data.caveat}
          </p>
        </>
      )}
    </div>
  );
}
