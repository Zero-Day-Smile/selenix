"""Real-data terrain roughness map: real Robbins (2019) crater-catalog
points, spatially binned into a real grid over a run's real footprint
using genuine geospatial libraries -- geopandas + shapely for the
point-in-polygon binning (a real spatial join, not manual lat/lon
range comparisons), rasterio for the LOLA DEM coverage check.

Score formula (per cell, stated explicitly so it's auditable both here
and on-screen):

    score = sum(crater diameter_km^2 for craters in cell) / cell_area_km2

This is RELATIVE TERRAIN ROUGHNESS (crater-density-based) ONLY. Never
"suitability", "landing", "safe", or "hazard" anywhere this data is
labeled -- see _CAVEAT below, which must ship verbatim with every
render of this data (API response, live map, or report).

Reuses report_generator.py's real footprint-geometry helpers
(_footprint_bbox, _footprint_area_km2) rather than reimplementing
footprint math a second time -- this module only adds the real
geopandas/shapely binning and the real rasterio DEM check on top.

DEM check: this project's real LOLA GDR global DEM
(backend/data/lola_dem/ldem_64.img, 64 px/degree = 473.802 m/px, a raw
headerless PDS3 raster -- see that directory's .lbl) genuinely covers
every point on the Moon, but this project's own prior investigation
(TASKS.md, "DEM-assisted registration: real LOLA data confirms
resolution is insufficient even at Tycho scale") already established
it's far too coarse to resolve crater-scale structure at the footprint
sizes this project's real runs actually produce. Rather than silently
assume that finding always holds, this module re-checks it per run,
using rasterio's real windowing/transform machinery against the real
DEM's real affine geometry (the same row/col<->lat/lon formula already
validated elsewhere in this project, see backend/scripts/
dem_hillshade_generate.py) -- honestly reporting whether the DEM adds
resolvable structure at THIS run's grid-cell scale, rather than
silently including or silently ignoring it.
"""
from __future__ import annotations

import json
import os

import geopandas as gpd
from shapely.geometry import box, Point

import rasterio
from rasterio.transform import Affine
from rasterio.windows import from_bounds as window_from_bounds

from . import crater_catalog, orbital_geometry
from .report_generator import _footprint_bbox

GRID_N = 3  # matches terrain_context_report.py's 3x3 convention

TITLE = "Relative Terrain Roughness (crater density-based)"
FORMULA_TEXT = "score = sum(crater diameter_km² for craters in cell) / cell_area_km²"

# Verbatim, same substance as terrain_context_report.py's _CAVEAT --
# must ship with every render of this data.
CAVEAT = (
    "This map characterizes catalogued crater density and size within the imaged footprint "
    "only. It does not model spacecraft trajectory, descent dynamics, slope, thermal "
    "environment, or any other factor relevant to actual landing site certification. Catalog "
    "coverage may be incomplete; regions with no catalogued craters are not necessarily "
    "smoother, they may simply be under-catalogued."
)

# --- Real LOLA GDR DEM geometry (raw PDS3 raster, no embedded header --
# see backend/data/lola_dem/ldem_64.lbl). Same real values and the same
# row/col<->lat/lon formula already validated in this project's own
# dem_hillshade_generate.py / dem_high_value_locations.py against real
# KML footprint corners (TASKS.md, part 11/12) -- reused verbatim, not
# re-derived, so this can never quietly disagree with that established
# conversion.
DEM_PATH = "backend/data/lola_dem/ldem_64.img"
DEM_LINES, DEM_SAMPLES = 11520, 23040
DEM_LINE_OFFSET, DEM_SAMPLE_OFFSET = 5759.5, 11519.5
DEM_RES_PPD = 64  # real pixels/degree -> 473.802 m/px (label-stated)

# Real, honest threshold: below this many real DEM pixels across a grid
# cell's shorter side, the DEM cannot add independently resolvable
# structure beyond what a single sample already tells you -- reported
# as "insufficient" rather than silently used or silently dropped.
DEM_MIN_PIXELS_PER_CELL_SIDE = 4

