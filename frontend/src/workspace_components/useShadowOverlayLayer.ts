// workspace_components/useShadowOverlayLayer.ts
//
// Adds the real, per-pixel shadow-overlay PNG (RGBA; alpha channel already
// encodes shadow/not-shadow, see backend/pipeline/shadow.py) as a second
// OpenSeadragon layer on top of the base image, toggleable via opacity.
// The overlay PNG shares the exact pixel dimensions of the processed image
// it was computed from, so no coordinate scaling is needed -- unlike the
// crater markers, which need lat/lon-to-pixel conversion.
import { useEffect, useRef } from 'react';
import OpenSeadragon from 'openseadragon';

export function useShadowOverlayLayer(viewer: OpenSeadragon.Viewer | null, overlayUrl: string | null, opacity: number) {
  const itemRef = useRef<OpenSeadragon.TiledImage | null>(null);

  useEffect(() => {
    if (!viewer || !overlayUrl) return;
    let cancelled = false;
    const add = () => {
      if (cancelled) return;
      viewer.addTiledImage({
        tileSource: { type: 'image', url: overlayUrl },
        opacity,
        success: (e) => {
          if (!cancelled) itemRef.current = e.item;
        },
      });
    };
    if (viewer.isOpen()) {
      add();
    } else {
      viewer.addOnceHandler('open', add);
    }
    return () => {
      cancelled = true;
      if (itemRef.current) {
        try {
          viewer.world.removeItem(itemRef.current);
        } catch {
          // viewer may already be mid-destroy
        }
      }
      itemRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, overlayUrl]);

  useEffect(() => {
    itemRef.current?.setOpacity(opacity);
  }, [opacity]);
}
