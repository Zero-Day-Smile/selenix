// workspace_components/CrossSensorCompare.tsx
//
// Animated cross-sensor appearance comparison for the Detection stage --
// a crossfade loop (primary, anime.js-driven timeline with an ease-in-out
// fade and a deliberate hold at the 50/50 midpoint) plus a togglable
// wipe/reveal divider (secondary), both running entirely in the browser
// on the two already-loaded processed images (no video file, no new
// backend call).
//
// Metadata overlay note: sensor name is a real, deterministic filename-
// pattern label (services/api.ts::sensorLabelForFilename) -- this
// project's own real NAC/PDS4 labels don't carry a human-readable sensor
// name field, so this is pattern-matched from the same real naming
// convention this app's own real datasets already use, not read from a
// metadata field. Sun angle and GSD ARE read from real result-JSON fields
// (shadowAnalysis.*.sun_angle_context, ingestion.*_geometry) but both are
// frequently absent for a real upload -- sun angle is only ever populated
// for this project's 4 known real Chandrayaan-2 frames (see
// backend/app/main.py::_sun_angle_context), and GSD is a best-effort,
// label-derived value that's empty for plain-PNG preview uploads (no
// label to read). Every field below shows "not available" rather than a
// guessed number when the real value isn't present.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { animate, type JSAnimation } from 'animejs';
import { sensorLabelForFilename } from '../services/api';

export type SideMeta = {
  sensor: string | null;
  sunAngleDeg: number | null;
  gsdLabel: string | null; // e.g. "map_scale: 0.474 km/pix" -- raw, attributed, not unit-normalized
};

function buildGsdLabel(geometry: Record<string, string> | null | undefined): string | null {
  if (!geometry) return null;
  for (const key of ['map_scale', 'map_resolution', 'image_resolution', 'resolution', 'spatial_resolution', 'pixel_scale']) {
    if (geometry[key]) return `${key}: ${geometry[key]}`;
  }
  return null;
}

// Improvement 4: label opacity tied to which side currently dominates --
// phase 0 = fully source, 1 = fully reference (same convention as the
// crossfade opacity below).
function labelOpacity(phase: number, side: 'src' | 'ref'): number {
  const dominant = side === 'src' ? phase < 0.4 : phase > 0.6;
  const midpoint = phase >= 0.4 && phase <= 0.6;
  if (midpoint) return 0.6;
  return dominant ? 1 : 0.3;
}

function MetaLine({ label, meta, opacity }: { label: string; meta: SideMeta; opacity: number }) {
  return (
    <div
      className="bg-black/75 text-white text-[10px] font-mono px-2 py-1.5 rounded-sm leading-tight transition-opacity duration-300"
      style={{ opacity }}
    >
      <div className="font-bold text-[11px]">{label}</div>
      <div>{meta.sensor ?? 'sensor unknown'}</div>
      <div>{meta.sunAngleDeg != null ? `${meta.sunAngleDeg.toFixed(1)}° sun angle` : 'sun angle not available'}</div>
      <div>{meta.gsdLabel ?? 'GSD not available'}</div>
    </div>
  );
}

// Improvement 3: progress-bar color interpolates from the source color
// (amber, matching this app's existing match-point color language) to the
// reference color (theme black, matching the app's black & white palette)
// across the phase range.
const SRC_COLOR: [number, number, number] = [245, 158, 11]; // amber-500
const REF_COLOR: [number, number, number] = [14, 14, 14]; // #0E0E0E

