// workspace_components/InlierFunnelChart.tsx
//
// Chart 2 (RANSAC stage), Nivo version: real candidates -> inliers as an
// @nivo/funnel (gray narrowing to green), with the real rejected
// (outlier) count shown as falling particles beside the funnel -- a
// real count driving a real number of dots, not a fixed decorative
// animation, so a run with 2 outliers looks different from one with 30.
import { useMemo, type CSSProperties } from 'react';
import { ResponsiveFunnel } from '@nivo/funnel';
import { nivoChartTheme } from './nivoTheme';
import ChartCard from './ChartCard';
import { useCurrentTheme } from './ThemeContext';

const MAX_PARTICLES = 8;

export default function InlierFunnelChart({
  candidates,
  inliers,
  outliers,
  inlierRatio,
}: {
  candidates: number;
  inliers: number;
  outliers: number;
  inlierRatio: number;
}) {
  const nivoTheme = nivoChartTheme(useCurrentTheme());
  const data = [
    { id: 'Candidates', value: Math.max(candidates, 1), label: `${candidates} candidates` },
    { id: 'Inliers', value: Math.max(inliers, 0.001), label: `${inliers} inliers (${(inlierRatio * 100).toFixed(1)}%)` },
  ];

  // Real particle count scales with the real rejected fraction, capped for
  // legibility -- a run with 30 outliers still shows more falling dots
  // than one with 2, just not literally 30 of them.
  const particleCount = useMemo(() => {
    if (outliers <= 0) return 0;
    const frac = candidates > 0 ? outliers / candidates : 0;
    return Math.max(1, Math.round(frac * MAX_PARTICLES) || (outliers > 0 ? 1 : 0));
  }, [outliers, candidates]);

  return (
    <ChartCard title="Candidates -> inliers" height={220} subtitle={`${outliers} rejected as outliers`}>
      <style>{`
        @keyframes funnel-particle-fall {
          0% { transform: translateY(0) translateX(0); opacity: 0.9; }
          100% { transform: translateY(70px) translateX(var(--dx)); opacity: 0; }
        }
      `}</style>
      <div className="relative h-full">
        <ResponsiveFunnel
          data={data}
          direction="vertical"
          interpolation="smooth"
          colors={['#64748b', '#4ade80']}
          borderWidth={0}
          labelColor="#0f172a"
          beforeSeparatorLength={0}
          afterSeparatorLength={0}
          currentPartSizeExtension={0}
          theme={nivoTheme}
          margin={{ top: 10, right: 60, bottom: 10, left: 60 }}
          motionConfig="gentle"
        />
        {/* Falling-particle rejection visual, beside the funnel's narrow
            (bottom/right) end -- a real count of real outliers falling
            away, not a fixed decoration. */}
        {particleCount > 0 && (
          <div className="absolute right-3 bottom-6 flex flex-col items-center pointer-events-none">
            <span className="text-[9px] text-red-400 mb-1">-{outliers}</span>
            <div className="relative w-6 h-16">
              {Array.from({ length: particleCount }).map((_, i) => (
                <span
                  key={i}
                  className="absolute w-1.5 h-1.5 rounded-full bg-red-400"
                  style={
                    {
                      left: `${(i / particleCount) * 100}%`,
                      animation: `funnel-particle-fall ${0.9 + (i % 3) * 0.2}s ease-in ${i * 0.12}s infinite`,
                      '--dx': `${(i % 2 === 0 ? 1 : -1) * (4 + i)}px`,
                    } as CSSProperties
                  }
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </ChartCard>
  );
}
