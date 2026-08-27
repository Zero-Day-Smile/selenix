"""One-time preprocessing: parses the two real downloaded catalogs (Robbins
2019 Lunar Crater Database CSV, USGS Gazetteer of Planetary Nomenclature
KML) into compact numpy .npz caches for fast bounding-box queries at
runtime, per the local-store requirement (no live per-request network
fetch, no need for a full GIS database at this scale -- a plain lat/lon
bounding-box filter over an in-memory array is sub-millisecond for both
catalogs).

Run once after downloading the source files:
  PYTHONPATH=. .venv/Scripts/python.exe backend/pipeline/build_crater_catalog.py

Source files (real, downloaded, see TASKS.md for provenance):
  backend/data/real/_catalogs/lunar_crater_database_robbins_2018_bundle/data/
    lunar_crater_database_robbins_2018.csv
  backend/data/real/_catalogs/MOON_nomenclature_center_pts.kml

Both catalogs use 0-360 longitude (confirmed empirically, not assumed --
see TASKS.md), matching our own Chandrayaan-2 per-pixel geometry. NAC KML
footprints are the odd one out (-180/180 natively) -- that conversion
happens where NAC KML is already parsed elsewhere in the pipeline, not here.
"""
from __future__ import annotations

import csv
import os
import re

import numpy as np

CATALOG_DIR = "backend/data/real/_catalogs"
ROBBINS_CSV = os.path.join(
    CATALOG_DIR, "lunar_crater_database_robbins_2018_bundle", "data",
    "lunar_crater_database_robbins_2018.csv")
GAZETTEER_KML = os.path.join(CATALOG_DIR, "MOON_nomenclature_center_pts.kml")
ROBBINS_NPZ = os.path.join(CATALOG_DIR, "robbins_craters.npz")
GAZETTEER_NPZ = os.path.join(CATALOG_DIR, "gazetteer_craters.npz")


def build_robbins():
    ids, lats, lons, diams = [], [], [], []
    with open(ROBBINS_CSV, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                lat = float(row["LAT_CIRC_IMG"])
                lon = float(row["LON_CIRC_IMG"])
                diam = float(row["DIAM_CIRC_IMG"])
            except (ValueError, KeyError):
                continue
            ids.append(row["CRATER_ID"])
            lats.append(lat)
            lons.append(lon)
            diams.append(diam)

    print(f"Robbins: parsed {len(ids)} craters")
    np.savez_compressed(
        ROBBINS_NPZ,
        crater_id=np.array(ids, dtype="U16"),
        lat=np.array(lats, dtype=np.float64),
        lon=np.array(lons, dtype=np.float64),
        diam_km=np.array(diams, dtype=np.float64),
    )
    print(f"wrote {ROBBINS_NPZ}")


def build_gazetteer():
    with open(GAZETTEER_KML, encoding="utf-8") as f:
        content = f.read()

    placemarks = re.findall(r"<Placemark[ >].*?</Placemark>", content, re.DOTALL)
    names, lats, lons, diams, links = [], [], [], [], []
    n_craters = 0
    n_missing_diam = 0
    for p in placemarks:
        type_m = re.search(r'<SimpleData name="type">([^<]*)</SimpleData>', p)
        if not type_m or not type_m.group(1).startswith("Crater"):
            continue
        n_craters += 1
        name_m = re.search(r'<SimpleData name="clean_name">([^<]*)</SimpleData>', p)
        lat_m = re.search(r'<SimpleData name="center_lat">([^<]*)</SimpleData>', p)
        lon_m = re.search(r'<SimpleData name="center_lon">([^<]*)</SimpleData>', p)
        diam_m = re.search(r'<SimpleData name="diameter">([^<]*)</SimpleData>', p)
        link_m = re.search(r'<SimpleData name="link">([^<]*)</SimpleData>', p)
        if not (name_m and lat_m and lon_m):
            continue
        names.append(name_m.group(1))
        lats.append(float(lat_m.group(1)))
        lons.append(float(lon_m.group(1)))
        # defensive: honestly represent a missing diameter as NaN rather than
        # 0 or a guess -- none observed in the current export (checked), but
        # don't assume that holds forever
        if diam_m and diam_m.group(1).strip() != "":
            diams.append(float(diam_m.group(1)))
        else:
            diams.append(float("nan"))
            n_missing_diam += 1
        links.append(link_m.group(1) if link_m else "")

    print(f"Gazetteer: {n_craters} crater-type placemarks, "
          f"{len(names)} with usable name+coords, {n_missing_diam} missing diameter")
    np.savez_compressed(
        GAZETTEER_NPZ,
        name=np.array(names, dtype="U64"),
        lat=np.array(lats, dtype=np.float64),
        lon=np.array(lons, dtype=np.float64),
        diam_km=np.array(diams, dtype=np.float64),
        link=np.array(links, dtype="U128"),
    )
    print(f"wrote {GAZETTEER_NPZ}")


if __name__ == "__main__":
    build_robbins()
    build_gazetteer()
