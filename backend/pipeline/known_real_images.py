"""Single source of truth for which uploaded filenames correspond to our
known real Chandrayaan-2 / LRO NAC archive images -- used to gate features
that need real per-image metadata (real sun-angle telemetry, real GSD) to
a fixed allowlist matched by filename, never a directory listing or
arbitrary path, so these features can never be used to read arbitrary
files off disk.

CHANDRAYAAN2_IMAGE_IDS intentionally mirrors the constant of the same name
in backend/app/main.py (defined there first, for the crater/shadow
features) rather than importing across the pipeline/app layering
boundary -- small, stable, 4-element list; kept in sync manually.
"""
from __future__ import annotations

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHANDRAYAAN2_DIR = os.path.join(BASE_DIR, "data", "real", "chandrayaan2")
LRO_NAC_DIR = os.path.join(BASE_DIR, "data", "real", "lro_nac")

CHANDRAYAAN2_IMAGE_IDS = [
    "tmc2_20260803_0049", "tmc2_20260809_1606", "tmc2_20260811_1856", "tmc2_20260812_0506",
]

# Real LRO NAC product ids with a real *_overlap_info.json on disk (source
# of the real KML-footprint-derived GSD estimate used when no per-pixel
# label GSD exists). Excludes "self_pair" (not a real product id) and
# M1100131076RE (its real ODE footprint query failed -- see TASKS.md --
# so there is no real overlap extent to derive a GSD from).
LRO_NAC_IMAGE_IDS = [
    "M1202635811LE", "M1202635811RE", "M1221463099LE", "M1221463099RE",
    "M1306094925LE", "M1342582517LE", "M1349544899LE", "M1349544899RE",
    "M1382845798LE", "M1385774154LE", "M1385774154RE", "M1394580290LE",
    "M1394580290RE", "M1394580363LE", "M1394580363RE", "M1410451203LE",
    "M1410451203RE", "M1416270448LE", "M1444613697LE", "M1444613697RE",
]


def match_chandrayaan2_id(basename: str) -> str | None:
    return next((i for i in CHANDRAYAAN2_IMAGE_IDS if i in basename), None)


def match_lro_nac_id(basename: str) -> str | None:
    return next((i for i in LRO_NAC_IMAGE_IDS if i in basename), None)
