'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/app/lib/authContext';
import TickerSearch from './TickerSearch';

interface AppNavigationProps {
  selectedTicker: string;
  onTickerChange: (ticker: string) => void;
}

export default function AppNavigation({ selectedTicker, onTickerChange }: AppNavigationProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = async () => {
    try {
      await logout();
      router.push('/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isMenuOpen]);

  return (
    <div className="bg-white border-b border-gray-200 shadow-sm">
      <div className="w-full max-w-none px-6 py-3">
        <div className="flex items-center justify-between gap-6">
          {/* Left side: Logo, Search, Navigation */}
          <div className="flex items-center gap-6 flex-1">
            {/* Logo/Brand */}
            <div className="flex-shrink-0">
              <div className="text-lg font-bold text-blue-600 tracking-tight">StockAnalysis</div>
            </div>
            {/* Ticker Search Bar */}
            <div className="flex-1 max-w-md">
              <TickerSearch 
                selectedTicker={selectedTicker}
                onTickerChange={onTickerChange}
              />
            </div>
            {/* Navigation Items */}
            <nav className="flex items-center gap-6 flex-shrink-0">
              <Link
                href={`/${selectedTicker}/value`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${selectedTicker}/value`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                Value
              </Link>
              <Link
                href={`/${selectedTicker}/kpi`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${selectedTicker}/kpi`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                KPI
              </Link>
              <Link
                href={`/${selectedTicker}/kpi-match`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${selectedTicker}/kpi-match`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                KPI Match
              </Link>
              <Link
                href={`/${selectedTicker}/documents`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${selectedTicker}/documents`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                Documents
              </Link>
              <Link
                href={`/${selectedTicker}/quarterly-analysis`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${selectedTicker}/quarterly-analysis`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                Analysis
              </Link>
            </nav>
          </div>
          {/* Right side: User Menu with Logout */}
          {user && (
            <div className="relative flex-shrink-0" ref={menuRef}>
              <button
                onClick={() => setIsMenuOpen(!isMenuOpen)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
              >
                {user.photoURL && (
                  <img
                    src={user.photoURL}
                    alt={user.displayName || 'User'}
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <span className="text-sm text-gray-700 font-medium">
                  {user.displayName || user.email}
                </span>
                <svg
                  className={`w-4 h-4 text-gray-500 transition-transform ${
                    isMenuOpen ? 'rotate-180' : ''
                  }`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
              </button>
              {isMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">
                      {user.displayName || 'User'}
                    </p>
                    <p className="text-xs text-gray-500 truncate">
                      {user.email}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}





