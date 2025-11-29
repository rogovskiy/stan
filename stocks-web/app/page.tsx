'use client';

import { useState, useEffect, useMemo } from 'react';
import { transformApiDataForChart, TransformedDataPoint } from './lib/dataTransform';
import { calculateNormalPERatio, calculateGrowthRate } from './lib/calculations';
import { DailyPriceResponse, QuarterlyDataResponse } from './types/api';
import StockAnalysisChart from './components/StockAnalysisChart';
import PeriodSelector from './components/PeriodSelector';
import StockSidebar from './components/StockSidebar';
import StockHeader from './components/StockHeader';

export default function Home() {
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [stockData, setStockData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('8y');

  // Fetch stock data
  const fetchStockData = async (ticker: string, selectedPeriod: string = period) => {
    console.log(`Page: fetchStockData called with ticker=${ticker}, selectedPeriod=${selectedPeriod}`);
    setLoading(true);
    setError(null);
    
    try {
      console.log(`Page: Making API calls for ${ticker} with period ${selectedPeriod}`);
      // Fetch both daily and quarterly data in parallel
      const [dailyResponse, quarterlyResponse] = await Promise.all([
        fetch(`/api/daily-prices?ticker=${ticker}&period=${selectedPeriod}&refresh=false`),
        fetch(`/api/quarterly-timeseries?ticker=${ticker}&period=${selectedPeriod}&maxAge=24`)
      ]);

      if (!dailyResponse.ok) {
        const errorText = await dailyResponse.text();
        console.error('Daily data fetch error:', errorText);
        throw new Error(`Failed to fetch daily data: ${dailyResponse.status}`);
      }

      if (!quarterlyResponse.ok) {
        const errorText = await quarterlyResponse.text();
        console.error('Quarterly data fetch error:', errorText);
        throw new Error(`Failed to fetch quarterly data: ${quarterlyResponse.status}`);
      }

      let quarterlyData: QuarterlyDataResponse | null = null;
      
      try {
        quarterlyData = await quarterlyResponse.json();
      } catch (err) {
        console.error('Error parsing quarterly JSON:', err);
      }
      
      const dailyData: DailyPriceResponse = await dailyResponse.json();

      if (!dailyData.data || dailyData.data.length === 0) {
        throw new Error('No daily stock data available');
      }

      const transformedData = transformApiDataForChart(
        dailyData.data,
        quarterlyData?.data || undefined,
        fairValueRatio
      );
      setStockData(transformedData);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  // Load data when ticker/period changes
  useEffect(() => {
    console.log(`Fetching data for ticker: ${selectedTicker}, period: ${period}`);
    fetchStockData(selectedTicker, period);
  }, [selectedTicker, period]);

  // Handle ticker change
  const handleTickerChange = (newTicker: string) => {
    setSelectedTicker(newTicker);
  };

  // Handle period change
  const handlePeriodChange = (newPeriod: string) => {
    console.log(`Period change requested: ${period} → ${newPeriod}`);
    setPeriod(newPeriod);
  };

  // Get current stock info
  const currentData = stockData[stockData.length - 1];
  const previousData = stockData[stockData.length - 2];
  const priceChange = currentData && previousData ? currentData.stockPrice - previousData.stockPrice : 0;
  const priceChangePercent = currentData && previousData ? ((priceChange / previousData.stockPrice) * 100) : 0;

  // Calculate metrics using top-level functions (memoized to avoid recalculating on every render)
  const normalPERatio = useMemo(() => calculateNormalPERatio(stockData), [stockData]);
  const growthRate = useMemo(() => calculateGrowthRate(stockData), [stockData]);

  const fairValueRatio = 18; // Hardcoded to 18 (as used in fair value calculation)

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
            <div></div>
          </div>
        </div>
      </div>

      {/* Stock Header Section */}
      <StockHeader
        selectedTicker={selectedTicker}
        onTickerChange={handleTickerChange}
        currentData={currentData}
        priceChange={priceChange}
        priceChangePercent={priceChangePercent}
      />

      {/* Loading/Error States */}
      {loading && (
        <div className="w-full max-w-none px-6 py-8">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading data...</p>
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
              {/* Chart Title and Period Selector Row */}
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
                  Value Analysis
                </h2>
                <PeriodSelector 
                  currentPeriod={period}
                  onPeriodChange={handlePeriodChange}
                />
              </div>
              
              {/* Stock Analysis Chart Component */}
              <StockAnalysisChart 
                stockData={stockData} 
                currentPeriod={period}
              />
            </div>

            {/* Right Sidebar - 1/4 width */}
            <div className="xl:col-span-1">
              <StockSidebar 
                currentData={currentData}
                growthRate={growthRate}
                normalPERatio={normalPERatio}
                fairValueRatio={fairValueRatio}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
