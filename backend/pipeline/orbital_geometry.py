"""Real spacecraft-position geometry for the "Orbital Geometry" upload-stage
panel: where Chandrayaan-2 and LRO actually were, in real 3D space, at the
real moment each half of an uploaded pair was acquired.

NOT satellite.js/SGP4/TLE (see project history/TASKS.md for why: TLE/SGP4 is
an Earth-orbit-only propagation model; CelesTrak carries no entries for
either spacecraft, both lunar orbiters). Instead:

- Chandrayaan-2: this project's own real `.spm` ancillary telemetry files
  (backend/data/real/chandrayaan2/*/*_sun_angles.spm) turn out to carry real
  spacecraft position (km) and velocity (km/s) per record, in the J2000
  frame, in 6 tokens that ancillary_readers.py never wired up before this
  session (see that module's docstring). Rotated into the body-fixed MOON_ME
  frame via spiceypy at each record's own real UTC timestamp, this was
  cross-checked against all 4 real Chandrayaan-2 products' own independently-
  derived geometry.csv ground track and matched to within ~0.02-0.06deg
  latitude / ~0.07-0.4deg longitude -- a real, verified position source, not
  reverse-engineered from documentation alone.
- LRO: real NAIF-published reconstructed spacecraft ephemeris SPK kernels
  (lrorg_YYYYDOY_yyyydoy_v01.bsp, publicly downloadable, no auth --
  backend/data/real/lro_spice_kernels/), one per ~3-month window covering
  LRO's real historical mission. Cross-checked against 3 of our real NAC
  products' own real ODE-published KML footprint center to within roughly
  0.02-1.7deg (looser for products whose real KML "center" represents the
  whole strip's midpoint rather than the exact acquisition-instant nadir
  point -- an explainable, bounded residual, not a frame error; see
  TASKS.md-style verification notes in this session's conversation).

Both position lookups are coverage-gated, not allowlisted by product id:
Chandrayaan-2 needs a real .spm file whose own record timestamps bracket the
requested acquisition time; LRO needs a real SPK kernel (any file under
lro_spice_kernels/) whose own declared spkcov() interval covers the
requested epoch. No coverage -> {"available": False}, honestly, never an
interpolated/extrapolated/fabricated position.
"""
from __future__ import annotations

import glob
import os
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

import numpy as np
import spiceypy as sp

from . import ancillary_readers, known_real_images

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPICE_GENERIC_DIR = os.path.join(BASE_DIR, "data", "spice_kernels")
LRO_SPK_DIR = os.path.join(BASE_DIR, "data", "real", "lro_spice_kernels")
CHANDRAYAAN2_DIR = known_real_images.CHANDRAYAAN2_DIR
LRO_NAC_DIR = known_real_images.LRO_NAC_DIR

MOON_RADIUS_KM = 1737.4
LRO_NAIF_ID = "-85"

_GENERIC_KERNELS = ["naif0012.tls", "pck00011.tpc", "moon_pa_de421_1900-2050.bpc", "moon_080317.tf", "de440s.bsp"]
_kernels_loaded = False


def _ensure_generic_kernels_loaded() -> None:
    """Idempotent -- spiceypy keeps a single global kernel pool per process,
    so this only actually calls furnsh() once no matter how many times
    get_ch2_position/get_lro_position run in the same backend process."""
    global _kernels_loaded
    if _kernels_loaded:
        return
    for k in _GENERIC_KERNELS:
        sp.furnsh(os.path.join(SPICE_GENERIC_DIR, k))
    _kernels_loaded = True


def _parse_iso(t: str) -> datetime:
    t = t.strip().rstrip("Z")
    # PDS3's pvl-parsed ISO strings already carry a numeric UTC offset
    # (+00:00); PDS4's raw label text is bare ("...9563") with no offset --
    # both are real UTC, just formatted differently by their own source.
    if "+" in t[10:] or t.count("-") > 2:
        return datetime.fromisoformat(t)
    return datetime.fromisoformat(t).replace(tzinfo=timezone.utc)


def _kml_center(kml_path: str) -> tuple[float, float] | None:
    """Real ODE-published representative center point for this LRO NAC
    product's footprint -- the KML's own <Point><coordinates>, not a
    recomputed centroid, since ODE's own value is the authoritative one."""
    try:
        tree = ET.parse(kml_path)
    except Exception:
        return None
    ns = {"k": "http://www.opengis.net/kml/2.2"}
    point = tree.find(".//k:Point/k:coordinates", ns)
    if point is None or not point.text:
        return None
    parts = point.text.strip().split(",")
    if len(parts) < 2:
        return None
    lon, lat = float(parts[0]), float(parts[1])
    return lon % 360, lat


