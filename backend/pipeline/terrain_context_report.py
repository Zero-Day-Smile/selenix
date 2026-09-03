"""Generates the "Terrain Context Report" PDF -- crater-catalog-derived
terrain roughness/site-selection context for one run's real footprint.

Explicitly, repeatedly, NOT a landing, descent, or trajectory analysis:
every number in this report comes from real catalogued crater positions
and diameters (backend/pipeline/crater_catalog.py, Robbins 2019) inside
the real footprint this run's orbital_geometry already computed. No
spacecraft dynamics, propulsion, sensor performance, or GNC modeling of
any kind is involved or implied anywhere in this module -- the mandatory
caveat paragraph (see _CAVEAT below) says so on every generated report,
and this docstring says so here for anyone reading the code.

Deliberately reuses report_generator.py's own real helpers
(_footprint_bbox, _footprint_area_km2, _build_map_image) rather than
reimplementing footprint geometry or the real WMS map fetch a second
time -- same real data, same real map source, one implementation.
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
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image, HRFlowable

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

from . import crater_catalog, orbital_geometry, geo_extent_guard
from .report_generator import _footprint_bbox, _footprint_area_km2, _build_map_image, PS_ID

GRID_N = 3  # 3x3 -- matches the task spec's "quadrants or a 3x3 grid"

_HEADER_LINE = (
    "TERRAIN ROUGHNESS / SITE-SELECTION CONTEXT — derived from real crater catalog data. "
    "This is not a landing trajectory or descent simulation."
)

_CAVEAT = (
    "This report characterizes catalogued crater density and size within the imaged footprint "
    "only. It does not model spacecraft trajectory, descent dynamics, propulsion, sensor "
    "performance, or any other factor relevant to actual landing site certification. Catalog "
    "coverage may be incomplete; regions with no catalogued craters are not necessarily "
    "smoother, they may simply be under-catalogued."
)


def _grid_cells(lat_min: float, lat_max: float, lon_min: float, lon_max: float, n: int):
    """Real n x n grid over the real footprint bbox. Returns a list of
    (row, col, lat0, lat1, lon0, lon1, area_km2) -- area via the same
    equirectangular approximation report_generator._footprint_area_km2
    uses (small-region, small-error), not a new formula."""
    lat_step = (lat_max - lat_min) / n
    lon_step = (lon_max - lon_min) / n
    cells = []
    for row in range(n):
        for col in range(n):
            lat0, lat1 = lat_min + row * lat_step, lat_min + (row + 1) * lat_step
            lon0, lon1 = lon_min + col * lon_step, lon_min + (col + 1) * lon_step
            mean_lat = (lat0 + lat1) / 2
            area_km2 = (lat1 - lat0) * geo_extent_guard.MOON_KM_PER_DEG * (lon1 - lon0) * geo_extent_guard.MOON_KM_PER_DEG * math.cos(math.radians(mean_lat))
            cells.append({"row": row, "col": col, "lat0": lat0, "lat1": lat1, "lon0": lon0, "lon1": lon1, "area_km2": abs(area_km2)})
    return cells


def _roughness_scores(craters: list[dict], cells: list[dict]) -> list[dict]:
    """Real, auditable score per cell: sum(diameter_km^2 for craters in
    cell) / cell_area_km2 -- crater count implicitly weighted by size
    (a bigger crater contributes more "roughness" than a small one),
    normalized by area so cells of slightly different size are
    comparable. Explicitly named "relative terrain roughness", never
    "hazard" or "safety"."""
    out = []
    for cell in cells:
        in_cell = [c for c in craters
                   if cell["lat0"] <= c["lat"] < cell["lat1"] and cell["lon0"] <= c["lon"] < cell["lon1"]
                   and c["diameter_km"] is not None]
        weighted_sum = sum((c["diameter_km"] ** 2) for c in in_cell)
        score = weighted_sum / cell["area_km2"] if cell["area_km2"] > 0 else 0.0
        out.append({**cell, "count": len(in_cell), "weighted_sum_km2": weighted_sum, "score": score})
    return out


def _density_heatmap_png(craters: list[dict], lat_min: float, lat_max: float, lon_min: float, lon_max: float) -> bytes:
    """Real 2D histogram of real crater positions -- craters per grid
    cell, gridded finer than the roughness scoring grid (here purely for
    visual density, not the audited roughness score)."""
    bins = 12
    lats = np.array([c["lat"] for c in craters]) if craters else np.array([])
    lons = np.array([c["lon"] for c in craters]) if craters else np.array([])
    fig, ax = plt.subplots(figsize=(4.5, 4.5), dpi=150)
    if len(craters):
        h, xedges, yedges, im = ax.hist2d(lons, lats, bins=bins, range=[[lon_min, lon_max], [lat_min, lat_max]], cmap="viridis")
        fig.colorbar(im, ax=ax, label="craters / cell", shrink=0.8)
    else:
        ax.text(0.5, 0.5, "No real catalogued craters\nin this footprint", ha="center", va="center", transform=ax.transAxes)
    ax.set_xlabel("longitude (deg)")
    ax.set_ylabel("latitude (deg)")
    ax.set_title(f"Real crater density ({len(craters)} catalogued craters)", fontsize=9)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return buf.getvalue()


def _size_histogram_png(craters: list[dict]) -> bytes:
    diams = [c["diameter_km"] for c in craters if c["diameter_km"] is not None]
    fig, ax = plt.subplots(figsize=(4.5, 3.2), dpi=150)
    if diams:
        ax.hist(diams, bins=min(20, max(5, len(diams) // 3)), color="#0891b2", edgecolor="white")
        ax.axvline(float(np.mean(diams)), color="#dc2626", linestyle="--", linewidth=1, label=f"mean {np.mean(diams):.2f} km")
        ax.legend(fontsize=7)
    else:
        ax.text(0.5, 0.5, "No real diameters recorded", ha="center", va="center", transform=ax.transAxes)
    ax.set_xlabel("diameter (km)")
    ax.set_ylabel("count")
    ax.set_title("Real catalogued crater diameter distribution", fontsize=9)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png")
    plt.close(fig)
    return buf.getvalue()


def _roughness_overlay_png(footprint: list[list[float]], target_lat: float, target_lon: float, scored_cells: list[dict], craters: list[dict]) -> bytes | None:
    """The real footprint image (same real WMS fetch as the main report)
    with the real scored grid drawn on top, shaded light->dark by each
    cell's real roughness score -- spatial view of the same numbers in
    the table, not a separate illustrative graphic."""
    map_png = _build_map_image(footprint, target_lat, target_lon)
    if not map_png:
        return None
    from PIL import Image as PILImage, ImageDraw

    lat_min, lat_max, lon_min, lon_max = _footprint_bbox(footprint)
    img = PILImage.open(io.BytesIO(map_png)).convert("RGBA")
    w, h = img.size
    overlay = PILImage.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    lat_span_full = max(lat_max - lat_min, 1e-9) * 1.6
    lon_span_full = max(lon_max - lon_min, 1e-9) * 1.6
    half_lat, half_lon = lat_span_full / 2, lon_span_full / 2
    view_lat0, view_lat1 = target_lat - half_lat, target_lat + half_lat
    view_lon0, view_lon1 = target_lon - half_lon, target_lon + half_lon

    def to_px(lat, lon):
        x = (lon - view_lon0) / (view_lon1 - view_lon0) * w
        y = (view_lat1 - lat) / (view_lat1 - view_lat0) * h
        return x, y

    max_score = max((c["score"] for c in scored_cells), default=1.0) or 1.0
    for cell in scored_cells:
        t = min(1.0, cell["score"] / max_score)
        alpha = int(30 + t * 150)
        x0, y0 = to_px(cell["lat1"], cell["lon0"])
        x1, y1 = to_px(cell["lat0"], cell["lon1"])
        draw.rectangle([x0, y0, x1, y1], fill=(220, 38, 38, alpha), outline=(255, 255, 255, 180))
        draw.text(((x0 + x1) / 2 - 10, (y0 + y1) / 2 - 6), f"{cell['score']:.2f}", fill=(255, 255, 255, 255))

    for c in craters:
        px, py = to_px(c["lat"], c["lon"])
        draw.ellipse([px - 2, py - 2, px + 2, py + 2], fill=(56, 189, 248, 220))

    composed = PILImage.alpha_composite(img, overlay).convert("RGB")
    out = io.BytesIO()
    composed.save(out, format="PNG")
    return out.getvalue()


def generate_terrain_context_report_pdf(run_id: str, runs_dir: str) -> bytes:
    metrics_path = os.path.join(runs_dir, run_id, "metrics.json")
    if not os.path.exists(metrics_path):
        raise FileNotFoundError(f"no real metrics.json for run_id {run_id!r}")

    orbital = orbital_geometry.get_orbital_geometry(run_id, runs_dir)
    footprint = orbital.get("footprint")
    target_lat, target_lon = orbital.get("target_lat"), orbital.get("target_lon")

    styles = getSampleStyleSheet()
    h1 = ParagraphStyle("H1", parent=styles["Heading1"], fontSize=13, textColor=colors.HexColor("#7c2d12"))
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], fontSize=11.5, spaceBefore=12, spaceAfter=6)
    body = ParagraphStyle("Body", parent=styles["Normal"], fontSize=9.5, leading=13)
    small = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, textColor=colors.grey)
    warn_box = ParagraphStyle("Warn", parent=styles["Normal"], fontSize=8.5, leading=12, textColor=colors.HexColor("#7c2d12"))

    def header_flowables():
        return [
            Paragraph(_HEADER_LINE, h1),
            Paragraph(f"run_id <font face='Courier'>{run_id}</font> &middot; Problem Statement {PS_ID} &middot; "
                      f"generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}", small),
            HRFlowable(width="100%", color=colors.HexColor("#fca5a5"), spaceBefore=6, spaceAfter=10),
        ]

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=16 * mm, bottomMargin=16 * mm, leftMargin=18 * mm, rightMargin=18 * mm)

    story = list(header_flowables())

    if not footprint or len(footprint) < 3:
        story.append(Paragraph("No real footprint geometry available for this run -- this report cannot be "
                                "generated without real footprint corners from orbital_geometry.py.", body))
        story.append(Paragraph(_CAVEAT, warn_box))
        doc.build(story)
        return buf.getvalue()

    lat_min, lat_max, lon_min, lon_max = _footprint_bbox(footprint)
    footprint_area_km2 = _footprint_area_km2(footprint)
    try:
        craters = [c for c in crater_catalog.query_bbox(lon_min, lon_max, lat_min, lat_max) if c["crater_id"] is not None]
    except Exception:
        craters = []

    # 2. Density heatmap
    story.append(Paragraph("Crater Density", h2))
    density_png = _density_heatmap_png(craters, lat_min, lat_max, lon_min, lon_max)
    story.append(Image(io.BytesIO(density_png), width=85 * mm, height=85 * mm))
    story.append(Paragraph(f"Real 2D histogram, {len(craters)} real catalogued craters (Robbins 2019) binned by real position "
                            "within the footprint.", small))

    # 3. Size distribution
    story.append(Paragraph("Size Distribution", h2))
    diams = [c["diameter_km"] for c in craters if c["diameter_km"] is not None]
    if diams:
        story.append(Paragraph(
            f"Count: {len(diams)} &middot; Min: {min(diams):.2f} km &middot; Max: {max(diams):.2f} km &middot; "
            f"Mean: {sum(diams) / len(diams):.2f} km", body))
    else:
        story.append(Paragraph("No real diameters recorded for any catalogued crater in this footprint.", body))
    hist_png = _size_histogram_png(craters)
    story.append(Image(io.BytesIO(hist_png), width=85 * mm, height=60 * mm))

    # 4. Roughness scoring
    story.append(Paragraph("Relative Terrain Roughness (not a hazard or safety score)", h2))
    story.append(Paragraph(
        f"Formula (per {GRID_N}x{GRID_N} grid cell): "
        f"<font face='Courier'>score = sum(crater diameter_km &sup2;) / cell_area_km&sup2;</font> "
        f"-- real catalogued craters only, real cell area from the same equirectangular approximation used "
        f"throughout this project. Higher score = more/larger catalogued craters per unit area in that cell "
        f"relative to the others shown here, nothing more.", body))
    cells = _grid_cells(lat_min, lat_max, lon_min, lon_max, GRID_N)
    scored = _roughness_scores(craters, cells)
    rows = [["Cell (row,col)", "Craters", "Sum diam&sup2; (km&sup2;)", "Area (km&sup2;)", "Score"]]
    for c in sorted(scored, key=lambda c: (c["row"], c["col"])):
        rows.append([f"({c['row']},{c['col']})", str(c["count"]), f"{c['weighted_sum_km2']:.2f}", f"{c['area_km2']:.2f}", f"{c['score']:.4f}"])
    story.append(Spacer(1, 6))
    story.append(Table(rows, colWidths=[80, 60, 100, 90, 70],
                        style=TableStyle([("FONTSIZE", (0, 0), (-1, -1), 8), ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#e2e8f0")),
                                          ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fef2f2"))])))

    # 5. Overlay diagram
    story.append(Paragraph("Roughness Overlay", h2))
    overlay_png = _roughness_overlay_png(footprint, target_lat, target_lon, scored, craters)
    if overlay_png:
        story.append(Spacer(1, 6))
        story.append(Image(io.BytesIO(overlay_png), width=95 * mm, height=95 * mm))
        story.append(Paragraph("Real footprint image (ASU Lunaserv WMS) with the real scored grid overlaid "
                                "(darker red = higher real roughness score, cyan dots = real catalogued crater positions).", small))
    else:
        story.append(Paragraph("Real overlay image could not be generated (public map service unreachable at generation time).", body))

    # 6. Mandatory caveat
    story.append(Spacer(1, 14))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#fca5a5")))
    story.append(Paragraph(_CAVEAT, warn_box))

    doc.build(story)
    return buf.getvalue()


def terrain_context_report_filename(run_id: str, runs_dir: str) -> str:
    from . import known_real_images
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
    return f"terrain-context_{src_id}_x_{ref_id}_{date_str}.pdf"
