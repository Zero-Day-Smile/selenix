"""Builds the invariance-curve plots (Step 5) from invariance_sweep.py's
results.jsonl. Run after invariance_sweep.py completes.

    ./.venv/Scripts/python.exe backend/scripts/invariance_plots.py
"""
from __future__ import annotations

import json
import os

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

RESULTS_PATH = "backend/outputs/invariance_sweep/results.jsonl"
PLOTS_DIR = "backend/outputs/invariance_sweep/plots"


def load_results() -> list:
    with open(RESULTS_PATH) as f:
        return [json.loads(line) for line in f if line.strip()]


def aggregate(records: list, category: str, x_key: str):
    """Groups by x_key within a category, returns sorted (x, pass_rate, mean_err_m, n)."""
    by_x = {}
    for r in records:
        if r["meta"].get("category") != category:
            continue
        x = r["meta"].get(x_key)
        by_x.setdefault(x, []).append(r)
    xs = sorted(by_x.keys())
    pass_rates, mean_errs, ns = [], [], []
    for x in xs:
        group = by_x[x]
        n = len(group)
        passed = sum(1 for r in group if r.get("validated"))
        errs = [r["true_reprojection_error_m_mean"] for r in group if r.get("true_reprojection_error_m_mean") is not None]
        pass_rates.append(100.0 * passed / n if n else 0.0)
        mean_errs.append(float(np.mean(errs)) if errs else float("nan"))
        ns.append(n)
    return xs, pass_rates, mean_errs, ns


def find_first_degradation(xs, pass_rates):
    """The data-driven "starts failing" point: the first x (in increasing
    severity order, x=0 excluded as the trivial baseline) where pass rate
    drops below the perfect 100% seen at baseline. Not a pre-set percentage
    cutoff -- with only 2-3 real sources per point, an arbitrary 50% line
    either never triggers (too lenient) or is meaningless noise (too
    strict); "first sign of real degradation from the perfect baseline" is
    what the data can actually support at this sample size."""
    for x, p in zip(xs, pass_rates):
        if x == 0:
            continue
        if p < 100.0:
            return x
    return None


def find_full_failure(xs, pass_rates):
    """First x where pass rate hits 0% -- complete breakdown, not just
    degradation."""
    for x, p in zip(xs, pass_rates):
        if x == 0:
            continue
        if p <= 0.0:
            return x
    return None


def plot_dual_axis(xs, pass_rates, mean_errs, xlabel, title, out_path, threshold_label_fmt):
    fig, ax1 = plt.subplots(figsize=(7, 4.5))
    ax1.plot(xs, pass_rates, "o-", color="#2563eb", label="Validation pass rate (%)")
    ax1.set_xlabel(xlabel)
    ax1.set_ylabel("Validation pass rate (%)", color="#2563eb")
    ax1.set_ylim(-5, 105)
    ax1.tick_params(axis="y", labelcolor="#2563eb")

    ax2 = ax1.twinx()
    valid_errs = [(x, e) for x, e in zip(xs, mean_errs) if not np.isnan(e)]
    if valid_errs:
        ex, ey = zip(*valid_errs)
        ax2.plot(ex, ey, "s--", color="#dc2626", label="Mean true reprojection error (m)")
    ax2.set_ylabel("Mean true reprojection error (m)", color="#dc2626")
    ax2.tick_params(axis="y", labelcolor="#dc2626")

    degrade_x = find_first_degradation(xs, pass_rates)
    fail_x = find_full_failure(xs, pass_rates)
    if degrade_x is not None:
        degrade_p = pass_rates[xs.index(degrade_x)]
        ax1.axhline(degrade_p, color="gray", linestyle=":", linewidth=1)
        ax1.annotate(threshold_label_fmt(degrade_x) + " (first degradation)", xy=(degrade_x, degrade_p),
                     xytext=(0.35, 0.30), textcoords="axes fraction", fontsize=9, color="black",
                     arrowprops=dict(arrowstyle="->", color="black"))
    else:
        ax1.text(0.5, 0.30, "100% pass rate held across the entire tested range",
                  transform=ax1.transAxes, ha="center", fontsize=9)
    if fail_x is not None:
        ax1.annotate(threshold_label_fmt(fail_x) + " (total failure, 0%)", xy=(fail_x, 0),
                     xytext=(0.35, 0.15), textcoords="axes fraction", fontsize=9, color="darkred",
                     arrowprops=dict(arrowstyle="->", color="darkred"))

    plt.title(title)
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
    return {"first_degradation": degrade_x, "total_failure": fail_x}


