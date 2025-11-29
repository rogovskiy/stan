'use client';

import { useState, useEffect, useMemo } from 'react';
import { calculateNormalPERatio, calculateGrowthRate, QuarterlyDataPoint, calculateAnnualEps, getTrailing4QuartersEps, calculateFairValue, QuarterlyDataPoint as CalcQuarterlyDataPoint, calculateMaxAvailableYears } from './lib/calculations';
import { DailyPriceResponse, QuarterlyDataResponse, DailyDataPoint, QuarterlyDataPoint as ApiQuarterlyDataPoint } from './types/api';
import StockAnalysisChart from './components/StockAnalysisChart';
import PeriodSelector from './components/PeriodSelector';
import StockSidebar from './components/StockSidebar';
import StockHeader from './components/StockHeader';
import TickerSearch from './components/TickerSearch';

export default function Home() {
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [dailyData, setDailyData] = useState<DailyDataPoint[]>([]);
  const [quarterlyData, setQuarterlyData] = useState<ApiQuarterlyDataPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState('8y');
  const forecastYears = 2; // Number of fiscal years to forecast (8 quarters)

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
        fetch(`/api/quarterly-timeseries?ticker=${ticker}`)
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

      // Store raw API data; transformation for charting is owned by the chart component
      setDailyData(dailyData.data);
      setQuarterlyData(quarterlyData?.data || []);
      
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

  // Get current stock info from daily data
  const currentDaily = dailyData[dailyData.length - 1];
  const previousDaily = dailyData[dailyData.length - 2];
  const currentPrice = currentDaily?.price ?? 0;
  const previousPrice = previousDaily?.price ?? 0;
  const priceChange = currentDaily && previousDaily ? currentPrice - previousPrice : 0;
  const priceChangePercent = currentDaily && previousDaily && previousPrice !== 0
    ? ((priceChange / previousPrice) * 100)
    : 0;

  // Extract minimal quarterly data points for calculations from API quarterly series,
  // including an approximate stock price at the quarter date using daily prices.
  const quarterlyCalcData = useMemo((): QuarterlyDataPoint[] => {
    if (quarterlyData.length === 0 || dailyData.length === 0) {
      return quarterlyData.map(item => ({
        date: item.date,
        eps_adjusted: item.eps_adjusted ?? null,
        earnings: item.eps ?? null,
        stockPrice: null
      }));
    }

    const sortedDaily = [...dailyData].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // Ensure quarterly data is processed in chronological order
    const sortedQuarterly = [...quarterlyData].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    let dailyIndex = 0;

    return sortedQuarterly.map(item => {
      const qDate = new Date(item.date).getTime();

      // Advance dailyIndex to the last daily point on or before the quarter date
      while (
        dailyIndex + 1 < sortedDaily.length &&
        new Date(sortedDaily[dailyIndex + 1].date).getTime() <= qDate
      ) {
        dailyIndex += 1;
      }

      const priceForQuarter =
        new Date(sortedDaily[dailyIndex].date).getTime() <= qDate
          ? sortedDaily[dailyIndex].price
          : sortedDaily[0].price;

      return {
        date: item.date,
        eps_adjusted: item.eps_adjusted ?? null,
        earnings: item.eps ?? null,
        stockPrice: priceForQuarter ?? null
      };
    });
  }, [quarterlyData, dailyData]);

  // Calculate metrics using top-level functions (memoized to avoid recalculating on every render)
  const normalPERatio = useMemo(() => calculateNormalPERatio(quarterlyCalcData), [quarterlyCalcData]);
  const growthRate = useMemo(() => calculateGrowthRate(quarterlyCalcData), [quarterlyCalcData]);
  
  // Calculate quarterly growth rate from annual growth rate
  // Formula: quarterlyGrowthRate = (1 + annualGrowthRate/100)^(1/4) - 1
  const quarterlyGrowthRate = useMemo(() => {
    if (growthRate === null || growthRate === undefined) return null;
    return Math.pow(1 + growthRate / 100, 1 / 4) - 1;
  }, [growthRate]);

  // Calculate maximum available years from quarterly data
  const maxAvailableYears = useMemo(() => {
    return calculateMaxAvailableYears(quarterlyData);
  }, [quarterlyData]);

  const fairValueRatio = 18; // Hardcoded to 18 (as used in fair value calculation)

  // Current snapshot for header/sidebar, derived from latest daily + quarterly data
  const currentSnapshot = useMemo(() => {
    if (!currentDaily) return undefined;

    const currentDate = new Date(currentDaily.date);

    // Build calc quarterly data for trailing EPS
    const calcQuarterlyData: CalcQuarterlyDataPoint[] = quarterlyData.map(item => ({
      date: item.date,
      eps_adjusted: item.eps_adjusted ?? null,
      earnings: item.eps ?? null,
      stockPrice: null
    }));

    const trailing4 = getTrailing4QuartersEps(calcQuarterlyData, currentDate);

    let annualEps: number | null = null;
    if (trailing4.length > 0) {
      const epsValues = trailing4.map(q =>
        q.eps_adjusted !== null && q.eps_adjusted !== undefined
          ? q.eps_adjusted
          : (q.earnings || 0)
      );
      annualEps = calculateAnnualEps(epsValues);
    }

    const fairValue = calculateFairValue(annualEps, fairValueRatio);
    const peRatio = annualEps && annualEps > 0 ? currentPrice / annualEps : null;

    // Latest quarterly point on or before current date for EPS/dividend stats
    const latestQuarter = [...quarterlyData]
      .filter(q => new Date(q.date) <= currentDate)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];

    const earnings = latestQuarter?.eps ?? null;
    const dividendsPOR = latestQuarter?.dividendsPOR ?? null;

    let dividend: number | null = null;
    if (dividendsPOR !== null && dividendsPOR !== undefined && currentPrice) {
      const annualYield = dividendsPOR / 100;
      dividend = (currentPrice * annualYield) / 4;
    }

    const marketCap = currentPrice ? currentPrice * 16.0 : null;

    return {
      stockPrice: currentPrice || null,
      fairValue,
      peRatio,
      earnings,
      dividend,
      dividendsPOR,
      marketCap
    };
  }, [currentDaily, quarterlyData, fairValueRatio, currentPrice]);

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      {/* Top Navigation Bar */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="w-full max-w-none px-6 py-2.5">
          <div className="flex items-center justify-between gap-4">
            {/* Logo/Brand */}
            <div className="flex items-center gap-3">
              <div className="text-lg font-bold text-blue-600 tracking-tight">StockAnalysis</div>
            </div>
            {/* Ticker Search Bar */}
            <div className="flex-1 flex justify-center max-w-2xl">
              <TickerSearch 
                selectedTicker={selectedTicker}
                onTickerChange={handleTickerChange}
              />
            </div>
            <div className="w-32"></div> {/* Spacer for centering */}
          </div>
        </div>
      </div>

      {/* Stock Header Section */}
      <StockHeader
        selectedTicker={selectedTicker}
        onTickerChange={handleTickerChange}
        currentData={currentSnapshot}
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
      {!loading && !error && dailyData.length > 0 && (
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
                  maxYears={maxAvailableYears}
                />
              </div>
              
              {/* Stock Analysis Chart Component */}
              <StockAnalysisChart 
                dailyData={dailyData}
                quarterlyData={quarterlyData}
                fairValueRatio={fairValueRatio}
                currentPeriod={period}
                normalPERatio={normalPERatio}
                growthRate={growthRate}
                quarterlyGrowthRate={quarterlyGrowthRate}
                forecastYears={forecastYears}
              />
            </div>

            {/* Right Sidebar - 1/4 width */}
            <div className="xl:col-span-1">
              <StockSidebar 
                currentData={currentSnapshot}
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
