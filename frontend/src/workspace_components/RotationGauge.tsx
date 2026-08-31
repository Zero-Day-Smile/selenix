// workspace_components/RotationGauge.tsx
//
// Visual dial for the homography's decomposed rotation angle, so an extreme
// value (e.g. 88.59deg) reads as visually extreme at a glance instead of
// requiring the viewer to already know that number is implausible for a
// near-nadir lunar image pair.
//
// Band thresholds are set from this project's real measured rotation
// readings (backend/outputs/runs/*/metrics.json, decomposed the same way
// this app derives rotation -- atan2 of the homography's linear part):
// every confirmed-valid case sits at 12.06-30.36deg; every confirmed-
// degenerate case (condition ratio > 5:1) sits at 68.6-117.85deg magnitude.
// One real "passes condition-ratio" case (4.74:1, right at the edge of that
// threshold) still reads -136.09deg -- exactly the kind of case this gauge
// exists to flag visually even when the primary check doesn't. Bands:
// <=30deg green (matches the real valid cluster), 30-70deg amber (caution,
// no real valid case observed here but no real failure either), >70deg red
// (every real failure case's magnitude, plus that one suspicious pass).
import React from 'react';

const DEFAULT_GREEN_MAX = 30;
const DEFAULT_AMBER_MAX = 70;
const DEFAULT_MAX_DEG = 180;

export default function RotationGauge({
  rotationDeg,
  greenMax = DEFAULT_GREEN_MAX,
  amberMax = DEFAULT_AMBER_MAX,
  maxDeg = DEFAULT_MAX_DEG,
  greenLabel = 'plausible',
  amberLabel = 'caution',
  redLabel = 'extreme',
}: {
  rotationDeg: number;
  // Real per-metric thresholds -- defaults match this component's original
  // homography-rotation use (see module docstring); pass different bands
  // for a different metric (e.g. rotation-consistency std, threshold 15deg)
  // rather than duplicating the whole gauge for each metric.
  greenMax?: number;
  amberMax?: number;
  maxDeg?: number;
  greenLabel?: string;
  amberLabel?: string;
  redLabel?: string;
}) {
  const magnitude = Math.min(Math.abs(rotationDeg), maxDeg);
  const color = magnitude <= greenMax ? '#16a34a' : magnitude <= amberMax ? '#d97706' : '#dc2626';
  const label = magnitude <= greenMax ? greenLabel : magnitude <= amberMax ? amberLabel : redLabel;

  // Semicircle gauge: 0deg magnitude at the left end, maxDeg at the right end.
  const cx = 70, cy = 66, r = 56;
  const angleToPoint = (deg: number) => {
    const rad = (Math.PI * (1 - deg / maxDeg)); // 0 -> left (pi), maxDeg -> right (0)
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  };
  const start = angleToPoint(0);
  const greenEnd = angleToPoint(Math.min(greenMax, maxDeg));
  const amberEnd = angleToPoint(Math.min(amberMax, maxDeg));
  const end = angleToPoint(maxDeg);
  const needle = angleToPoint(magnitude);

  const arc = (from: { x: number; y: number }, to: { x: number; y: number }, sweepDeg: number) =>
    `M ${from.x} ${from.y} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${to.x} ${to.y}`;

  const uid = React.useId().replace(/:/g, '');

  return (
    <div className="flex flex-col items-center shrink-0 rounded-sm p-2 bg-white/60 border border-gray-200 dark:bg-white/[0.04] dark:border-white/10 backdrop-blur-md" style={{ width: 148 }}>
      <svg viewBox="0 0 140 78" width={140} height={78}>
        <defs>
          {/* Real semantic colors, given a small amount of depth via a
              restrained gradient -- not a neon effect. */}
          <linearGradient id={`${uid}-g`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#16a34a" />
          </linearGradient>
          <linearGradient id={`${uid}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eab308" />
            <stop offset="100%" stopColor="#d97706" />
          </linearGradient>
          <linearGradient id={`${uid}-r`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
        </defs>
        <path d={arc(start, greenEnd, greenMax)} stroke={`url(#${uid}-g)`} strokeWidth={9} fill="none" />
        <path d={arc(greenEnd, amberEnd, amberMax - greenMax)} stroke={`url(#${uid}-a)`} strokeWidth={9} fill="none" />
        <path d={arc(amberEnd, end, maxDeg - amberMax)} stroke={`url(#${uid}-r)`} strokeWidth={9} fill="none" />
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={color} strokeWidth={2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3.5} fill={color} />
      </svg>
      <div className="text-center -mt-1">
        <div className="font-mono font-bold text-sm" style={{ color }}>
          {rotationDeg.toFixed(2)}°
        </div>
        <div className="text-[9px] uppercase tracking-wide font-bold" style={{ color }}>
          {label}
        </div>
      </div>
    </div>
  );
}