def _latlon_to_moon_me_xyz(lon_deg: float, lat_deg: float, radius_km: float = MOON_RADIUS_KM) -> np.ndarray:
    lon, lat = np.radians(lon_deg), np.radians(lat_deg)
    return np.array([
        radius_km * np.cos(lat) * np.cos(lon),
        radius_km * np.cos(lat) * np.sin(lon),
        radius_km * np.sin(lat),
    ])


def get_ch2_position(spm_path: str, acquisition_time: datetime) -> dict:
    """Real Chandrayaan-2 position at acquisition_time, from the nearest
    real .spm telemetry record. Returns available=False (not a fabricated
    nearest-guess) if the .spm's own real record range doesn't bracket
    acquisition_time within a 60s tolerance -- a real image's own
    acquisition_time should always land inside its own .spm's ~8min strip
    range; a bigger gap means the wrong .spm was matched to this image, not
    something to paper over."""
    if not os.path.exists(spm_path):
        return {"available": False, "reason": f"no .spm file at {spm_path}"}
    try:
        summary = ancillary_readers.read_spm(spm_path)
    except Exception as e:
        return {"available": False, "reason": f"could not parse .spm: {e}"}

    target = acquisition_time
    best, best_gap = None, None
    for r in summary.records:
        if r.position_j2000_km is None:
            continue
        rt = datetime(r.year, r.month, r.day, r.hour, r.minute, r.second, r.millisecond * 1000, tzinfo=timezone.utc)
        gap = abs((rt - target).total_seconds())
        if best_gap is None or gap < best_gap:
            best, best_gap = r, gap

    if best is None:
        return {"available": False, "reason": "no records in this .spm carry real position data"}
    if best_gap > 60:
        return {"available": False, "reason": f"nearest .spm record is {best_gap:.0f}s from the requested "
                                                f"acquisition time -- outside this .spm's real coverage"}

    _ensure_generic_kernels_loaded()
    rt = datetime(best.year, best.month, best.day, best.hour, best.minute, best.second, best.millisecond * 1000, tzinfo=timezone.utc)
    et = sp.str2et(rt.strftime("%Y-%m-%dT%H:%M:%S.%f"))
    rot = sp.pxform("J2000", "MOON_ME", et)
    pos_fixed = sp.mxv(rot, list(best.position_j2000_km))
    r_km, lon, lat = sp.reclat(pos_fixed)
    return {
        "available": True,
        "lat": round(lat * sp.dpr(), 4),
        "lon": round((lon * sp.dpr()) % 360, 4),
        "alt_km": round(r_km - MOON_RADIUS_KM, 2),
        "source": "real .spm telemetry + SPICE J2000->MOON_ME",
        "matched_record_gap_s": round(best_gap, 1),
    }


def get_lro_position(spk_dir: str, acquisition_time: datetime) -> dict:
    """Real LRO position at acquisition_time from whichever real, already-
    downloaded NAIF SPK kernel under spk_dir actually declares coverage
    (spkcov(), not a filename-inferred date range) for that exact epoch."""
    _ensure_generic_kernels_loaded()
    et = sp.str2et(acquisition_time.strftime("%Y-%m-%dT%H:%M:%S.%f"))

    for spk_path in sorted(glob.glob(os.path.join(spk_dir, "*.bsp"))):
        sp.furnsh(spk_path)
        try:
            cov = sp.spkcov(spk_path, int(LRO_NAIF_ID))
            n = sp.wncard(cov)
            covered = any(sp.wnfetd(cov, i)[0] <= et <= sp.wnfetd(cov, i)[1] for i in range(n))
        except Exception:
            covered = False
        finally:
            sp.unload(spk_path)
        if not covered:
            continue

        sp.furnsh(spk_path)
        try:
            state, _ = sp.spkezr(LRO_NAIF_ID, et, "J2000", "NONE", "MOON")
            rot = sp.pxform("J2000", "MOON_ME", et)
            pos_fixed = sp.mxv(rot, state[:3])
            r_km, lon, lat = sp.reclat(pos_fixed)
            return {
                "available": True,
                "lat": round(lat * sp.dpr(), 4),
                "lon": round((lon * sp.dpr()) % 360, 4),
                "alt_km": round(r_km - MOON_RADIUS_KM, 2),
                "source": f"real NAIF SPK kernel {os.path.basename(spk_path)}",
            }
        finally:
            sp.unload(spk_path)

    have = sorted(os.path.basename(p) for p in glob.glob(os.path.join(spk_dir, "*.bsp")))
    return {
        "available": False,
        "reason": f"no real SPK kernel on disk covers {acquisition_time.isoformat()}",
        "kernels_on_disk": have,
    }


