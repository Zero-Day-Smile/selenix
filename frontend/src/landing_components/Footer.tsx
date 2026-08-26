import React from 'react';

export default function Footer() {
  return (
    <footer
      className="
        relative
        z-20
        w-full
        border-t
        border-white/10
        bg-[#0E0E0E]
        px-6
        pb-7
        pt-10
        text-white
        sm:px-8
        md:px-[10%]
        md:pb-8
        md:pt-12
      "
    >
      <div
        className="
          flex
          w-full
          flex-col
          items-start
          justify-between
          gap-10
          md:flex-row
          md:items-end
          md:gap-8
        "
      >
        {/* =====================================================
            BRAND
        ===================================================== */}
        <div
          className="
            z-10
            flex
            items-center
            gap-3
          "
        >
          <div
            className="
              flex
              h-11
              w-11
              shrink-0
              items-center
              justify-center
              rounded-md
              bg-white
              text-xl
              font-bold
              text-[#0E0E0E]
              shadow-lg
              sm:h-12
              sm:w-12
            "
          >
            ⚙
          </div>

          <div>
            <h3
              className="
                text-lg
                font-bold
                tracking-[0.18em]
                sm:text-xl
              "
            >
              LUNAR TERRA
            </h3>

            <p
              className="
                mt-1
                max-w-[260px]
                text-[9px]
                uppercase
                tracking-[0.12em]
                text-gray-400
                sm:text-[10px]
              "
            >
              Align lunar imagery with sub-pixel precision
            </p>
          </div>
        </div>

        {/* =====================================================
            DECORATIVE MARK
        ===================================================== */}
        <div
          className="
            flex
            select-none
            pointer-events-none
            translate-y-2
            gap-1
            overflow-hidden
            text-[100px]
            font-black
            leading-[0.7]
            tracking-[-0.12em]
            text-white
            opacity-[0.85]
            sm:text-[140px]
            md:translate-y-4
            md:text-[180px]
          "
          aria-hidden="true"
        >
          <span>?</span>
          <span>?</span>
          <span>?</span>
        </div>
      </div>
    </footer>
  );
}