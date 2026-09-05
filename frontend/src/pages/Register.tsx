// pages/Register.tsx
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import logoImg from '../assets/logo.png'; 

export default function Register() {
  const navigate = useNavigate();
  
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ fullName?: string; email?: string; password?: string }>({});

  const validateForm = () => {
    const newErrors: typeof errors = {};
    if (!fullName.trim()) newErrors.fullName = 'Please enter your full name.';
    if (!email.trim()) newErrors.email = 'Please enter your email.';
    if (!password) newErrors.password = 'Please enter your password.';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setIsLoading(true);

    // Simulates auth delay, then navigates to workspace
    setTimeout(() => {
      setIsLoading(false);
      navigate('/workspace');
    }, 1200);
  };

  return (
    <div className="min-h-screen w-full flex bg-black text-white font-sans selection:bg-white selection:text-black">
      {/* Left Form Column */}
      <div className="w-full lg:w-[40%] flex flex-col justify-between p-8 sm:p-12 lg:p-16 relative z-10">
        
        {/* Header / Logo */}
        <button 
          onClick={() => navigate('/')}
          className="flex items-center gap-3 focus:outline-none focus-visible:ring-1 focus-visible:ring-white rounded-sm w-fit cursor-pointer"
        >
          <img src={logoImg} alt="Selenix" className="w-6 h-6 object-contain filter invert" />
          <span className="font-bold tracking-widest text-sm uppercase">Selenix</span>
        </button>

        {/* Form Container */}
        <div className="w-full max-w-sm mx-auto mt-12 lg:mt-0">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-8">Sign Up</h1>
          
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            <div>
              <label htmlFor="fullName" className="block text-xs font-medium text-gray-400 mb-2">
                Full Name
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
                    <circle cx="12" cy="7" r="4"></circle>
                  </svg>
                </span>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  disabled={isLoading}
                  onChange={(e) => {
                    setFullName(e.target.value);
                    if (errors.fullName) setErrors((prev) => ({ ...prev, fullName: undefined }));
                  }}
                  className={`w-full bg-transparent border rounded-md py-3.5 pl-11 pr-4 text-sm transition-colors focus:outline-none focus:border-white ${
                    errors.fullName ? 'border-gray-500' : 'border-gray-800'
                  }`}
                  placeholder="Commander Shepard"
                />
              </div>
              {errors.fullName && <p className="text-[11px] mt-1.5 text-gray-400">{errors.fullName}</p>}
            </div>

            <div>
              <label htmlFor="email" className="block text-xs font-medium text-gray-400 mb-2">
                Email
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="20" height="16" x="2" y="4" rx="2"></rect>
                    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path>
                  </svg>
                </span>
                <input
                  id="email"
                  type="email"
                  value={email}
                  disabled={isLoading}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }));
                  }}
                  className={`w-full bg-transparent border rounded-md py-3.5 pl-11 pr-4 text-sm transition-colors focus:outline-none focus:border-white ${
                    errors.email ? 'border-gray-500' : 'border-gray-800'
                  }`}
                  placeholder="operator@selenix.space"
                />
              </div>
              {errors.email && <p className="text-[11px] mt-1.5 text-gray-400">{errors.email}</p>}
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-medium text-gray-400 mb-2">
                Password
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect width="18" height="11" x="3" y="11" rx="2" ry="2"></rect>
                    <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                  </svg>
                </span>
                <input
                  id="password"
                  type="password"
                  value={password}
                  disabled={isLoading}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
                  }}
                  className={`w-full bg-transparent border rounded-md py-3.5 pl-11 pr-4 text-sm transition-colors focus:outline-none focus:border-white ${
                    errors.password ? 'border-gray-500' : 'border-gray-800'
                  }`}
                  placeholder="••••••••"
                />
              </div>
              {errors.password && <p className="text-[11px] mt-1.5 text-gray-400">{errors.password}</p>}
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-white text-black font-semibold py-3.5 rounded-md text-sm transition-opacity hover:opacity-90 active:opacity-100 disabled:opacity-50 mt-4 flex justify-center items-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <div className="w-4 h-4 rounded-full border-2 border-black border-t-transparent animate-spin" />
              ) : (
                'SIGN UP'
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-12 text-sm text-gray-500">
          Already have an account?{' '}
          <button 
            onClick={() => navigate('/login')}
            className="text-white font-medium ml-1 hover:underline focus:outline-none cursor-pointer"
          >
            Sign in
          </button>
        </div>
      </div>

      {/* Right Image Column */}
      <div className="hidden lg:block w-[60%] relative overflow-hidden bg-[#111]">
        <img 
          src="https://images.unsplash.com/photo-1522030299830-16b8d3d049fe?q=80&w=2000&auto=format&fit=crop" 
          alt="Lunar Surface" 
          className="absolute inset-0 w-full h-full object-cover opacity-60 grayscale mix-blend-luminosity"
        />
        {/* Subtle overlay gradient */}
        <div className="absolute inset-0 bg-gradient-to-r from-black via-transparent to-transparent opacity-80" />
        
        {/* Overlay Text */}
        <div className="absolute inset-0 flex items-center justify-center p-20">
          <div className="max-w-md">
            <h2 className="text-2xl font-light text-white leading-relaxed mb-6">
              A new way to experience lunar correspondence in the infinite spatial domain.
            </h2>
            <button className="text-[10px] tracking-[0.2em] uppercase font-bold text-gray-300 border-b border-gray-600 pb-1 hover:text-white hover:border-white transition-colors focus:outline-none cursor-pointer">
              Learn More
            </button>
          </div>
        </div>

        {/* Carousel Indicators Dummy */}
        <div className="absolute bottom-12 right-12 flex items-center gap-6">
          <div className="flex gap-2">
            <div className="w-8 h-px bg-white"></div>
            <div className="w-8 h-px bg-gray-600"></div>
            <div className="w-8 h-px bg-gray-600"></div>
          </div>
          <div className="flex gap-4">
            <button className="text-gray-400 hover:text-white transition-colors focus:outline-none cursor-pointer">‹</button>
            <button className="text-gray-400 hover:text-white transition-colors focus:outline-none cursor-pointer">›</button>
          </div>
        </div>
      </div>
    </div>
  );
}