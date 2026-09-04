"""Generates the "Area Intelligence Report" PDF -- combines the three
supporting cards added to the live area-intelligence view (Region
Identity, Illumination & Sun Geometry, Shadow Coverage) into one
downloadable PDF for one real run. Reuses this run's own already-computed
real data and report_generator.py's existing helpers rather than
duplicating any of that logic -- this file adds no new computation of its
own beyond formatting/compositing what already exists.

Section -> real source:
  1. Region identity       -> orbital_geometry.get_orbital_geometry() (real
                               footprint centroid, per-side sensor + real
                               acquisition start_time), gazetteer.py (real
                               nearest named feature), this run's own real
                               metrics.json ingestion.src_geometry/
                               ref_geometry (best-effort label-derived
                               ground scale, frequently empty -- shown
                               honestly as "not available" when so)
  2. Illumination & sun     -> main.py::_sun_angle_context() (real CH2
     geometry                  .spm telemetry), this run's own real
                               metrics.json contrast_recovery
                               (preprocessing.py::contrast_recovery_ratio)
  3. Shadow coverage        -> this run's own real metrics.json
                               shadow_analysis (shadow.py's real
                               shadow_fraction), the real per-pixel shadow
                               overlay PNGs already written to this run's
                               output directory, composited over the real
                               processed base image -- the same real
                               overlay file the live ShadowRegionOverlay /
                               useShadowOverlayLayer render in-app, not a
                               separately rendered diagram.
"""
from __future__ import annotations

import io
import json
import os
from datetime import datetime, timezone

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, HRFlowable,
)
from PIL import Image as PILImage

from . import orbital_geometry, gazetteer
from .report_generator import PS_ID, _sensor_label, report_filename

# Mandatory, verbatim -- see the Shadow Coverage Report spec this section
# implements. Must not be shortened or omitted.
_SHADOW_CAPTION = (
    "Shadow detected in this single image at time of capture. This is not a "
    "permanently shadowed region (PSR) analysis, PSR identification requires "
    "multi-temporal data this project does not currently model."
)


def _first_geometry_value(geom: dict | None) -> str:
    if not geom:
        return "not available"
    for k, v in geom.items():
        return f"{k}: {v}"
    return "not available"


def _composite_shadow_overlay(run_dir: str, base_name: str, overlay_name: str) -> bytes | None:
    """Real base processed frame + real shadow.py overlay PNG, alpha-
    composited -- the exact same two real files
    useShadowOverlayLayer/ShadowRegionOverlay layer live in the app,
    flattened here into one static image for the PDF."""
    base_path = os.path.join(run_dir, base_name)
    overlay_path = os.path.join(run_dir, overlay_name)
    if not (os.path.exists(base_path) and os.path.exists(overlay_path)):
        return None
    try:
        base = PILImage.open(base_path).convert("RGBA")
        overlay = PILImage.open(overlay_path).convert("RGBA")
        if overlay.size != base.size:
            overlay = overlay.resize(base.size)
        composited = PILImage.alpha_composite(base, overlay).convert("RGB")
        composited.thumbnail((900, 900))
        out = io.BytesIO()
        composited.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return None


