"""PyTorch Dataset on top of LunarRasterReader, driven by pairs.json.

Each item is a real Chandrayaan-2/LRO NAC pair (or whatever raster_reader
can route), normalised via metadata_utils.adaptive_stretch (the
already-validated median +/- 3*IQR stretch, not the naive fixed-percentile
one -- see metadata_utils.py), and guarded by a real footprint-overlap
check before being returned.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import Dataset

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from datasets.raster_reader import LunarRasterReader  # noqa: E402
from datasets.metadata_utils import adaptive_stretch, footprint_overlap_guard  # noqa: E402


def _bbox_from_footprint(footprint) -> tuple | None:
    """Accepts either a PDS4-style dict ({lon_min,lon_max,lat_min,lat_max})
    or a PDS3-style 4-corner list -- returns (lon_min, lon_max, lat_min,
    lat_max), or None if no real footprint is available for this product."""
    if footprint is None:
        return None
    if isinstance(footprint, dict):
        return footprint["lon_min"], footprint["lon_max"], footprint["lat_min"], footprint["lat_max"]
    if isinstance(footprint, list) and footprint:
        lons = [c[0] for c in footprint]
        lats = [c[1] for c in footprint]
        return min(lons), max(lons), min(lats), max(lats)
    return None


class LunarPairDataset(Dataset):
    def __init__(self, pairs_json: str = "datasets/pairs.json", min_overlap_frac: float = 0.10):
        with open(pairs_json) as f:
            spec = json.load(f)
        self.pairs = spec["pairs"]
        self.min_overlap_frac = min_overlap_frac

    def __len__(self) -> int:
        return len(self.pairs)

    def __getitem__(self, idx: int) -> dict:
        pair = self.pairs[idx]
        query_meta = LunarRasterReader(pair["query"]).read()
        ref_meta = LunarRasterReader(pair["reference"]).read()

        query_bbox = _bbox_from_footprint(query_meta["footprint_latlon"])
        ref_bbox = _bbox_from_footprint(ref_meta["footprint_latlon"])
        overlap_bbox = None
        if query_bbox and ref_bbox:
            overlaps, frac, overlap_bbox = footprint_overlap_guard(query_bbox, ref_bbox, self.min_overlap_frac)
            if not overlaps:
                raise ValueError(
                    f"Pair {idx} ({pair['query']} / {pair['reference']}) rejected by the footprint "
                    f"overlap guard: only {frac:.1%} overlap (need >= {self.min_overlap_frac:.0%}) -- "
                    f"real bug class this guard exists to catch (see metadata_utils.py)."
                )

        query_tensor = torch.from_numpy(adaptive_stretch(query_meta["pixels"])).unsqueeze(0).float()
        ref_tensor = torch.from_numpy(adaptive_stretch(ref_meta["pixels"])).unsqueeze(0).float()

        return {
            "query": query_tensor,
            "reference": ref_tensor,
            "query_metadata": query_meta,
            "reference_metadata": ref_meta,
            "footprint_overlap_latlon": np.array(overlap_bbox) if overlap_bbox else None,
        }
