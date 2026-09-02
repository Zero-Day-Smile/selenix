import { useEffect, useState } from 'react';
import Navbar, { type Page } from '../landing_components/Navbar';
import Hero from '../landing_components/Hero';
import SectionInteractive from '../landing_components/SectionInteractive';
import SectionCTA from '../landing_components/SectionCTA';

// IMPORT ASSETS DIRECTLY
import landingVideo from '../assets/landing.mp4';

// ADD PROPS HERE
interface LandingProps {
  onNavigate?: (page: Page) => void;
}

export default function Landing({ onNavigate }: LandingProps) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 800);
    const t2 = setTimeout(() => setStage(2), 2200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
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

      <div className="relative z-10 w-full flex flex-col font-sans text-white">
        
        <div
          className="fixed top-0 w-full z-50 transition-transform duration-1000 ease-[cubic-bezier(0.77,0,0.175,1)]"
          style={{ transform: stage >= 1 ? 'translateY(0)' : 'translateY(-100%)' }}
        >
          {/* PASS PROP TO NAVBAR */}
          <Navbar onNavigate={onNavigate} />
        </div>

        <div
          className="w-full bg-[#f4f4f4] transition-all duration-[1.2s] ease-[cubic-bezier(0.77,0,0.175,1)] flex flex-col justify-center overflow-hidden shadow-2xl relative z-20"
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
          <SectionInteractive />
          
          <div className="w-full bg-[#0E0E0E] h-screen flex flex-col">
            <SectionCTA />
          </div>
        </div>

      </div>
    </>
  );
}