def generate_area_intelligence_report_pdf(run_id: str, runs_dir: str) -> bytes:
    run_dir = os.path.join(runs_dir, run_id)
    metrics_path = os.path.join(run_dir, "metrics.json")
    if not os.path.exists(metrics_path):
        raise FileNotFoundError(f"no real metrics.json for run_id {run_id!r}")
    with open(metrics_path) as f:
        metrics = json.load(f)

    src_path = metrics.get("src_path", "")
    ref_path = metrics.get("ref_path", "")
    src_base = os.path.basename(src_path)
    ref_base = os.path.basename(ref_path)

    orbital = orbital_geometry.get_orbital_geometry(run_id, runs_dir)
    footprint = orbital.get("footprint")
    target_lat, target_lon = orbital.get("target_lat"), orbital.get("target_lon")
    src_acq = orbital.get("src_acquisition")
    ref_acq = orbital.get("ref_acquisition")
    sun_incidence = orbital.get("sun_angle_ch2_deg")

    nearest_feature = None
    if footprint and len(footprint) >= 3 and target_lat is not None:
        try:
            nearest_feature = gazetteer.get_nearest_named_feature(target_lat, target_lon)
        except Exception as e:
            nearest_feature = {"available": False, "reason": f"lookup failed: {e}"}

    ingestion = metrics.get("ingestion") or {}
    src_geom = ingestion.get("src_geometry") or {}
    ref_geom = ingestion.get("ref_geometry") or {}

    from ..app.main import _sun_angle_context  # local import: avoids a circular import at module load time
    src_sun_ctx = _sun_angle_context(src_path) if src_path else None
    ref_sun_ctx = _sun_angle_context(ref_path) if ref_path else None
    contrast_recovery = metrics.get("contrast_recovery")

    shadow_analysis = metrics.get("shadow_analysis")
    src_shadow_png = _composite_shadow_overlay(run_dir, "src_processed.png", "src_shadow_overlay.png") if shadow_analysis else None
    ref_shadow_png = _composite_shadow_overlay(run_dir, "ref_processed.png", "ref_shadow_overlay.png") if shadow_analysis else None

    # ---- render PDF ----
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=18 * mm, leftMargin=18 * mm, rightMargin=18 * mm)
    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=16, spaceAfter=4)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=12, spaceBefore=14, spaceAfter=6, textColor=colors.HexColor("#0f172a"))
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9.5, leading=13)
    small = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, textColor=colors.grey)
    caption_style = ParagraphStyle("Caption", parent=styles["Normal"], fontSize=8.5, leading=12, textColor=colors.HexColor("#92400e"))

    story = []
    story.append(Paragraph("Area Intelligence Report", h1))
    story.append(Paragraph(
        f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} &middot; Problem Statement {PS_ID} &middot; run_id <font face='Courier'>{run_id}</font>",
        small))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#cbd5e1"), spaceBefore=6, spaceAfter=10))

    # 1. Region identity
    story.append(Paragraph("1. Region Identity", h2))
    if footprint and len(footprint) >= 3:
        clat = sum(p[0] for p in footprint) / len(footprint)
        clon = sum(p[1] for p in footprint) / len(footprint)
        centroid_line = f"Footprint centroid: {clat:.4f}&deg; lat, {clon:.4f}&deg; lon"
    else:
        centroid_line = "Footprint centroid: not available -- no real footprint geometry for this run"
    story.append(Paragraph(centroid_line, body))

    if nearest_feature and nearest_feature.get("available"):
        feature_line = (f"Nearest named feature: <b>{nearest_feature.get('name')}</b> "
                         f"({nearest_feature.get('lat', 0):.3f}&deg;, {nearest_feature.get('lon', 0):.3f}&deg;)")
    elif nearest_feature is not None:
        feature_line = "Nearest named feature: none found"
    else:
        feature_line = "Nearest named feature: not available"
    story.append(Paragraph(feature_line, body))

    rows = [
        ["Source sensor", _sensor_label(src_base)],
        ["Source acquired", src_acq["start_time"] if src_acq else "not available"],
        ["Reference sensor", _sensor_label(ref_base)],
        ["Reference acquired", ref_acq["start_time"] if ref_acq else "not available"],
        ["Solar incidence at capture", f"{sun_incidence:.1f}°" if sun_incidence is not None else "not available"],
        ["Source ground scale", _first_geometry_value(src_geom)],
        ["Reference ground scale", _first_geometry_value(ref_geom)],
    ]
    story.append(Spacer(1, 4))
    story.append(Table([["Field", "Value"]] + rows, colWidths=[180, 260],
                        style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8.5), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                                          ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9"))])))

    # 2. Illumination & sun geometry
    story.append(Paragraph("2. Illumination &amp; Sun Geometry", h2))
    if not src_sun_ctx and not ref_sun_ctx:
        story.append(Paragraph("Sun geometry unavailable for this frame -- no real .spm telemetry match for either side.", body))
    else:
        for label, ctx in (("Source", src_sun_ctx), ("Reference", ref_sun_ctx)):
            if not ctx:
                continue
            cr = (contrast_recovery or {}).get("src" if label == "Source" else "ref")
            story.append(Paragraph(
                f"<b>{label}</b> &mdash; solar incidence {ctx['solar_incidence_mean_deg']:.1f}&deg; "
                f"(elevation {ctx['sun_elevation_mean_deg']:.1f}&deg;, azimuth {ctx['sun_azimuth_mean_deg']:.1f}&deg;)"
                + (f", contrast recovered {cr:.2f}x" if cr is not None else ""), body))
        story.append(Spacer(1, 4))
        story.append(Paragraph(
            "Lower sun elevation increases shadow length and contrast; this affects cross-sensor matching difficulty.",
            small))

    # 3. Shadow coverage
    story.append(Paragraph("3. Shadow Coverage", h2))
    if not shadow_analysis:
        story.append(Paragraph("Not evaluated -- shadow detection did not run for this pair.", body))
    else:
        for label, key, img_png in (("Source", "src", src_shadow_png), ("Reference", "ref", ref_shadow_png)):
            side = shadow_analysis.get(key, {}) or {}
            frac = side.get("shadow_fraction")
            story.append(Paragraph(
                f"<b>{label}</b>: {frac * 100:.1f}% of frame classified as shadowed" if frac is not None else f"<b>{label}</b>: not available",
                body))
            if img_png:
                story.append(Spacer(1, 4))
                story.append(Image(io.BytesIO(img_png), width=80 * mm, height=80 * mm, kind="proportional"))
                story.append(Spacer(1, 6))
        story.append(Paragraph(_SHADOW_CAPTION, caption_style))

    story.append(Spacer(1, 14))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#cbd5e1")))
    story.append(Paragraph(
        "Every figure in this report is read directly from this run's own real pipeline output (metrics.json, "
        "shadow.py, preprocessing.py, orbital_geometry.py) and real external lookups (ASU Lunaserv WMS, USGS "
        "Gazetteer of Planetary Nomenclature) at generation time -- none is estimated, interpolated, or invented.",
        small))

    doc.build(story)
    return buf.getvalue()


def area_intelligence_report_filename(run_id: str, runs_dir: str) -> str:
    """Same real pair-identity + date convention as report_generator's own
    filename, distinguished only by prefix."""
    base = report_filename(run_id, runs_dir)
    return base.replace("report_", "area-intelligence_", 1)
