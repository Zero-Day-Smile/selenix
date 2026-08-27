"""Local, in-memory queryable store for the two real crater catalogs (see
build_crater_catalog.py for provenance/preprocessing). Loaded once at import
time from the preprocessed .npz caches -- no live network fetch per request,
no GIS database needed at this scale: a plain numpy boolean-mask bounding-box
filter over ~1.3M rows is sub-millisecond.

Robbins and the Gazetteer are queried and returned SEPARATELY, never merged
or matched by proximity. Matching "is this Robbins circle-fit crater the same
physical crater as this Gazetteer-named one" would require guessing (their
center coordinates differ slightly since they're independently measured) --
exactly the kind of blending the project's honesty constraint rules out. A
crater that is both cataloged and IAU-named will legitimately appear twice in
results, each row citing its own real source, rather than being silently
fused into one claimed-authoritative entry.
"""
from __future__ import annotations

import os

import numpy as np

CATALOG_DIR = "backend/data/real/_catalogs"
ROBBINS_NPZ = os.path.join(CATALOG_DIR, "robbins_craters.npz")
GAZETTEER_NPZ = os.path.join(CATALOG_DIR, "gazetteer_craters.npz")

ROBBINS_SOURCE = "Robbins (2019) Lunar Crater Database, NASA PDS Cartography and Imaging Sciences Node"
GAZETTEER_SOURCE = "USGS Gazetteer of Planetary Nomenclature"

_robbins = None
_gazetteer = None


def _load():
    global _robbins, _gazetteer
    if _robbins is None:
        if not os.path.exists(ROBBINS_NPZ) or not os.path.exists(GAZETTEER_NPZ):
            raise FileNotFoundError(
                f"Crater catalog caches not found at {ROBBINS_NPZ} / {GAZETTEER_NPZ}. "
                f"Run: PYTHONPATH=. .venv/Scripts/python.exe backend/pipeline/build_crater_catalog.py")
        _robbins = dict(np.load(ROBBINS_NPZ))
        _gazetteer = dict(np.load(GAZETTEER_NPZ))


def catalog_status() -> dict:
    """Real counts for the currently-loaded catalogs, for a status endpoint
    / honest UI note about completeness -- not hardcoded numbers."""
    _load()
    return {
        "robbins_total_craters": int(len(_robbins["crater_id"])),
        "gazetteer_named_craters": int(len(_gazetteer["name"])),
        "robbins_source": ROBBINS_SOURCE,
        "gazetteer_source": GAZETTEER_SOURCE,
    }


def query_bbox(lon_min: float, lon_max: float, lat_min: float, lat_max: float) -> list[dict]:
    """Returns every real catalog crater (both sources, unmerged) whose
    published center falls within the given 0-360 longitude / -90-90
    latitude box. Caller is responsible for converting any -180/180 source
    geometry (e.g. NAC KML footprints) to 0-360 BEFORE calling this --
    both catalogs are natively 0-360 (confirmed empirically, see TASKS.md),
    and this function does not attempt to detect or fix a wrong convention
    silently, since a caller-side bug there should fail loudly, not be
    papered over here."""
    _load()
    results = []

    r = _robbins
    mask = ((r["lon"] >= lon_min) & (r["lon"] <= lon_max) &
            (r["lat"] >= lat_min) & (r["lat"] <= lat_max))
    for i in np.where(mask)[0]:
        results.append({
            "name": None,
            "crater_id": str(r["crater_id"][i]),
            "diameter_km": float(r["diam_km"][i]),
            "lat": float(r["lat"][i]),
            "lon": float(r["lon"][i]),
            "source": ROBBINS_SOURCE,
            "gazetteer_link": None,
        })

    g = _gazetteer
    mask = ((g["lon"] >= lon_min) & (g["lon"] <= lon_max) &
            (g["lat"] >= lat_min) & (g["lat"] <= lat_max))
    for i in np.where(mask)[0]:
        diam = float(g["diam_km"][i])
        results.append({
            "name": str(g["name"][i]),
            "crater_id": None,
            "diameter_km": None if np.isnan(diam) else diam,
            "lat": float(g["lat"][i]),
            "lon": float(g["lon"][i]),
            "source": GAZETTEER_SOURCE,
            "gazetteer_link": str(g["link"][i]) or None,
        })

    return results