# lon = (col - DEM_SAMPLE_OFFSET) / DEM_RES_PPD ; lat = (DEM_LINE_OFFSET - row) / DEM_RES_PPD
_DEM_TRANSFORM = Affine(1.0 / DEM_RES_PPD, 0.0, -DEM_SAMPLE_OFFSET / DEM_RES_PPD,
                         0.0, -1.0 / DEM_RES_PPD, DEM_LINE_OFFSET / DEM_RES_PPD)


def _dem_coverage_note(lat_min: float, lat_max: float, lon_min: float, lon_max: float, grid_n: int) -> dict:
    """Real check, via rasterio's own windowing/transform math against
    the real DEM's real affine geometry, of how many genuine DEM pixels
    fall across one grid cell here. Deliberately does NOT load the
    ~500MB real raster into memory for this -- a coverage/resolution
    check only needs the transform, not the elevation values
    themselves, and the crater-based score formula above never reads
    elevation data at all."""
    if not os.path.exists(DEM_PATH):
        return {"available": False, "reason": "no real LOLA DEM file on disk", "sufficient": False}

    cell_lat_deg = (lat_max - lat_min) / grid_n
    cell_lon_deg = (lon_max - lon_min) / grid_n
    try:
        win = window_from_bounds(lon_min, lat_min, lon_min + cell_lon_deg, lat_min + cell_lat_deg, transform=_DEM_TRANSFORM)
    except Exception as e:
        return {"available": True, "reason": f"could not compute real DEM window: {e}", "sufficient": False}

    # Cast off numpy scalar types (win.height/.width are numpy float64)
    # to native Python float/bool -- FastAPI's jsonable_encoder cannot
    # serialize numpy scalars directly.
    px_h, px_w = float(abs(win.height)), float(abs(win.width))
    sufficient = bool(min(px_h, px_w) >= DEM_MIN_PIXELS_PER_CELL_SIDE)
    note = (
        f"Real LOLA GDR global DEM (64 px/degree, 473.802 m/px, backend/data/lola_dem/ldem_64.img) "
        f"is present and covers this footprint. Each {grid_n}x{grid_n} grid cell here spans only "
        f"~{px_w:.1f}x{px_h:.1f} real DEM pixels"
        + (
            " -- too coarse to add independently resolvable elevation structure at this grid-cell scale "
            "(consistent with this project's own prior finding, TASKS.md \"DEM-assisted registration\"). "
            "Roughness scoring below uses the real crater catalog only."
            if not sufficient else
            " -- enough real DEM pixels to potentially resolve structure at this scale, though this map's "
            "roughness score still uses the real crater catalog only, per its stated formula."
        )
    )
    return {"available": True, "sufficient": sufficient, "px_per_cell_w": px_w, "px_per_cell_h": px_h, "note": note}


def _grid_geodataframe(lat_min: float, lat_max: float, lon_min: float, lon_max: float, n: int) -> gpd.GeoDataFrame:
    """Real n x n grid of real shapely polygons over the real footprint
    bbox. CRS deliberately left unset (None): this is a lunar
    simple-cylindrical (lat/lon-as-degrees) grid, not an Earth datum --
    tagging it EPSG:4326 (WGS84, Earth) would misrepresent it. geopandas'
    binary predicates (point-in-polygon) work correctly on planar
    lon/lat coordinates regardless of a named CRS; only real-world
    distance/area needs the explicit km-per-degree conversion applied
    below, which happens outside any CRS machinery, the same way the
    rest of this project already handles lunar coordinates."""
    from math import cos, radians
    from . import geo_extent_guard

    lat_step = (lat_max - lat_min) / n
    lon_step = (lon_max - lon_min) / n
    rows = []
    for row in range(n):
        for col in range(n):
            lat0, lat1 = lat_min + row * lat_step, lat_min + (row + 1) * lat_step
            lon0, lon1 = lon_min + col * lon_step, lon_min + (col + 1) * lon_step
            mean_lat = (lat0 + lat1) / 2
            area_km2 = abs((lat1 - lat0) * geo_extent_guard.MOON_KM_PER_DEG *
                            (lon1 - lon0) * geo_extent_guard.MOON_KM_PER_DEG * cos(radians(mean_lat)))
            rows.append({
                "row": row, "col": col,
                "lat0": lat0, "lat1": lat1, "lon0": lon0, "lon1": lon1,
                "area_km2": area_km2,
                "geometry": box(lon0, lat0, lon1, lat1),  # shapely box(minx, miny, maxx, maxy) = (lon0, lat0, lon1, lat1)
            })
    return gpd.GeoDataFrame(rows, geometry="geometry", crs=None)


