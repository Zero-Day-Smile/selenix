import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export type Page = 'landing' | 'workspace' | 'invariance' | 'registration-attempt';

interface NavbarProps {
  onNavigate?: (page: Page) => void;
  // Dark variant for the workspace (Idea 1: match the landing page's
  // cinematic mood) -- the landing page itself keeps its own light Navbar
  // unchanged (dark=false, the default) since that's real, already-shipped
  // behavior this change isn't meant to touch.
  dark?: boolean;
  // Only present when this Navbar is rendered inside the workspace (which
  // owns the actual light/dark toggle state) -- the landing page's Navbar
  // doesn't pass these and simply shows no toggle button.
  theme?: 'light' | 'dark';
  onToggleTheme?: () => void;
}

export default function Navbar({ onNavigate, dark = false, theme, onToggleTheme }: NavbarProps) {
  const navigate = useNavigate();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

  // Close menu on Escape key press & return focus to toggle button
  useEffect(() => {
    if (!isMenuOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsMenuOpen(false);
        toggleButtonRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen]);

  // Focus first menu button when dropdown opens
  useEffect(() => {
    if (isMenuOpen) {
      const firstBtn = dropdownRef.current?.querySelector('button');
      firstBtn?.focus();
    }
  }, [isMenuOpen]);

  const handleNav = (page: Page) => {
    setIsMenuOpen(false);
    if (page === 'landing') navigate('/');
    else if (page === 'workspace') navigate('/workspace/step/0');
    else if (page === 'invariance') navigate('/invariance');
    else if (page === 'registration-attempt') navigate('/registration-attempt');
    if (onNavigate) {
      onNavigate(page);
    }
  };

  return (
    <nav
      className={`w-full flex items-center justify-between px-6 py-3 shadow-sm relative z-[9999] ${
        dark ? 'bg-[#0a0b0f]/90 backdrop-blur-md border-b border-white/10' : 'bg-white border-b border-gray-200'
      }`}
    >
      <button
        onClick={() => handleNav('workspace')}
        className={`px-4 py-1.5 text-[10px] font-bold rounded-sm tracking-wide hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
          dark ? 'text-black bg-cyan-400' : 'text-white bg-black'
        }`}
      >
        WORKSPACE
      </button>

      {/* Center section with logo and Hamburger */}
      <div className="flex items-center gap-3 relative" ref={menuRef}>
        <button
          onClick={() => handleNav('landing')}
          aria-label="Lunar Terra Home"
          className="flex items-center gap-2 group focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded-sm p-1"
        >
          <div
            className={`w-6 h-6 rounded flex items-center justify-center transition-transform group-hover:scale-105 ${dark ? 'bg-cyan-400' : 'bg-black'}`}
          >
            <div className={`w-3 h-3 rounded-full border border-t-transparent animate-spin ${dark ? 'border-black' : 'border-white'}`}></div>
          </div>
          <span
            className={`font-bold tracking-widest text-xs ${dark ? 'text-white' : 'text-black'}`}
          >
            LUNAR TERRA
          </span>
        </button>

        <div className="relative">
          <button
            ref={toggleButtonRef}
            aria-label="Toggle navigation menu"
            aria-expanded={isMenuOpen}
            aria-controls="nav-dropdown-menu"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className={`w-6 h-6 flex items-center justify-center ml-1 text-xs rounded-sm hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              dark ? 'bg-cyan-400 text-black' : 'bg-black text-white'
            }`}
          >
            ≡
          </button>

          {/* Dropdown Menu */}
          {isMenuOpen && (
            <div
              ref={dropdownRef}
              id="nav-dropdown-menu"
              role="menu"
              className={`absolute top-full mt-3 left-1/2 -translate-x-1/2 w-40 shadow-lg flex flex-col rounded-sm overflow-hidden z-[10000] ${
                dark ? 'bg-[#111318] border border-white/10' : 'bg-white border border-gray-200'
              }`}
            >
              <button
                role="menuitem"
                onClick={() => handleNav('landing')}
                className={`text-center px-4 py-3 text-[11px] font-bold tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  dark ? 'text-gray-200 border-b border-white/10 hover:bg-white/5' : 'text-black border-b border-gray-100 hover:bg-gray-50'
                }`}
              >
                HOME
              </button>
              <button
                role="menuitem"
                onClick={() => handleNav('workspace')}
                className={`text-center px-4 py-3 text-[11px] font-bold tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  dark ? 'text-gray-200 border-b border-white/10 hover:bg-white/5' : 'text-black border-b border-gray-100 hover:bg-gray-50'
                }`}
              >
                WORKSPACE
              </button>
              <button
                role="menuitem"
                onClick={() => handleNav('invariance')}
                className={`text-center px-4 py-3 text-[11px] font-bold tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  dark ? 'text-gray-200 border-b border-white/10 hover:bg-white/5' : 'text-black border-b border-gray-100 hover:bg-gray-50'
                }`}
              >
                INVARIANCE
              </button>
              <button
                role="menuitem"
                onClick={() => handleNav('registration-attempt')}
                className={`text-center px-4 py-3 text-[11px] font-bold tracking-wider transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                  dark ? 'text-gray-200 hover:bg-white/5' : 'text-black hover:bg-gray-50'
                }`}
              >
                REGISTRATION ATTEMPT
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3">
        {onToggleTheme && (
          <button
            onClick={onToggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`w-6 h-6 flex items-center justify-center rounded-sm text-xs transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
              dark ? 'bg-white/10 text-gray-200 hover:bg-white/20' : 'bg-black/5 text-black hover:bg-black/10'
            }`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        )}
        <button
          onClick={() => navigate('/login')}
          className={`text-[10px] font-bold tracking-wide hover:opacity-70 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${dark ? 'text-gray-300' : 'text-black'}`}
        >
          LOGIN / SIGN UP
        </button>
      </div>
    </nav>
  );
}
