'use client';

import { useState, useEffect } from 'react';
import AnalystDataCard from './AnalystDataCard';

interface SidebarCurrentData {
  stockPrice: number | null;
  fairValue: number | null;
  peRatio: number | null;
  earnings: number | null;
  dividend: number | null;
  dividendsPOR: number | null;
  marketCap: number | null;
}

interface StockSidebarProps {
  selectedTicker: string;
  currentData: SidebarCurrentData | undefined;
  growthRate: number | null;
  normalPERatio: number | null;
  fairValueRatio: number;
  priceChange: number;
  priceChangePercent: number;
}

export default function StockSidebar({ 
  selectedTicker,
  currentData, 
  growthRate, 
  normalPERatio, 
  fairValueRatio,
  priceChange,
  priceChangePercent
}: StockSidebarProps) {
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [exchange, setExchange] = useState<string | null>(null);

  // Fetch company name when ticker changes
  useEffect(() => {
    const fetchCompanyInfo = async () => {
      if (!selectedTicker) {
        setCompanyName(null);
        setExchange(null);
        return;
      }

      try {
        const response = await fetch(`/api/tickers?ticker=${selectedTicker}`);
        const result = await response.json();
        
        if (result.success && result.data) {
          setCompanyName(result.data.name || null);
          setExchange(result.data.exchange || null);
        } else {
          setCompanyName(null);
          setExchange(null);
        }
      } catch (err) {
        console.error('Error fetching company info:', err);
        setCompanyName(null);
        setExchange(null);
      }
    };

    fetchCompanyInfo();
  }, [selectedTicker]);

  return (
    <div className="space-y-6">
      {/* Integrated Header with Ratios - Sharp Modern Design */}
      <div className="bg-gradient-to-br from-white to-gray-50 rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
        {/* Company Info & Price Section */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-200">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight mb-1">
                {companyName || selectedTicker || 'Loading...'}
              </h1>
              <p className="text-gray-500 text-sm font-medium mb-2">
                {exchange ? `${exchange}: ` : ''}{selectedTicker}
              </p>
              {/* Market Cap, P/E, and Dividend */}
              {currentData && (
                <div className="flex items-center gap-4 text-xs text-gray-600">
                  {currentData.marketCap && (
                    <span>
                      <span className="font-semibold">Market Cap:</span> ${currentData.marketCap.toFixed(1)}B
                    </span>
                  )}
                  {currentData.peRatio !== null && currentData.peRatio !== undefined && (
                    <span>
                      <span className="font-semibold">P/E:</span> {currentData.peRatio.toFixed(1)}
                    </span>
                  )}
                  {currentData.dividendsPOR !== null && currentData.dividendsPOR !== undefined && (
                    <span>
                      <span className="font-semibold">Dividend:</span> {currentData.dividendsPOR.toFixed(1)}%
                    </span>
                  )}
                </div>
              )}
            </div>
            
            {/* Price Display - Right aligned, less prominent */}
            {currentData && (
              <div className="text-right ml-4">
                <div className="text-lg font-semibold text-gray-700 tracking-tight mb-1">
                  ${currentData.stockPrice?.toFixed(2) || '0.00'}
                </div>
                <div className="flex items-center justify-end gap-1.5 flex-wrap">
                  <span className={`text-xs font-medium ${priceChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}
                  </span>
                  <span className={`text-xs font-medium ${priceChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    ({priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%)
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Ratios Grid - Integrated */}
        {currentData && (
          <div className="px-6 py-5">
            <div className="grid grid-cols-3 gap-3">
              {/* Growth Rate */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide text-center">Growth</div>
                <div className={`text-xl font-bold text-center ${
                  growthRate !== null && growthRate >= 0 
                    ? 'text-green-600' 
                    : growthRate !== null 
                    ? 'text-red-600'
                    : 'text-gray-400'
                }`}>
                  {growthRate !== null ? `${growthRate.toFixed(1)}%` : 'N/A'}
                </div>
              </div>

              {/* Fair Value Ratio */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide text-center">Fair Value</div>
                <div className="text-xl font-bold text-center text-orange-600">
                  {fairValueRatio.toFixed(1)}x
                </div>
              </div>

              {/* Normal P/E Ratio */}
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wide text-center">Normal P/E</div>
                <div className="text-xl font-bold text-center text-blue-600">
                  {normalPERatio !== null ? `${normalPERatio.toFixed(1)}x` : 'N/A'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Valuation & Analyst Predictions - Combined Card */}
      <AnalystDataCard ticker={selectedTicker} currentPrice={currentData?.stockPrice} currentData={currentData} />
    </div>
  );
}

