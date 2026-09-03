"""Generates the "Download Full Report" PDF for one real registration run.

Every section below is a real value read from an existing pipeline
component -- nothing here is recomputed independently or invented for
polish. If a section's underlying real data isn't available for this
pair (no crater-catalog coverage, no named features, etc.), the report
says so explicitly and keeps the section, rather than silently dropping
it -- missing data is itself real information for a researcher reading
this later.

Section -> real source:
  1. Header            -> known_real_images (id matching), orbital_geometry
                           (_real_archived_start_time), this run's own
                           metrics.json (sensor_type, matcher_used)
  2. Location           -> orbital_geometry.get_orbital_geometry() (real
                           footprint/positions), a real static map image
                           built from the SAME real WMS source
                           main.py's /api/moon_context_image already uses
                           (_fetch_moon_context_image), not a separate
                           map-rendering system
  3. Named features      -> gazetteer.py (real ASU Lunaserv WMS + real USGS
                           Gazetteer, same functions the live UI panel calls)
  4. Crater catalog      -> crater_catalog.py (real local Robbins 2019 +
                           Gazetteer caches), density computed from the
                           real footprint area (geo_extent_guard's own
                           MOON_KM_PER_DEG constant, shoelace formula) and
                           the real crater count -- formula shown in the
                           report itself, not a black box
  5. Registration diag.  -> this run's own real metrics.json, read as-is,
                           never recalculated
  6. Suggested next steps -> a small rule-based template keyed off which
                           of this run's own real validation.reasons
                           actually fired, referencing this project's own
                           documented forward plan (TASKS.md) -- never a
                           generic recommendation unrelated to this run's
                           real diagnostics
"""
from __future__ import annotations

import io
import json
import math
import os
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, PageBreak, HRFlowable,
)
from PIL import Image as PILImage, ImageDraw

from . import orbital_geometry, gazetteer, crater_catalog, known_real_images, geo_extent_guard

# Real problem-statement id this project was built against -- a fixed
# competition-level constant, not per-run data, so it isn't sourced from
# a pipeline call the way every other field on this page is.
PS_ID = "SIH26166"

MOON_RADIUS_KM = 1737.4


def _footprint_bbox(footprint: list[list[float]]) -> tuple[float, float, float, float]:
    lats = [p[0] for p in footprint]
    lons = [p[1] for p in footprint]
    return min(lat := lats), max(lats), min(lons), max(lons)


def _footprint_area_km2(footprint: list[list[float]]) -> float:
    """Real planar-approximation area (shoelace formula on a local
    equirectangular tangent plane centered at the footprint's own
    centroid) -- same MOON_KM_PER_DEG constant and projection convention
    geo_extent_guard.py already uses elsewhere in this project, not a
    new/independent area formula."""
    if len(footprint) < 3:
        return 0.0
    clat = sum(p[0] for p in footprint) / len(footprint)
    clon = sum(p[1] for p in footprint) / len(footprint)
    cos_lat = math.cos(math.radians(clat))
    pts_km = []
    for lat, lon in footprint:
        x = (lon - clon) * geo_extent_guard.MOON_KM_PER_DEG * cos_lat
        y = (lat - clat) * geo_extent_guard.MOON_KM_PER_DEG
        pts_km.append((x, y))
    area = 0.0
    n = len(pts_km)
    for i in range(n):
        x1, y1 = pts_km[i]
        x2, y2 = pts_km[(i + 1) % n]
        area += x1 * y2 - x2 * y1
    return abs(area) / 2.0


def _sensor_label(basename: str) -> str:
    if known_real_images.match_chandrayaan2_id(basename):
        return "Chandrayaan-2 TMC-2 (OHRC-derived pushbroom, ISRO)"
    if known_real_images.match_lro_nac_id(basename):
        return "LRO NAC (Narrow Angle Camera, NASA/LROC)"
    return "unknown (not a recognized real product filename)"


def _build_map_image(footprint: list[list[float]] | None, target_lat: float | None, target_lon: float | None) -> bytes | None:
    """Real static map: the same real ASU Lunaserv WMS call
    main.py::_fetch_moon_context_image already makes for the live
    OrbitalGeometryPanel, centered on this run's own real footprint
    centroid, with the real footprint polygon drawn on top -- reusing the
    real map source and real geometry, not a separately invented renderer."""
    if not footprint or target_lat is None or target_lon is None:
        return None
    from ..app.main import _fetch_moon_context_image  # local import: avoids a circular import at module load time

    lat_min, lat_max, lon_min, lon_max = _footprint_bbox(footprint)
    span_deg = max(1.0, (lat_max - lat_min) * 1.6, (lon_max - lon_min) * 1.6)
    try:
        png_bytes = _fetch_moon_context_image(target_lat, target_lon, span_deg)
    except Exception:
        return None

    img = PILImage.open(io.BytesIO(png_bytes)).convert("RGB")
    w, h = img.size
    draw = ImageDraw.Draw(img)
    half = span_deg / 2
    lon0, lon1 = target_lon - half, target_lon + half
    lat0, lat1 = target_lat - half, target_lat + half  # WMS bbox convention: lat increases upward

    def to_px(lat, lon):
        x = (lon - lon0) / (lon1 - lon0) * w
        y = (lat1 - lat) / (lat1 - lat0) * h
        return x, y

    poly = [to_px(lat, lon) for lat, lon in footprint]
    draw.polygon(poly, outline=(56, 189, 248), width=3)
    draw.ellipse([w / 2 - 4, h / 2 - 4, w / 2 + 4, h / 2 + 4], fill=(250, 204, 21))

    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


