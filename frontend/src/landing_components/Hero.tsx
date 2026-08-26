import React from 'react';

export default function Hero() {
  return (
    <section
      className="
        flex
        w-full
        flex-col
        items-center
        px-4
        text-center
        text-black
        sm:px-6
      "
    >
      <p
        className="
          mb-7
          max-w-[620px]
          text-[11px]
          font-medium
          leading-[1.7]
          tracking-[0.01em]
          text-gray-600
          opacity-0
          animate-fade-in-up
          sm:mb-8
          sm:text-[11.5px]
        "
      >
        AI-powered lunar image registration aligns Chandrayaan-2 imagery with
        reference maps — achieving sub-pixel accuracy before you analyze a
        single crater.
      </p>

      <h1
        className="
          max-w-[1100px]
          text-[3rem]
          font-medium
          leading-[0.98]
          tracking-[-0.045em]
          opacity-0
          animate-fade-in-up
          animation-delay-200
          sm:text-[4rem]
          md:text-[4.75rem]
          lg:text-[5.25rem]
        "
      >
        Align lunar imagery with
        <br />

        <span className="whitespace-nowrap">
          sub-pixel precision
        </span>
      </h1>
    </section>
  );
}