'use client';

import { useState, useEffect } from 'react';
import { TransformedDataPoint } from '../lib/dataTransform';

interface Ticker {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
}

interface StockHeaderProps {
  selectedTicker: string;
  onTickerChange: (ticker: string) => void;
  currentData: TransformedDataPoint | undefined;
  priceChange: number;
  priceChangePercent: number;
}

export default function StockHeader({
  selectedTicker,
  onTickerChange,
  currentData,
  priceChange,
  priceChangePercent
}: StockHeaderProps) {
  const [allTickers, setAllTickers] = useState<Ticker[]>([]);
  const [tickersLoading, setTickersLoading] = useState(false);

  // Fetch all tickers for dropdown
  const fetchAllTickers = async () => {
    try {
      setTickersLoading(true);
      const response = await fetch('/api/tickers?getAllTickers=true');
      const result = await response.json();
      
      if (result.success) {
        setAllTickers(result.data);
      } else {
        console.error('Failed to fetch tickers:', result.error);
      }
    } catch (err) {
      console.error('Error fetching tickers:', err);
    } finally {
      setTickersLoading(false);
    }
  };

  // Load tickers on mount
  useEffect(() => {
    fetchAllTickers();
  }, []);
  return (
    <div className="bg-white border-b border-gray-200">
      <div className="w-full max-w-none px-6 py-4">
        {/* Single Row: Company Info, Quick Stats, and Price */}
        <div className="flex items-center justify-between mb-5">
          {/* Left: Company Info */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-md">
              <span className="text-white font-bold text-lg tracking-tight">{selectedTicker}</span>
            </div>
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                  {selectedTicker || 'Loading...'}
                </h1>
                <select 
                  value={selectedTicker}
                  onChange={(e) => onTickerChange(e.target.value)}
                  className="text-base text-gray-600 bg-transparent border border-gray-300 rounded px-2 py-1 focus:outline-none cursor-pointer font-medium"
                >
                  {tickersLoading ? (
                    <option>Loading...</option>
                  ) : (
                    allTickers.map(ticker => (
                      <option key={ticker.ticker} value={ticker.ticker}>{ticker.ticker}</option>
                    ))
                  )}
                </select>
              </div>
              <p className="text-gray-500 text-sm font-medium">NASDAQ: {selectedTicker}</p>
            </div>
          </div>

          {/* Center: Quick Stats */}
          {currentData && (
            <div className="flex items-center gap-8">
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">Fair Value</div>
                <div className="text-sm font-bold text-gray-900">${currentData.fairValue?.toFixed(2) || '0.00'}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">P/E Ratio</div>
                <div className="text-sm font-bold text-gray-900">{currentData.peRatio?.toFixed(1) || '0.0'}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">Dividend</div>
                <div className="text-sm font-bold text-gray-900">${currentData.dividend?.toFixed(2) || '0.00'}</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">POR %</div>
                <div className="text-sm font-bold text-gray-900">{currentData.dividendsPOR?.toFixed(1) || '0.0'}%</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">EPS</div>
                <div className="text-sm font-bold text-gray-900">${currentData.earnings?.toFixed(2) || '0.00'}</div>
              </div>
            </div>
          )}
          
          {/* Right: Price Info */}
          {currentData && (
            <div className="text-right">
              <div className="text-3xl font-bold text-gray-900 mb-1 tracking-tight">
                ${currentData.stockPrice?.toFixed(2) || '0.00'}
              </div>
              <div className="flex items-center justify-end gap-2 mb-1">
                <span className={`text-lg font-bold ${priceChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}
                </span>
                <span className={`text-base font-semibold ${priceChange >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ({priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%)
                </span>
                <span className={`px-2 py-1 text-xs font-bold rounded-md ${
                  priceChange >= 0 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}>
                  {priceChange >= 0 ? '↗' : '↘'} Today
                </span>
              </div>
              <div className="text-xs text-gray-500 font-medium">
                Data from separate endpoints
              </div>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-8 border-b border-gray-200">
          <button className="pb-3 px-1 border-b-2 border-blue-600 text-blue-600 font-bold text-base">
            Summary
          </button>
          <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
            Chart
          </button>
          <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
            Statistics
          </button>
          <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
            Historical Data
          </button>
          <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
            Profile
          </button>
          <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
            Financials
          </button>
          <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
            Analysis
          </button>
        </div>
      </div>
    </div>
  );
}