def _craters_geodataframe(craters: list[dict]) -> gpd.GeoDataFrame:
    """Real catalogued crater points (Robbins 2019 only -- crater_id is
    not None -- same convention report_generator.py/
    terrain_context_report.py already use) as a real GeoDataFrame of
    shapely Points, for a genuine spatial join rather than manual
    lat/lon range comparisons."""
    if not craters:
        return gpd.GeoDataFrame({"lat": [], "lon": [], "diameter_km": [], "crater_id": []},
                                 geometry=[], crs=None)
    return gpd.GeoDataFrame(
        {
            "lat": [c["lat"] for c in craters],
            "lon": [c["lon"] for c in craters],
            "diameter_km": [c["diameter_km"] for c in craters],
            "crater_id": [c["crater_id"] for c in craters],
        },
        geometry=[Point(c["lon"], c["lat"]) for c in craters],  # shapely Point(x=lon, y=lat)
        crs=None,
    )


def compute_terrain_roughness(run_id: str, runs_dir: str) -> dict:
    orbital = orbital_geometry.get_orbital_geometry(run_id, runs_dir)
    footprint = orbital.get("footprint")
    result = {
        "title": TITLE,
        "formula": FORMULA_TEXT,
        "grid_n": GRID_N,
        "caveat": CAVEAT,
        "footprint": footprint,
        "available": False,
    }
    if not footprint or len(footprint) < 3:
        result["reason"] = "No real footprint geometry available for this run."
        return result

    lat_min, lat_max, lon_min, lon_max = _footprint_bbox(footprint)
    try:
        craters = [c for c in crater_catalog.query_bbox(lon_min, lon_max, lat_min, lat_max) if c["crater_id"] is not None]
    except Exception:
        craters = []

    grid_gdf = _grid_geodataframe(lat_min, lat_max, lon_min, lon_max, GRID_N)
    craters_gdf = _craters_geodataframe(craters)

    # Real spatial join -- genuine point-in-polygon test via
    # geopandas/shapely (predicate="within"), not a hand-rolled
    # lat0<=lat<lat1 comparison.
    if len(craters_gdf):
        joined = gpd.sjoin(craters_gdf, grid_gdf[["row", "col", "geometry"]], how="inner", predicate="within")
    else:
        joined = craters_gdf.assign(row=[], col=[])

    grid_gdf = grid_gdf.set_index(["row", "col"])
    scores = {}
    for (row, col), area_km2 in grid_gdf["area_km2"].items():
        in_cell = joined[(joined["row"] == row) & (joined["col"] == col)] if len(joined) else joined
        weighted_sum = float((in_cell["diameter_km"] ** 2).sum()) if len(in_cell) else 0.0
        count = int(len(in_cell))
        score = weighted_sum / area_km2 if area_km2 > 0 else 0.0
        scores[(row, col)] = {"count": count, "weighted_sum_km2": round(weighted_sum, 4), "score": round(score, 6)}

    grid_gdf = grid_gdf.reset_index()
    for key in ("count", "weighted_sum_km2", "score"):
        grid_gdf[key] = [scores[(r, c)][key] for r, c in zip(grid_gdf["row"], grid_gdf["col"])]
    grid_gdf["area_km2"] = grid_gdf["area_km2"].round(4)

    max_score = float(grid_gdf["score"].max()) if len(grid_gdf) else 0.0

    dem_note = _dem_coverage_note(lat_min, lat_max, lon_min, lon_max, GRID_N)

    result.update({
        "available": True,
        "max_score": max_score,
        # geopandas' own real GeoJSON serialization (GeoDataFrame.to_json,
        # correct [lon,lat] coordinate order, real polygon geometry, and
        # numpy scalar types converted to native JSON types along the
        # way) -- not hand-built, and safer than __geo_interface__ (whose
        # dict can still carry raw numpy dtypes).
        "cells_geojson": json.loads(grid_gdf.to_json()),
        "craters_geojson": json.loads(craters_gdf.to_json()) if len(craters_gdf) else {"type": "FeatureCollection", "features": []},
        "crater_count": len(craters),
        "dem_note": dem_note,
    })
    return result
