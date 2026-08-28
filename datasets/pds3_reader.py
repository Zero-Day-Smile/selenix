"""PDS3 reader for LRO NAC/WAC files -- a thin metadata-extraction layer on
top of backend/pipeline/pds_readers.py::read_pds3, which already does the
real, tested work of locating and reading the binary image data (attached
or detached label, the RECORD_BYTES x LABEL_RECORDS offset math, and the
confirmed real "8-bit signed-in-label but physically unsigned DN" quirk --
see that module's docstring for the actual product this was confirmed
against). This file does NOT re-parse the image array a second time; it
only adds the richer per-product metadata (sun angle, orbit, exposure,
checksum) that pds_readers.py doesn't currently expose.

Real field check (not assumed): a real LRO NAC PDS3 label
(M1306094925LE.IMG) was inspected directly before writing this. It DOES
carry START_TIME, ORBIT_NUMBER, LINE_EXPOSURE_DURATION at the top level
and MD5_CHECKSUM nested under the IMAGE object -- all extracted below. It
does NOT carry INCIDENCE_ANGLE, SUB_SOLAR_AZIMUTH, or SPACECRAFT_ALTITUDE
anywhere in the label -- those fields are returned as None with an
explicit reason rather than a fabricated value. (Real per-image sun-angle
telemetry for NAC products doesn't exist in this project's archive at
all -- confirmed earlier via live_invariance.py's own scoping.)
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

import pvl  # noqa: E402

from backend.pipeline import pds_readers  # noqa: E402
from backend.data.real._overlap_maps import get_kml_corners  # noqa: E402


def _find_sibling_kml(label_path: str) -> str | None:
    """A real KML footprint (4 real corners) is a SEPARATE file this
    project fetches from ODE, not part of the .IMG/.LBL product itself --
    see backend/data/real/_kml_map.json. Only used if genuinely present
    next to the data file; never fabricated."""
    stem = os.path.splitext(label_path)[0]
    for suffix in ("_xml.kml", ".kml"):
        candidate = stem + suffix
        if os.path.exists(candidate):
            return candidate
    return None


def read_pds3_full(path: str) -> dict:
    """path: a PDS3 .LBL (detached) or .IMG (attached-label) file.

    Returns real image data + real metadata actually present in the label,
    with None (not a guess) for fields the label genuinely doesn't carry."""
    read_result = pds_readers.read_pds3(path)  # real array read, reused unmodified

    label = pvl.load(path)  # cheap re-parse of the (small) ASCII label text only,
                             # not the binary payload -- needed because
                             # PdsReadResult doesn't currently expose the raw label
    image_obj = label.get("IMAGE", label.get("QUBE", {}))

    md5 = image_obj.get("MD5_CHECKSUM")
    start_time = label.get("START_TIME")
    orbit_number = label.get("ORBIT_NUMBER")
    line_exposure = label.get("LINE_EXPOSURE_DURATION")

    # Real fields this project's actual NAC labels do NOT carry (checked
    # directly against M1306094925LE.IMG before writing this, not assumed).
    incidence_angle = label.get("INCIDENCE_ANGLE")
    sub_solar_azimuth = label.get("SUB_SOLAR_AZIMUTH")
    spacecraft_altitude = label.get("SPACECRAFT_ALTITUDE")

    footprint_latlon = None
    kml_path = _find_sibling_kml(path)
    if kml_path:
        with open(kml_path) as f:
            corners = get_kml_corners(f.read())
        footprint_latlon = corners  # real 4-corner estimate, 0-360 already (get_kml_corners converts)

    return {
        "pixels": read_result.data,
        "record_bytes": int(label.get("RECORD_BYTES", 0)),
        "lines": read_result.lines,
        "samples": read_result.samples,
        "sample_bits": int(image_obj.get("SAMPLE_BITS", 0)) or None,
        "sample_type_declared": str(image_obj.get("SAMPLE_TYPE", "")) or None,
        "label_records": int(label.get("LABEL_RECORDS", 0)) or None,
        "start_time": str(start_time) if start_time is not None else None,
        "orbit_number": int(orbit_number) if orbit_number is not None else None,
        "sun_angle_deg": float(incidence_angle) if incidence_angle is not None else None,
        "sun_azimuth_deg": float(sub_solar_azimuth) if sub_solar_azimuth is not None else None,
        "spacecraft_altitude_km": float(spacecraft_altitude) if spacecraft_altitude is not None else None,
        "line_exposure_duration": str(line_exposure) if line_exposure is not None else None,
        "md5": str(md5) if md5 is not None else None,
        "footprint_latlon": footprint_latlon,
        "format": read_result.format,
        "warnings": read_result.warnings + (
            [] if (incidence_angle is not None or sub_solar_azimuth is not None or spacecraft_altitude is not None)
            else ["Real label carries no INCIDENCE_ANGLE/SUB_SOLAR_AZIMUTH/SPACECRAFT_ALTITUDE for this "
                  "product -- confirmed absent, not a parsing failure. No real per-image sun-angle "
                  "telemetry exists for NAC products in this project's archive."]
        ),
    }