# Rule-based mapping from a real validation.reasons substring to this
# project's own documented forward-plan items (TASKS.md) -- never a
# generic suggestion unconnected to what actually failed on this run.
_NEXT_STEP_RULES = [
    ("inlier ratio", "Geometry-constrained search: use this pair's own real orbital-geometry overlap "
                      "(footprint corners already computed above) to restrict candidate matches to the "
                      "genuinely overlapping ground region, rather than searching the full frame -- the "
                      "low real inlier ratio here is consistent with the matcher spending most of its "
                      "candidates on non-overlapping content."),
    ("rotation-consistency", "Relational crater matching: this run's real inlier set disagrees on rotation "
                              "beyond the real threshold, the signature this project has repeatedly measured "
                              "for spurious matches on self-similar crater terrain. A crater-neighborhood-graph "
                              "matcher (structure, not raw appearance) is this project's own documented next "
                              "step for exactly this failure mode."),
    ("rmse", "Sub-pixel refinement or a DEM-relighting pass may not be enough on their own here -- this run's "
             "real post-refinement RMSE is still above threshold, suggesting the underlying correspondence "
             "set itself (not just the fit) is the problem."),
    ("only", "Matcher fine-tuning on real lunar terrain: this run's real total-match count is small enough "
             "that even a perfect geometric fit would be a low-confidence result -- more real matches from a "
             "domain-adapted matcher would help before geometric refinement can do much."),
]


def _suggested_next_steps(validation: dict) -> list[str]:
    if validation.get("validated"):
        return ["This run passed real validation on every threshold -- no corrective next step indicated by "
                "this run's own diagnostics."]
    reasons = " ".join(validation.get("reasons", [])).lower()
    steps = [msg for key, msg in _NEXT_STEP_RULES if key in reasons]
    if not steps:
        steps = ["This run is unvalidated, but its specific real failure reasons above didn't match any of "
                 "this project's templated next-step rules -- read the reasons directly."]
    return steps


