"""Standalone geographic-overlap pre-screen for candidate CH2/NAC (or any
real-footprint) pairs -- the same check_footprint_overlap() gate that
run_pipeline.py now runs automatically before matching, exposed here so
pair *selection* for future diagnostics/demos can be screened before any
image is even uploaded to the pipeline, not just at run time.

Added after a real mistake this project made during development: a pair
used for most of a working session (tmc2_20260812_0506 x M1412862267LE)
turned out to be ~97deg / ~2,947km apart on the Moon -- nowhere near
overlapping -- because nothing checked real footprint geometry before it
was picked as a "cross-sensor test case". This exists so that check can
happen in five seconds, before spending any time on a pair, instead of
being discovered later by a confusing pipeline failure.

Usage:
    # single pair, by real product id (matches the ids used throughout
    # backend/data/real/chandrayaan2/ and backend/data/real/lro_nac/):
    python -m backend.scripts.check_pair_overlap --ch2 tmc2_20260812_0506 --nac M1412862267LE

    # batch mode: a JSON file with a list of {"ch2": "...", "nac": "..."}
    # (or {"src": "<path>", "ref": "<path>"}) candidate pairs:
    python -m backend.scripts.check_pair_overlap --batch candidates.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.pipeline import geo_extent_guard, orbital_geometry  # noqa: E402


def _footprint_for_ch2_id(ch2_id: str):
    geom_csv = os.path.join(orbital_geometry.CHANDRAYAAN2_DIR, ch2_id, f"{ch2_id}_geometry.csv")
    return orbital_geometry._ch2_footprint_corners(geom_csv)  # noqa: SLF001 -- same module family, intentional reuse


def _footprint_for_nac_id(nac_id: str):
    kml_path = os.path.join(orbital_geometry.LRO_NAC_DIR, nac_id, f"{nac_id}_xml.kml")
    return orbital_geometry._nac_footprint_corners(kml_path)  # noqa: SLF001


def check_one(label: str, footprint_a, footprint_b) -> dict:
    if footprint_a is None or footprint_b is None:
        result = {"overlaps": False, "separation_km": None,
                  "reason": "could not load real footprint geometry for one or both sides -- not tested"}
    else:
        result = geo_extent_guard.check_footprint_overlap(footprint_a, footprint_b)
    verdict = "OVERLAP" if result["overlaps"] else "NO OVERLAP"
    sep = f"{result['separation_km']:.1f}km" if result.get("separation_km") is not None else "n/a"
    print(f"[{verdict:10s}] {label}  (separation: {sep})  -- {result['reason']}")
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--ch2", help="a real Chandrayaan-2 product id, e.g. tmc2_20260812_0506")
    ap.add_argument("--nac", help="a real LRO NAC product id, e.g. M1412862267LE")
    ap.add_argument("--batch", help="path to a JSON file: a list of {\"ch2\": id, \"nac\": id} candidate pairs")
    args = ap.parse_args()

    if args.batch:
        with open(args.batch) as f:
            pairs = json.load(f)
        for p in pairs:
            fp_a = _footprint_for_ch2_id(p["ch2"])
            fp_b = _footprint_for_nac_id(p["nac"])
            check_one(f"{p['ch2']} x {p['nac']}", fp_a, fp_b)
    elif args.ch2 and args.nac:
        fp_a = _footprint_for_ch2_id(args.ch2)
        fp_b = _footprint_for_nac_id(args.nac)
        check_one(f"{args.ch2} x {args.nac}", fp_a, fp_b)
    else:
        ap.error("either --batch, or both --ch2 and --nac, are required")


if __name__ == "__main__":
    main()
