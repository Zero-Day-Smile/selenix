// workspace_components/CorrespondenceCanvas.tsx
//
// A single static side-by-side SVG canvas (source | reference) with real
// lines connecting each matched point pair. Deliberately NOT built on the
// independent dual-OpenSeadragon-viewer setup used elsewhere in this app:
// once each pane can pan/zoom independently, a line drawn between them
// stops representing anything real (it would only be correct when both
// panes happen to sit at their home view). This canvas fixes both images
// at a shared, known scale specifically so the lines stay geometrically
// honest. For detailed per-image inspection, the caller offers the
// existing OSD dual-viewer as a separate "zoom" mode instead.
import React, { useMemo, useState } from 'react';

export interface CorrespondencePoint {
  src_x: number;
  src_y: number;
  ref_x: number;
  ref_y: number;
  color: string;
  opacity: number;
  dotRadius: number;
  lineWidth: number;
  lineOpacity: number;
  glow?: boolean;
  sortWeight: number; // higher = drawn later (on top) and kept when capping
}

const DISPLAY_HEIGHT = 420;
const GAP = 24;
const DEFAULT_CAP = 150;

export default function CorrespondenceCanvas({
  srcUrl,
  refUrl,
  srcShape,
  refShape,
  points,
  capLabel = 'match',
}: {
  srcUrl: string;
  refUrl: string;
  srcShape: [number, number]; // [h, w]
  refShape: [number, number];
  points: CorrespondencePoint[];
  capLabel?: string;
}) {
  const [showAll, setShowAll] = useState(false);

  const [srcH, srcW] = srcShape;
  const [refH, refW] = refShape;
  const srcScale = DISPLAY_HEIGHT / srcH;
  const refScale = DISPLAY_HEIGHT / refH;
  const srcDispW = srcW * srcScale;
  const refDispW = refW * refScale;
  const refOffsetX = srcDispW + GAP;
  const totalW = srcDispW + GAP + refDispW;

  const sorted = useMemo(() => [...points].sort((a, b) => a.sortWeight - b.sortWeight), [points]);
  const needsCap = sorted.length > DEFAULT_CAP;
  const shown = showAll || !needsCap ? sorted : sorted.slice(-DEFAULT_CAP);

  return (
    <div>
      <div className="rounded-sm border border-gray-200 dark:border-white/10 bg-black overflow-hidden">
        <svg viewBox={`0 0 ${totalW} ${DISPLAY_HEIGHT}`} width="100%" style={{ display: 'block' }}>
          <image href={srcUrl} x={0} y={0} width={srcDispW} height={DISPLAY_HEIGHT} preserveAspectRatio="none" />
          <image href={refUrl} x={refOffsetX} y={0} width={refDispW} height={DISPLAY_HEIGHT} preserveAspectRatio="none" />
          <line x1={srcDispW + GAP / 2} y1={0} x2={srcDispW + GAP / 2} y2={DISPLAY_HEIGHT} stroke="#d1d5db" strokeWidth={1} />
          {shown.map((p, i) => {
            const x1 = p.src_x * srcScale;
            const y1 = p.src_y * srcScale;
            const x2 = refOffsetX + p.ref_x * refScale;
            const y2 = p.ref_y * refScale;
            return (
              <g key={i}>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={p.color} strokeWidth={p.lineWidth} opacity={p.lineOpacity} />
                {p.glow && <circle cx={x1} cy={y1} r={p.dotRadius + 3} fill={p.color} opacity={0.25} />}
                {p.glow && <circle cx={x2} cy={y2} r={p.dotRadius + 3} fill={p.color} opacity={0.25} />}
                <circle cx={x1} cy={y1} r={p.dotRadius} fill={p.color} opacity={p.opacity} stroke="black" strokeOpacity={0.15} />
                <circle cx={x2} cy={y2} r={p.dotRadius} fill={p.color} opacity={p.opacity} stroke="black" strokeOpacity={0.15} />
              </g>
            );
          })}
        </svg>
      </div>
      {needsCap && (
        <p className="text-[10px] text-gray-400 mt-2">
          Showing {shown.length} of {sorted.length} {capLabel}es to keep the view readable.{' '}
          <button className="underline hover:text-gray-600" onClick={() => setShowAll((s) => !s)}>
            {showAll ? `Show top ${DEFAULT_CAP} only` : `Show all ${sorted.length}`}
          </button>
        </p>
      )}
    </div>
  );
}
