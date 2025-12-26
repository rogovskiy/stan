'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppNavigation from '../components/AppNavigation';
import PortfolioManager from '../components/PortfolioManager';

export default function PortfoliosPage() {
  const router = useRouter();
  const [selectedTicker, setSelectedTicker] = useState('AAPL'); // Default ticker for navigation

  const handleTickerChange = (ticker: string) => {
    setSelectedTicker(ticker);
    // Optionally navigate to that ticker's page
    // router.push(`/${ticker}/value`);
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation 
        selectedTicker={selectedTicker}
        onTickerChange={handleTickerChange}
      />
      
      <div className="w-full max-w-none px-6 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Portfolio Management</h1>
          <p className="text-sm text-gray-600 mt-2">
            Manage your investment portfolios and track positions with optional links to investment theses.
          </p>
        </div>
        
        <PortfolioManager />
      </div>
    </div>
  );
}


