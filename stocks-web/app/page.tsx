'use client';

import { useState, useEffect } from 'react';
import { transformApiDataForChart, TransformedDataPoint } from './lib/dataTransform';
import { DailyPriceResponse, QuarterlyDataResponse } from './types/api';
import StockAnalysisChart from './components/StockAnalysisChart';

// Types for API data
interface StockDataPoint {
  date: string;
  fyDate: string;
  year: number;
  estimated: boolean;
  frequency: 'daily' | 'quarterly';
  price?: number;
  eps?: number;
  fairValue?: number;
  normalPE?: number;
  dividendsPOR?: number;
}

interface Ticker {
  ticker: string;
  name: string;
  sector: string;
  exchange: string;
}

export default function Home() {
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [stockData, setStockData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('2y');
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

  // Fetch from separate endpoints
  const fetchStockData = async (ticker: string, selectedPeriod: string = period) => {
    setLoading(true);
    setError(null);
    try {
      console.log(`Fetching data separately for ${ticker}...`);
      
      // Fetch both daily and quarterly data in parallel
      const [dailyResponse, quarterlyResponse] = await Promise.all([
        fetch(`/api/daily-prices?ticker=${ticker}&period=${selectedPeriod}&refresh=false`),
        fetch(`/api/quarterly-timeseries?ticker=${ticker}&period=${selectedPeriod}&maxAge=24`)
      ]);
      
      if (!dailyResponse.ok) {
        throw new Error('Failed to fetch daily price data');
      }
      
      let quarterlyData: QuarterlyDataResponse | null = null;
      if (quarterlyResponse.ok) {
        quarterlyData = await quarterlyResponse.json();
      } else {
        console.warn('Quarterly data not available, continuing with daily data only');
      }
      
      const dailyData: DailyPriceResponse = await dailyResponse.json();
      
      console.log('Separate fetch results:', {
        dailyPoints: dailyData.data.length,
        quarterlyPoints: quarterlyData?.data.length || 0
      });
      
      // Transform using new separated function
      const transformedData = transformApiDataForChart(
        dailyData.data, 
        quarterlyData?.data || []
      );
      setStockData(transformedData);
      
    } catch (err) {
      console.error('Error fetching separated stock data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  // Load tickers and initial data on component mount
  useEffect(() => {
    fetchAllTickers();
  }, []);

  // Load data when ticker/period changes
  useEffect(() => {
    fetchStockData(selectedTicker, period);
  }, [selectedTicker, period]);

  // Handle ticker change
  const handleTickerChange = (ticker: string) => {
    setSelectedTicker(ticker);
  };

  // Handle period change
  const handlePeriodChange = (newPeriod: string) => {
    setPeriod(newPeriod);
  };

  // Get current stock info
  const currentData = stockData[stockData.length - 1];
  const previousData = stockData[stockData.length - 2];
  const priceChange = currentData && previousData ? currentData.stockPrice - previousData.stockPrice : 0;
  const priceChangePercent = currentData && previousData ? ((priceChange / previousData.stockPrice) * 100) : 0;

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      {/* Top Navigation Bar */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="w-full max-w-none px-6 py-2.5">
          <div className="flex items-center justify-between">
            {/* Logo/Brand */}
            <div className="flex items-center gap-3">
              <div className="text-lg font-bold text-blue-600 tracking-tight">StockAnalysis</div>
            </div>
            
            {/* Period Selection */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Period:</span>
              <select
                value={period}
                onChange={(e) => handlePeriodChange(e.target.value)}
                className="px-3 py-1 border border-gray-300 rounded-lg text-sm font-medium bg-white"
              >
                <option value="1y">1 Year</option>
                <option value="2y">2 Years</option>
                <option value="5y">5 Years</option>
              </select>
            </div>

            {/* User Actions */}
            <div className="flex items-center gap-3">
              <button 
                onClick={() => fetchStockData(selectedTicker, period)}
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 rounded-lg transition-colors"
              >
                {loading ? 'Loading...' : 'Refresh'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stock Header Section */}
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
                    onChange={(e) => handleTickerChange(e.target.value)}
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

      {/* Loading/Error States */}
      {loading && (
        <div className="w-full max-w-none px-6 py-8">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading stock data...</p>
          </div>
        </div>
      )}

      {error && (
        <div className="w-full max-w-none px-6 py-8">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
            <p className="text-red-800 font-medium">Error: {error}</p>
            <button 
              onClick={() => fetchStockData(selectedTicker, period)}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      {!loading && !error && stockData.length > 0 && (
        <div className="w-full max-w-none px-6 py-6">
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
            {/* Main Chart Area - 3/4 width */}
            <div className="xl:col-span-3 space-y-8">
              {/* Stock Analysis Chart Component */}
              <StockAnalysisChart stockData={stockData} />
            </div>

            {/* Right Sidebar - 1/4 width */}
            <div className="xl:col-span-1 space-y-6">
              {/* Statistics Card */}
              <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">Key Statistics</h3>
                {currentData ? (
                  <div className="space-y-5">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 font-semibold">Fair Value</span>
                      <span className="font-bold text-gray-900 text-lg">${currentData.fairValue?.toFixed(2) || '0.00'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 font-semibold">P/E Ratio</span>
                      <span className="font-bold text-gray-900 text-lg">{currentData.peRatio?.toFixed(1) || '0.0'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 font-semibold">EPS</span>
                      <span className="font-bold text-gray-900 text-lg">${currentData.earnings?.toFixed(2) || '0.00'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 font-semibold">Dividend</span>
                      <span className="font-bold text-gray-900 text-lg">${currentData.dividend?.toFixed(2) || '0.00'}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 font-semibold">POR %</span>
                      <span className="font-bold text-gray-900 text-lg">{currentData.dividendsPOR?.toFixed(1) || '0.0'}%</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-600 font-semibold">Est. Cap</span>
                      <span className="font-bold text-gray-900 text-lg">${currentData.marketCap?.toFixed(1) || '0.0'}B</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-gray-500">Loading...</div>
                )}
              </div>

              {/* Valuation Analysis Card */}
              <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">Valuation Analysis</h3>
                {currentData ? (
                  <div className="space-y-4">
                    {(() => {
                      const fairValue = currentData.fairValue || 0;
                      const currentPrice = currentData.stockPrice || 0;
                      const ratio = fairValue > 0 && currentPrice > 0 ? fairValue / currentPrice : 0;
                      const premium = ((currentPrice - fairValue) / fairValue) * 100;
                      
                      return (
                        <>
                          <div className="flex items-center gap-4">
                            <div className={`w-4 h-4 rounded-full ${
                              ratio > 1.15 ? 'bg-green-500' : 
                              ratio > 1.05 ? 'bg-blue-500' : 
                              ratio < 0.85 ? 'bg-red-500' : 'bg-yellow-500'
                            }`}></div>
                            <span className="text-gray-700 font-semibold">
                              {ratio > 1.15 ? 'Undervalued' : 
                               ratio > 1.05 ? 'Fair Value' : 
                               ratio < 0.85 ? 'Overvalued' : 'Neutral'}
                            </span>
                            <span className="ml-auto font-bold text-gray-900 text-lg">
                              {ratio > 0 ? `${(ratio * 100).toFixed(0)}%` : 'N/A'}
                            </span>
                          </div>
                          <div className="pt-4 border-t border-gray-200">
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-gray-600 font-semibold">Current Price</span>
                              <span className="font-bold text-gray-900">${currentPrice.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center mb-2">
                              <span className="text-gray-600 font-semibold">Fair Value</span>
                              <span className="font-bold text-gray-900">${fairValue.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-gray-600 font-semibold">Premium</span>
                              <span className={`font-bold ${premium > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                {premium > 0 ? '+' : ''}{premium.toFixed(1)}%
                              </span>
                            </div>
                          </div>
                        </>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="text-center text-gray-500">Loading...</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
