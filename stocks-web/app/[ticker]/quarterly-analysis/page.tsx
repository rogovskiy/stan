'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import QuarterlyAnalysisView from '../../components/QuarterlyAnalysisView';
import AppNavigation from '../../components/AppNavigation';
import CompanyInfoCard from '../../components/CompanyInfoCard';
import NewsWidget from '../../components/NewsWidget';
import { QuarterlyAnalysis, DailyDataPoint, QuarterlyDataPoint } from '../../types/api';
import { calculateNormalPERatio, calculateGrowthRate, QuarterlyDataPoint as CalcQuarterlyDataPoint, getTrailing4QuartersEps, calculateAnnualEps, calculateFairValue } from '../../lib/calculations';

export default function QuarterlyAnalysisPage() {
  const params = useParams();
  const router = useRouter();
  const ticker = (params?.ticker as string) || 'AAPL';
  const [analyses, setAnalyses] = useState<QuarterlyAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dailyData, setDailyData] = useState<DailyDataPoint[]>([]);
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyDataPoint[]>([]);

  // Helper function to get previous quarter key
  const getPreviousQuarterKey = (quarterKey: string): string | null => {
    const match = quarterKey.match(/^(\d{4})Q(\d)$/);
    if (!match) return null;
    
    const year = parseInt(match[1], 10);
    const quarter = parseInt(match[2], 10);
    
    if (quarter === 1) {
      return `${year - 1}Q4`;
    } else {
      return `${year}Q${quarter - 1}`;
    }
  };

  // Fetch stock data for sidebar
  useEffect(() => {
    const fetchStockData = async () => {
      try {
        const [dailyResponse, quarterlyResponse] = await Promise.all([
          fetch(`/api/daily-prices/${ticker}?period=8y&refresh=false`),
          fetch(`/api/quarterly-timeseries/${ticker}`)
        ]);

        if (dailyResponse.ok) {
          const dailyResult = await dailyResponse.json();
          setDailyData(dailyResult.data || []);
        }

        if (quarterlyResponse.ok) {
          const quarterlyResult = await quarterlyResponse.json();
          setQuarterlyData(quarterlyResult.data || []);
        }
      } catch (err) {
        console.error('Error fetching stock data for sidebar:', err);
        // Don't set error - sidebar data is optional
      }
    };

    fetchStockData();
  }, [ticker]);

  // Fetch quarterly text analysis data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // First, fetch the current quarter to get the quarter_key
        const currentResponse = await fetch(`/api/quarterly-text-analysis/${ticker}`);
        const currentResult = await currentResponse.json();
        
        if (!currentResponse.ok || !currentResult.success) {
          console.error('Failed to fetch current quarter:', currentResult);
          throw new Error(currentResult.error || 'Failed to fetch quarterly analysis');
        }

        const currentData = currentResult.data;
        console.log('Current quarter data:', currentData);
        console.log('Valuation data:', currentData?.valuation);
        console.log('Has valuation:', !!currentData?.valuation);
        console.log('Valuation methods:', currentData?.valuation?.methods);
        
        const currentQuarterKey = currentData.quarter_key || currentData.current_quarter;
        
        if (!currentQuarterKey || !currentQuarterKey.match(/^\d{4}Q\d$/)) {
          console.error('Invalid quarter key format:', currentQuarterKey);
          // If we have data but no valid quarter key, still try to display it
          if (currentData.initiatives && currentData.initiatives.length > 0) {
            // Use a placeholder quarter key and just show the current data
            // Handle quarterly_highlights - can be string or object
            let quarterlyHighlights: string | { text: string; charts?: any[] } | undefined;
            if (typeof currentData.quarterly_highlights === 'string') {
              quarterlyHighlights = currentData.quarterly_highlights;
            } else if (currentData.quarterly_highlights && typeof currentData.quarterly_highlights === 'object') {
              quarterlyHighlights = currentData.quarterly_highlights;
            } else {
              quarterlyHighlights = currentData.quarterly_highlights;
            }

            const analysis: QuarterlyAnalysis = {
              ticker: currentData.ticker || ticker.toUpperCase(),
              quarter_key: 'current',
              summary: typeof quarterlyHighlights === 'string' ? quarterlyHighlights : quarterlyHighlights?.text || '',
              quarterly_highlights: quarterlyHighlights,
              initiatives: currentData.initiatives || [],
              business_model: currentData.business_model,
              changes: currentData.changes,
              overall_quarter_strength: currentData.overall_quarter_strength,
              valuation: currentData.valuation, // Include valuation data
              created_at: currentData.created_at,
              num_documents: currentData.num_documents,
              kpi_metrics: [
                {
                  name: 'Revenue Growth',
                  unit: '%',
                  values: [12.5, 10.0, 8.5, 7.2, 6.0, 5.5, 4.8, 4.2],
                  trend: 'up' as const,
                  description: 'Year-over-year revenue growth'
                },
                {
                  name: 'Operating Margin',
                  unit: '%',
                  values: [46.9, 45.2, 44.8, 44.1, 43.5, 43.0, 42.5, 42.0],
                  trend: 'up' as const,
                  description: 'Operating margin percentage'
                }
              ],
              highlights: currentData.headline_bullets && currentData.headline_bullets.length > 0
                ? currentData.headline_bullets.slice(0, 3).map(bullet => ({
                    text: bullet.text,
                    impact: undefined,
                    trend: bullet.indicator === 'up' ? 'up' as const : bullet.indicator === 'down' ? 'down' as const : 'neutral' as const
                  }))
                : (currentData.initiatives || [])
                    .slice(0, 3)
                    .map(initiative => ({
                      text: initiative.title,
                      impact: initiative.status === 'new' ? 'New' : initiative.status === 'on track' ? 'On Track' : 'At Risk',
                      trend: initiative.status === 'at risk' ? 'down' as const : 'up' as const
                    })),
            };
            setAnalyses([analysis]);
            return;
          }
          throw new Error('Invalid quarter key format and no initiatives found');
        }

        // Calculate previous 3 quarter keys
        const quarterKeys: string[] = [currentQuarterKey];
        let previousKey = getPreviousQuarterKey(currentQuarterKey);
        for (let i = 0; i < 3 && previousKey; i++) {
          quarterKeys.push(previousKey);
          previousKey = getPreviousQuarterKey(previousKey);
        }

        // Fetch all quarters in parallel
        const quarterPromises = quarterKeys.map(quarterKey =>
          fetch(`/api/quarterly-text-analysis/${ticker}?quarterKey=${quarterKey}`)
            .then(res => res.json())
            .then(result => result.success ? result.data : null)
            .catch(() => null) // Return null if quarter doesn't exist
        );

        const quarterDataArray = await Promise.all(quarterPromises);
        
        // Transform database data to QuarterlyAnalysis format
        const analyses: QuarterlyAnalysis[] = quarterDataArray
          .filter(data => data !== null)
          .map((data, index) => {
            // Use headline_bullets from database if available, otherwise generate from initiatives
            let highlights: QuarterHighlight[] | undefined;
            
            if (data.headline_bullets && data.headline_bullets.length > 0) {
              // Use headline_bullets from database (preferred)
              highlights = data.headline_bullets.slice(0, 3).map(bullet => ({
                text: bullet.text,
                impact: undefined, // headline_bullets don't have impact values
                trend: bullet.indicator === 'up' ? 'up' as const : bullet.indicator === 'down' ? 'down' as const : 'neutral' as const
              }));
            } else if (data.initiatives && data.initiatives.length > 0) {
              // Fallback: generate from initiatives
              highlights = data.initiatives.slice(0, 3).map(initiative => ({
                text: initiative.title,
                impact: initiative.status === 'new' ? 'New' : initiative.status === 'on track' ? 'On Track' : 'At Risk',
                trend: initiative.status === 'at risk' ? 'down' as const : 'up' as const
              }));
            }

            // Handle quarterly_highlights - can be string or object
            let quarterlyHighlights: string | { text: string; charts?: any[] } | undefined;
            if (typeof data.quarterly_highlights === 'string') {
              quarterlyHighlights = data.quarterly_highlights;
            } else if (data.quarterly_highlights && typeof data.quarterly_highlights === 'object') {
              quarterlyHighlights = data.quarterly_highlights;
            } else {
              quarterlyHighlights = data.quarterly_highlights;
            }

            const analysis: QuarterlyAnalysis = {
              ticker: data.ticker || ticker.toUpperCase(),
              quarter_key: data.quarter_key || quarterKeys[index],
              summary: typeof quarterlyHighlights === 'string' ? quarterlyHighlights : quarterlyHighlights?.text || '',
              quarterly_highlights: quarterlyHighlights,
              initiatives: data.initiatives || [],
              business_model: data.business_model,
              changes: data.changes,
              headline_bullets: data.headline_bullets,
              overall_quarter_strength: data.overall_quarter_strength,
              valuation: data.valuation, // Include valuation data
              created_at: data.created_at,
              num_documents: data.num_documents,
              // Keep mock data for these fields
              historical_eps: undefined,
              highlights: highlights,
              kpi_metrics: undefined,
            };

            // Add mock KPI metrics only for the current (first) quarter
            if (index === 0) {
              analysis.kpi_metrics = [
                {
                  name: 'Revenue Growth',
                  unit: '%',
                  values: [12.5, 10.0, 8.5, 7.2, 6.0, 5.5, 4.8, 4.2],
                  trend: 'up' as const,
                  description: 'Year-over-year revenue growth'
                },
                {
                  name: 'Operating Margin',
                  unit: '%',
                  values: [46.9, 45.2, 44.8, 44.1, 43.5, 43.0, 42.5, 42.0],
                  trend: 'up' as const,
                  description: 'Operating margin percentage'
                }
              ];
            }

            return analysis;
          });

        if (analyses.length === 0) {
          console.warn('No analyses found after fetching quarters');
          setError('No quarterly analysis data found');
        } else {
          console.log(`Successfully loaded ${analyses.length} quarters`);
          setAnalyses(analyses);
        }
      } catch (err) {
        console.error('Error fetching quarterly analysis:', err);
        setError(err instanceof Error ? err.message : 'Failed to load quarterly analysis');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [ticker]);

  // Handle ticker change
  const handleTickerChange = (newTicker: string) => {
    router.push(`/${newTicker}/quarterly-analysis`);
  };

  // Calculate metrics for sidebar
  const quarterlyCalcData = useMemo((): CalcQuarterlyDataPoint[] => {
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

    const sortedQuarterly = [...quarterlyData].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    let dailyIndex = 0;

    return sortedQuarterly.map(item => {
      const qDate = new Date(item.date).getTime();

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

  const normalPERatio = useMemo(() => calculateNormalPERatio(quarterlyCalcData), [quarterlyCalcData]);
  const growthRate = useMemo(() => calculateGrowthRate(quarterlyCalcData), [quarterlyCalcData]);
  const fairValueRatio = 18;
  
  // Calculate quarterly growth rate from annual growth rate
  const quarterlyGrowthRate = useMemo(() => {
    if (growthRate === null || growthRate === undefined) return null;
    return Math.pow(1 + growthRate / 100, 1 / 4) - 1;
  }, [growthRate]);

  // Current snapshot for sidebar
  const currentSnapshot = useMemo(() => {
    if (dailyData.length === 0) return undefined;

    const currentDaily = dailyData[dailyData.length - 1];
    const currentDate = new Date(currentDaily.date);
    const currentPrice = currentDaily.price;

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
  }, [dailyData, quarterlyData, fairValueRatio]);

  // Price change calculation
  const priceChange = useMemo(() => {
    if (dailyData.length < 2) return 0;
    const currentDaily = dailyData[dailyData.length - 1];
    const previousDaily = dailyData[dailyData.length - 2];
    return currentDaily && previousDaily ? currentDaily.price - previousDaily.price : 0;
  }, [dailyData]);

  const priceChangePercent = useMemo(() => {
    if (dailyData.length < 2) return 0;
    const currentDaily = dailyData[dailyData.length - 1];
    const previousDaily = dailyData[dailyData.length - 2];
    return currentDaily && previousDaily && previousDaily.price !== 0
      ? ((priceChange / previousDaily.price) * 100)
      : 0;
  }, [dailyData, priceChange]);

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation 
        selectedTicker={ticker}
        onTickerChange={handleTickerChange}
      />

      {/* Loading State */}
      {loading && (
        <div className="w-full max-w-none px-6 py-8">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Loading quarterly analysis...</p>
          </div>
        </div>
      )}

      {/* Error State */}
      {error && (
        <div className="w-full max-w-none px-6 py-8">
          <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
            <p className="text-red-800 font-medium">Error: {error}</p>
            <p className="text-red-600 text-sm mt-2">
              No quarterly analysis data found for {ticker}. The data may not be available yet.
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      {!loading && !error && analyses.length > 0 && (
        <div className="w-full max-w-none px-6 py-6">
          <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
            {/* Main Content Area - 3/4 width */}
            <div className="xl:col-span-3">
              <QuarterlyAnalysisView 
                analyses={analyses}
                dailyData={dailyData}
                quarterlyData={quarterlyData}
                normalPERatio={normalPERatio}
                growthRate={growthRate}
                fairValueRatio={fairValueRatio}
                quarterlyGrowthRate={quarterlyGrowthRate}
              />
            </div>

            {/* Right Sidebar - 1/4 width */}
            <div className="xl:col-span-1 space-y-6">
              <CompanyInfoCard 
                ticker={ticker}
                showPrice={true}
                stockPrice={currentSnapshot?.stockPrice}
                priceChange={priceChange}
                priceChangePercent={priceChangePercent}
                marketCap={currentSnapshot?.marketCap}
                peRatio={currentSnapshot?.peRatio}
                dividend={currentSnapshot?.dividendsPOR}
              />
              
              {/* News Widget */}
              <NewsWidget ticker={ticker} />
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && analyses.length === 0 && (
        <div className="w-full max-w-none px-6 py-8">
          <div className="bg-white rounded-2xl shadow-lg p-8 text-center">
            <p className="text-gray-600">No quarterly analysis data available.</p>
          </div>
        </div>
      )}
    </div>
  );
}