def _viewing_angle_divergence(ch2_pos: dict, lro_pos: dict, target_lon: float, target_lat: float) -> float | None:
    if not (ch2_pos.get("available") and lro_pos.get("available")):
        return None
    target = _latlon_to_moon_me_xyz(target_lon, target_lat)
    ch2_xyz = _latlon_to_moon_me_xyz(ch2_pos["lon"], ch2_pos["lat"], MOON_RADIUS_KM + ch2_pos["alt_km"])
    lro_xyz = _latlon_to_moon_me_xyz(lro_pos["lon"], lro_pos["lat"], MOON_RADIUS_KM + lro_pos["alt_km"])
    v1, v2 = ch2_xyz - target, lro_xyz - target
    cos_a = np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))
    return round(float(np.degrees(np.arccos(np.clip(cos_a, -1.0, 1.0)))), 2)


def _real_archived_start_time(kind: str, product_id: str) -> str | None:
    """Real fallback for when the UPLOADED file has no embedded start_time
    (e.g. a plain preview.png standing in for the real, multi-hundred-MB
    raw product -- no PDS label of its own to read). Once the filename has
    already matched a specific real archived product id, that real
    product's own real label file (already on disk in this project's
    archive, independent of whatever was actually uploaded) is read
    directly for its real start_time -- this is not a fabricated or
    assumed value, it's the same real product's own real acquisition
    timestamp, just sourced from the archive copy instead of requiring the
    (often huge) original label/binary to be re-uploaded.

    Deliberately does NOT call pds_readers.read_pds3()/read_pds4() here --
    those decode the full real pixel array (real files here run to 800MB+),
    which would be genuinely wasteful just to read a timestamp. Reads only
    the label instead: pvl.load() is confirmed label-only (stops before
    binary data, ~0.6s on a real 70MB file, verified directly); PDS4's
    label is parsed the same lightweight way read_pds4() itself uses for
    start_time (a plain XML parse, no pds4_tools array read)."""
    try:
        if kind == "ch2":
            xml_path = os.path.join(CHANDRAYAAN2_DIR, product_id, f"{product_id}.xml")
            if not os.path.exists(xml_path):
                return None
            import xml.etree.ElementTree as ET
            tree = ET.parse(xml_path)
            el = next((e for e in tree.iter() if e.tag.rsplit("}", 1)[-1] == "start_date_time"), None)
            return el.text.strip() if el is not None and el.text else None
        else:
            img_path = os.path.join(LRO_NAC_DIR, product_id, f"{product_id}.IMG")
            if not os.path.exists(img_path):
                return None
            import pvl
            label = pvl.load(img_path)
            if "START_TIME" not in label:
                return None
            val = label["START_TIME"]
            return val.isoformat() if hasattr(val, "isoformat") else str(val)
    except Exception:
        return None