function lerpColor(t: number): string {
  const c = SRC_COLOR.map((s, i) => Math.round(s + (REF_COLOR[i] - s) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

// Improvement 2: fade-in to the 50/50 midpoint (ease-in-out-cubic), a
// deliberate hold at the midpoint (the most informative frame -- both
// sensors visible simultaneously), fade the rest of the way, a short pause
// at the far end, then anime's `alternate` direction reverses the whole
// timeline back. Durations exactly as specified.
const FADE_IN_MS = 1000;
const HOLD_MID_MS = 1750; // "1.5-2s hold at midpoint" -- middle of that range
const FADE_OUT_MS = 1000;
const END_PAUSE_MS = 500;

export default function CrossSensorCompare({
  srcUrl,
  refUrl,
  srcMeta,
  refMeta,
}: {
  srcUrl: string;
  refUrl: string;
  srcMeta: SideMeta;
  refMeta: SideMeta;
}) {
  const [mode, setMode] = useState<'crossfade' | 'wipe'>('crossfade');
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [playing, setPlaying] = useState(true);
  // phase in [0,1]: 0 = fully on src, 1 = fully on ref. Driven by an
  // anime.js timeline (see below) rather than a hand-rolled rAF loop, so
  // the fade gets real easing + a real mid-hold instead of linear opacity.
  const [phase, setPhase] = useState(0);
  const animRef = useRef<JSAnimation | null>(null);
  const phaseProxyRef = useRef({ phase: 0 });

  const [wipePct, setWipePct] = useState(50);
  const draggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    if (mode !== 'crossfade') {
      animRef.current?.pause();
      return;
    }
    const proxy = phaseProxyRef.current;
    const anim = animate(proxy, {
      keyframes: [
        { phase: 0.5, duration: FADE_IN_MS, ease: 'inOutCubic' },
        { phase: 0.5, duration: HOLD_MID_MS, ease: 'linear' },
        { phase: 1, duration: FADE_OUT_MS, ease: 'inOutCubic' },
        { phase: 1, duration: END_PAUSE_MS, ease: 'linear' },
      ],
      loop: true,
      direction: 'alternate',
      autoplay: playing,
      onUpdate: () => setPhase(proxy.phase),
    });
    animRef.current = anim;
    return () => {
      anim.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    if (!animRef.current) return;
    if (playing) animRef.current.play();
    else animRef.current.pause();
  }, [playing]);

  const onWipePointerDown = (e: React.PointerEvent) => {
    draggingRef.current = true;
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onWipePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setWipePct(Math.max(0, Math.min(100, pct)));
  };
  const onWipePointerUp = () => {
    draggingRef.current = false;
  };

  // Improvement 6: keyboard shortcuts. Ignored while focus is in a real
  // input/textarea elsewhere on the page, so this never hijacks typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === 'c' || e.key === 'C') {
        setMode('crossfade');
      } else if (e.key === 'w' || e.key === 'W') {
        setMode('wipe');
      } else if (e.key === 'ArrowLeft' && modeRef.current === 'wipe') {
        setWipePct((p) => Math.max(0, p - 5));
      } else if (e.key === 'ArrowRight' && modeRef.current === 'wipe') {
        setWipePct((p) => Math.min(100, p + 5));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Metadata overlay cross-fades with the image -- src's box fades out as
  // ref's fades in, matching phase exactly (task: "show the numbers
  // changing as the visual changes").
  const srcLabelOpacity = mode === 'wipe' ? 1 : labelOpacity(phase, 'src');
  const refLabelOpacity = mode === 'wipe' ? 1 : labelOpacity(phase, 'ref');
  const progressPct = mode === 'crossfade' ? phase * 100 : 100;
  const progressColor = useMemo(() => lerpColor(mode === 'crossfade' ? phase : 0.5), [mode, phase]);

  return (
    <div className="bg-white border border-[#0E0E0E]/15 dark:bg-[#0E0E0E] dark:backdrop-blur-md dark:border-white/10 p-6 shadow-sm rounded-sm mb-6">
      <style>{`
        @keyframes wipe-divider-pulse {
          0%, 100% { box-shadow: 0 0 4px 1px rgba(255, 255, 255, 0.5); }
          50% { box-shadow: 0 0 9px 2px rgba(255, 255, 255, 0.95); }
        }
        .wipe-divider-glow { animation: wipe-divider-pulse 1.6s ease-in-out infinite; }
      `}</style>
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div>
          <h3 className="text-xs font-bold tracking-wide uppercase text-gray-700 dark:text-gray-300">
            Cross-sensor appearance comparison
          </h3>
          <p className="text-[10px] text-gray-500">same location, different satellites</p>
        </div>
        <div className="flex items-center gap-2 relative" onMouseEnter={() => setShowShortcuts(true)} onMouseLeave={() => setShowShortcuts(false)}>
          {showShortcuts && (
            <div className="absolute top-full right-0 mt-1 z-10 bg-black text-gray-400 text-[9px] font-mono px-2.5 py-2 rounded-sm whitespace-nowrap shadow-lg">
              <div><span className="text-white font-bold">Space</span> play/pause</div>
              <div><span className="text-white font-bold">C</span> crossfade &nbsp; <span className="text-white font-bold">W</span> wipe</div>
              <div><span className="text-white font-bold">&#8592;/&#8594;</span> scrub divider (wipe mode)</div>
            </div>
          )}
          {mode === 'crossfade' && (
            <button
              onClick={() => setPlaying((p) => !p)}
              aria-label={playing ? 'Pause animation' : 'Play animation'}
              className="px-3 py-1.5 text-[10px] font-mono uppercase tracking-wide border rounded-sm bg-gray-50 dark:bg-white/[0.03] text-gray-400 border-gray-300 dark:border-white/15 hover:border-[#0E0E0E]/60 dark:hover:border-white/60 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E0E0E] dark:focus-visible:ring-white"
            >
              {playing ? 'Pause' : 'Play'}
            </button>
          )}
          <div className="flex text-[10px] font-mono uppercase tracking-wide border border-gray-300 dark:border-white/15 rounded-sm overflow-hidden">
            <button
              onClick={() => setMode('crossfade')}
              aria-label="Switch to crossfade mode"
              className={`px-3 py-1.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E0E0E] dark:focus-visible:ring-white ${mode === 'crossfade' ? 'bg-[#0E0E0E] text-white dark:bg-white dark:text-[#0E0E0E]' : 'bg-gray-50 dark:bg-white/[0.03] text-gray-400 hover:bg-white/10'}`}
            >
              Crossfade
            </button>
            <button
              onClick={() => setMode('wipe')}
              aria-label="Switch to wipe/scrub mode"
              className={`px-3 py-1.5 border-l border-gray-300 dark:border-white/15 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0E0E0E] dark:focus-visible:ring-white ${mode === 'wipe' ? 'bg-[#0E0E0E] text-white dark:bg-white dark:text-[#0E0E0E]' : 'bg-gray-50 dark:bg-white/[0.03] text-gray-400 hover:bg-white/10'}`}
            >
              Wipe / scrub
            </button>
          </div>
        </div>
      </div>

      <div
        ref={containerRef}
        className="relative h-[320px] overflow-hidden rounded-sm bg-black select-none"
        onPointerMove={mode === 'wipe' ? onWipePointerMove : undefined}
        onPointerUp={mode === 'wipe' ? onWipePointerUp : undefined}
      >
        <img src={srcUrl} alt="Source sensor image comparison slice" className="absolute inset-0 w-full h-full object-cover" draggable={false} />

        {mode === 'crossfade' ? (
          <img
            src={refUrl}
            alt="Reference sensor image comparison slice"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
            style={{ opacity: phase }}
          />
        ) : (
          <img
            src={refUrl}
            alt="Reference sensor image comparison slice"
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
            style={{ clipPath: `inset(0 ${100 - wipePct}% 0 0)` }}
          />
        )}

        {mode === 'wipe' && (
          <div
            className="absolute top-0 bottom-0 w-1 bg-white cursor-ew-resize touch-none wipe-divider-glow"
            style={{ left: `${wipePct}%`, transform: 'translateX(-50%)' }}
            onPointerDown={onWipePointerDown}
          >
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white flex items-center justify-center text-black text-[10px] font-bold">
              &#8596;
            </div>
          </div>
        )}

        {/* Metadata overlays -- top-left for source, top-right for reference. */}
        <div className="absolute top-2 left-2">
          <MetaLine label="Source" meta={srcMeta} opacity={srcLabelOpacity} />
        </div>
        <div className="absolute top-2 right-2 text-right">
          <MetaLine label="Reference" meta={refMeta} opacity={refLabelOpacity} />
        </div>

        {/* Improvement 3: cycle progress bar, source-color -> reference-color. */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-black/40">
          <div
            className="h-full"
            style={{ width: `${progressPct}%`, backgroundColor: progressColor, transition: mode === 'wipe' ? 'width 0.2s linear' : undefined }}
          />
        </div>
      </div>

      <p className="text-[10px] text-gray-400 mt-2">
        {mode === 'crossfade'
          ? 'Looping crossfade between the two real processed images -- pauses visibly at the 50/50 midpoint. Space to pause, hover the controls for shortcuts.'
          : 'Drag the cyan divider (or use arrow keys) to reveal the source image on one side and the reference image on the other.'}
      </p>
    </div>
  );
}

export function metaFromFilename(
  filename: string | null | undefined,
  sunAngleDeg: number | null | undefined,
  geometry: Record<string, string> | null | undefined
): SideMeta {
  return {
    sensor: sensorLabelForFilename(filename),
    sunAngleDeg: sunAngleDeg ?? null,
    gsdLabel: buildGsdLabel(geometry),
  };
}
