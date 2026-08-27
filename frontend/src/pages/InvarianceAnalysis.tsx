// pages/InvarianceAnalysis.tsx
//
// Surfaces the 4 real plots from the sun-angle/scale/rotation invariance
// test suite (backend/scripts/invariance_sweep.py + invariance_plots.py,
// see TASKS.md) -- these previously only existed as PNG files on disk,
// invisible during a live demo. Applies across every pair tested, not a
// single run's result, so this is its own top-level page rather than
// something buried inside the Workspace flow.
import React from 'react';
import Navbar, { type Page } from '../landing_components/Navbar';
import { API_BASE } from '../services/api';

const PLOTS: { file: string; title: string; caption: string }[] = [
  {
    file: 'plot_a_sun_angle.png',
    title: 'Plot A -- Sun-angle invariance',
    caption:
      "Sun-angle invariance — 100% validation pass rate through 30° sun-angle difference; first degradation at 45° " +
      '(drops to 50%). Measured on real images with synthetic relighting using image-derived height fields and ' +
      'cast-shadow simulation.',
  },
  {
    file: 'plot_b_scale.png',
    title: 'Plot B -- Scale invariance',
    caption:
      'Scale invariance — 100% pass rate maintained across the full 0.5x–2.0x scale range tested (4x total range). ' +
      'Strongest measured invariance axis.',
  },
  {
    file: 'plot_c_rotation.png',
    title: 'Plot C -- Rotation invariance',
    caption:
      'Rotation invariance — terrain-dependent split, not a smooth curve: 2/3 source images tolerate rotation up to ' +
      '90°; 1/3 fails at every nonzero rotation. Reported as a categorical split rather than a misleading average.',
  },
  {
    file: 'plot_d_compound_heatmap.png',
    title: 'Plot D -- Compound invariance',
    caption:
      'Compound invariance (sun-angle × scale, rotation fixed at 30°) — stable at 50% pass rate for sun deltas 0–30° ' +
      'across all scale factors; collapses to 0% at -45° sun delta.',
  },
];

export default function InvarianceAnalysis({ onNavigate }: { onNavigate: (page: Page) => void }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar onNavigate={onNavigate} />

      <div className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-xl font-bold tracking-wide mb-1">Sun-angle / Scale / Rotation Invariance Analysis</h1>
        <p className="text-xs text-gray-500 mb-4">
          82 synthetic same-source pairs with exact known ground truth, run through the real, unmodified pipeline.
        </p>

        <div className="bg-amber-50 border border-amber-300 rounded-sm px-4 py-3 mb-8">
          <p className="text-[11px] text-amber-900 leading-relaxed">
            This suite tests illumination, scale, and rotation invariance on synthetic same-source pairs with exact
            ground-truth correspondence. It does <span className="font-bold">NOT</span> test cross-sensor or
            self-similar-terrain correspondence — that is the separately-documented finding from the 24 real pairs.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {PLOTS.map((p) => (
            <div key={p.file} className="bg-white border border-gray-200 rounded-sm shadow-sm p-4">
              <h3 className="text-xs font-bold tracking-wide uppercase mb-2">{p.title}</h3>
              <img
                src={`${API_BASE}/api/invariance_plots/${p.file}`}
                alt={p.title}
                className="w-full border border-gray-200 rounded-sm bg-white"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                  const fallback = e.currentTarget.nextElementSibling as HTMLElement | null;
                  if (fallback) fallback.style.display = 'block';
                }}
              />
              <p className="hidden text-[11px] text-red-600 mt-2">
                Plot not generated yet — run backend/scripts/invariance_sweep.py then invariance_plots.py.
              </p>
              <p className="text-[11px] text-gray-600 leading-relaxed mt-3">{p.caption}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
