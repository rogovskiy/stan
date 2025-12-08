'use client';

import { useState, useEffect } from 'react';
import AnalystDataCard from './AnalystDataCard';
import CompanyInfoCard from './CompanyInfoCard';

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
  const [companySummary, setCompanySummary] = useState<string | null>(null);

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

  // Fetch company summary when ticker changes
  useEffect(() => {
    const fetchCompanySummary = async () => {
      if (!selectedTicker) {
        setCompanySummary(null);
        return;
      }

      try {
        const response = await fetch(`/api/company-summary?ticker=${selectedTicker}`);
        const result = await response.json();
        
        if (result.success && result.data && result.data.summary) {
          setCompanySummary(result.data.summary);
        } else {
          setCompanySummary(null);
        }
      } catch (err) {
        console.error('Error fetching company summary:', err);
        setCompanySummary(null);
      }
    };

    fetchCompanySummary();
  }, [selectedTicker]);

  return (
    <div className="space-y-6">
      {/* Company Info Card - Reusable Component */}
      <CompanyInfoCard 
        ticker={selectedTicker} 
        showPrice={true}
        stockPrice={currentData?.stockPrice}
        priceChange={priceChange}
        priceChangePercent={priceChangePercent}
        marketCap={currentData?.marketCap}
        peRatio={currentData?.peRatio}
        dividend={currentData?.dividendsPOR}
      />
      
      {/* Integrated Ratios Section */}
      <div className="bg-gradient-to-br from-white to-gray-50 rounded-2xl shadow-xl border border-gray-200 overflow-hidden">

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

