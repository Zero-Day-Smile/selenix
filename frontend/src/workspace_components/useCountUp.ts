// workspace_components/useCountUp.ts
//
// Animates a displayed integer counting up from 0 to the real target value
// whenever that target changes (e.g. a new pipeline run produces a new
// keypoint/match count) -- purely a presentation animation, never alters
// the underlying real number. Uses anime.js (already a dependency, see
// CrossSensorCompare.tsx) to drive a plain numeric proxy rather than
// hand-rolling another rAF loop.
import { useEffect, useRef, useState } from 'react';
import { animate } from 'animejs';

export function useCountUp(target: number, durationMs = 900): number {
  const [display, setDisplay] = useState(0);
  const proxyRef = useRef({ value: 0 });

  useEffect(() => {
    const proxy = proxyRef.current;
    proxy.value = 0;
    setDisplay(0);
    if (!target || target <= 0) {
      setDisplay(target || 0);
      return;
    }
    const anim = animate(proxy, {
      value: target,
      duration: durationMs,
      ease: 'outCubic',
      onUpdate: () => setDisplay(Math.round(proxy.value)),
    });
    return () => {
      anim.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return display;
}
