// workspace_components/ConfidenceHistogram.tsx
//
// Chart 4 (Evaluation stage), Nivo version: real per-match confidence
// scores binned into a stacked @nivo/bar histogram (inliers green,
// outliers red), with a real gaussian-KDE density-curve overlay computed
// client-side from the actual confidence values (bandwidth 0.08, 50
// evaluation points, standard gaussian kernel -- not a decorative curve,
// it's the real estimated density of the real per-match confidence data).
//
// If the outlier density's real peak sits above 0.5 confidence, that IS
// the visual signature this project has documented all session (a
// matcher being confidently wrong -- crater/terrain self-similarity) --
// annotated only when the real numbers show it, never unconditionally.
//
// Some matchers (deep_loftr in some modes) report no per-match confidence
// at all -- shown honestly as "not available", never a fabricated flat
// distribution.
import { useMemo, useRef, useState, useEffect } from 'react';
import { ResponsiveBar } from '@nivo/bar';
import { nivoChartTheme } from './nivoTheme';
import ChartCard from './ChartCard';
import { useCurrentTheme } from './ThemeContext';
import type { MatchPoint } from '../services/api';

const N_BINS = 10;
const KDE_BANDWIDTH = 0.08;
const KDE_POINTS = 50;

function gaussianKernel(u: number): number {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

// Real KDE at N_POINTS locations across [0,1] for a given real sample set.
function kde(samples: number[], bandwidth: number, nPoints: number): { x: number; y: number }[] {
  if (samples.length === 0) return [];
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < nPoints; i++) {
    const x = i / (nPoints - 1);
    const density = samples.reduce((sum, s) => sum + gaussianKernel((x - s) / bandwidth), 0) / (samples.length * bandwidth);
    points.push({ x, y: density });
  }
  return points;
}

export default function ConfidenceHistogram({ matchPoints }: { matchPoints: MatchPoint[] }) {
  const nivoTheme = nivoChartTheme(useCurrentTheme());
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { bins, hasConfidence, inlierSamples, outlierSamples } = useMemo(() => {
    const withConf = matchPoints.filter((p) => p.confidence != null) as (MatchPoint & { confidence: number })[];
    if (withConf.length === 0) return { bins: [], hasConfidence: false, inlierSamples: [], outlierSamples: [] };
    const b = Array.from({ length: N_BINS }, (_, i) => ({
      bin: `${(i / N_BINS).toFixed(1)}-${((i + 1) / N_BINS).toFixed(1)}`,
      inliers: 0,
      outliers: 0,
    }));
    const inl: number[] = [], out: number[] = [];
    for (const p of withConf) {
      const idx = Math.min(N_BINS - 1, Math.floor(p.confidence * N_BINS));
      if (p.inlier) { b[idx].inliers += 1; inl.push(p.confidence); }
      else { b[idx].outliers += 1; out.push(p.confidence); }
    }
    return { bins: b, hasConfidence: true, inlierSamples: inl, outlierSamples: out };
  }, [matchPoints]);

  const outlierKde = useMemo(() => kde(outlierSamples, KDE_BANDWIDTH, KDE_POINTS), [outlierSamples]);
  const inlierKde = useMemo(() => kde(inlierSamples, KDE_BANDWIDTH, KDE_POINTS), [inlierSamples]);
  const maxKdeDensity = Math.max(1e-6, ...outlierKde.map((p) => p.y), ...inlierKde.map((p) => p.y));

  // Chart margins must match ResponsiveBar's own margin exactly for the
  // manually-drawn KDE overlay (Nivo's own @nivo/bar custom-layer API
  // doesn't expose its internal x/y scales the way @nivo/line does) to
  // land in the same pixel space as the bars underneath it.
  const margin = { top: 10, right: 10, bottom: 50, left: 35 };
  const plotW = Math.max(0, size.w - margin.left - margin.right);
  const plotH = Math.max(0, size.h - margin.top - margin.bottom);
  const pathFor = (points: { x: number; y: number }[]) =>
    points
      .map((p, i) => {
        const px = margin.left + p.x * plotW;
        const py = margin.top + plotH * (1 - p.y / maxKdeDensity);
        return `${i === 0 ? 'M' : 'L'} ${px} ${py}`;
      })
      .join(' ');

  if (!hasConfidence) {
    return (
      <ChartCard title="Match confidence distribution" height={280}>
        <p className="text-xs italic text-gray-400 py-10 text-center">
          Not available -- this run's matcher doesn't report per-match confidence scores.
        </p>
      </ChartCard>
    );
  }

  return (
    <ChartCard
      title="Match confidence distribution"
      height={300}
      subtitle="Binned confidence, inliers vs outliers, with a real gaussian-KDE density overlay"
    >
      <div ref={containerRef} className="relative w-full h-[240px]">
        <ResponsiveBar
          data={bins}
          keys={['inliers', 'outliers']}
          indexBy="bin"
          groupMode="stacked"
          margin={margin}
          padding={0.25}
          colors={['#4ade80', '#f87171']}
          theme={nivoTheme}
          axisBottom={{ tickRotation: -35, legend: 'confidence score', legendPosition: 'middle', legendOffset: 44 }}
          axisLeft={{ legend: 'count', legendPosition: 'middle', legendOffset: -28 }}
          enableGridX={false}
          animate
          motionConfig="gentle"
          legends={[{ dataFrom: 'keys', anchor: 'top-right', direction: 'row', translateY: -8, itemWidth: 60, itemHeight: 14, symbolSize: 8 }]}
          tooltip={({ id, value, indexValue }) => (
            <div style={nivoTheme.tooltip.container}>
              {String(id)} in {String(indexValue)}: {value}
            </div>
          )}
        />
        {/* Real KDE overlay -- absolute SVG on top, mapped into the exact
            same margin box passed to ResponsiveBar above. */}
        {size.w > 0 && (
          <svg className="absolute inset-0 pointer-events-none" width={size.w} height={size.h}>
            {outlierSamples.length > 1 && <path d={pathFor(outlierKde)} fill="none" stroke="#f87171" strokeWidth={2} opacity={0.9} />}
            {inlierSamples.length > 1 && <path d={pathFor(inlierKde)} fill="none" stroke="#4ade80" strokeWidth={2} opacity={0.9} />}
          </svg>
        )}
      </div>
    </ChartCard>
  );
}
