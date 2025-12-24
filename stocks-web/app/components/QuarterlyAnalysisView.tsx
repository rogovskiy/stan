'use client';

/**
 * QuarterlyAnalysisView Component
 * 
 * Displays LLM-generated quarterly performance analysis in a beautiful timeline layout.
 * 
 * Features:
 * - Timeline view with chronological quarter display (most recent first)
 * - Expandable/collapsible quarter sections
 * - Summary section with paragraph and bullet points
 * - Growth theses displayed as cards with strength indicators
 * - Expandable thesis cards showing detailed explanations and supporting evidence
 * - Responsive design that works on mobile and desktop
 * 
 * @example
 * ```tsx
 * import QuarterlyAnalysisView from './components/QuarterlyAnalysisView';
 * 
 * const analyses: QuarterlyAnalysis[] = [
 *   {
 *     ticker: 'AAPL',
 *     quarter_key: '2025Q1',
 *     summary: 'Quarter summary with bullet points...',
 *     growth_theses: [...]
 *   }
 * ];
 * 
 * <QuarterlyAnalysisView analyses={analyses} ticker="AAPL" />
 * ```
 */

import { useState, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { QuarterlyAnalysis, EPSGrowthDriver, KPIMetric, Initiative, DailyDataPoint, QuarterlyDataPoint } from '../types/api';
import { GrowthCardWithKPI } from './GrowthCardWithKPI';
import { QuarterlyCard } from './QuarterlyCard';
import { QuarterlyDetailsDrawer } from './QuarterlyDetailsDrawer';
import { InitiativeDrawer } from './InitiativeDrawer';
import StockAnalysisChart from './StockAnalysisChart';
import AnalysisChart from './AnalysisChart';
import ValuationChartSelector from './ValuationChartSelector';
import CompactChart from './CompactChart';

// Business Model Card Component with Key Growth Factors
function BusinessModelCard({ 
  businessModel, 
  initiatives, 
  kpiMetrics,
  analyses,
  ticker,
  valuation,
  onQuarterClick,
  onInitiativeClick
}: { 
  businessModel: { summary?: string; industry?: string; maturity_level?: string };
  initiatives: Initiative[];
  kpiMetrics: KPIMetric[];
  analyses: QuarterlyAnalysis[];
  ticker: string;
  valuation?: import('../types/api').Valuation;
  onQuarterClick: (analysis: QuarterlyAnalysis) => void;
  onInitiativeClick: (initiative: Initiative, kpi?: KPIMetric) => void;
}) {

  const getMaturityColor = (level?: string): string => {
    switch (level) {
      case 'early': return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'growth': return 'bg-green-100 text-green-800 border-green-200';
      case 'mature': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'declining': return 'bg-red-100 text-red-800 border-red-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getMaturityLabel = (level?: string): string => {
    switch (level) {
      case 'early': return 'Early Stage';
      case 'growth': return 'Growth';
      case 'mature': return 'Mature';
      case 'declining': return 'Declining';
      default: return level || 'Unknown';
    }
  };

  const normalizeName = (name: string) => name.toLowerCase().replace(/\b(growth|revenue|sales|margin|expansion|ratio|efficiency)\b/gi, '').trim();

  // Fetch KPI timeseries data
  const [kpiTimeseriesData, setKpiTimeseriesData] = useState<any>(null);

  useEffect(() => {
    const fetchKPIData = async () => {
      try {
        const response = await fetch(`/api/tickers/timeseries/kpi/${ticker}`);
        if (response.ok) {
          const result = await response.json();
          setKpiTimeseriesData(result);
        }
      } catch (err) {
        console.warn('Error fetching KPI timeseries for initiatives:', err);
      }
    };

    if (ticker) {
      fetchKPIData();
    }
  }, [ticker]);

  // Helper function to find KPI by name (flexible matching)
  const findKPIInTimeseries = (metricName: string): any => {
    if (!kpiTimeseriesData?.kpis) return null;
    
    const normalizedMetric = metricName.toLowerCase().trim();
    
    return kpiTimeseriesData.kpis.find((kpi: any) => {
      const kpiName = (kpi.name || '').toLowerCase().trim();
      // Exact match or contains match
      return kpiName === normalizedMetric || 
             kpiName.includes(normalizedMetric) || 
             normalizedMetric.includes(kpiName);
    });
  };

  // Get metric from initiative chart, or fallback to KPI matching
  const initiativesWithMetric = useMemo(() => {
    return initiatives.map(initiative => {
      // First, try to get metric from initiative.chart.metrics[0]
      const chartMetric = initiative.chart?.metrics?.[0];
      
      if (chartMetric) {
        // Try to find the metric in KPI timeseries
        const kpi = findKPIInTimeseries(chartMetric);
        
        // Get the latest value from KPI timeseries (first value in the array is most recent)
        let metricValue: number | undefined = undefined;
        let metricUnit: string = '%'; // Default to percentage
        
        if (kpi && kpi.values && kpi.values.length > 0) {
          // Values are sorted with most recent first
          const latestValue = kpi.values[0];
          const previousValue = kpi.values.length > 1 ? kpi.values[1] : null;
          metricUnit = kpi.unit || latestValue.unit || '%';
          
          // If unit is already a percentage, show the value as-is
          // Otherwise, calculate quarterly change
          if (metricUnit === '%') {
            metricValue = latestValue.value;
          } else if (previousValue && previousValue.value !== null && previousValue.value !== undefined && previousValue.value !== 0) {
            // Calculate quarterly change: ((current - previous) / previous) * 100
            const change = ((latestValue.value - previousValue.value) / previousValue.value) * 100;
            metricValue = change;
            metricUnit = '%'; // Change is always shown as percentage
          } else {
            // If we can't calculate change, show the raw value
            metricValue = latestValue.value;
          }
        }
        
        return { 
          initiative, 
          metricName: chartMetric,
          metricValue,
          metricUnit
        };
      }
      
      // Fallback: Match with KPIs (for backward compatibility)
      const matchingKPI = kpiMetrics.find(kpi => {
        const kpiName = normalizeName(kpi.name);
        const initiativeName = normalizeName(initiative.title || '');
        return kpiName === initiativeName || kpiName.includes(initiativeName) || initiativeName.includes(kpiName);
      });
      
      if (matchingKPI) {
        const unit = matchingKPI.unit || '%';
        let metricValue: number | undefined = matchingKPI.values?.[0];
        
        // If unit is not a percentage and we have at least 2 values, calculate quarterly change
        if (unit !== '%' && matchingKPI.values && matchingKPI.values.length >= 2) {
          const current = matchingKPI.values[0];
          const previous = matchingKPI.values[1];
          if (previous !== null && previous !== undefined && previous !== 0) {
            const change = ((current - previous) / previous) * 100;
            metricValue = change;
            // Change is always shown as percentage
            return {
              initiative,
              metricName: matchingKPI.name,
              metricValue,
              metricUnit: '%',
              kpi: matchingKPI
            };
          }
        }
        
        return { 
          initiative, 
          metricName: matchingKPI.name,
          metricValue,
          metricUnit: unit,
          kpi: matchingKPI
        };
      }
      
      return {
        initiative,
        metricName: undefined,
        metricValue: undefined,
        metricUnit: '%',
        kpi: undefined
      };
    });
  }, [initiatives, kpiMetrics, kpiTimeseriesData, ticker]);

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
      <div className="mb-6">
        <h3 className="text-lg font-bold text-gray-900">Business Model</h3>
      </div>
      
      <div className="space-y-6">
        {/* Business Model Info */}
        <div className="space-y-4">
          {businessModel.summary && (
            <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
              <ReactMarkdown>
                {businessModel.summary}
              </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Initiatives - All in One Row (Each Collapsible) */}
        {initiatives.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide">Company Initiatives</h4>
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide">
                {valuation?.business_model_chart 
                  ? `${valuation.business_model_chart.frequency === 'annual' ? 'Annual' : 'Quarterly'} ${valuation.business_model_chart.metrics[0] || 'Chart'}`
                  : 'Annual EPS2'}
              </h4>
            </div>
            <div className="flex items-start gap-6">
              {/* Initiatives List */}
              <div className="flex-1 flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
              {initiativesWithMetric.map((item, idx) => {
                const { initiative, metricName, metricValue, metricUnit, kpi } = item;
                
                const handleClick = () => {
                  onInitiativeClick(initiative, kpi);
                };

                return (
                  <div key={idx} className="flex-shrink-0 w-80">
                    <button
                      onClick={handleClick}
                      className="w-full bg-gradient-to-br from-white to-gray-50 rounded-lg border border-gray-200 p-4 hover:shadow-md hover:border-gray-300 transition-all text-left"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-bold text-gray-900 leading-tight flex-1">
                          {initiative.title}
                        </h4>
                        <svg
                          className="w-4 h-4 text-gray-400 flex-shrink-0 ml-2"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                      {metricName && metricValue !== undefined && metricValue !== null && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-gray-500">{metricName}</span>
                            <span className={`text-xs font-semibold ${metricValue >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {metricUnit === '%' ? (metricValue >= 0 ? '+' : '') + metricValue.toFixed(1) + '%' : metricValue.toFixed(1)}
                            </span>
                          </div>
                        </div>
                      )}
                    </button>
                  </div>
                );
              })}
              </div>
              
              {/* Business Model Chart */}
              <div className="flex-shrink-0 pt-1">
                {valuation?.business_model_chart ? (
                  <CompactChart 
                    chartSpec={valuation.business_model_chart} 
                    ticker={ticker}
                    renderingMode="small"
                  />
                ) : (
                  <div className="w-full flex items-center justify-center h-16 text-xs text-gray-400">
                    No chart data available
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Quarter Highlights - Simplified */}
        {analyses.length > 0 && (
          <div>
            <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">Quarter Highlights</h4>
            <div className="flex gap-2 flex-wrap">
              {analyses.map((analysis) => {
                // Use overall_quarter_strength from extracted data, fallback to 'neutral' if not available
                const trend = analysis.overall_quarter_strength || 'neutral';
                
                const formatQuarterLabel = (quarterKey: string): string => {
                  const match = quarterKey.match(/^(\d{4})Q(\d)$/);
                  return match ? `${match[1]} Q${match[2]}` : quarterKey;
                };

                return (
                  <button
                    key={analysis.quarter_key}
                    onClick={() => onQuarterClick(analysis)}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 rounded-lg hover:border-gray-300 hover:shadow-sm transition-all text-sm font-medium text-gray-900"
                  >
                    <span>{formatQuarterLabel(analysis.quarter_key)}</span>
                    {trend === 'up' && (
                      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                      </svg>
                    )}
                    {trend === 'down' && (
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                      </svg>
                    )}
                    {trend === 'neutral' && (
                      <svg className="w-4 h-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Status Badge Component
function StatusBadge({ status }: { status: 'new' | 'on track' | 'at risk' }) {
  const getStatusColor = (status: 'new' | 'on track' | 'at risk'): string => {
    switch (status) {
      case 'new': return 'bg-green-100 text-green-800 border-green-200';
      case 'on track': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'at risk': return 'bg-gray-100 text-gray-800 border-gray-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusLabel = (status: 'new' | 'on track' | 'at risk'): string => {
    switch (status) {
      case 'new': return 'New';
      case 'on track': return '';
      case 'at risk': return 'At Risk';
      default: return status;
    }
  };

  const label = getStatusLabel(status);
  
  // For 'on track', show an icon instead of text
  if (status === 'on track') {
    return (
      <span className={`px-2 py-1 text-xs font-semibold rounded-md border flex-shrink-0 flex items-center justify-center ${getStatusColor(status)}`}>
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  
  // Don't render badge if there's no label
  if (!label) {
    return null;
  }

  return (
    <span className={`px-2 py-1 text-xs font-semibold rounded-md border flex-shrink-0 ${getStatusColor(status)}`}>
      {label}
    </span>
  );
}

// Initiative Card with KPI Component (similar to GrowthCardWithKPI)
function InitiativeCardWithKPI({ metric, initiative }: { metric: KPIMetric; initiative: Initiative }) {
  const chartData = useMemo(() => {
    return metric.values.map((value, idx) => ({
      period: metric.labels?.[idx] || 'Q' + (idx + 1),
      value: value
    }));
  }, [metric]);

  const maxValue = Math.max(...metric.values, 0);
  const minValue = Math.min(...metric.values, 0);
  const range = maxValue - minValue || 1;
  const isPositiveTrend = metric.trend === 'up' || (metric.values.length >= 2 && metric.values[0] > metric.values[metric.values.length - 1]);

  const isRisk = initiative.status === 'at risk';

  const formatValue = (value: number): string => {
    if (metric.unit === '%') {
      return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
    } else if (metric.unit === '$B') {
      return '$' + value.toFixed(1) + 'B';
    }
    return value.toFixed(1);
  };

  return (
    <div className={`bg-gradient-to-br ${isRisk ? 'from-red-50 to-orange-50' : 'from-white to-gray-50'} rounded-lg border ${isRisk ? 'border-red-200' : 'border-gray-200'} p-3 hover:shadow-sm transition-shadow w-full`}>
      <div className="flex items-center justify-between mb-2">
        <h4 className={`text-sm font-bold ${isRisk ? 'text-red-900' : 'text-gray-900'} leading-tight`}>
          {initiative.title}
        </h4>
        <StatusBadge status={initiative.status} />
      </div>
      {initiative.bullet_points && initiative.bullet_points.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {initiative.bullet_points.map((point, ptIdx) => (
            <div key={ptIdx} className="flex items-start gap-1.5 text-xs text-gray-800 leading-relaxed">
              <span className={`${isRisk ? 'text-red-600' : 'text-blue-600'} mt-0.5 flex-shrink-0 font-bold`}>•</span>
              <span>{point}</span>
            </div>
          ))}
        </div>
      )}
      {/* KPI Data */}
      <div className="mt-3 pt-3 border-t border-gray-200">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-gray-500">{metric.name}</span>
          {metric.trend && (
            <div className={`flex-shrink-0 ${metric.trend === 'up' ? 'text-green-600' : metric.trend === 'down' ? 'text-red-600' : 'text-gray-500'}`}>
              {metric.trend === 'up' && (
                <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                </svg>
              )}
              {metric.trend === 'down' && (
                <svg className="w-2 h-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" />
                </svg>
              )}
            </div>
          )}
        </div>
        {metric.values.length > 0 && (
          <div className="mb-2">
            <div className={`text-sm font-semibold ${isPositiveTrend ? 'text-green-600' : 'text-gray-600'}`}>
              {formatValue(metric.values[0])}
            </div>
          </div>
        )}
        {/* Mini Bar Chart */}
        {chartData.length > 1 && (
          <div className="mt-1">
            <div className="flex items-end gap-0.5 h-6">
              {chartData.map((data, idx) => {
                const height = ((data.value - minValue) / range) * 100;
                const isLatest = idx === 0;
                
                return (
                  <div
                    key={idx}
                    className={`rounded-t transition-all ${
                      isLatest
                        ? isPositiveTrend ? 'bg-green-400' : 'bg-gray-400'
                        : 'bg-gray-300'
                    }`}
                    style={{ 
                      height: Math.max(height, 8) + '%',
                      width: '5px',
                      minWidth: '5px'
                    }}
                    title={data.period + ': ' + formatValue(data.value)}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-0.5 text-[10px] text-gray-400">
              <span>{chartData[chartData.length - 1]?.period}</span>
              <span>{chartData[0]?.period}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface QuarterlyAnalysisViewProps {
  analyses: QuarterlyAnalysis[];
  dailyData?: DailyDataPoint[];
  quarterlyData?: QuarterlyDataPoint[];
  normalPERatio?: number | null;
  growthRate?: number | null;
  fairValueRatio?: number;
  quarterlyGrowthRate?: number | null;
}

export default function QuarterlyAnalysisView({ 
  analyses,
  dailyData = [],
  quarterlyData = [],
  normalPERatio = null,
  growthRate = null,
  fairValueRatio = 18,
  quarterlyGrowthRate = null
}: QuarterlyAnalysisViewProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedQuarter, setSelectedQuarter] = useState<QuarterlyAnalysis | null>(null);
  const [selectedInitiative, setSelectedInitiative] = useState<{ initiative: Initiative; kpi?: KPIMetric } | null>(null);
  const [selectedValuationMethod, setSelectedValuationMethod] = useState<string | null>(null);

  // Sort analyses by quarter (most recent first)
  const sortedAnalyses = useMemo(() => {
    return [...analyses].sort((a, b) => {
      const aMatch = a.quarter_key.match(/^(\d{4})Q(\d)$/);
      const bMatch = b.quarter_key.match(/^(\d{4})Q(\d)$/);
      if (!aMatch || !bMatch) return 0;
      const aYear = parseInt(aMatch[1], 10);
      const aQuarter = parseInt(aMatch[2], 10);
      const bYear = parseInt(bMatch[1], 10);
      const bQuarter = parseInt(bMatch[2], 10);
      if (aYear !== bYear) return bYear - aYear;
      return bQuarter - aQuarter;
    });
  }, [analyses]);


  // Get business model and initiatives from most recent analysis
  const mostRecentAnalysis = sortedAnalyses.length > 0 ? sortedAnalyses[0] : null;
  const businessModel = mostRecentAnalysis?.business_model;
  const initiatives = mostRecentAnalysis?.initiatives || [];
  const kpiMetrics = mostRecentAnalysis?.kpi_metrics || [];
  const ticker = mostRecentAnalysis?.ticker || analyses[0]?.ticker || 'AAPL';
  const valuation = mostRecentAnalysis?.valuation;
  
  // Set default valuation method when valuation data loads
  useEffect(() => {
    if (valuation && valuation.methods && valuation.methods.length > 0 && !selectedValuationMethod) {
      const sortedMethods = [...valuation.methods].sort((a, b) => a.preference_order - b.preference_order);
      setSelectedValuationMethod(sortedMethods[0].method);
    }
  }, [valuation, selectedValuationMethod]);
  
  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    console.log('QuarterlyAnalysisView - Valuation data:', valuation);
    console.log('QuarterlyAnalysisView - Has valuation:', !!valuation);
    console.log('QuarterlyAnalysisView - Valuation methods:', valuation?.methods);
  }

  return (
    <div className="space-y-6">
      {/* Business Model Section with Key Growth Factors */}
      {businessModel && (
        <BusinessModelCard 
          businessModel={businessModel}
          initiatives={initiatives}
          kpiMetrics={kpiMetrics}
          analyses={sortedAnalyses}
          ticker={ticker}
          valuation={valuation}
          onQuarterClick={(analysis) => {
            setSelectedQuarter(analysis);
            setDrawerOpen(true);
          }}
          onInitiativeClick={(initiative, kpi) => {
            setSelectedInitiative({ initiative, kpi });
          }}
        />
      )}


      {/* Valuation Section */}
      {dailyData.length > 0 && quarterlyData.length > 0 && (
        <ValuationSection
          dailyData={dailyData}
          quarterlyData={quarterlyData}
          normalPERatio={normalPERatio}
          growthRate={growthRate}
          fairValueRatio={fairValueRatio}
          quarterlyGrowthRate={quarterlyGrowthRate}
          valuation={valuation}
          ticker={ticker}
          selectedValuationMethod={selectedValuationMethod}
          onValuationMethodChange={setSelectedValuationMethod}
        />
      )}

      {/* Investment Ideas */}
      <InvestmentIdeasSection />


      {/* Quarter Details Drawer */}
      {drawerOpen && selectedQuarter && (
        <QuarterlyDetailsDrawer
          analysis={selectedQuarter}
          sortedAnalyses={sortedAnalyses}
          onClose={() => {
            setDrawerOpen(false);
            setSelectedQuarter(null);
          }}
        />
      )}

      {/* Initiative Drawer */}
      {selectedInitiative && (
        <InitiativeDrawer
          initiative={selectedInitiative.initiative}
          kpi={selectedInitiative.kpi}
          ticker={ticker}
          onClose={() => {
            setSelectedInitiative(null);
          }}
        />
      )}
    </div>
  );
}

// Investment Ideas Section Component
function InvestmentIdeasSection() {
  const investmentIdeas = [
    {
      title: 'Steady returns',
      timeFrame: '1–2 years',
      idea: 'Apple continues generating strong cash flow and buying back shares. The company has demonstrated consistent ability to return capital to shareholders through buybacks, which reduces share count and increases earnings per share. With a strong balance sheet and predictable revenue streams from iPhone, Mac, and Services, Apple can maintain this strategy even in moderate economic downturns. The buyback program has historically been a key driver of shareholder value, and there\'s no indication this will change in the near term.',
      mainRisk: 'Earnings slow more than expected.',
      assumedValueCreated: 600,
      impliedAnnualReturn: 4.1
    },
    {
      title: 'Services drive profits',
      timeFrame: '3–5 years',
      idea: 'Services grow faster than hardware and improve profit margins. Apple\'s Services segment, which includes App Store, iCloud, Apple Music, Apple Pay, and other subscription services, has been growing at a faster rate than hardware sales. This shift is significant because Services have much higher profit margins (typically 60-70%) compared to hardware (30-40%). As Services become a larger portion of revenue, overall company margins should expand. The installed base of over 2 billion active devices provides a massive addressable market for these services, and Apple has been successfully monetizing this base through various subscription offerings.',
      mainRisk: 'Pricing pressure or regulation limits growth.',
      assumedValueCreated: 800,
      impliedAnnualReturn: 5.2
    },
    {
      title: 'New product platforms',
      timeFrame: '7–10 years',
      idea: 'Apple creates a new product category that adds a new revenue stream. Historically, Apple has successfully created entirely new product categories that have become massive revenue drivers - the iPhone (2007), iPad (2010), and Apple Watch (2015) are prime examples. The company is currently investing heavily in areas like augmented reality (AR), autonomous vehicles, and health technology. If Apple can successfully launch a new platform in any of these areas, it could unlock a new multi-billion dollar revenue stream. The company\'s track record of innovation, strong brand, and ecosystem integration gives it a significant advantage in bringing new products to market.',
      mainRisk: 'This may never happen.',
      assumedValueCreated: 1200,
      impliedAnnualReturn: 6.8
    }
  ];

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
      <h3 className="text-lg font-bold text-gray-900 mb-6">
        Investment Ideas
      </h3>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {investmentIdeas.map((idea, idx) => (
          <div 
            key={idx} 
            className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-md transition-all duration-200 hover:border-gray-300 flex flex-col h-full"
          >
            {/* Header with Time Frame */}
            <div className="flex items-start justify-between mb-5">
              <h4 className="text-base font-bold text-gray-900 leading-tight">{idea.title}</h4>
              <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium text-gray-600 bg-gray-50 border border-gray-200 whitespace-nowrap">
                {idea.timeFrame}
              </span>
            </div>
            
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-4 mb-5 pb-5 border-b border-gray-200">
              {/* Assumed Value Created */}
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Assumed Value Created</div>
                <div className="text-lg font-bold text-green-600">+${idea.assumedValueCreated}B</div>
              </div>
              
              {/* Implied Annual Return */}
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Implied Annual Return</div>
                <div className="text-lg font-semibold text-gray-900">~{idea.impliedAnnualReturn.toFixed(1)}%</div>
              </div>
            </div>
            
            {/* Content Area - Flex grow to push button down */}
            <div className="flex-1 flex flex-col">
              {/* Idea Section */}
              <div className="mb-4">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex-shrink-0">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-2">Idea</span>
                    <p className="text-sm text-gray-700 leading-relaxed">{idea.idea}</p>
                  </div>
                </div>
              </div>
              
              {/* Risk Section */}
              <div className="pt-4 border-t border-gray-200 mb-4">
                <div className="flex items-start gap-2.5">
                  <div className="mt-0.5 flex-shrink-0">
                    <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide block mb-1.5">Main risk</span>
                    <p className="text-sm text-gray-700 leading-relaxed">{idea.mainRisk}</p>
                  </div>
                </div>
              </div>

              {/* CTA Button - Pushed to bottom with mt-auto */}
              <button className="mt-auto w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 rounded-lg text-sm font-medium transition-colors duration-200 border border-gray-200">
                <span>Explore More</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create Your Own Button */}
      <button className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-gray-50 hover:bg-gray-100 border border-gray-300 hover:border-gray-400 rounded-lg text-sm font-medium text-gray-700 transition-all duration-200 group">
        <svg className="w-4 h-4 text-gray-500 group-hover:text-gray-700 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        <span>Create your own investment idea</span>
      </button>
    </div>
  );
}

// Valuation Section Component
function ValuationSection({
  dailyData,
  quarterlyData,
  normalPERatio,
  growthRate,
  fairValueRatio,
  quarterlyGrowthRate,
  valuation,
  ticker,
  selectedValuationMethod,
  onValuationMethodChange
}: {
  dailyData: DailyDataPoint[];
  quarterlyData: QuarterlyDataPoint[];
  normalPERatio: number | null;
  growthRate: number | null;
  fairValueRatio: number;
  quarterlyGrowthRate: number | null;
  valuation?: import('../types/api').Valuation;
  ticker: string;
  selectedValuationMethod: string | null;
  onValuationMethodChange: (method: string) => void;
}) {
  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-2xl font-bold text-gray-900">Valuation</h3>
        {valuation && valuation.methods && valuation.methods.length > 1 && (
          <ValuationChartSelector
            methods={valuation.methods}
            selectedMethod={selectedValuationMethod}
            onMethodChange={onValuationMethodChange}
          />
        )}
      </div>
      
      {/* Valuation Rationale from Database (constructed from selected method) */}
      {valuation && valuation.methods && valuation.methods.length > 0 && (() => {
        // Get the selected method, or default to the most preferred method
        const selectedMethod = selectedValuationMethod 
          ? valuation.methods.find(m => m.method === selectedValuationMethod)
          : null;
        const methodToShow = selectedMethod || valuation.methods
          .sort((a, b) => a.preference_order - b.preference_order)[0];
        
        return (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <p className="text-base text-gray-700 leading-relaxed">
              {methodToShow.explanation}
              {valuation.business_model_chart && valuation.business_model_chart.metrics.length > 0 && (
                <>
                  {' '}The fair value calculation uses a multiple of annual{' '}
                  <strong>{valuation.business_model_chart.metrics[0]}</strong>, reflecting the company's ability to generate sustainable profits from its business operations.
                </>
              )}
            </p>
          </div>
        );
      })()}

      <StockAnalysisChart
        dailyData={dailyData}
        quarterlyData={quarterlyData}
        currentPeriod="8y"
        normalPERatio={normalPERatio}
        fairValueRatio={fairValueRatio}
        growthRate={growthRate}
        quarterlyGrowthRate={quarterlyGrowthRate}
        forecastYears={2}
        analystPriceTargets={null}
      />
    </div>
  );
}

// Compact Timeline Summary Component (Quarter Highlights Only)
function QuarterlyTimelineSummary({ 
  analyses, 
  onQuarterClick
}: { 
  analyses: QuarterlyAnalysis[]; 
  onQuarterClick: (analysis: QuarterlyAnalysis) => void;
}) {
  if (analyses.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4">
          <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-4">
            Quarter Highlights
          </h3>
          <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100">
            {analyses.map((analysis, idx) => (
              <QuarterlyCard
                key={analysis.quarter_key}
                analysis={analysis}
                index={idx}
                onClick={() => onQuarterClick(analysis)}
              />
            ))}
      </div>
    </div>
  );
}


