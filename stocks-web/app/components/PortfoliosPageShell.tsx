'use client';

import { useState } from 'react';
import AppNavigation from './AppNavigation';
import PortfolioManager from './PortfolioManager';

export default function PortfoliosPageShell({
  portfolioIdFromRoute,
}: {
  portfolioIdFromRoute?: string;
}) {
  const [selectedTicker, setSelectedTicker] = useState('AAPL');

  const handleTickerChange = (ticker: string) => {
    setSelectedTicker(ticker);
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation selectedTicker={selectedTicker} onTickerChange={handleTickerChange} />

      <div className="w-full max-w-none px-6 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Portfolio Management</h1>
          <p className="text-sm text-gray-600 mt-2">
            Manage your investment portfolios and track positions with optional links to investment
            theses.
          </p>
        </div>

        <PortfolioManager portfolioIdFromRoute={portfolioIdFromRoute} />
      </div>
    </div>
  );
}