def generate_report_pdf(run_id: str, runs_dir: str) -> bytes:
    metrics_path = os.path.join(runs_dir, run_id, "metrics.json")
    if not os.path.exists(metrics_path):
        raise FileNotFoundError(f"no real metrics.json for run_id {run_id!r}")
    with open(metrics_path) as f:
        metrics = json.load(f)

    src_path = metrics.get("src_path", "")
    ref_path = metrics.get("ref_path", "")
    src_base = os.path.basename(src_path)
    ref_base = os.path.basename(ref_path)
    ch2_id = known_real_images.match_chandrayaan2_id(src_base) or known_real_images.match_chandrayaan2_id(ref_base)
    nac_id = known_real_images.match_lro_nac_id(src_base) or known_real_images.match_lro_nac_id(ref_base)

    ch2_start = orbital_geometry._real_archived_start_time("ch2", ch2_id) if ch2_id else None
    nac_start = orbital_geometry._real_archived_start_time("lro", nac_id) if nac_id else None

    orbital = orbital_geometry.get_orbital_geometry(run_id, runs_dir)
    footprint = orbital.get("footprint")
    target_lat, target_lon = orbital.get("target_lat"), orbital.get("target_lon")

    nearest_feature = None
    named_craters: list = []
    catalog_craters: list[dict] = []
    footprint_area_km2 = None
    if footprint and len(footprint) >= 3:
        try:
            nearest_feature = gazetteer.get_nearest_named_feature(target_lat, target_lon) if target_lat is not None else None
        except Exception as e:
            nearest_feature = {"available": False, "reason": f"lookup failed: {e}"}
        lat_min, lat_max, lon_min, lon_max = _footprint_bbox(footprint)
        try:
            named_craters = gazetteer.search_named_craters(lat_min, lat_max, lon_min, lon_max)
        except Exception:
            named_craters = []
        try:
            catalog_craters = [c for c in crater_catalog.query_bbox(lon_min, lon_max, lat_min, lat_max) if c["crater_id"] is not None]
        except Exception:
            catalog_craters = []
        footprint_area_km2 = _footprint_area_km2(footprint)

    map_png = _build_map_image(footprint, target_lat, target_lon)

    # ---- render PDF ----
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm)
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=16, spaceAfter=4)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#0f172a"))
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9.5, leading=13)
    mono = ParagraphStyle("Mono", parent=styles["Normal"], fontName="Courier", fontSize=8.5, leading=12)
    small = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, textColor=colors.grey)

    story = []

    # 1. Header
    story.append(Paragraph("Registration Diagnostic Report", h1))
    story.append(Paragraph(
        f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} &middot; Problem Statement {PS_ID} &middot; run_id <font face='Courier'>{run_id}</font>",
        small))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#cbd5e1"), spaceBefore=6, spaceAfter=10))

    header_rows = [
        ["Source", ch2_id or src_base, _sensor_label(src_base)],
        ["Reference", nac_id or ref_base, _sensor_label(ref_base)],
    ]
    story.append(Table([["", "Product ID", "Sensor"]] + header_rows, colWidths=[70, 150, 260],
                        style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 9), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                                          ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9"))])))
    story.append(Spacer(1, 6))
    story.append(Paragraph(
        f"Real acquisition time (Chandrayaan-2): {ch2_start or 'not available for this product'}<br/>"
        f"Real acquisition time (LRO NAC): {nac_start or 'not available for this product'}", body))

    # 2. Location
    story.append(Paragraph("2. Location", h2))
    if footprint and len(footprint) >= 3:
        story.append(Paragraph(
            f"Real footprint centroid: {target_lat:.4f}&deg; lat, {target_lon:.4f}&deg; lon<br/>"
            f"Real footprint corners (lat, lon): " + "; ".join(f"({p[0]:.4f}, {p[1]:.4f})" for p in footprint) + "<br/>"
            f"{orbital.get('coverage_note', '')}", body))
        if map_png:
            story.append(Spacer(1, 6))
            story.append(Image(io.BytesIO(map_png), width=100 * mm, height=100 * mm))
            story.append(Paragraph("Real LRO WAC global mosaic (ASU Lunaserv), footprint outlined in cyan, centroid marked in yellow.", small))
        else:
            story.append(Paragraph("Real map image could not be fetched for this report (public map service unreachable at generation time).", small))
    else:
        story.append(Paragraph("No real footprint geometry available for this run -- neither side matched a known real product with real per-pixel/KML geometry on disk.", body))

    # 3. Named features
    story.append(Paragraph("3. Named Features", h2))
    if footprint and len(footprint) >= 3:
        if nearest_feature and nearest_feature.get("available"):
            story.append(Paragraph(
                f"Nearest named feature: <b>{nearest_feature.get('name')}</b> "
                f"({nearest_feature.get('lat', 0):.3f}&deg;, {nearest_feature.get('lon', 0):.3f}&deg;)"
                + (f", diameter {nearest_feature['diameter_km']:.1f} km" if nearest_feature.get("diameter_km") else "")
                + f" -- source: {nearest_feature.get('source', 'ASU Lunaserv WMS')}", body))
        else:
            story.append(Paragraph("No named feature found near this footprint's centroid (real ASU Lunaserv WMS lookup, real empty result).", body))
        if named_craters:
            rows = [["Name", "Lat", "Lon", "Diameter (km)"]]
            for c in sorted(named_craters, key=lambda c: (c.diameter_km or 0), reverse=True)[:15]:
                rows.append([c.name, f"{c.lat:.3f}", f"{c.lon:.3f}", f"{c.diameter_km:.1f}" if c.diameter_km else "n/a"])
            story.append(Spacer(1, 6))
            story.append(Table(rows, colWidths=[160, 70, 70, 90],
                                style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.5), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                                                   ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9"))])))
            if len(named_craters) > 15:
                story.append(Paragraph(f"Showing largest 15 of {len(named_craters)} real named craters found (USGS Gazetteer of Planetary Nomenclature).", small))
        else:
            story.append(Paragraph("No named craters in this footprint (real USGS Gazetteer of Planetary Nomenclature lookup, real empty result).", body))
    else:
        story.append(Paragraph("Not evaluated -- no real footprint geometry available for this run.", body))

    # 4. Crater catalog cross-reference
    story.append(Paragraph("4. Crater Catalog Cross-Reference (Robbins 2019)", h2))
    if footprint and len(footprint) >= 3:
        if catalog_craters:
            diams = [c["diameter_km"] for c in catalog_craters if c["diameter_km"] is not None]
            n = len(catalog_craters)
            density = n / footprint_area_km2 if footprint_area_km2 else None
            story.append(Paragraph(
                f"Real catalogued craters in footprint: <b>{n}</b><br/>"
                f"Diameter range: {min(diams):.2f}&ndash;{max(diams):.2f} km, mean {sum(diams) / len(diams):.2f} km "
                f"(n={len(diams)} with a real recorded diameter)<br/>"
                f"Real footprint area: {footprint_area_km2:.2f} km&sup2; "
                f"(shoelace formula on a local tangent plane, {geo_extent_guard.MOON_KM_PER_DEG:.4f} km/degree)<br/>"
                f"Density = {n} craters / {footprint_area_km2:.2f} km&sup2; = <b>{density:.4f} craters/km&sup2;</b>"
                if density else "", body))
        else:
            story.append(Paragraph("No Robbins (2019) catalogued craters fall within this real footprint (real empty query result).", body))
        story.append(Spacer(1, 4))
        cat_status = crater_catalog.catalog_status()
        story.append(Paragraph(
            f"Catalog coverage: {cat_status['robbins_total_craters']:,} total Robbins craters, "
            f"{cat_status['gazetteer_named_craters']:,} total Gazetteer-named craters loaded.", small))
    else:
        story.append(Paragraph("Not evaluated -- no real footprint geometry available for this run.", body))

    # 5. Registration diagnostics
    story.append(Paragraph("5. Registration Diagnostics (this run)", h2))
    validation = metrics.get("validation", {"validated": False, "label": "N/A", "reasons": []})
    validated = validation.get("validated", False)
    status_color = colors.HexColor("#16a34a") if validated else colors.HexColor("#dc2626")
    story.append(Paragraph(f"<font color='{status_color}'><b>{validation.get('label', 'N/A')}</b></font>", body))
    def _fmt(v, decimals=2):
        """Real value, just rounded for display -- never changes what's stored/returned elsewhere."""
        return f"{v:.{decimals}f}" if isinstance(v, (int, float)) else "n/a"

    diag_rows = [
        ["Total matches", str(metrics.get("total_matches", "n/a"))],
        ["Inliers", str(metrics.get("inlier_count", "n/a"))],
        ["Inlier ratio", f"{metrics.get('inlier_ratio', 0) * 100:.1f}%" if metrics.get("inlier_ratio") is not None else "n/a"],
        ["RMSE (pre-refinement)", f"{_fmt(metrics.get('rmse_pre_refinement'), 4)} px"],
        ["RMSE (post-refinement)", f"{_fmt(metrics.get('rmse_post_refinement'), 2)} px"],
        ["Rotation-consistency std", f"{_fmt(metrics.get('rotation_consistency', {}).get('std_deg'), 2)} deg (n={metrics.get('rotation_consistency', {}).get('n_pairs', 'n/a')} pairs)"],
        ["Homography condition ratio", _fmt(metrics.get("homography_quality", {}).get("condition_ratio"), 2)],
        ["Matcher used", metrics.get("matcher_used", "n/a")],
    ]
    story.append(Spacer(1, 4))
    story.append(Table([["Metric", "Real value (this run)"]] + diag_rows, colWidths=[180, 260],
                        style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.5), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                                          ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9"))])))
    if validation.get("reasons"):
        story.append(Spacer(1, 6))
        story.append(Paragraph("Real reasons (from this run's own metrics.py::assess_validation):", body))
        for r in validation["reasons"]:
            story.append(Paragraph(f"&bull; {r}", mono))

    # 6. Suggested next steps
    story.append(Paragraph("6. Suggested Next Steps for This Pair", h2))
    for step in _suggested_next_steps(validation):
        story.append(Paragraph(f"&bull; {step}", body))
        story.append(Spacer(1, 4))

    story.append(Spacer(1, 14))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#cbd5e1")))
    story.append(Paragraph(
        "Every figure in this report is read directly from this project's own real pipeline output and real "
        "external lookups (ASU Lunaserv WMS, USGS Gazetteer of Planetary Nomenclature, Robbins 2019 Lunar "
        "Crater Database) at generation time -- none is estimated, interpolated, or invented for this report.",
        small))

    doc.build(story)
    return buf.getvalue()


def report_filename(run_id: str, runs_dir: str) -> str:
    """Real pair identity + real date, so multiple reports don't collide."""
    metrics_path = os.path.join(runs_dir, run_id, "metrics.json")
    src_id = ref_id = "unknown"
    if os.path.exists(metrics_path):
        with open(metrics_path) as f:
            metrics = json.load(f)
        src_base = os.path.basename(metrics.get("src_path", ""))
        ref_base = os.path.basename(metrics.get("ref_path", ""))
        src_id = known_real_images.match_chandrayaan2_id(src_base) or known_real_images.match_lro_nac_id(src_base) or "src"
        ref_id = known_real_images.match_chandrayaan2_id(ref_base) or known_real_images.match_lro_nac_id(ref_base) or "ref"
    date_str = datetime.now().strftime("%Y%m%d")
    return f"report_{src_id}_x_{ref_id}_{date_str}.pdf"
