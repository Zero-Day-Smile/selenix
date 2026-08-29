"""DEM-Assisted Registration follow-up, Step 1 -- find real, topographically
distinctive locations from the real LOLA ldem_64.img where a match-relevant
crop (a few-to-tens of km, the scale that actually matters, per TASKS.md
part 11's finding) would span enough real DEM pixels to carry structure.

Real elevation variance is computed via an integral-image (summed-area
table) over the full global 64ppd grid -- exact, not sampled/approximated
-- for a real 50km-radius window, then cross-referenced against:
  - real named craters >=50km diameter (USGS Gazetteer, via the already-
    integrated crater_catalog.py -- real data, not fabricated)
  - real named lunar mountain ranges (Montes Apenninus, Montes Caucasus --
    public IAU-recognized locations, coordinates from the USGS Gazetteer
    of Planetary Nomenclature)
Ranks ALL candidates by the same real measured variance, not by category.
"""
import numpy as np

from backend.pipeline import crater_catalog

DEM_PATH = "backend/data/lola_dem/ldem_64.img"
DEM_LINES, DEM_SAMPLES = 11520, 23040
DEM_LINE_OFFSET, DEM_SAMPLE_OFFSET = 5759.5, 11519.5
DEM_RES = 64
DEM_SCALING = 0.5
KM_PER_DEG = 2 * np.pi * 1737.4 / 360
RADIUS_KM = 50.0
RADIUS_PX = int(round(RADIUS_KM * 1000 / 473.802))  # ~106 px

# Real, IAU-recognized lunar mountain ranges (USGS Gazetteer of Planetary
# Nomenclature) -- approximate central coordinates of the named massif.
NAMED_MASSIFS = [
    ("Montes Apenninus", 19.0, 356.9),   # ~ -3.1 W -> 356.9 E
    ("Montes Caucasus", 37.5, 8.8),
]


def lonlat_to_rc(lat, lon):
    row = DEM_LINE_OFFSET - lat * DEM_RES
    col = (DEM_SAMPLE_OFFSET + lon * DEM_RES) % DEM_SAMPLES
    return int(round(row)), int(round(col))


def local_variance_at(sat, sat2, row, col, r):
    r0, r1 = max(row - r, 0), min(row + r, DEM_LINES - 1)
    c0, c1 = col - r, col + r  # allow wraparound in longitude
    n = (r1 - r0 + 1) * (2 * r + 1)

    def integral_sum(S, r0, r1, c0, c1):
        # Handle longitude wraparound by splitting into at most 2 segments.
        total = 0.0
        segs = []
        if c0 < 0:
            segs.append((0, c1))
            segs.append((c0 + DEM_SAMPLES, DEM_SAMPLES - 1))
        elif c1 >= DEM_SAMPLES:
            segs.append((c0, DEM_SAMPLES - 1))
            segs.append((0, c1 - DEM_SAMPLES))
        else:
            segs.append((c0, c1))
        for cc0, cc1 in segs:
            A = S[r1, cc1]
            B = S[r0 - 1, cc1] if r0 > 0 else 0.0
            C = S[r1, cc0 - 1] if cc0 > 0 else 0.0
            D = S[r0 - 1, cc0 - 1] if (r0 > 0 and cc0 > 0) else 0.0
            total += A - B - C + D
        return total

    s = integral_sum(sat, r0, r1, c0, c1)
    s2 = integral_sum(sat2, r0, r1, c0, c1)
    mean = s / n
    var = s2 / n - mean ** 2
    return float(var), float(np.sqrt(max(var, 0)))


def main():
    print(f"Loading DEM and building integral image (radius={RADIUS_PX}px = {RADIUS_KM}km)...")
    dem = np.fromfile(DEM_PATH, dtype="<i2").reshape(DEM_LINES, DEM_SAMPLES).astype(np.float64) * DEM_SCALING
    # Pad in longitude for wraparound-safe cumsum construction isn't needed
    # since integral_sum() handles wraparound explicitly via segment split.
    sat = np.cumsum(np.cumsum(dem, axis=0), axis=1)
    sat2 = np.cumsum(np.cumsum(dem ** 2, axis=0), axis=1)

    candidates = []

    # Real named craters >=50km diameter, from the already-integrated real
    # USGS Gazetteer catalog (global query).
    gaz = crater_catalog.query_bbox(0, 360, -90, 90)
    named_large = [c for c in gaz if c["name"] and c["diameter_km"] and c["diameter_km"] >= 50]
    print(f"Real named craters >=50km in Gazetteer: {len(named_large)}")
    for c in named_large:
        candidates.append(("crater", c["name"], c["lat"], c["lon"], c["diameter_km"]))

    for name, lat, lon in NAMED_MASSIFS:
        candidates.append(("massif", name, lat, lon, None))

    print(f"Computing real local elevation variance for {len(candidates)} candidates...")
    scored = []
    for kind, name, lat, lon, diam in candidates:
        row, col = lonlat_to_rc(lat, lon)
        var, std = local_variance_at(sat, sat2, row, col, RADIUS_PX)
        scored.append((std, kind, name, lat, lon, diam))

    scored.sort(reverse=True)
    print(f"\nTop 5 by real elevation std-dev within {RADIUS_KM}km radius:")
    for std, kind, name, lat, lon, diam in scored[:5]:
        diam_str = f", diameter={diam:.0f}km" if diam else ""
        print(f"  {name} ({kind}{diam_str}): lat={lat:.2f}, lon={lon:.2f}, elevation_std={std:.1f}m")

    import json
    with open("backend/outputs/_dem_high_value_locations.json", "w") as f:
        json.dump([
            {"kind": k, "name": n, "lat": la, "lon": lo, "diameter_km": d, "elevation_std_m": s}
            for s, k, n, la, lo, d in scored[:20]
        ], f, indent=2)
    print("\nSaved top 20 to backend/outputs/_dem_high_value_locations.json")


if __name__ == "__main__":
    main()
