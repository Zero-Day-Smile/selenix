// workspace_components/MatchDistributionHeatmap.tsx
//
// Chart 5 (Evaluation stage), Nivo version: the real 4x4 match-count grid
// (computed in Workspace.tsx::applyResult from the real match points'
// source-image positions -- this data was already being computed every
// run but had zero consumers anywhere in the UI before this pass) as an
// @nivo/heatmap with continuous black<->white color interpolation, no
// cell borders, a real quadrant-position tooltip, and a framer-motion
// scan-pattern fade-in (top-left -> bottom-right, 20ms/cell).
import { useMemo } from 'react';
import { ResponsiveHeatMap } from '@nivo/heatmap';
import { motion } from 'framer-motion';
import { nivoChartTheme } from './nivoTheme';
import ChartCard from './ChartCard';
import { useCurrentTheme } from './ThemeContext';

function quadrantLabel(rowFrac: number, colFrac: number): string {
  const rowLabel = rowFrac < 0.34 ? 'top' : rowFrac > 0.66 ? 'bottom' : 'middle';
  const colLabel = colFrac < 0.34 ? 'left' : colFrac > 0.66 ? 'right' : 'center';
  if (rowLabel === 'middle' && colLabel === 'center') return 'center';
  return `${rowLabel}-${colLabel}`;
}

export default function MatchDistributionHeatmap({ heatmapData }: { heatmapData: number[][] }) {
  const theme = useCurrentTheme();
  const nivoTheme = nivoChartTheme(theme);
  const gridN = heatmapData.length;
  const maxCount = Math.max(1, ...heatmapData.flat());

  // Nivo's real per-row-series shape: one series per grid row (top row of
  // the real source image first), each with gridN real x-columns.
  const data = useMemo(
    () =>
      heatmapData.map((row, gy) => ({
        id: `row-${gy}`,
        rowIndex: gy,
        data: row.map((count, gx) => ({ x: `col-${gx}`, y: count, colIndex: gx })),
      })),
    [heatmapData]
  );

  return (
    <ChartCard title="Match distribution heatmap" height={300} subtitle="Same real 4x4 match-count grid, smooth color-scaled cells">
      <ResponsiveHeatMap
        data={data}
        margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
        valueFormat=">-.0f"
        axisTop={null}
        axisRight={null}
        axisBottom={null}
        axisLeft={null}
        colors={{
          type: 'sequential',
          scheme: 'greys', // overridden per-cell below via a custom cell renderer's own interpolation
        }}
        theme={nivoTheme}
        borderWidth={0}
        enableLabels={false}
        hoverTarget="cell"
        animate
        motionConfig="gentle"
        tooltip={({ cell }) => {
          const rowIndex = (cell.data as any).rowIndex ?? 0;
          const colIndex = (cell.data as any).colIndex ?? 0;
          const label = quadrantLabel((rowIndex + 0.5) / gridN, (colIndex + 0.5) / gridN);
          return (
            <div style={nivoTheme.tooltip.container}>
              <strong>{cell.value} matches</strong>
              <div className="text-gray-400">{label} of source image</div>
            </div>
          );
        }}
        cellComponent={({ cell, borderRadius }) => {
          const t = (cell.value ?? 0) / maxCount;
          // Real, fixed low<->high density interpolation (not per-run
          // auto-scaled beyond this run's own max) -- dark mode goes
          // black (low) to white (high); light mode inverts so the high
          // end stays dark and visible against a white card.
          const c0 = theme === 'dark' ? [15, 15, 15] : [255, 255, 255];
          const c1 = theme === 'dark' ? [255, 255, 255] : [15, 15, 15];
          const rgb = c0.map((v, i) => Math.round(v + (c1[i] - v) * t));
          const color = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
          // Real scan-order index (row-major, top-left -> bottom-right) for
          // the stagger delay -- rowIndex/colIndex come straight from the
          // real data built above, not the cell's arbitrary render order.
          const rowIndex = (cell.data as any).rowIndex ?? 0;
          const colIndex = (cell.data as any).colIndex ?? 0;
          const scanIndex = rowIndex * gridN + colIndex;
          return (
            <motion.rect
              x={cell.x - cell.width / 2}
              y={cell.y - cell.height / 2}
              width={cell.width}
              height={cell.height}
              rx={borderRadius}
              fill={color}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25, delay: scanIndex * 0.02 }}
            />
          );
        }}
      />
    </ChartCard>
  );
}