def plot_heatmap(records, out_path):
    grid = {}
    for r in records:
        m = r["meta"]
        if m.get("category") != "compound_grid":
            continue
        key = (m["sun_delta"], m["scale"])
        grid.setdefault(key, []).append(r)

    sun_deltas = sorted(set(k[0] for k in grid))
    scales = sorted(set(k[1] for k in grid))
    mat = np.full((len(sun_deltas), len(scales)), np.nan)
    for i, sd in enumerate(sun_deltas):
        for j, sc in enumerate(scales):
            group = grid.get((sd, sc))
            if not group:
                continue
            n = len(group)
            passed = sum(1 for r in group if r.get("validated"))
            mat[i, j] = 100.0 * passed / n

    fig, ax = plt.subplots(figsize=(6.5, 5))
    im = ax.imshow(mat, cmap="RdYlGn", vmin=0, vmax=100, aspect="auto")
    ax.set_xticks(range(len(scales)))
    ax.set_xticklabels(scales)
    ax.set_yticks(range(len(sun_deltas)))
    ax.set_yticklabels(sun_deltas)
    ax.set_xlabel("Scale factor")
    ax.set_ylabel("Sun-angle delta (deg)")
    ax.set_title("Compound validation pass rate (%) -- rotation fixed at 30deg")
    for i in range(len(sun_deltas)):
        for j in range(len(scales)):
            val = mat[i, j]
            if not np.isnan(val):
                ax.text(j, i, f"{val:.0f}", ha="center", va="center",
                        color="black" if val > 40 else "white", fontsize=9)
    fig.colorbar(im, ax=ax, label="pass rate (%)")
    fig.tight_layout()
    fig.savefig(out_path, dpi=140)
    plt.close(fig)
    return mat, sun_deltas, scales


def main():
    os.makedirs(PLOTS_DIR, exist_ok=True)
    records = load_results()
    print(f"Loaded {len(records)} results")

    thresholds = {}

    xs, pr, me, ns = aggregate(records, "sun_only", "sun_delta")
    print("Plot A sun_only x/pass/err/n:", list(zip(xs, pr, me, ns)))
    if xs:
        thresholds["sun_delta_deg"] = plot_dual_axis(
            xs, pr, me, "Sun-angle delta (degrees below real baseline)",
            "Plot A: Sun-angle invariance", os.path.join(PLOTS_DIR, "plot_a_sun_angle.png"),
            lambda x: f"fails at {x} deg")

    xs, pr, me, ns = aggregate(records, "scale_only", "scale")
    print("Plot B scale_only x/pass/err/n:", list(zip(xs, pr, me, ns)))
    if xs:
        thresholds["scale_factor"] = plot_dual_axis(
            xs, pr, me, "Scale factor", "Plot B: Scale invariance",
            os.path.join(PLOTS_DIR, "plot_b_scale.png"), lambda x: f"fails at {x}x")

    xs, pr, me, ns = aggregate(records, "rotation_only", "rotation_deg")
    print("Plot C rotation_only x/pass/err/n:", list(zip(xs, pr, me, ns)))
    if xs:
        thresholds["rotation_deg"] = plot_dual_axis(
            xs, pr, me, "Rotation angle (degrees)", "Plot C: Rotation invariance",
            os.path.join(PLOTS_DIR, "plot_c_rotation.png"), lambda x: f"fails at {x} deg")

    mat, sun_deltas, scales = plot_heatmap(records, os.path.join(PLOTS_DIR, "plot_d_compound_heatmap.png"))
    print("Plot D heatmap (rows=sun_delta, cols=scale):")
    print(mat)

    hard = [r for r in records if r["meta"].get("category") == "compound_hard"]
    print("Compound hard cases:", [(r["meta"], r.get("validated"), r.get("true_reprojection_error_m_mean")) for r in hard])

    with open(os.path.join("backend/outputs/invariance_sweep", "thresholds.json"), "w") as f:
        json.dump({"thresholds_50pct_pass": thresholds,
                   "compound_hard_cases": [{"meta": r["meta"], "validated": r.get("validated"),
                                             "reprojection_error_m": r.get("true_reprojection_error_m_mean")}
                                            for r in hard]}, f, indent=2)
    print("\nThresholds:", thresholds)


if __name__ == "__main__":
    main()
