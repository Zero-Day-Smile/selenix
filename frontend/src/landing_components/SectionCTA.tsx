import { useNavigate } from 'react-router-dom';

export default function SectionCTA() {
  const navigate = useNavigate();
  const handleTryNow = () => navigate('/workspace/step/0');

  return (
    <section
      className="
        flex
        w-full
        items-center
        px-6
        py-24
        text-white
        sm:px-8
        md:px-[10%]
        md:py-28
      "
    >
      <div
        className="
          flex
          w-full
          flex-col
          items-start
          justify-between
          gap-12
          md:flex-row
          md:items-center
          md:gap-8
        "
      >
        {/* LEFT LABEL */}
        <h3
          className="
            text-xl
            font-medium
            leading-[1.1]
            tracking-tight
            text-gray-300
            sm:text-2xl
          "
        >
          Heard
          <br />
          Enough?
        </h3>

        {/* MAIN CTA */}
        <div
          onClick={handleTryNow}
          className="
            group
            relative
            flex
            cursor-pointer
            flex-col
            items-start
            md:items-center
          "
        >
          <h2
            className="
              inline-block
              pb-3
              text-[2.8rem]
              font-medium
              leading-none
              tracking-[-0.04em]
              transition-transform
              duration-500
              ease-out
              group-hover:-translate-y-1
              sm:text-5xl
              md:text-[4rem]
            "
          >
            Try it out now
          </h2>

          <div
            className="
              h-[2px]
              w-[90%]
              origin-left
              bg-white
              transition-all
              duration-500
              ease-out
              group-hover:w-full
              group-hover:bg-gray-400
            "
          />
        </div>

        {/* ARROW */}
        <button
          type="button"
          onClick={handleTryNow}
          aria-label="Try it out now"
          className="
            group
            flex
            h-16
            w-16
            shrink-0
            items-center
            justify-center
            rounded-full
            border
            border-white/20
            bg-transparent
            transition-all
            duration-300
            hover:scale-105
            hover:border-white/50
            active:scale-95
            sm:h-20
            sm:w-20
          "
        >
          <svg
            className="
              h-7
              w-7
              text-white
              transition-transform
              duration-300
              ease-out
              group-hover:translate-x-1
              sm:h-8
              sm:w-8
            "
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="M14 5l7 7m0 0l-7 7m7-7H3"
            />
          </svg>
        </button>
      </div>
    </section>
  );
}