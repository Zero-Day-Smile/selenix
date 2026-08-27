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

const GREEN_MAX = 30;
const AMBER_MAX = 70;

export default function RotationGauge({ rotationDeg }: { rotationDeg: number }) {
  const magnitude = Math.min(Math.abs(rotationDeg), 180);
  const color = magnitude <= GREEN_MAX ? '#16a34a' : magnitude <= AMBER_MAX ? '#d97706' : '#dc2626';
  const label = magnitude <= GREEN_MAX ? 'plausible' : magnitude <= AMBER_MAX ? 'caution' : 'extreme';

  // Semicircle gauge: 0deg magnitude at the left end, 180deg at the right end.
  const cx = 70, cy = 66, r = 56;
  const angleToPoint = (deg: number) => {
    const rad = (Math.PI * (180 - deg)) / 180; // 0deg -> left (pi), 180deg -> right (0)
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
  };
  const start = angleToPoint(0);
  const greenEnd = angleToPoint(GREEN_MAX);
  const amberEnd = angleToPoint(AMBER_MAX);
  const end = angleToPoint(180);
  const needle = angleToPoint(magnitude);

  const arc = (from: { x: number; y: number }, to: { x: number; y: number }, sweepDeg: number) =>
    `M ${from.x} ${from.y} A ${r} ${r} 0 ${sweepDeg > 180 ? 1 : 0} 1 ${to.x} ${to.y}`;

  return (
    <div className="flex flex-col items-center shrink-0" style={{ width: 140 }}>
      <svg viewBox="0 0 140 78" width={140} height={78}>
        <path d={arc(start, greenEnd, GREEN_MAX)} stroke="#bbf7d0" strokeWidth={10} fill="none" />
        <path d={arc(greenEnd, amberEnd, AMBER_MAX - GREEN_MAX)} stroke="#fde68a" strokeWidth={10} fill="none" />
        <path d={arc(amberEnd, end, 180 - AMBER_MAX)} stroke="#fecaca" strokeWidth={10} fill="none" />
        <line x1={cx} y1={cy} x2={needle.x} y2={needle.y} stroke={color} strokeWidth={2.5} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={4} fill={color} />
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
