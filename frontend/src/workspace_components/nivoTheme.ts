// workspace_components/nivoTheme.ts
//
// Theme-aware, transparent-white chart chrome -- matches every other card
// in this app (the `bg-white/[0.04] backdrop-blur-md` glass convention),
// not a bespoke solid-dark block. Colors stay readable against either the
// light or dark background via the app's own theme toggle.
import type { Theme as AppTheme } from './useTheme';

export function nivoChartTheme(theme: AppTheme) {
  const dark = theme === 'dark';
  return {
    background: 'transparent',
    text: { fill: dark ? '#cbd5e1' : '#334155', fontSize: 11 },
    axis: {
      domain: { line: { stroke: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' } },
      ticks: {
        line: { stroke: dark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)' },
        text: { fill: dark ? '#94a3b8' : '#64748b', fontSize: 10 },
      },
      legend: { text: { fill: dark ? '#94a3b8' : '#64748b', fontSize: 10 } },
    },
    grid: { line: { stroke: dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)' } },
    legends: { text: { fill: dark ? '#cbd5e1' : '#334155', fontSize: 10 } },
    labels: { text: { fill: dark ? '#cbd5e1' : '#334155', fontSize: 10 } },
    tooltip: {
      container: {
        background: dark ? '#111827' : '#ffffff',
        color: dark ? '#e2e8f0' : '#1e293b',
        border: `1px solid ${dark ? 'rgba(6,182,212,0.4)' : '#e2e8f0'}`,
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        fontSize: 12,
      },
    },
  } as const;
}

export const NIVO_THEME = nivoChartTheme('dark');

export function chartCardClassName(): string {
  return 'bg-white/60 border border-gray-200 dark:bg-white/[0.04] dark:border-white/10 backdrop-blur-md shadow-sm';
}

export const CHART_TITLE_CLASS = 'text-xs font-bold tracking-wide uppercase text-gray-700 dark:text-gray-300 mb-3';
