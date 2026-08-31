// workspace_components/useElapsedTimer.ts
//
// Simple "mission clock" -- starts counting the first time `active` becomes
// true (the pipeline run has actually started) and never resets or stops on
// its own afterward, matching a real ground-control elapsed-time readout
// rather than a per-stage stopwatch. Ticks once per second, which is all a
// human-readable mm:ss display needs (no reason to re-render faster).
import { useEffect, useRef, useState } from 'react';

export function useElapsedTimer(active: boolean): number {
  const startRef = useRef<number | null>(null);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    if (startRef.current == null) startRef.current = Date.now();
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  if (startRef.current == null) return 0;
  return Date.now() - startRef.current;
}

export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
