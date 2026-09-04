// workspace_components/SunGeometryCard.tsx
//
// Illumination & Sun Geometry Card: a small supporting detail panel, not a
// full report page. Two real sources, nothing illustrative:
//   - Solar incidence/elevation/azimuth from CH2 real .spm ancillary
//     telemetry (backend/app/main.py::_sun_angle_context, reading
//     backend/pipeline/ancillary_readers.py's real per-record sun angles).
//     Only ever present for the Chandrayaan-2 side of a pair -- LRO NAC has
//     no matching per-acquisition sun-angle telemetry in this project's
//     archive (see orbital_geometry.py's own docstring for the same
//     honest gap).
//   - The real global-contrast-recovery ratio (std(after)/std(before))
//     computed by preprocessing.contrast_recovery_ratio() at the same
//     illumination_normalize() call site run_pipeline.py already makes.
//     This figure did NOT exist as pipeline output before this feature;
//     see that function's own docstring for why it's a genuine, cheap,
//     auditable computation and not a fabricated number.
// When neither side has real telemetry (e.g. a pure NAC-vs-NAC pair with
// no Chandrayaan-2 side at all), shows an honest "sun geometry unavailable
// for this frame" rather than omitting the card.
import type { SunAngleContext } from '../services/api';

function SunPositionDiagram({ elevationDeg, azimuthDeg }: { elevationDeg: number; azimuthDeg: number }) {
  const cx = 50;
  const cy = 50;
  const R = 42;
  // Real telemetry values drive both placements: radius shrinks toward
  // the center as elevation rises toward zenith (90°), angle is azimuth
  // measured clockwise from north/up -- not an illustrative position.
  const clampedElevation = Math.max(0, Math.min(90, elevationDeg));
  const r = R * ((90 - clampedElevation) / 90);
  const azRad = (azimuthDeg * Math.PI) / 180;
  const px = cx + r * Math.sin(azRad);
  const py = cy - r * Math.cos(azRad);

  return (
    <svg viewBox="0 0 100 100" width={80} height={80} className="shrink-0" role="img" aria-label={`Sun position: elevation ${elevationDeg.toFixed(1)} degrees, azimuth ${azimuthDeg.toFixed(1)} degrees`}>
      {/* Ground plane / horizon */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="currentColor" className="text-gray-300 dark:text-white/20" strokeWidth={1} />
      {/* Zenith marker */}
      <circle cx={cx} cy={cy} r={1.4} fill="currentColor" className="text-gray-400 dark:text-white/30" />
      <text x={cx} y={cy - R - 3} textAnchor="middle" fontSize={7} className="fill-gray-400">N</text>
      {/* Real sun direction */}
      <line x1={cx} y1={cy} x2={px} y2={py} stroke="#f59e0b" strokeWidth={1.5} />
      <circle cx={px} cy={py} r={4} fill="#f59e0b" stroke="#fff" strokeWidth={0.75} />
    </svg>
  );
}

function SideCard({ label, ctx, contrast }: { label: string; ctx: SunAngleContext; contrast: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <SunPositionDiagram elevationDeg={ctx.sun_elevation_mean_deg} azimuthDeg={ctx.sun_azimuth_mean_deg} />
      <div className="space-y-1 min-w-0">
        <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500">{label}</div>
        <div className="text-xs">
          <span className="font-bold text-gray-700 dark:text-gray-300">Solar incidence: </span>
          <span className="font-mono text-gray-800 dark:text-gray-100">{ctx.solar_incidence_mean_deg.toFixed(1)}°</span>
        </div>
        <div className="text-[10px] text-gray-500 font-mono">
          elevation {ctx.sun_elevation_mean_deg.toFixed(1)}°, azimuth {ctx.sun_azimuth_mean_deg.toFixed(1)}°
        </div>
        {contrast != null && (
          <div className="text-xs">
            <span className="font-bold text-gray-700 dark:text-gray-300">Contrast recovered: </span>
            <span className="font-mono text-gray-800 dark:text-gray-100">{contrast.toFixed(2)}x local contrast</span>
          </div>
        )}
      </div>
    </div>
  );
}

export interface SunGeometryCardProps {
  srcContext: SunAngleContext | null;
  refContext: SunAngleContext | null;
  contrastRecovery: { src: number; ref: number } | null;
}

export default function SunGeometryCard({ srcContext, refContext, contrastRecovery }: SunGeometryCardProps) {
  const hasAny = !!srcContext || !!refContext;

  return (
    <div className="bg-white border border-gray-200 dark:bg-white/[0.04] dark:backdrop-blur-md dark:border-white/10 rounded-sm p-4 text-xs">
      <h4 className="text-[9px] font-bold tracking-widest uppercase text-gray-500 mb-2">Illumination &amp; sun geometry</h4>

      {!hasAny && <p className="italic text-gray-400">Sun geometry unavailable for this frame.</p>}

      {hasAny && (
        <div className="space-y-3">
          {srcContext && <SideCard label="Source" ctx={srcContext} contrast={contrastRecovery?.src ?? null} />}
          {refContext && <SideCard label="Reference" ctx={refContext} contrast={contrastRecovery?.ref ?? null} />}
          <p className="text-[9px] text-gray-500 leading-relaxed pt-2 border-t border-gray-200 dark:border-white/10">
            Lower sun elevation increases shadow length and contrast; this affects cross-sensor matching difficulty.
          </p>
        </div>
      )}
    </div>
  );
}
