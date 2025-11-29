'use client';

import { useState, useEffect } from 'react';

interface AnalystData {
  price_targets?: {
    current_price?: number;
    target_high?: number;
    target_low?: number;
    target_mean?: number;
    target_median?: number;
    number_of_analysts?: number;
  };
  recommendations?: {
    latest_summary?: {
      strongBuy?: number;
      buy?: number;
      hold?: number;
      sell?: number;
      strongSell?: number;
    };
    recommendation_mean?: number;
    recommendation_key?: string;
    number_of_analysts?: number;
  };
  growth_estimates?: {
    stock_trend?: {
      '0q'?: number;
      '+1q'?: number;
      '0y'?: number;
      '+1y'?: number;
    };
  };
  earnings_trend?: {
    earnings_estimate?: {
      avg?: {
        '0q'?: number;
        '+1q'?: number;
        '0y'?: number;
        '+1y'?: number;
      };
      yearAgoEps?: {
        '0q'?: number;
        '+1q'?: number;
        '0y'?: number;
        '+1y'?: number;
      };
    };
  };
  fetched_at?: string;
}

interface SidebarCurrentData {
  stockPrice: number | null;
  fairValue: number | null;
  peRatio: number | null;
  earnings: number | null;
  dividend: number | null;
  dividendsPOR: number | null;
  marketCap: number | null;
}

interface AnalystDataCardProps {
  ticker: string;
  currentPrice?: number | null;
  currentData?: SidebarCurrentData;
}

