import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import logoImg from '../assets/logo.png';
import { useTheme } from '../workspace_components/useTheme';

export default function Login() {
  const navigate = useNavigate();
  const [theme, toggleTheme] = useTheme();
  const isDark = theme === 'dark';
  // This page branches on the `isDark` boolean throughout rather than
  // Tailwind's `dark:` pseudo-variant, so focus rings need the same
  // manual branching to stay black/white-themed in both modes.
  const ring = isDark ? 'white' : '[#0E0E0E]';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [isLoading, setIsLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const validateForm = () => {
    const newErrors: { email?: string; password?: string } = {};

    if (!email.trim()) {
      newErrors.email = 'Please enter your email.';
    }

    if (!password) {
      newErrors.password = 'Please enter your password.';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setInfoMessage(null);

    if (!validateForm()) {
      return;
    }

    setIsLoading(true);

    // Frontend-only simulated authentication flow
    setTimeout(() => {
      setIsLoading(false);
      navigate('/workspace/step/0');
    }, 850);
  };

  const handleForgotPassword = (e: React.MouseEvent) => {
    e.preventDefault();
    setInfoMessage('Password reset is managed by your mission ground-control administrator.');
  };

  return (
    <div
      className={`min-h-screen w-full flex flex-col justify-between relative overflow-hidden font-sans transition-colors duration-300 select-none ${
        isDark ? 'dark bg-[#0a0b0f] text-white' : 'bg-[#f4f6f9] text-gray-900'
      }`}
    >
      {/* Background ambient technical grid */}
      <div
        className={`absolute inset-0 pointer-events-none transition-opacity duration-300 ${
          isDark ? 'opacity-20' : 'opacity-40'
        }`}
        style={{
          backgroundImage: isDark
            ? `
                linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(255, 255, 255, 0.05) 1px, transparent 1px)
              `
            : `
                linear-gradient(to right, rgba(0, 0, 0, 0.05) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(0, 0, 0, 0.05) 1px, transparent 1px)
              `,
          backgroundSize: '48px 48px',
        }}
      />

      {/* Subtle radial glow */}
      <div
        className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] rounded-full pointer-events-none transition-all duration-300 ${
          isDark
            ? 'bg-white/[0.03] blur-3xl'
            : 'bg-[#0E0E0E]/[0.04] blur-3xl'
        }`}
      />

      {/* Top telemetry bar */}
      <header
        className={`w-full px-6 py-4 flex items-center justify-between border-b z-10 backdrop-blur-sm transition-colors duration-300 ${
          isDark
            ? 'bg-[#0a0b0f]/80 border-white/10'
            : 'bg-white/80 border-[#0E0E0E]/15 shadow-xs'
        }`}
      >
        <Link
          to="/"
          className={`flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-${ring} rounded-sm`}
          aria-label="Return to Selenix Home"
        >
          <div
            className={`w-7 h-7 rounded flex items-center justify-center border transition-colors ${
              isDark
                ? 'bg-white/10 border-white/30 group-hover:border-white'
                : 'bg-[#0E0E0E]/10 border-[#0E0E0E]/30 group-hover:border-[#0E0E0E]'
            }`}
          >
            <img src={logoImg} alt="Selenix Logo" className="w-4 h-4 object-contain" />
          </div>
          <div>
            <span
              className={`font-bold tracking-widest text-xs block ${
                isDark ? 'text-white' : 'text-gray-900'
              }`}
            >
              SELENIX
            </span>
            <span
              className={`text-[9px] font-mono tracking-widest uppercase block ${
                isDark ? 'text-white' : 'text-[#0E0E0E]'
              }`}
            >
              LUNAR CORRESPONDENCE
            </span>
          </div>
        </Link>

        {/* Top right: Telemetry and Theme Switcher */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="hidden sm:flex items-center gap-4 text-[10px] font-mono uppercase tracking-widest text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              SECURE PORTAL
            </span>
            <span className={isDark ? 'text-white/20' : 'text-gray-300'}>|</span>
            <span>NODE: 0x4F-CH2</span>
          </div>

          {/* Accessible Light/Dark Theme Switcher Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-sm border text-[10px] font-mono uppercase tracking-wider transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-${ring} ${
              isDark
                ? 'bg-white/5 border-white/10 text-gray-300 hover:bg-white/10 hover:text-white'
                : 'bg-gray-100 border-gray-300 text-gray-700 hover:bg-gray-200 hover:text-gray-900'
            }`}
          >
            {isDark ? (
              <>
                <svg
                  className="w-3.5 h-3.5 text-white shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
                  />
                </svg>
                <span className="hidden xs:inline">LIGHT</span>
              </>
            ) : (
              <>
                <svg
                  className="w-3.5 h-3.5 text-[#0E0E0E] shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
                  />
                </svg>
                <span className="hidden xs:inline">DARK</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Login Card Container */}
      <main className="flex-1 flex items-center justify-center px-4 py-10 z-10">
        <div className="w-full max-w-md relative">
          {/* Technical corner accents */}
          <div
            className={`absolute -top-2 -left-2 w-3 h-3 border-t-2 border-l-2 pointer-events-none transition-colors ${
              isDark ? 'border-white/60' : 'border-[#0E0E0E]/70'
            }`}
          />
          <div
            className={`absolute -top-2 -right-2 w-3 h-3 border-t-2 border-r-2 pointer-events-none transition-colors ${
              isDark ? 'border-white/60' : 'border-[#0E0E0E]/70'
            }`}
          />
          <div
            className={`absolute -bottom-2 -left-2 w-3 h-3 border-b-2 border-l-2 pointer-events-none transition-colors ${
              isDark ? 'border-white/60' : 'border-[#0E0E0E]/70'
            }`}
          />
          <div
            className={`absolute -bottom-2 -right-2 w-3 h-3 border-b-2 border-r-2 pointer-events-none transition-colors ${
              isDark ? 'border-white/60' : 'border-[#0E0E0E]/70'
            }`}
          />

          {/* Card body */}
          <div
            className={`border backdrop-blur-md rounded-sm p-6 sm:p-8 shadow-2xl relative transition-all duration-300 ${
              isDark
                ? 'bg-[#111318]/90 border-white/15 shadow-black/40'
                : 'bg-white border-[#0E0E0E]/15 shadow-gray-300/40'
            }`}
          >
            {/* Mission Identifier Header */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span
                  className={`text-[10px] font-mono uppercase tracking-widest font-semibold ${
                    isDark ? 'text-white' : 'text-[#0E0E0E]'
                  }`}
                >
                  SELENIX // ACCESS
                </span>
                <span
                  className={`text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-xs border ${
                    isDark
                      ? 'text-gray-400 bg-white/[0.04] border-white/10'
                      : 'text-gray-600 bg-gray-100 border-[#0E0E0E]/15'
                  }`}
                >
                  SYS: ACTIVE
                </span>
              </div>
              <h1
                className={`text-2xl sm:text-3xl font-medium tracking-tight ${
                  isDark ? 'text-white' : 'text-gray-900'
                }`}
              >
                Welcome back
              </h1>
              <p
                className={`text-xs mt-1.5 leading-relaxed ${
                  isDark ? 'text-gray-400' : 'text-gray-600'
                }`}
              >
                Sign in to access the Selenix lunar image correspondence system.
              </p>
            </div>

            {/* Informational notification banner if triggered */}
            {infoMessage && (
              <div
                role="status"
                aria-live="polite"
                className={`mb-5 p-3 text-xs rounded-sm flex items-start gap-2.5 border ${
                  isDark
                    ? 'bg-white/10 border-white/30 text-gray-100'
                    : 'bg-gray-100 border-gray-300 text-gray-900'
                }`}
              >
                <svg
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    isDark ? 'text-white' : 'text-[#0E0E0E]'
                  }`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span>{infoMessage}</span>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              {/* Email / Username Field */}
              <div>
                <label
                  htmlFor="email"
                  className={`block text-[10px] font-bold tracking-widest uppercase mb-1.5 ${
                    isDark ? 'text-gray-400' : 'text-gray-700'
                  }`}
                >
                  Email / Username
                </label>
                <div className="relative">
                  <input
                    id="email"
                    name="email"
                    type="text"
                    autoComplete="username"
                    value={email}
                    disabled={isLoading}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (errors.email) {
                        setErrors((prev) => ({ ...prev, email: undefined }));
                      }
                    }}
                    placeholder="operator@isro.gov.in"
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? 'email-error' : undefined}
                    className={`w-full border rounded-sm px-3 py-2.5 text-xs font-mono transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-${ring} ${
                      isDark
                        ? `bg-white/[0.03] text-gray-200 placeholder-gray-600 ${
                            errors.email
                              ? 'border-red-500/80 focus:border-red-400'
                              : 'border-white/15 focus:border-white/50'
                          }`
                        : `bg-gray-50/80 text-gray-900 placeholder-gray-400 ${
                            errors.email
                              ? 'border-red-500 focus:border-red-600'
                              : 'border-gray-300 focus:border-[#0E0E0E] focus:bg-white'
                          }`
                    }`}
                  />
                </div>
                {errors.email && (
                  <p
                    id="email-error"
                    role="alert"
                    className={`text-[11px] mt-1.5 flex items-center gap-1.5 font-mono ${
                      isDark ? 'text-red-400' : 'text-red-600'
                    }`}
                  >
                    <span className="w-1 h-1 rounded-full bg-red-500 shrink-0" />
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="password"
                    className={`text-[10px] font-bold tracking-widest uppercase ${
                      isDark ? 'text-gray-400' : 'text-gray-700'
                    }`}
                  >
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className={`text-[10px] font-mono transition-colors focus:outline-none focus-visible:underline ${
                      isDark
                        ? 'text-white hover:text-gray-300'
                        : 'text-[#0E0E0E] hover:text-black/70'
                    }`}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    disabled={isLoading}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      if (errors.password) {
                        setErrors((prev) => ({ ...prev, password: undefined }));
                      }
                    }}
                    placeholder="••••••••••••"
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={errors.password ? 'password-error' : undefined}
                    className={`w-full border rounded-sm px-3 py-2.5 pr-10 text-xs font-mono transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-${ring} ${
                      isDark
                        ? `bg-white/[0.03] text-gray-200 placeholder-gray-600 ${
                            errors.password
                              ? 'border-red-500/80 focus:border-red-400'
                              : 'border-white/15 focus:border-white/50'
                          }`
                        : `bg-gray-50/80 text-gray-900 placeholder-gray-400 ${
                            errors.password
                              ? 'border-red-500 focus:border-red-600'
                              : 'border-gray-300 focus:border-[#0E0E0E] focus:bg-white'
                          }`
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded focus:outline-none focus-visible:ring-1 focus-visible:ring-${ring} ${
                      isDark
                        ? 'text-gray-400 hover:text-gray-200'
                        : 'text-gray-500 hover:text-gray-800'
                    }`}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l18 18"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                        />
                      </svg>
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p
                    id="password-error"
                    role="alert"
                    className={`text-[11px] mt-1.5 flex items-center gap-1.5 font-mono ${
                      isDark ? 'text-red-400' : 'text-red-600'
                    }`}
                  >
                    <span className="w-1 h-1 rounded-full bg-red-500 shrink-0" />
                    {errors.password}
                  </p>
                )}
              </div>

              {/* Remember me option */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    disabled={isLoading}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className={`w-3.5 h-3.5 rounded-xs focus:ring-1 focus:ring-${ring} focus:ring-offset-0 focus:outline-none ${
                      isDark
                        ? 'border-white/20 bg-white/[0.05] checked:bg-white text-white'
                        : 'border-gray-300 bg-gray-50 checked:bg-[#0E0E0E] text-[#0E0E0E]'
                    }`}
                  />
                  <span
                    className={`text-xs ${
                      isDark ? 'text-gray-400 hover:text-gray-300' : 'text-gray-600 hover:text-gray-800'
                    }`}
                  >
                    Remember this session
                  </span>
                </label>
              </div>

              {/* Primary Sign In Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isLoading}
                  className={`w-full py-3 px-4 text-xs font-bold tracking-wider uppercase rounded-sm transition-all duration-150 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-${ring} disabled:opacity-50 disabled:cursor-not-allowed ${
                    isDark
                      ? 'bg-white text-black hover:bg-white/90 active:bg-white/80'
                      : 'bg-[#0E0E0E] text-white hover:opacity-90 active:opacity-80'
                  }`}
                >
                  {isLoading ? (
                    <>
                      <div
                        className={`w-3.5 h-3.5 rounded-full border-2 border-t-transparent animate-spin ${
                          isDark ? 'border-black' : 'border-white'
                        }`}
                      />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <span>Sign In</span>
                  )}
                </button>
              </div>
            </form>

            {/* Back to Home / Navigation footer */}
            <div
              className={`mt-6 pt-4 border-t text-center ${
                isDark ? 'border-white/10' : 'border-[#0E0E0E]/15'
              }`}
            >
              <Link
                to="/"
                className={`text-xs font-mono transition-colors inline-flex items-center gap-1.5 ${
                  isDark
                    ? 'text-gray-500 hover:text-gray-300'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <span>←</span> Back to Selenix Home
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* Bottom mission status bar */}
      <footer
        className={`w-full px-6 py-3 border-t z-10 backdrop-blur-sm flex flex-col sm:flex-row items-center justify-between gap-2 text-[10px] font-mono transition-colors duration-300 ${
          isDark
            ? 'bg-[#0a0b0f]/80 border-white/10 text-gray-500'
            : 'bg-white/80 border-[#0E0E0E]/15 text-gray-600 shadow-xs'
        }`}
      >
        <div className="flex items-center gap-3">
          <span>MISSION: CHANDRAYAAN-2 ↔ LRO NAC</span>
          <span className={isDark ? 'text-white/10' : 'text-gray-300'}>•</span>
          <span>LAT/LON VERIFIED</span>
        </div>
        <div>
          <span>ISRO PS // MULTI-MODAL INVARIANCE</span>
        </div>
      </footer>
    </div>
  );
}
