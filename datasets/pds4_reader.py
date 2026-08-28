"""PDS4 reader for Chandrayaan-2 OHRC/TMC-2/IIRS files -- a thin layer on
top of backend/pipeline/pds_readers.py::read_pds4, which already does the
real, tested work of selecting the correct Array_2D_Image structure (via
pds4_tools, filtering by which structure actually has ndim'd array data --
NOT by position; a real PDS4 label can and does contain a HeaderStructure
alongside the real image array, and picking "the first array element" is
exactly the bug this project already found and root-caused for a real WAC
product, see TASKS.md "distinctive-landmark test... macro-scale attempt").

This file does NOT re-implement array reading. It adds two things
pds_readers.py doesn't currently do: (1) direct XML metadata extraction
(solar incidence/azimuth, spacecraft altitude, orbit number -- ISRO's real
label extends the standard PDS4 schema with an `isda:` namespace for these,
confirmed by inspecting a real label, https://isda.issdc.gov.in/pds4/isda/v1),
and (2) loading the real per-pixel lat/lon geometry CSV via
geo_extent_guard.load_tmc_geometry (already real, tested, reused unmodified).
"""
from __future__ import annotations

import math
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.pipeline import pds_readers, geo_extent_guard  # noqa: E402
from datasets.metadata_utils import normalize_longitude_0_360  # noqa: E402

MOON_RADIUS_KM = 1737.4


def _local_name(tag: str) -> str:
    """Strips a namespace URI from an ElementTree tag ('{uri}local' -> 'local')
    so metadata extraction doesn't need to hardcode every namespace URI a
    given ISSDC label revision might use."""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _find_field(root: ET.Element, *names: str) -> str | None:
    """First element anywhere in the tree whose local (namespace-stripped)
    tag matches one of `names`, case-sensitive (real ISDA labels are
    consistent about casing) -- returns its text, or None if genuinely
    absent (not a parsing failure; not every field exists on every product)."""
    wanted = set(names)
    for el in root.iter():
        if _local_name(el.tag) in wanted and el.text:
            return el.text.strip()
    return None


def _find_geometry_csv(xml_path: str) -> str | None:
    """Real per-pixel lat/lon geometry CSV -- a separate file, same base
    name, `_geometry.csv` suffix (confirmed against this project's real 4
    Chandrayaan-2 TMC-2 products)."""
    stem = xml_path[:-4] if xml_path.lower().endswith(".xml") else os.path.splitext(xml_path)[0]
    candidate = stem + "_geometry.csv"
    return candidate if os.path.exists(candidate) else None


def read_pds4_full(xml_path: str) -> dict:
    """xml_path: a Chandrayaan-2 PDS4 .xml label.

    Returns real image data + real metadata actually present in the label,
    with None (not a guess) for fields genuinely absent."""
    read_result = pds_readers.read_pds4(xml_path)  # real array read, reused unmodified

    tree = ET.parse(xml_path)
    root = tree.getroot()

    start_date_time = _find_field(root, "start_date_time")
    orbit_number = _find_field(root, "imaging_orbit_number", "orbit_number")
    spacecraft_altitude = _find_field(root, "spacecraft_altitude")
    solar_incidence = _find_field(root, "solar_incidence", "solar_incidence_angle")
    sun_azimuth = _find_field(root, "sun_azimuth", "solar_azimuth")

    geometry_csv = _find_geometry_csv(xml_path)
    footprint_latlon = None
    gsd_meters = None
    if geometry_csv:
        rows = geo_extent_guard.load_tmc_geometry(geometry_csv)  # real (scan, pixel, lon, lat) rows, reused unmodified
        lons = [normalize_longitude_0_360(r[2]) for r in rows]
        lats = [r[3] for r in rows]
        lon_min, lon_max, lat_min, lat_max = min(lons), max(lons), min(lats), max(lats)
        footprint_latlon = {"lon_min": lon_min, "lon_max": lon_max, "lat_min": lat_min, "lat_max": lat_max}

        # Real GSD from the real lon/lat span and the real NATIVE pixel
        # dimensions of the array we just read (no preview-downsample
        # rescale needed here, unlike synthetic_invariance.real_gsd_ch2,
        # which corrects for a separately-downsampled preview file).
        scans = sorted(set(r[0] for r in rows))
        pixels = sorted(set(r[1] for r in rows))
        native_h, native_w = scans[-1] + 1, pixels[-1] + 1
        mean_lat_rad = math.radians((lat_min + lat_max) / 2)
        lon_span_km = math.radians(lon_max - lon_min) * MOON_RADIUS_KM * math.cos(mean_lat_rad)
        lat_span_km = math.radians(lat_max - lat_min) * MOON_RADIUS_KM
        gsd_x_m = (lon_span_km * 1000) / native_w
        gsd_y_m = (lat_span_km * 1000) / native_h
        gsd_meters = (gsd_x_m + gsd_y_m) / 2

    return {
        "pixels": read_result.data,
        "lines": read_result.lines,
        "samples": read_result.samples,
        "bands": read_result.bands,
        "start_time": start_date_time,
        "orbit_number": int(orbit_number) if orbit_number is not None else None,
        "sun_angle_deg": float(solar_incidence) if solar_incidence is not None else None,
        "sun_azimuth_deg": float(sun_azimuth) if sun_azimuth is not None else None,
        "spacecraft_altitude_km": float(spacecraft_altitude) if spacecraft_altitude is not None else None,
        "gsd_meters": gsd_meters,
        "footprint_latlon": footprint_latlon,
        "geometry_csv_path": geometry_csv,
        "format": read_result.format,
        "warnings": read_result.warnings + (
            [] if geometry_csv else ["No sibling _geometry.csv found next to this label -- "
                                      "per-pixel footprint and real GSD are unavailable for this product."]
        ),
    }