export default function AnalystDataCard({ ticker, currentPrice, currentData }: AnalystDataCardProps) {
  const [analystData, setAnalystData] = useState<AnalystData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDetailsExpanded, setIsDetailsExpanded] = useState(false);

  useEffect(() => {
    const fetchAnalystData = async () => {
      if (!ticker) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/analyst?ticker=${ticker}`);
        const result = await response.json();

        if (result.success && result.data) {
          setAnalystData(result.data);
        } else {
          setError(result.message || 'No analyst data available');
        }
      } catch (err) {
        console.error('Error fetching analyst data:', err);
        setError('Failed to fetch analyst data');
      } finally {
        setLoading(false);
      }
    };

    fetchAnalystData();
  }, [ticker]);

  if (loading) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
        <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">Analyst Predictions</h3>
        <div className="text-center text-gray-500 py-4">Loading...</div>
      </div>
    );
  }

  if (error || !analystData) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
        <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">Analyst Predictions</h3>
        <div className="text-center text-gray-500 py-4 text-sm">
          {error || 'No analyst data available'}
        </div>
      </div>
    );
  }

  const priceTargets = analystData.price_targets;
  const recommendations = analystData.recommendations;
  const growthEstimates = analystData.growth_estimates;
  const earningsTrend = analystData.earnings_trend;

  // Calculate bullish percentage
  const latestRec = recommendations?.latest_summary;
  const totalRecs = latestRec 
    ? (latestRec.strongBuy || 0) + (latestRec.buy || 0) + (latestRec.hold || 0) + 
      (latestRec.sell || 0) + (latestRec.strongSell || 0)
    : 0;
  const bullishRecs = latestRec ? (latestRec.strongBuy || 0) + (latestRec.buy || 0) : 0;
  const bullishPercent = totalRecs > 0 ? (bullishRecs / totalRecs) * 100 : 0;

  // Calculate price range visualization
  const targetLow = priceTargets?.target_low;
  const targetHigh = priceTargets?.target_high;
  const targetMean = priceTargets?.target_mean;
  
  // Calculate position percentages for visual bar
  let meanTargetPercent = 50;
  
  if (targetLow && targetHigh && targetMean) {
    const range = targetHigh - targetLow;
    if (range > 0) {
      meanTargetPercent = ((targetMean - targetLow) / range) * 100;
    }
  }

  // Get 1Y EPS growth
  const oneYearGrowth = growthEstimates?.stock_trend?.['+1y'];
  const nextYearEPS = earningsTrend?.earnings_estimate?.avg?.['+1y'];
  const currentYearEPS = earningsTrend?.earnings_estimate?.avg?.['0y'];
  const previousYearEPS = earningsTrend?.earnings_estimate?.yearAgoEps?.['0y'];

  // Calculate fiscal year numbers based on current date
  const currentDate = new Date();
  const currentYear = currentDate.getFullYear();
  const previousYear = currentYear - 1;
  const nextYear = currentYear + 1;

  // Calculate percent change from current price to targets (using currentPrice as base)
  const priceToMeanPercent = currentPrice && targetMean 
    ? ((targetMean - currentPrice) / currentPrice) * 100 
    : null;
  // High: positive when current < high (showing upside potential)
  const priceToHighPercent = currentPrice && targetHigh 
    ? ((targetHigh - currentPrice) / currentPrice) * 100 
    : null;
  // Low: negative when current > low (we're above the low target)
  const priceToLowPercent = currentPrice && targetLow 
    ? ((targetLow - currentPrice) / currentPrice) * 100 
    : null;

  // Calculate valuation metrics
  const fairValue = currentData?.fairValue || 0;
  const currentPriceForValuation = currentData?.stockPrice || 0;
  const valuationRatio = fairValue > 0 && currentPriceForValuation > 0 ? fairValue / currentPriceForValuation : 0;
  const premium = ((currentPriceForValuation - fairValue) / fairValue) * 100;

  return (
    <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
      <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">Valuation & Analyst Predictions</h3>
      
      <div className="space-y-6">
        {/* Valuation Analysis */}
        {currentData && currentPriceForValuation > 0 && (
          <div className="text-center pb-4 border-b border-gray-200">
            <div className="text-sm text-gray-700">
              Stock is{' '}
              <span className={`font-bold ${
                valuationRatio > 1.15 ? 'text-green-600' : 
                valuationRatio > 1.05 ? 'text-blue-600' : 
                valuationRatio < 0.85 ? 'text-red-600' : 'text-yellow-600'
              }`}>
                {valuationRatio > 1.15 ? 'undervalued' : 
                 valuationRatio > 1.05 ? 'fairly valued' : 
                 valuationRatio < 0.85 ? 'overvalued' : 'neutral'}
              </span>
              {' '}and trading{' '}
              {Math.abs(premium) > 0.1 ? (
                <>
                  <span className={`font-bold ${premium > 0 ? 'text-gray-700' : 'text-green-600'}`}>
                    {premium > 0 ? `${premium.toFixed(1)}% above` : `${Math.abs(premium).toFixed(1)}% below`}
                  </span>
                  {' '}fair value
                </>
              ) : (
                <span className="font-bold text-gray-900">at fair value</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-4 text-center mt-4">
              <div>
                <div className="text-xs text-gray-500 mb-1">Current Price</div>
                <div className="text-sm font-bold text-gray-900">${currentPriceForValuation.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Fair Value</div>
                <div className="text-sm font-bold text-gray-900">${fairValue.toFixed(2)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Premium</div>
                <div className={`text-sm font-bold ${premium > 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {premium > 0 ? '+' : ''}{premium.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Sentiment and Target Price - Narrative First Row */}
        {priceTargets && targetMean && (
          <div className="text-center pb-4 border-b border-gray-200">
            <div className="text-sm text-gray-700">
              Analysts are{' '}
              <span className={`font-bold ${bullishPercent >= 50 ? 'text-green-600' : bullishPercent >= 30 ? 'text-yellow-600' : 'text-red-600'}`}>
                {bullishPercent >= 50 ? 'bullish' : bullishPercent >= 30 ? 'neutral' : 'bearish'}
              </span>
              {' '}and expected price target is{' '}
              <span className="font-bold text-gray-900">${targetMean.toFixed(2)}</span>
              {priceToMeanPercent !== null && (
                <span className={`ml-1 ${priceToMeanPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  ({priceToMeanPercent >= 0 ? '+' : ''}{priceToMeanPercent.toFixed(1)}%)
                </span>
              )}
            </div>
          </div>
        )}

        {/* EPS Forecast - Previous | Current | Next */}
        {(previousYearEPS !== undefined || currentYearEPS !== undefined || nextYearEPS !== undefined) && (
          <div className="pt-4">
            <div className="text-xs text-gray-500 mb-3 text-center">EPS Forecast</div>
            <div className="grid grid-cols-3 gap-4">
              {/* Previous Year */}
              {previousYearEPS !== undefined && (
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">FY {previousYear}</div>
                  <div className="text-sm font-semibold text-gray-700">
                    ${previousYearEPS.toFixed(2)}
                  </div>
                </div>
              )}
              
              {/* Current Year */}
              {currentYearEPS !== undefined && (
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">FY {currentYear}</div>
                  <div className="text-sm font-semibold text-gray-900">
                    ${currentYearEPS.toFixed(2)}
                  </div>
                  {previousYearEPS !== undefined && currentYearEPS > previousYearEPS && (
                    <div className="text-xs text-green-600 mt-0.5">
                      +{(((currentYearEPS - previousYearEPS) / previousYearEPS) * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              )}
              
              {/* Next Year */}
              {nextYearEPS !== undefined && (
                <div className="text-center">
                  <div className="text-xs text-gray-500 mb-1">FY {nextYear}</div>
                  <div className="text-sm font-semibold text-gray-900">
                    ${nextYearEPS.toFixed(2)}
                  </div>
                  {currentYearEPS !== undefined && nextYearEPS > currentYearEPS && (
                    <div className="text-xs text-green-600 mt-0.5">
                      +{(((nextYearEPS - currentYearEPS) / currentYearEPS) * 100).toFixed(1)}%
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Details - Expandable (Sentiment + Price Range) */}
        {(priceTargets && targetMean && targetLow && targetHigh) || (recommendations && latestRec) ? (
          <div>
            <button
              onClick={() => setIsDetailsExpanded(!isDetailsExpanded)}
              className="w-full flex items-center justify-between text-left py-2 hover:bg-gray-50 rounded-lg px-2 -mx-2 transition-colors"
            >
              <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Details
              </span>
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${isDetailsExpanded ? 'transform rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            
            {isDetailsExpanded && (
              <div className="pt-3 mt-2 border-t border-gray-100 space-y-4">
                {/* Sentiment Breakdown */}
                {recommendations && latestRec && totalRecs > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Sentiment</div>
                    <div className="flex items-center justify-between mb-3">
                      <span className={`text-base font-bold ${bullishPercent >= 50 ? 'text-green-600' : bullishPercent >= 30 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {bullishPercent.toFixed(0)}% Bullish
                      </span>
                      <span className="text-xs text-gray-500">
                        {totalRecs} analysts
                      </span>
                    </div>
                    <div className="grid grid-cols-5 gap-2 text-center">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">SB</div>
                        <div className="text-sm font-semibold text-green-700">{latestRec.strongBuy || 0}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Buy</div>
                        <div className="text-sm font-semibold text-green-600">{latestRec.buy || 0}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Hold</div>
                        <div className="text-sm font-semibold text-gray-600">{latestRec.hold || 0}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Sell</div>
                        <div className="text-sm font-semibold text-orange-600">{latestRec.sell || 0}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">SS</div>
                        <div className="text-sm font-semibold text-red-700">{latestRec.strongSell || 0}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Price Range */}
                {priceTargets && targetMean && targetLow && targetHigh && (
                  <div>
                    <div className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">Price Range</div>
                    <div className="grid grid-cols-3 gap-4">
                      {/* Low */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">Low</div>
                        <div className="text-sm font-semibold text-gray-700">
                          ${targetLow.toFixed(0)}
                        </div>
                        {priceToLowPercent !== null && (
                          <div className={`text-xs mt-0.5 ${priceToLowPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {priceToLowPercent >= 0 ? '+' : ''}{priceToLowPercent.toFixed(1)}%
                          </div>
                        )}
                      </div>
                      
                      {/* Mean */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">Mean</div>
                        <div className="text-sm font-semibold text-gray-700">
                          ${targetMean.toFixed(0)}
                        </div>
                        {priceToMeanPercent !== null && (
                          <div className={`text-xs mt-0.5 ${priceToMeanPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {priceToMeanPercent >= 0 ? '+' : ''}{priceToMeanPercent.toFixed(1)}%
                          </div>
                        )}
                      </div>
                      
                      {/* High */}
                      <div className="text-center">
                        <div className="text-xs text-gray-500 mb-1">High</div>
                        <div className="text-sm font-semibold text-gray-700">
                          ${targetHigh.toFixed(0)}
                        </div>
                        {priceToHighPercent !== null && (
                          <div className={`text-xs mt-0.5 ${priceToHighPercent >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {priceToHighPercent >= 0 ? '+' : ''}{priceToHighPercent.toFixed(1)}%
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

