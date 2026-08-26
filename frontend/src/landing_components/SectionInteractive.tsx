import React, { useEffect, useRef, useState } from 'react';

import imgLeft from '../assets/img1moonleft.png';
import imgRight from '../assets/img2moonrigght.png';

export default function SectionInteractive() {
  const containerRef = useRef(null);
  const rafRef = useRef(null);
  const stageRef = useRef(1);

  const [activeStage, setActiveStage] = useState(1);

  /*
   * ============================================================
   * PIPELINE DATA
   * ============================================================
   */

  const steps = [
    {
      title: 'Upload',
      desc: 'Load Chandrayaan-2 source image and a lunar reference frame with metadata.',
      num: '01',
    },
    {
      title: 'Detect & Match',
      desc: 'Extract keypoints, form candidate correspondences across both images.',
      num: '02',
    },
    {
      title: 'Filter Inliers',
      desc: 'Robust estimation (e.g. RANSAC) separates true matches from outliers.',
      num: '03',
    },
    {
      title: 'Warp & Register',
      desc: 'Estimate the transform and align source onto the reference frame.',
      num: '04',
    },
    {
      title: 'Evaluate & Export',
      desc: 'Score with RMSE / inlier ratio, then export the registered product.',
      num: '05',
    },
  ];

  /*
   * ============================================================
   * SCROLL → STAGE
   *
   * IMPORTANT:
   * We do NOT update React state continuously.
   * State only changes when the stage changes.
   * ============================================================
   */

  useEffect(() => {
    const container = containerRef.current;

    if (!container) return;

    const updateStage = () => {
      const rect = container.getBoundingClientRect();
      const scrollDistance = container.offsetHeight - window.innerHeight;

      if (scrollDistance <= 0) {
        rafRef.current = null;
        return;
      }

      const progress = Math.max(
        0,
        Math.min(1, -rect.top / scrollDistance)
      );

      let nextStage;

      if (progress < 0.33) {
        nextStage = 1;
      } else if (progress < 0.66) {
        nextStage = 2;
      } else {
        nextStage = 3;
      }

      /*
       * Only trigger React re-render if the stage
       * actually changed.
       */
      if (stageRef.current !== nextStage) {
        stageRef.current = nextStage;
        setActiveStage(nextStage);
      }

      rafRef.current = null;
    };

    const handleScroll = () => {
      if (rafRef.current !== null) return;

      rafRef.current = window.requestAnimationFrame(updateStage);
    };

    const handleResize = () => {
      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }

      rafRef.current = window.requestAnimationFrame(updateStage);
    };

    updateStage();

    window.addEventListener('scroll', handleScroll, {
      passive: true,
    });

    window.addEventListener('resize', handleResize, {
      passive: true,
    });

    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleResize);

      if (rafRef.current !== null) {
        window.cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  /*
   * ============================================================
   * CARD POSITIONS
   *
   * These preserve the original alignment but make the
   * transition cleaner.
   * ============================================================
   */

  const cardWidth = 190;
  const cardGap = 4;

  const totalPipelineWidth =
    cardWidth * 5 + cardGap * 4;

  const halfPipelineWidth =
    totalPipelineWidth / 2;

  const pipelineLeftOffsets = [
    `calc(50% - ${halfPipelineWidth}px)`,
    `calc(50% - ${
      halfPipelineWidth - (cardWidth + cardGap)
    }px)`,
    `calc(50% - ${
      halfPipelineWidth - 2 * (cardWidth + cardGap)
    }px)`,
    `calc(50% - ${
      halfPipelineWidth - 3 * (cardWidth + cardGap)
    }px)`,
    `calc(50% - ${
      halfPipelineWidth - 4 * (cardWidth + cardGap)
    }px)`,
  ];

  /*
   * ============================================================
   * STAGE 1 POSITIONS
   * ============================================================
   */

  const stage1Left = [
    'calc(50% - 230px)',
    'calc(50% + 8px)',
    'calc(50% - 230px)',
  ];

  /*
   * ============================================================
   * STAGE 2 POSITIONS
   * ============================================================
   */

  const stage2Left = [
    'calc(70% - 230px)',
    'calc(70% + 8px)',
    'calc(70% - 230px)',
  ];

  /*
   * ============================================================
   * CARD STYLE
   * ============================================================
   *
   * We animate transform + opacity rather than repeatedly
   * calculating expensive layout changes.
   * ============================================================
   */

  const getCardStyle = (index) => {
    if (activeStage === 3) {
      return {
        left: pipelineLeftOffsets[index],
        top: '50%',
        transform: 'translate3d(0, -50%, 0)',
      };
    }

    if (index < 3) {
      const left =
        activeStage === 1
          ? stage1Left[index]
          : stage2Left[index];

      const top =
        index === 2
          ? 'calc(30% + 260px)'
          : '30%';

      return {
        left,
        top,
        transform: 'translate3d(0, 0, 0)',
      };
    }

    return {
      left: '50%',
      top: '50%',
      transform:
        'translate3d(-50%, -50%, 0) scale(0.92)',
    };
  };

  /*
   * ============================================================
   * CARD CONTENT
   * ============================================================
   */

  const renderCardContent = (index) => {
    /*
     * ----------------------------------------------------------
     * CARD 1
     * ----------------------------------------------------------
     */

    if (index === 0) {
      return (
        <>
          {/* STAGE 1 */}
          <div
            className={`content-stage ${
              activeStage === 1
                ? 'stage-visible'
                : 'stage-hidden-down'
            }`}
          >
            <div className="h-full p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[11px] font-medium text-white">
                  Source · MOVING
                </h3>

                <span className="font-mono text-[9px] text-white/25">
                  01
                </span>
              </div>

              <img
                src={imgLeft}
                alt="Source lunar image"
                className="moon-image mb-2 aspect-square w-full rounded-md object-cover grayscale"
                draggable="false"
              />

              <p className="text-[11px] font-medium text-gray-400">
                Source
              </p>
            </div>
          </div>

          {/* STAGE 2 */}
          <div
            className={`content-stage ${
              activeStage === 2
                ? 'stage-visible'
                : 'stage-hidden-up'
            }`}
          >
            <div className="flex h-full flex-col p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">
                Illumination Variation
              </h3>

              <ul className="flex-grow list-disc space-y-2 pl-4 text-[11px] leading-relaxed text-gray-300">
                <li>
                  Sun azimuth and elevation reshape shadows
                  and surface brightness between passes,
                  making direct pixel correlation unreliable.
                </li>

                <li>
                  Different orbital altitudes and sensor
                  resolutions create large scale ratios
                  between source and reference.
                </li>
              </ul>

              <span className="mt-4 font-mono text-[9px] text-white/25">
                LIGHTING
              </span>
            </div>
          </div>

          {/* STAGE 3 */}
          <div
            className={`content-stage ${
              activeStage === 3
                ? 'stage-visible'
                : 'stage-hidden-up'
            }`}
          >
            <div className="flex h-full flex-col p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">
                  Upload
                </h3>

                <span className="font-mono text-[9px] text-white/25">
                  01
                </span>
              </div>

              <p className="flex-grow text-[11px] leading-relaxed text-gray-300">
                Load Chandrayaan-2 source image and a lunar
                reference frame with metadata.
              </p>

              <span className="font-mono text-[10px] text-gray-500">
                01
              </span>
            </div>
          </div>
        </>
      );
    }

    /*
     * ----------------------------------------------------------
     * CARD 2
     * ----------------------------------------------------------
     */

    if (index === 1) {
      return (
        <>
          {/* STAGE 1 */}
          <div
            className={`content-stage ${
              activeStage === 1
                ? 'stage-visible'
                : 'stage-hidden-down'
            }`}
          >
            <div className="h-full p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-[11px] font-medium text-white">
                  Reference · FIXED
                </h3>

                <span className="font-mono text-[9px] text-white/25">
                  02
                </span>
              </div>

              <img
                src={imgRight}
                alt="Reference lunar image"
                className="moon-image mb-2 aspect-square w-full rounded-md object-cover grayscale"
                draggable="false"
              />

              <p className="text-[11px] font-medium text-gray-400">
                Reference
              </p>
            </div>
          </div>

          {/* STAGE 2 */}
          <div
            className={`content-stage ${
              activeStage === 2
                ? 'stage-visible'
                : 'stage-hidden-up'
            }`}
          >
            <div className="flex h-full flex-col p-5">
              <h3 className="mb-3 text-sm font-semibold text-white">
                Viewpoint Variation
              </h3>

              <ul className="flex-grow list-disc space-y-2 pl-4 text-[11px] leading-relaxed text-gray-300">
                <li>
                  Differing camera position and orientation
                  shift, rotate and perspective-distort the
                  same surface features.
                </li>

                <li>
                  Rotation and tilt must be estimated before
                  reliable alignment.
                </li>
              </ul>

              <span className="mt-4 font-mono text-[9px] text-white/25">
                VIEWPOINT
              </span>
            </div>
          </div>

          {/* STAGE 3 */}
          <div
            className={`content-stage ${
              activeStage === 3
                ? 'stage-visible'
                : 'stage-hidden-up'
            }`}
          >
            <div className="flex h-full flex-col p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">
                  Detect & Match
                </h3>

                <span className="font-mono text-[9px] text-white/25">
                  02
                </span>
              </div>

              <p className="flex-grow text-[11px] leading-relaxed text-gray-300">
                Extract keypoints and form candidate
                correspondences across both images.
              </p>

              <span className="font-mono text-[10px] text-gray-500">
                02
              </span>
            </div>
          </div>
        </>
      );
    }

    /*
     * ----------------------------------------------------------
     * CARD 3
     * ----------------------------------------------------------
     */

    if (index === 2) {
      return (
        <>
          {/* STAGE 1 */}
          <div
            className={`content-stage ${
              activeStage === 1
                ? 'stage-visible'
                : 'stage-hidden-down'
            }`}
          >
            <div className="flex h-full flex-col justify-center p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-xs text-white">
                  How it Aligns
                </h3>

                <span className="font-mono text-[9px] tracking-widest text-gray-400">
                  FLAG
                </span>
              </div>

              <p className="text-[11px] leading-relaxed text-gray-200">
                Key-points are detected on both images,
                matched, filtered for geometric consistency
                and used to wrap the source onto the reference
                frame.
              </p>
            </div>
          </div>

          {/* STAGE 2 */}
          <div
            className={`content-stage ${
              activeStage === 2
                ? 'stage-visible'
                : 'stage-hidden-up'
            }`}
          >
            <div className="flex h-full flex-col justify-center p-5">
              <div className="mb-2 flex items-center justify-between">
                <h3 className="font-semibold text-xs text-white">
                  Scale Variation
                </h3>

                <span className="font-mono text-[9px] text-gray-400">
                  RESOLVED
                </span>
              </div>

              <p className="text-[11px] leading-relaxed text-gray-300">
                Different orbital altitudes and sensor
                resolutions across missions can create large
                scale ratios between source and reference.
              </p>
            </div>
          </div>

          {/* STAGE 3 */}
          <div
            className={`content-stage ${
              activeStage === 3
                ? 'stage-visible'
                : 'stage-hidden-up'
            }`}
          >
            <div className="flex h-full flex-col p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-xs font-semibold text-white">
                  Filter Inliers
                </h3>

                <span className="font-mono text-[9px] text-white/25">
                  03
                </span>
              </div>

              <p className="flex-grow text-[11px] leading-relaxed text-gray-300">
                Robust estimation such as RANSAC separates
                true geometric matches from outliers.
              </p>

              <span className="font-mono text-[10px] text-gray-500">
                03
              </span>
            </div>
          </div>
        </>
      );
    }

    /*
     * ----------------------------------------------------------
     * CARD 4
     * ----------------------------------------------------------
     */

    if (index === 3) {
      return (
        <div
          className={`content-stage ${
            activeStage === 3
              ? 'stage-visible'
              : 'stage-hidden-up'
          }`}
        >
          <div className="pipeline-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-white">
                Warp & Register
              </h3>

              <span className="font-mono text-[9px] text-white/25">
                04
              </span>
            </div>

            <p className="pipeline-description text-[11px] leading-relaxed text-gray-300">
              Estimate the transform and align the source
              onto the reference frame.
            </p>

            <span className="font-mono text-[10px] text-gray-500">
              04
            </span>
          </div>
        </div>
      );
    }

    /*
     * ----------------------------------------------------------
     * CARD 5
     * ----------------------------------------------------------
     */

    return (
      <div
        className={`content-stage ${
          activeStage === 3
            ? 'stage-visible'
            : 'stage-hidden-up'
        }`}
      >
        <div className="pipeline-card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold text-white">
              Evaluate & Export
            </h3>

            <span className="font-mono text-[9px] text-white/25">
              05
            </span>
          </div>

          <p className="pipeline-description text-[11px] leading-relaxed text-gray-300">
            Score with RMSE / inlier ratio, then export the
            registered product.
          </p>

          <span className="font-mono text-[10px] text-gray-500">
            05
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{`
        /*
         * ========================================================
         * PERFORMANCE
         * ========================================================
         */

        .registration-card {
          position: absolute;

          /*
           * GPU compositing.
           * The browser can move these cards without forcing
           * layout/reflow on every animation frame.
           */
          will-change: transform, left, top;

          transform-origin: center center;

          transition:
            transform 1200ms cubic-bezier(0.22, 1, 0.36, 1),
            left 1200ms cubic-bezier(0.22, 1, 0.36, 1),
            top 1200ms cubic-bezier(0.22, 1, 0.36, 1);

          /*
           * Prevent sub-pixel flickering during transforms.
           */
          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;

          /*
           * Isolate card painting from the rest of the page.
           */
          contain: layout paint style;
        }

        /*
         * ========================================================
         * GLASS CARD
         * ========================================================
         */

        .glass-card {
          background: rgba(255, 255, 255, 0.12);

          border: 1px solid rgba(255, 255, 255, 0.15);

          border-radius: 16px;

          box-shadow:
            0 4px 30px rgba(0, 0, 0, 0.1);

          /*
           * IMPORTANT:
           * backdrop-filter is NOT animated.
           * This prevents expensive blur work during movement.
           */
          backdrop-filter: blur(5.1px);
          -webkit-backdrop-filter: blur(5.1px);

          overflow: hidden;

          /*
           * Keeps the card as an isolated rendering layer.
           */
          isolation: isolate;
        }

        /*
         * ========================================================
         * INNER CARD
         * ========================================================
         */

        .content-wrap {
          position: relative;

          width: 100%;
          height: 100%;

          background: rgba(255, 255, 255, 0.05);

          border: 1px solid rgba(255, 255, 255, 0.15);

          border-radius: 12px;

          overflow: hidden;
        }

        /*
         * ========================================================
         * CONTENT TRANSITIONS
         * ========================================================
         */

        .content-stage {
          position: absolute;

          inset: 0;

          /*
           * Only opacity + transform.
           * Both are GPU friendly.
           */
          transition:
            opacity 650ms cubic-bezier(0.22, 1, 0.36, 1),
            transform 650ms cubic-bezier(0.22, 1, 0.36, 1);

          will-change: opacity, transform;

          backface-visibility: hidden;
          -webkit-backface-visibility: hidden;
        }

        .stage-visible {
          opacity: 1;

          transform: translate3d(0, 0, 0);

          pointer-events: auto;

          visibility: visible;
        }

        .stage-hidden-down {
          opacity: 0;

          transform: translate3d(0, 14px, 0);

          pointer-events: none;

          visibility: hidden;
        }

        .stage-hidden-up {
          opacity: 0;

          transform: translate3d(0, -14px, 0);

          pointer-events: none;

          visibility: hidden;
        }

        /*
         * ========================================================
         * PIPELINE CARDS
         * ========================================================
         */

        .pipeline-card {
          display: flex;

          flex-direction: column;

          height: 100%;

          padding: 16px;
        }

        .pipeline-description {
          flex-grow: 1;
        }

        /*
         * ========================================================
         * IMAGE
         * ========================================================
         */

        .moon-image {
          /*
           * Static filter.
           * Do NOT animate filter during card movement.
           */
          filter: grayscale(100%);

          user-select: none;

          -webkit-user-drag: none;
        }

        /*
         * ========================================================
         * REDUCED MOTION
         * ========================================================
         */

        @media (prefers-reduced-motion: reduce) {
          .registration-card,
          .content-stage {
            transition: none !important;
          }
        }

        /*
         * ========================================================
         * TABLET
         * ========================================================
         */

        @media (max-width: 900px) {
          .registration-card {
            transition:
              transform 950ms cubic-bezier(0.22, 1, 0.36, 1),
              left 950ms cubic-bezier(0.22, 1, 0.36, 1),
              top 950ms cubic-bezier(0.22, 1, 0.36, 1);
          }
        }

        /*
         * ========================================================
         * MOBILE
         * ========================================================
         */

        @media (max-width: 640px) {
          .registration-card {
            transition:
              transform 750ms cubic-bezier(0.22, 1, 0.36, 1),
              left 750ms cubic-bezier(0.22, 1, 0.36, 1),
              top 750ms cubic-bezier(0.22, 1, 0.36, 1);
          }

          .glass-card {
            border-radius: 14px;
          }

          .content-wrap {
            border-radius: 10px;
          }
        }
      `}</style>

      <section
        ref={containerRef}
        className="relative z-10 h-[400vh] w-full"
      >
        <div className="sticky top-0 h-screen w-full overflow-hidden">
          {/* =====================================================
              STAGE 1 HEADING
          ====================================================== */}

          <div
            className={`absolute left-1/2 top-[12%] z-10 w-[460px] -translate-x-1/2 transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              activeStage === 1
                ? 'translate-y-0 opacity-100'
                : '-translate-y-10 opacity-0 pointer-events-none'
            }`}
          >
            <h2 className="text-center text-[2.5rem] font-medium leading-[1.1] text-white drop-shadow-md">
              Finding correspondence,
              <br />
              then registering
            </h2>
          </div>

          {/* =====================================================
              STAGE 2 HEADING
          ====================================================== */}

          <div
            className={`absolute left-[10%] top-[40%] z-10 w-[40%] transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              activeStage === 2
                ? 'translate-y-0 opacity-100'
                : activeStage === 1
                ? 'translate-y-10 opacity-0'
                : '-translate-y-10 opacity-0 pointer-events-none'
            }`}
          >
            <h2 className="text-[3.5rem] font-medium leading-[1.1] text-white drop-shadow-md">
              Why lunar
              <br />
              registration is hard.
            </h2>
          </div>

          {/* =====================================================
              STAGE 3 HEADING
          ====================================================== */}

          <div
            className={`absolute left-[10%] top-[15%] z-10 w-full transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              activeStage === 3
                ? 'translate-y-0 opacity-100'
                : 'translate-y-10 opacity-0 pointer-events-none'
            }`}
          >
            <h2 className="text-[3.5rem] font-medium leading-[1.1] text-white drop-shadow-md">
              Registration
              <br />
              pipeline
            </h2>
          </div>

          {/* =====================================================
              CARDS
          ====================================================== */}

          {Array.from({ length: 5 }).map((_, index) => {
            const isPipelineCard = index >= 3;

            const style = getCardStyle(index);

            return (
              <div
                key={index}
                className={`
                  registration-card
                  glass-card
                  p-1.5
                `}
                style={{
                  ...style,

                  width: activeStage === 3
                    ? `${cardWidth}px`
                    : index < 2
                    ? '222px'
                    : '460px',

                  height: activeStage === 3
                    ? '240px'
                    : index < 2
                    ? '240px'
                    : '120px',

                  opacity:
                    activeStage === 3
                      ? 1
                      : isPipelineCard
                      ? 0
                      : 1,

                  pointerEvents:
                    activeStage === 3 || !isPipelineCard
                      ? 'auto'
                      : 'none',

                  zIndex:
                    activeStage === 3 ? 2 : 1,
                }}
              >
                <div className="content-wrap">
                  {renderCardContent(index)}
                </div>
              </div>
            );
          })}

          {/* =====================================================
              STAGE 2 / 3 BOTTOM RIGHT TEXT
          ====================================================== */}

          <div
            className={`absolute bottom-16 right-[10%] z-10 max-w-xs transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              activeStage === 2 || activeStage === 3
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none translate-y-8 opacity-0'
            }`}
          >
            <p className="text-right text-[12px] font-medium leading-relaxed text-gray-300 drop-shadow-md">
              {activeStage === 2
                ? 'Same surface, different capture conditions. The pipeline is built to explicitly measure and compensate for three sources of misalignment.'
                : 'Five stages, from raw acquisitions to an evaluated, exportable registered product.'}
            </p>
          </div>

          {/* =====================================================
              STAGE 1 BOTTOM TEXT
          ====================================================== */}

          <div
            className={`absolute bottom-16 left-[10%] z-10 transition-all duration-1000 ease-[cubic-bezier(0.22,1,0.36,1)] ${
              activeStage === 1
                ? 'translate-y-0 opacity-100'
                : 'pointer-events-none translate-y-5 opacity-0'
            }`}
          >
            <p className="font-mono text-[10px] font-medium tracking-wide text-gray-400">
              4 candidate correspondences
              <span className="mx-2 text-gray-600">·</span>
              3 inliers
              <span className="mx-2 text-gray-600">·</span>
              1 outlier
            </p>
          </div>
        </div>
      </section>
    </>
  );
}