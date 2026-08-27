import React, { useState, useRef, useEffect } from 'react';

export type Page = 'landing' | 'workspace' | 'invariance';

interface NavbarProps {
  onNavigate?: (page: Page) => void;
}

export default function Navbar({ onNavigate }: NavbarProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu if user clicks outside of it
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleNav = (page: Page) => {
    setIsMenuOpen(false);
    if (onNavigate) {
      onNavigate(page);
    }
  };

  return (
    <nav className="w-full flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shadow-sm relative z-[9999]">
      <button
        onClick={() => handleNav('workspace')}
        className="px-4 py-1.5 text-[10px] font-bold text-white bg-black rounded-sm tracking-wide hover:opacity-80 transition-opacity"
      >
        WORKSPACE
      </button>

      {/* Center section with logo and Hamburger */}
      <div className="flex items-center gap-3 relative" ref={menuRef}>
        <div
          className="w-6 h-6 bg-black rounded flex items-center justify-center cursor-pointer transition-transform hover:scale-105"
          onClick={() => handleNav('landing')}
        >
          <div className="w-3 h-3 rounded-full border border-white border-t-transparent animate-spin"></div>
        </div>
        <span
          className="font-bold tracking-widest text-xs text-black cursor-pointer"
          onClick={() => handleNav('landing')}
        >
          LUNAR TERRA
        </span>

        <div className="relative">
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="w-6 h-6 bg-black text-white flex items-center justify-center ml-1 text-xs rounded-sm hover:opacity-80 transition-opacity"
          >
            ≡
          </button>

          {/* Dropdown Menu */}
          {isMenuOpen && (
            <div className="absolute top-full mt-3 left-1/2 -translate-x-1/2 w-40 bg-white border border-gray-200 shadow-lg flex flex-col rounded-sm overflow-hidden z-[10000]">
              <button
                onClick={() => handleNav('landing')}
                className="text-center px-4 py-3 text-[11px] font-bold tracking-wider text-black border-b border-gray-100 hover:bg-gray-50 transition-colors"
              >
                HOME
              </button>
              <button
                onClick={() => handleNav('workspace')}
                className="text-center px-4 py-3 text-[11px] font-bold tracking-wider text-black border-b border-gray-100 hover:bg-gray-50 transition-colors"
              >
                WORKSPACE
              </button>
              <button
                onClick={() => handleNav('invariance')}
                className="text-center px-4 py-3 text-[11px] font-bold tracking-wider text-black hover:bg-gray-50 transition-colors"
              >
                INVARIANCE
              </button>
            </div>
          )}
        </div>
      </div>

      <button className="text-[10px] font-bold tracking-wide text-black hover:opacity-70 transition-opacity">
        LOGIN / SIGN UP
      </button>
    </nav>
  );
}
