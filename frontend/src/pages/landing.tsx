import { useEffect, useState, useRef } from 'react';
import Navbar, { type Page } from '../landing_components/Navbar';
import Hero from '../landing_components/Hero';
import SectionInteractive from '../landing_components/SectionInteractive';
import SectionCTA from '../landing_components/SectionCTA';

import landingVideo from '../assets/landing.mp4';

interface LandingProps {
  onNavigate?: (page: Page) => void;
}

export default function Landing({ onNavigate }: LandingProps) {
  const [stage, setStage] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 800);
    const t2 = setTimeout(() => setStage(2), 2200);

    let isTransitioning = false;

    // Define the full page sections we want to snap between
    const getSections = () => {
      return Array.from(document.querySelectorAll<HTMLElement>('.page-snap-section'));
    };

    const handleWheel = (e: WheelEvent) => {
      // If a programmatic scroll transition is currently running, ignore further inputs
      if (isTransitioning) {
        e.preventDefault();
        return;
      }

      const sections = getSections();
      const scrollPos = window.scrollY;
      
      // Find which section is currently active in the viewport
      let activeIndex = 0;
      let minDistance = Infinity;

      sections.forEach((sec, idx) => {
        const distance = Math.abs(sec.offsetTop - scrollPos);
        if (distance < minDistance) {
          minDistance = distance;
          activeIndex = idx;
        }
      });

      // Special check for SectionInteractive: 
      // Because it's 400vh tall, we only want to snap away from it 
      // if the user has actually scrolled all the way to its bottom boundary!
      const interactiveSection = document.getElementById('section-interactive-wrapper');
      if (interactiveSection && activeIndex === 1) {
        const rect = interactiveSection.getBoundingClientRect();
        const isAtBottom = rect.bottom <= window.innerHeight + 5;
        const isAtTop = rect.top >= -5;

        // If scrolling down, but haven't reached the end of the 400vh animation yet, let it scroll naturally.
        if (e.deltaY > 0 && !isAtBottom) {
          return; 
        }
        // If scrolling up, but haven't reached the top of the 400vh animation yet, let it scroll naturally.
        if (e.deltaY < 0 && !isAtTop) {
          return;
        }
      }

      // Determine target section based on wheel direction
      const direction = e.deltaY > 0 ? 1 : -1;
      const targetIndex = activeIndex + direction;

      if (targetIndex >= 0 && targetIndex < sections.length) {
        e.preventDefault(); // Kill the native jumpy/aggressive scroll behavior
        isTransitioning = true;

        sections[targetIndex].scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });

        // Cooldown timer to re-enable wheel tracking after the smooth scroll finishes
        setTimeout(() => {
          isTransitioning = false;
        }, 700);
      }
    };

    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      window.removeEventListener('wheel', handleWheel);
    };
  }, []);

  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: -1 }}>
        <video
          src={landingVideo}
          autoPlay
          muted
          loop
          playsInline
          style={{ objectFit: 'cover', width: '100%', height: '100%', opacity: 0.85 }}
        />
        <div className="absolute inset-0 bg-[#0E0E0E]/40"></div>
      </div>

      <div ref={containerRef} className="relative z-10 w-full flex flex-col font-sans text-white">
        
        <div
          className="fixed top-0 w-full z-50 transition-transform duration-1000 ease-[cubic-bezier(0.77,0,0.175,1)]"
          style={{ transform: stage >= 1 ? 'translateY(0)' : 'translateY(-100%)' }}
        >
          <Navbar onNavigate={onNavigate} />
        </div>

        {/* SECTION 0: Hero */}
        <div
          className="page-snap-section w-full bg-[#f4f4f4] transition-all duration-[1.2s] ease-[cubic-bezier(0.77,0,0.175,1)] flex flex-col justify-center overflow-hidden shadow-2xl relative z-20"
          style={{ height: stage >= 1 ? '50vh' : '0vh' }}
        >
          <div className="w-full -mt-12">
            <Hero />
          </div>
        </div>

        <div
          className={`flex flex-col transition-opacity duration-1000 ease-in-out ${
            stage >= 2 ? 'opacity-100' : 'opacity-0'
          }`}
        >
          {/* SECTION 1: Interactive Pipeline (400vh tall animation block) */}
          <div id="section-interactive-wrapper" className="page-snap-section w-full relative">
            <SectionInteractive />
          </div>
          
          {/* SECTION 2: CTA Footer */}
          <div className="page-snap-section w-full bg-[#0E0E0E] h-screen flex flex-col">
            <SectionCTA />
          </div>
        </div>

      </div>
    </>
  );
}