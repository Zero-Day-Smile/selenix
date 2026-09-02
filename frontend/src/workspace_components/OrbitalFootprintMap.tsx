// workspace_components/OrbitalFootprintMap.tsx
//
// Shows the registered pair's real footprint on the global Moon map.
//
// Base layer: NASA Moon Trek WMTS (LRO WAC global mosaic, no API key).
// Verified directly against this product's real WMTSCapabilities.xml
// before writing any of this (not assumed from the URL pattern alone):
//   - TileMatrixSet "default028mm", TileMatrix "0": MatrixWidth=2,
//     MatrixHeight=1, TileSize=256x256, TopLeftCorner="-180 90" -- exactly
//     what Leaflet's L.CRS.EPSG4326 expects at zoom 0 for a plate-carree
//     (equirectangular) grid (2 tiles spanning 360deg longitude, 1 tile
//     spanning 180deg latitude), so no custom CRS/transformation class is
//     needed beyond the built-in EPSG4326.
//   - Real zoom levels present: 0 through 8 (matrix doubles in both
//     dimensions each level, confirmed up to 512x256 at level 8).
//   - Real tiles fetched directly at z=0,y=0,x=0 and z=0,y=0,x=1: both
//     returned real 200 image/jpeg responses (not a placeholder/404).
//
// Uses raw Leaflet (imperative API), not react-leaflet: this app is on
// React 19, and the imperative pattern (map.flyToBounds(), L.polygon)
// matches Leaflet's own idioms directly without a wrapper library's own
// version-compatibility surface.
//
// No search box, no manual lat/lon entry -- footprint is the only input,
// supplied by the caller from a real run's /api/orbital_geometry output.
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const TILE_URL = 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg';
const MAX_REAL_ZOOM = 8; // real TileMatrix identifiers confirmed present: 0-8

export interface OrbitalFootprintMapProps {
  // Real [lat, lon] corner points, in winding order, from a run's real
  // /api/orbital_geometry footprint field -- e.g. [[lat,lon], [lat,lon],
  // [lat,lon], [lat,lon]]. No default/fallback shape: an empty or missing
  // footprint just means nothing is drawn (see render guard below), never
  // a fabricated placeholder polygon.
  footprint: [number, number][];
  height?: number;
}

export default function OrbitalFootprintMap({ footprint, height = 280 }: OrbitalFootprintMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const polygonRef = useRef<L.Polygon | null>(null);

  // Mount once: create the map + base tile layer. Never recreated on
  // footprint changes (that would destroy/reflow the whole map on every
  // new run) -- only the polygon + view react to footprint.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      crs: L.CRS.EPSG4326,
      center: [0, 0],
      zoom: 1,
      minZoom: 0,
      maxZoom: MAX_REAL_ZOOM,
      attributionControl: true,
      zoomControl: true,
      // No search box / manual coordinate entry per spec -- this is a
      // read-only context view, not a navigable map tool.
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
  }, []);

  // Draw/update the footprint polygon and fly to it whenever footprint
  // changes (a new pipeline run finishing with a different real result).
  // Keyed on the real coordinate values, not the array reference -- a
  // parent re-render passing a new-but-identical footprint array
  // shouldn't re-trigger the fly-to animation.
  const footprintKey = footprint && footprint.length ? JSON.stringify(footprint) : '';
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (polygonRef.current) {
      polygonRef.current.remove();
      polygonRef.current = null;
    }
    if (!footprint || footprint.length < 3) return;

    const polygon = L.polygon(footprint, {
      color: '#06b6d4',
      weight: 2,
      fillColor: '#06b6d4',
      fillOpacity: 0.25,
    }).addTo(map);
    polygonRef.current = polygon;

    map.flyToBounds(polygon.getBounds(), { padding: [40, 40], duration: 1.2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [footprintKey]);

  return <div ref={containerRef} style={{ height, width: '100%' }} className="rounded-sm overflow-hidden" />;
}
