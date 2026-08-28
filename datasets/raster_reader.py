"""Format router: detects PDS3 vs PDS4 vs pre-converted GeoTIFF from the file
extension and returns ONE standardized dict regardless of format. Nothing
above this layer (raster_reader.py itself, or lunar_dataset.py) ever calls
pds3_reader/pds4_reader directly -- see LunarRasterReader.read().
"""
from __future__ import annotations

import math
import os
import sys
from pathlib import Path

import numpy as np

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.pipeline.run_pipeline import _sensor_from_path  # noqa: E402  (real, existing sensor-name heuristic, reused not duplicated)
from datasets import pds3_reader, pds4_reader  # noqa: E402

MOON_RADIUS_KM = 1737.4


def _sensor_label(path: str) -> str:
    """Maps run_pipeline._sensor_from_path's lowercase keys to this
    project's real product-family names."""
    key = _sensor_from_path(path)
    return {"ohrc": "OHRC", "tmc": "TMC2", "iirs": "IIRS", "nac": "NAC"}.get(key, "unknown")


def _kml_corner_gsd_estimate(corners: list, native_h: int, native_w: int) -> float | None:
    """Real, coarse GSD estimate from a KML footprint's 4 real corners
    (Haversine distance) and the real native pixel dimensions -- used only
    when no per-pixel geometry CSV exists (i.e. for NAC/WAC, which don't
    carry one). Same real technique already used in this project to
    compute NAC GSD for the Tycho distinctive-landmark test."""
    if not corners or len(corners) < 4 or native_h <= 0 or native_w <= 0:
        return None

    def haversine_km(lon1, lat1, lon2, lat2):
        lon1, lat1, lon2, lat2 = map(math.radians, [lon1, lat1, lon2, lat2])
        dlon, dlat = lon2 - lon1, lat2 - lat1
        a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
        return 2 * MOON_RADIUS_KM * math.asin(math.sqrt(a))

    along_track_km = haversine_km(*corners[0], *corners[1])
    cross_track_km = haversine_km(*corners[0], *corners[3])
    gsd_row = along_track_km * 1000 / native_h
    gsd_col = cross_track_km * 1000 / native_w
    return (gsd_row + gsd_col) / 2


class LunarRasterReader:
    """Public interface. `LunarRasterReader(path).read()` -> standardized dict:
        pixels, sun_angle_deg, sun_azimuth_deg, gsd_meters, orbit_number,
        acquisition_time, sensor, footprint_latlon, md5
    Every field is either a real value extracted from the actual label, or
    None with the reason logged in `warnings` -- never a fabricated
    placeholder."""

    def __init__(self, path: str):
        self.path = path

    def read(self) -> dict:
        ext = os.path.splitext(self.path)[1].lower()

        if ext == ".xml":
            raw = pds4_reader.read_pds4_full(self.path)
        elif ext in (".img", ".lbl"):
            raw = pds3_reader.read_pds3_full(self.path)
        elif ext in (".tif", ".tiff"):
            raw = self._read_geotiff_fallback(self.path)
        else:
            raise ValueError(
                f"Don't know how to route '{ext}' -- expected .xml (PDS4), .img/.lbl (PDS3), "
                f"or .tif/.tiff (pre-converted fallback only)."
            )

        pixels = raw["pixels"]
        if pixels.dtype != np.uint8:
            # Real per-image adaptive stretch (see metadata_utils.py) -- NOT
            # normalised to [0,1] here; the spec for this dict is an
            # un-normalised uint8 array, normalisation happens one layer up
            # in lunar_dataset.py so the raw reader output stays reusable
            # for anything that wants real DN, not just training.
            from datasets.metadata_utils import adaptive_stretch
            pixels = (adaptive_stretch(pixels) * 255).astype(np.uint8)

        gsd_meters = raw.get("gsd_meters")
        if gsd_meters is None and raw.get("footprint_latlon") and isinstance(raw["footprint_latlon"], list):
            gsd_meters = _kml_corner_gsd_estimate(raw["footprint_latlon"], raw["lines"], raw["samples"])

        return {
            "pixels": pixels,
            "sun_angle_deg": raw.get("sun_angle_deg"),
            "sun_azimuth_deg": raw.get("sun_azimuth_deg"),
            "gsd_meters": gsd_meters,
            "orbit_number": raw.get("orbit_number"),
            "acquisition_time": raw.get("start_time"),
            "sensor": _sensor_label(self.path),
            "footprint_latlon": raw.get("footprint_latlon"),
            "md5": raw.get("md5"),
            "warnings": raw.get("warnings", []),
        }

    @staticmethod
    def _read_geotiff_fallback(path: str) -> dict:
        """Fallback for pre-converted files only -- e.g. a synthetic
        same-source variant already saved as a plain PNG/TIFF by this
        project's own tooling (invariance sweep, relighting demos), which
        never came from a real PDS3/PDS4 archive product and carries no
        real per-image telemetry to extract."""
        import rasterio
        with rasterio.open(path) as ds:
            pixels = ds.read(1)
        return {
            "pixels": pixels, "lines": pixels.shape[0], "samples": pixels.shape[1],
            "sun_angle_deg": None, "sun_azimuth_deg": None, "orbit_number": None,
            "start_time": None, "md5": None, "footprint_latlon": None,
            "warnings": ["Pre-converted TIFF/PNG fallback -- no real PDS label to extract telemetry from."],
        }
