"""Sanity test for check_footprint_overlap(): confirms its answers agree
with ground truth we already trust before relying on it for anything new.

Two ground-truth sources:
  1. backend/data/real/_regression_extent_results.json -- every entry there
     has ok=True from verified_overlap_extent(), which only returns ok=True
     after finding >=10 real geometry-CSV points genuinely inside the NAC
     quadrilateral. That means every pair in this file is a REAL, CONFIRMED
     overlap (extent_mismatch is a separate, later question about relative
     size, not about whether they overlap at all) -- so the new gate must
     say overlaps=True for every one of them.
  2. The known-bad pairs found during this session: tmc2_20260812_0506,
     tmc2_20260803_0049, and tmc2_20260809_1606 were each mistakenly tested
     against M1412862267LE, which real footprint geometry confirms is
     ~62-104 degrees / ~1,900-3,150km from all three -- nowhere near
     overlapping. The gate must say overlaps=False for all three.

Run: python -m backend.scripts.sanity_check_overlap_gate
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.pipeline import geo_extent_guard, orbital_geometry  # noqa: E402

REGRESSION_RESULTS = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "data", "real", "_regression_extent_results.json",
)

KNOWN_BAD_PAIRS = [
    ("tmc2_20260812_0506", "M1412862267LE"),
    ("tmc2_20260803_0049", "M1412862267LE"),
    ("tmc2_20260809_1606", "M1412862267LE"),
]


def _footprint_for_ch2_id(ch2_id: str):
    geom_csv = os.path.join(orbital_geometry.CHANDRAYAAN2_DIR, ch2_id, f"{ch2_id}_geometry.csv")
    return orbital_geometry._ch2_footprint_corners(geom_csv)  # noqa: SLF001


def _footprint_for_nac_id(nac_id: str):
    kml_path = os.path.join(orbital_geometry.LRO_NAC_DIR, nac_id, f"{nac_id}_xml.kml")
    return orbital_geometry._nac_footprint_corners(kml_path)  # noqa: SLF001


def main() -> int:
    failures = []
    tested = 0
    skipped = 0

    print("=== known-good pairs (from _regression_extent_results.json, all real, verified overlaps) ===")
    with open(REGRESSION_RESULTS) as f:
        known_good = json.load(f)
    for entry in known_good:
        ch2_id, nac_id = entry["tmc"], entry["nac"]
        fp_a, fp_b = _footprint_for_ch2_id(ch2_id), _footprint_for_nac_id(nac_id)
        if fp_a is None or fp_b is None:
            print(f"  SKIP {ch2_id} x {nac_id}: real footprint geometry not on disk for this pair")
            skipped += 1
            continue
        result = geo_extent_guard.check_footprint_overlap(fp_a, fp_b)
        tested += 1
        status = "PASS" if result["overlaps"] else "FAIL"
        print(f"  [{status}] {ch2_id} x {nac_id} (verified_points={entry['verified_points']}) "
              f"-> overlaps={result['overlaps']}")
        if not result["overlaps"]:
            failures.append((ch2_id, nac_id, "expected overlaps=True (real verified overlap), got False", result))

    print()
    print("=== known-bad pairs (confirmed non-overlapping this session, real angular separation checked) ===")
    for ch2_id, nac_id in KNOWN_BAD_PAIRS:
        fp_a, fp_b = _footprint_for_ch2_id(ch2_id), _footprint_for_nac_id(nac_id)
        if fp_a is None or fp_b is None:
            print(f"  SKIP {ch2_id} x {nac_id}: real footprint geometry not on disk for this pair")
            skipped += 1
            continue
        result = geo_extent_guard.check_footprint_overlap(fp_a, fp_b)
        tested += 1
        status = "PASS" if not result["overlaps"] else "FAIL"
        print(f"  [{status}] {ch2_id} x {nac_id} -> overlaps={result['overlaps']} "
              f"separation_km={result['separation_km']}")
        if result["overlaps"]:
            failures.append((ch2_id, nac_id, "expected overlaps=False (confirmed non-overlapping), got True", result))

    print()
    print(f"Tested {tested} pairs ({skipped} skipped, no geometry on disk). {len(failures)} disagreement(s).")
    if failures:
        print("\nDISAGREEMENTS (fix check_footprint_overlap before trusting it on anything new):")
        for ch2_id, nac_id, msg, result in failures:
            print(f"  {ch2_id} x {nac_id}: {msg}  (full result: {result})")
        return 1

    print("All ground-truth pairs agree. check_footprint_overlap() is trustworthy on this evidence.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