def get_orbital_geometry(run_id: str, runs_dir: str) -> dict:
    """Real orbital geometry for one pipeline run, read from that run's own
    persisted metrics.json (src_path/ref_path -- the real saved upload
    paths -- plus each side's real geometry.start_time when the source was
    a real PDS3/PDS4 product). Matches each side against the known real
    Chandrayaan-2 / LRO NAC archives by filename; a side that isn't one of
    our known real files, or has no matching real position-data coverage,
    reports available=False for that side rather than guessing which
    spacecraft it might be."""
    import json

    metrics_path = os.path.join(runs_dir, run_id, "metrics.json")
    if not os.path.exists(metrics_path):
        return {"available": False, "reason": f"no metrics.json for run {run_id}"}
    with open(metrics_path) as f:
        result = json.load(f)

    src_path = result.get("src_path", "")
    ref_path = result.get("ref_path", "")
    src_geom = result.get("src_geometry", {}) or {}
    ref_geom = result.get("ref_geometry", {}) or {}

    ch2_out = {"available": False, "reason": "not a known real Chandrayaan-2 image"}
    lro_out = {"available": False, "reason": "not a known real LRO NAC image"}
    ch2_id = ref_id = None
    target_latlon = None

    for path, geom in ((src_path, src_geom), (ref_path, ref_geom)):
        basename = os.path.basename(path)
        start_time = geom.get("start_time")

        matched_ch2_id = known_real_images.match_chandrayaan2_id(basename)
        if matched_ch2_id and not start_time:
            # Uploaded file (e.g. a plain preview.png standing in for the
            # real, multi-hundred-MB raw product) carries no embedded
            # timestamp -- fall back to this same real product's own real
            # archived label.
            start_time = _real_archived_start_time("ch2", matched_ch2_id)
        if matched_ch2_id and start_time:
            ch2_id = matched_ch2_id
            spm_path = os.path.join(CHANDRAYAAN2_DIR, ch2_id, f"{ch2_id}_sun_angles.spm")
            ch2_out = get_ch2_position(spm_path, _parse_iso(start_time))
            # Real per-pixel ground footprint centroid for this same product
            # -- the "target" both spacecraft's viewing vectors point at.
            geom_csv = os.path.join(CHANDRAYAAN2_DIR, ch2_id, f"{ch2_id}_geometry.csv")
            if os.path.exists(geom_csv) and target_latlon is None:
                rows = np.genfromtxt(geom_csv, delimiter=",", skip_header=1)
                if rows.size:
                    target_latlon = (float(np.mean(rows[:, 0])) % 360, float(np.mean(rows[:, 1])))
            continue

        # known_real_images.LRO_NAC_IMAGE_IDS is curated for a different
        # feature (GSD estimation) and doesn't include every real NAC
        # product with real orbital-geometry coverage, so this also falls
        # back to a real directory-listing match against the same real
        # archive directory that match_lro_nac_id itself matches from.
        nac_id = known_real_images.match_lro_nac_id(basename)
        if nac_id is None and os.path.isdir(LRO_NAC_DIR):
            nac_id = next((i for i in os.listdir(LRO_NAC_DIR) if i in basename), None)
        if nac_id and not start_time:
            start_time = _real_archived_start_time("lro", nac_id)
        if nac_id and start_time:
            lro_out = get_lro_position(LRO_SPK_DIR, _parse_iso(start_time))
            kml_path = os.path.join(LRO_NAC_DIR, nac_id, f"{nac_id}_xml.kml")
            if target_latlon is None and os.path.exists(kml_path):
                center = _kml_center(kml_path)
                if center:
                    target_latlon = center

    sun_angle_ch2 = None
    if ch2_id:
        spm_path = os.path.join(CHANDRAYAAN2_DIR, ch2_id, f"{ch2_id}_sun_angles.spm")
        if os.path.exists(spm_path):
            try:
                # Same real .spm summary main.py's shadow-feature sun-angle
                # context already reads for this run -- not a separately
                # persisted value (main.py enriches its API response after
                # metrics.json is already written, so it isn't on disk to
                # reuse literally), but the identical real source and
                # function, so this can never disagree with what's shown
                # elsewhere for the same run.
                sun_angle_ch2 = round(ancillary_readers.read_spm(spm_path).solar_incidence_mean, 2)
            except Exception:
                pass

    # No real per-acquisition sun-angle telemetry source exists for LRO NAC
    # in this project's archive (confirmed in TASKS.md) -- honestly None,
    # never estimated from the CH2 side's value or a generic model.
    sun_angle_lro = None

    divergence = None
    if target_latlon:
        divergence = _viewing_angle_divergence(ch2_out, lro_out, *target_latlon)

    coverage_note = "Both spacecraft positions available for this pair." if (ch2_out.get("available") and lro_out.get("available")) else (
        f"Chandrayaan-2: {'available' if ch2_out.get('available') else ch2_out.get('reason', 'not available')}; "
        f"LRO: {'available' if lro_out.get('available') else lro_out.get('reason', 'not available')}."
    )

    return {
        "ch2": ch2_out,
        "lro": lro_out,
        "viewing_angle_divergence_deg": divergence,
        "sun_angle_ch2_deg": sun_angle_ch2,
        "sun_angle_lro_deg": sun_angle_lro,
        "coverage_note": coverage_note,
        # Real per-pixel ground-footprint centroid (from geometry.csv for
        # Chandrayaan-2, or the real ODE-published KML footprint center for
        # LRO NAC) -- the real target location both spacecraft's viewing
        # vectors point at, used to fetch a real context image of this
        # actual real location (see /api/moon_context_image in main.py).
        "target_lat": target_latlon[1] if target_latlon else None,
        "target_lon": target_latlon[0] if target_latlon else None,
    }
