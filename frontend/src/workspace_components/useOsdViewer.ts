// workspace_components/useOsdViewer.ts
import { useEffect, useRef, useState } from 'react';
import OpenSeadragon from 'openseadragon';

// homeFillsViewer: true makes the image fill the viewer frame on open
// (cropping overflow) instead of the OSD default of fitting the whole
// image inside the frame with letterbox bars. visibilityRatio: 1 stops
// the user panning the image entirely out of view. minZoomImageRatio
// lets them zoom back OUT past the fill state to see the whole,
// uncropped image on demand.
const BASE_OPTIONS: Partial<OpenSeadragon.Options> = {
  showNavigationControl: true,
  prefixUrl: '/openseadragon-images/',
  homeFillsViewer: true,
  visibilityRatio: 1,
  minZoomImageRatio: 0.3,
  defaultZoomLevel: 0,
  gestureSettingsMouse: { clickToZoom: false },
  drawer: 'canvas',
};

// "Fill viewer" scales to the loaded image's own axis-aligned bounding
// box -- for a real rotated/skewed source file (a real per-pixel-geometry
// crop that isn't axis-aligned to its own file's pixel grid, or a
// synthetic rotated variant), that bounding box is bigger than the actual
// visible content, so "fill" still leaves real empty margin around it.
// Zooming in a bit further than fill's own home position crops into that
// margin -- still real content, no image data invented, just a closer
// default view. The user can always zoom back out (minZoomImageRatio
// still allows it).
const OPEN_ZOOM_MULTIPLIER = 1.4;

export function useOsdViewer(elRef: React.RefObject<HTMLDivElement | null>, url: string | null) {
  const [viewer, setViewer] = useState<OpenSeadragon.Viewer | null>(null);

  useEffect(() => {
    if (!url || !elRef.current) return;
    const v = OpenSeadragon({
      ...BASE_OPTIONS,
      element: elRef.current,
      tileSources: { type: 'image', url },
    });
    v.addOnceHandler('open', () => {
      v.viewport.zoomTo(v.viewport.getHomeZoom() * OPEN_ZOOM_MULTIPLIER, undefined, true);
    });
    setViewer(v);
    return () => {
      v.destroy();
      setViewer(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return viewer;
}
