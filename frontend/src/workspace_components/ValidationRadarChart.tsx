// workspace_components/ValidationRadarChart.tsx
//
// Chart 3 (Evaluation stage), Nivo version: the real validation verdict as
// a 5-axis radar, each axis normalized so 100% = exactly at that metric's
// real threshold (backend/pipeline/metrics.py::assess_validation). Fill
// color is tied directly to the real `validated` verdict (cyan = passed,
// red/coral = failed) -- not re-derived from the axis shape itself, so it
// can never disagree with the actual backend result.
//
// A null metric (rotation-consistency/condition-ratio unavailable for
// this run) is plotted at 0 but listed explicitly below as "not
// available" -- never silently dropped (which would look like a perfect
// score) and never given a fabricated value.
import { useMemo } from 'react';
import { ResponsiveRadar } from '@nivo/radar';
import { nivoChartTheme } from './nivoTheme';
import ChartCard from './ChartCard';
import { useCurrentTheme } from './ThemeContext';

const THRESHOLDS = {
  inlierCount: 20,
  inlierRatio: 0.5,
  rotationStd: 15,
  rmse: 3,
  conditionRatio: 5,
};

function higherIsBetterPct(value: number | null, threshold: number): number | null {
  if (value == null) return null;
  return (value / threshold) * 100;
}

function lowerIsBetterPct(value: number | null, threshold: number): number | null {
  if (value == null || value <= 0) return value === 0 ? 999 : null; // 0 real error is a perfect (very high) score, not "unavailable"
  return (threshold / value) * 100;
}

const MAX_DISPLAY = 160; // headroom past 100% so a result that beats a threshold visibly extends past the dashed boundary

export default function ValidationRadarChart({
  inlierCount,
  inlierRatio,
  rotationConsistencyStd,
  rmsePx,
  conditionRatio,
  validated,
}: {
  inlierCount: number;
  inlierRatio: number;
  rotationConsistencyStd: number | null;
  rmsePx: number;
  conditionRatio: number | null;
  validated: boolean;
}) {
  const axes = useMemo(
    () => [
      { label: 'Inlier count', pct: higherIsBetterPct(inlierCount, THRESHOLDS.inlierCount) },
      { label: 'Inlier ratio', pct: higherIsBetterPct(inlierRatio, THRESHOLDS.inlierRatio) },
      { label: 'Rotation consistency', pct: lowerIsBetterPct(rotationConsistencyStd, THRESHOLDS.rotationStd) },
      { label: 'RMSE', pct: lowerIsBetterPct(rmsePx, THRESHOLDS.rmse) },
      { label: 'Condition ratio', pct: lowerIsBetterPct(conditionRatio, THRESHOLDS.conditionRatio) },
    ],
    [inlierCount, inlierRatio, rotationConsistencyStd, rmsePx, conditionRatio]
  );

  const data = axes.map((a) => ({
    axis: a.label,
    result: a.pct == null ? 0 : Math.min(a.pct, MAX_DISPLAY),
    threshold: 100,
  }));
  const unavailable = axes.filter((a) => a.pct == null);

  // Real verdict drives the fill color -- never re-derived from the axis
  // shape (which could technically disagree with the real backend verdict
  // in an edge case), always the actual data.validation.validated value.
  const seriesColor = validated ? '#06b6d4' : '#f87171';
  const theme = useCurrentTheme();
  const nivoTheme = nivoChartTheme(theme);
  const boundaryColor = theme === 'dark' ? '#94a3b8' : '#64748b';

  return (
    <ChartCard title="Validation scorecard" height={340} subtitle="Each axis: 100% = exactly at the real validation threshold">
      <div className="relative h-full">
        <ResponsiveRadar
          data={data}
          keys={['result']}
          indexBy="axis"
          maxValue={MAX_DISPLAY}
          margin={{ top: 50, right: 60, bottom: 50, left: 60 }}
          curve="linearClosed"
          borderWidth={2}
          borderColor={seriesColor}
          colors={[seriesColor]}
          fillOpacity={0.32}
          gridLevels={4}
          gridShape="circular"
          gridLabelOffset={16}
          enableDots
          dotSize={6}
          dotColor={{ theme: 'background' }}
          dotBorderWidth={2}
          dotBorderColor={seriesColor}
          theme={nivoTheme}
          isInteractive
          sliceTooltip={({ index, data: sliceData }) => {
            const axis = axes.find((a) => a.label === index);
            return (
              <div style={nivoTheme.tooltip.container}>
                <strong>{index}</strong>
                <div>
                  {axis?.pct == null
                    ? 'not available for this run'
                    : `${sliceData[0]?.formattedValue ?? Math.round(sliceData[0]?.value ?? 0)}% of threshold (100% = at threshold)`}
                </div>
              </div>
            );
          }}
          motionConfig="gentle"
          animate
          // Real dashed threshold boundary, drawn as a custom layer at the
          // exact value=100 radius on every axis -- Nivo's own per-series
          // styling is global (can't make one series dashed and another
          // solid via props alone), so the crisp dashed pentagon is drawn
          // here rather than as a second Nivo-rendered series.
          layers={[
            'grid',
            ({ centerX, centerY, radiusScale, angleStep, indices }) => {
              const r = radiusScale(100);
              const points = indices.map((_, i) => {
                const angle = -Math.PI / 2 + i * angleStep;
                return `${centerX + r * Math.cos(angle)},${centerY + r * Math.sin(angle)}`;
              });
              return (
                <polygon
                  points={points.join(' ')}
                  fill="none"
                  stroke={boundaryColor}
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  opacity={0.6}
                />
              );
            },
            'layers',
            'slices',
            'dots',
            'legends',
          ]}
        />
      </div>
      {unavailable.length > 0 && (
        <p className="text-[9px] text-gray-500 text-center -mt-2">
          Not available for this run: {unavailable.map((a) => a.label).join(', ')} (shown at 0%, not fabricated).
        </p>
      )}
    </ChartCard>
  );
}
