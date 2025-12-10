'use client';

import { useState, useEffect, useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, Legend, LabelList } from 'recharts';
import Link from 'next/link';
import { usePathname, useParams, useRouter } from 'next/navigation';
import TickerSearch from '../../components/TickerSearch';
import CompanyInfoCard from '../../components/CompanyInfoCard';

interface KPITimeseriesValue {
  quarter: string;
  value: number | string | null;
  unit: string;
  change?: number | string | null;
  change_type?: string | null;
  frequency?: number;
  context?: string | null;
  source?: string | null;
}

interface KPITimeseries {
  name: string;
  group: string;
  unit: string;
  coverage: number;
  coverage_count: number;
  total_quarters: number;
  max_frequency: number;
  values: KPITimeseriesValue[];
}

interface KPITimeseriesResponse {
  symbol: string;
  kpis: KPITimeseries[];
  metadata: {
    total_quarters: number;
    quarters: string[];
    min_coverage: number;
    min_quarters_required: number;
    total_kpis_extracted: number;
    kpis_included: number;
    kpis_filtered_out: number;
    created_at?: string;
  };
}

type DisplayMode = 'separate' | 'combined-bars' | 'stacked-area' | 'stacked-bars';
type AggregationMode = 'quarterly' | 'annual';

// Reusable Tooltip Component
function KPITooltip({ active, payload, changeType, formatValue, formatChange, aggregationMode }: any) {
  if (!active || !payload || payload.length === 0) return null;
  
  const data = payload[0].payload;
  const isSingleSeries = payload.length === 1;
  const isAnnual = aggregationMode === 'annual';
  
  // Detect if we're in combined chart mode (has aggregate values or KPI-specific keys)
  const isCombinedChart = data._aggregateDisplayYoY !== undefined || 
                          data._aggregateDisplayQoQ !== undefined ||
                          data._annualPercentChange !== undefined ||
                          (payload[0]?.dataKey && data[`${payload[0].dataKey}_displayYoY`] !== undefined);
  
  // Use pre-calculated display values for top line (always show both)
  // For separate charts: use individual KPI's YoY/QoQ
  // For combined charts: use aggregate YoY/QoQ (sum across all KPIs), or fall back to individual if aggregate is null
  let yoyValue: number | null = null;
  let qoqValue: number | null = null;
  let annualPercentChange: number | null = null;
  
  if (isAnnual && isCombinedChart) {
    // Annual mode: prioritize _percentChange (calculated for visible series only)
    // then fall back to _annualPercentChange (includes all series)
    if (data._percentChange !== null && data._percentChange !== undefined && !isNaN(data._percentChange)) {
      annualPercentChange = data._percentChange;
    } else {
      annualPercentChange = data._annualPercentChange ?? null;
    }
  } else if (isCombinedChart) {
    // Combined chart mode (quarterly)
    if (isSingleSeries && payload[0]?.dataKey) {
      // When only 1 series is visible, use that series's individual values
      yoyValue = data[`${payload[0].dataKey}_displayYoY`] ?? null;
      qoqValue = data[`${payload[0].dataKey}_displayQoQ`] ?? null;
    } else {
      // When multiple series are visible, use aggregate values (sum across all KPIs)
      // Fall back to first series's individual value if aggregate is null/undefined
      // For YoY: prioritize _percentChange (used by bar labels, includes only visible series)
      // then fall back to _aggregateDisplayYoY (includes all series)
      if (changeType === 'yoy' && data._percentChange !== null && data._percentChange !== undefined && !isNaN(data._percentChange)) {
        // Use _percentChange to match bar labels (calculated for visible series only)
        yoyValue = data._percentChange;
      } else if (data._aggregateDisplayYoY !== null && data._aggregateDisplayYoY !== undefined && !isNaN(data._aggregateDisplayYoY)) {
        // Use aggregate YoY (includes all KPIs in group)
        yoyValue = data._aggregateDisplayYoY;
      } else if (payload[0]?.dataKey) {
        yoyValue = data[`${payload[0].dataKey}_displayYoY`] ?? null;
      }
      
      // For QoQ: prioritize _percentChange (used by bar labels, includes only visible series)
      // then fall back to _aggregateDisplayQoQ (includes all series)
      if (changeType === 'qoq' && data._percentChange !== null && data._percentChange !== undefined && !isNaN(data._percentChange)) {
        // Use _percentChange to match bar labels (calculated for visible series only)
        qoqValue = data._percentChange;
      } else if (data._aggregateDisplayQoQ !== null && data._aggregateDisplayQoQ !== undefined && !isNaN(data._aggregateDisplayQoQ)) {
        // Use aggregate QoQ (includes all KPIs in group)
        qoqValue = data._aggregateDisplayQoQ;
      } else if (payload[0]?.dataKey) {
        // Last resort: use first series's individual value
        qoqValue = data[`${payload[0].dataKey}_displayQoQ`] ?? null;
      }
    }
  } else {
    // Separate chart mode: use individual values
    if (isAnnual && data.annualPercentChange !== null && data.annualPercentChange !== undefined) {
      annualPercentChange = data.annualPercentChange;
    } else {
      yoyValue = data.displayYoY ?? null;
      qoqValue = data.displayQoQ ?? null;
    }
  }
  
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 min-w-[200px] max-w-md">
      <p className="font-semibold text-gray-900 mb-2 border-b border-gray-200 pb-1">
        {data.quarter}
      </p>
      
      {/* Top line: Annual percent change for annual mode, or YoY/QoQ for quarterly mode */}
      <p className="text-sm font-medium mb-2 pb-2 border-b border-gray-200">
        {isAnnual && annualPercentChange !== null && annualPercentChange !== undefined && (
          <span className={annualPercentChange >= 0 ? 'text-green-600' : 'text-red-600'}>
            Annual: {annualPercentChange >= 0 ? '+' : ''}{annualPercentChange.toFixed(2)}%
          </span>
        )}
        {!isAnnual && yoyValue !== null && yoyValue !== undefined && (
          <span className={yoyValue >= 0 ? 'text-green-600' : 'text-red-600'}>
            YoY: {yoyValue >= 0 ? '+' : ''}{yoyValue.toFixed(2)}%
          </span>
        )}
        {!isAnnual && yoyValue !== null && yoyValue !== undefined && qoqValue !== null && qoqValue !== undefined && (
          <span className="text-gray-400 mx-1">,</span>
        )}
        {!isAnnual && qoqValue !== null && qoqValue !== undefined && (
          <span className={qoqValue >= 0 ? 'text-green-600' : 'text-red-600'}>
            QoQ: {qoqValue >= 0 ? '+' : ''}{qoqValue.toFixed(2)}%
          </span>
        )}
      </p>
      
      {/* Single series mode */}
      {isSingleSeries && (
        <>
          <p className="text-sm text-gray-700 mb-2">
            <span className="font-medium">Value:</span> {
              // For combined charts, use entry.value; for separate charts, use data.value
              isCombinedChart && payload[0]?.value !== undefined
                ? formatValue(payload[0].value, data[`${payload[0].dataKey}_unit`] || '')
                : formatValue(data.value, data.unit)
            }
          </p>
          
          {/* Show selected change type in detail */}
          {changeType === 'qoq' && (
            isCombinedChart && payload[0]?.dataKey
              ? (data[`${payload[0].dataKey}_qoqChange`] !== null && data[`${payload[0].dataKey}_qoqChange`] !== undefined && data[`${payload[0].dataKey}_qoqPreviousQuarter`] && (
                  <p className={`text-sm font-medium mb-1 ${
                    data[`${payload[0].dataKey}_qoqChange`] >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    <span className="font-medium text-gray-700">Change from Previous Quarter ({data[`${payload[0].dataKey}_qoqPreviousQuarter`]}):</span>{' '}
                    {data[`${payload[0].dataKey}_qoqChange`] >= 0 ? '+' : ''}{data[`${payload[0].dataKey}_qoqChange`].toFixed(2)}%
                  </p>
                ))
              : (data.qoqChange !== null && data.qoqChange !== undefined && data.qoqPreviousQuarter && (
                  <p className={`text-sm font-medium mb-1 ${
                    data.qoqChange >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    <span className="font-medium text-gray-700">Change from Previous Quarter ({data.qoqPreviousQuarter}):</span>{' '}
                    {data.qoqChange >= 0 ? '+' : ''}{data.qoqChange.toFixed(2)}%
                  </p>
                ))
          )}
          
          {changeType === 'yoy' && (
            isCombinedChart && payload[0]?.dataKey
              ? (data[`${payload[0].dataKey}_yoyChange`] !== null && data[`${payload[0].dataKey}_yoyChange`] !== undefined && data[`${payload[0].dataKey}_yoyPreviousQuarter`] && (
                  <p className={`text-sm font-medium mb-1 ${
                    data[`${payload[0].dataKey}_yoyChange`] >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    <span className="font-medium text-gray-700">Change Year-over-Year ({data[`${payload[0].dataKey}_yoyPreviousQuarter`]}):</span>{' '}
                    {data[`${payload[0].dataKey}_yoyChange`] >= 0 ? '+' : ''}{data[`${payload[0].dataKey}_yoyChange`].toFixed(2)}%
                  </p>
                ))
              : (data.yoyChange !== null && data.yoyChange !== undefined && data.yoyPreviousQuarter && (
                  <p className={`text-sm font-medium mb-1 ${
                    data.yoyChange >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    <span className="font-medium text-gray-700">Change Year-over-Year ({data.yoyPreviousQuarter}):</span>{' '}
                    {data.yoyChange >= 0 ? '+' : ''}{data.yoyChange.toFixed(2)}%
                  </p>
                ))
          )}
          
          {/* Legacy change field (if present) */}
          {data.change !== null && data.change !== undefined && 
           data.qoqChange === null && data.yoyChange === null && (
            <p className="text-sm text-gray-700 mb-1">
              <span className="font-medium">Change:</span> {formatChange(data.change, data.changeType)}
            </p>
          )}
          
          {(isCombinedChart && payload[0]?.dataKey ? data[`${payload[0].dataKey}_context`] : data.context) && (
            <p className="text-sm text-gray-600 mt-2 pt-2 border-t border-gray-200 max-w-xs">
              <span className="font-medium">Context:</span> {isCombinedChart && payload[0]?.dataKey ? data[`${payload[0].dataKey}_context`] : data.context}
            </p>
          )}
        </>
      )}
      
      {/* Multiple series mode */}
      {!isSingleSeries && payload.map((entry: any, idx: number) => {
        const kpiName = entry.dataKey.replace(/_/g, ' ');
        const context = data[`${entry.dataKey}_context`];
        const unit = data[`${entry.dataKey}_unit`] || '';
        // Use pre-calculated selected change value (for consistency with bar labels)
        const selectedChange = data[`${entry.dataKey}_selectedChangeValue`];
        
        return (
          <div key={idx} className="mb-3 pb-3 border-b border-gray-100 last:border-0 last:mb-0">
            <p className="text-sm font-medium text-gray-700 mb-1">
              <span style={{ color: entry.color }}>●</span> {kpiName}: {formatValue(entry.value, unit)}
              {selectedChange !== null && selectedChange !== undefined && (
                <span className={`ml-2 text-xs font-medium ${
                  selectedChange >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  ({changeType === 'qoq' ? 'QoQ' : 'YoY'}: {selectedChange >= 0 ? '+' : ''}{selectedChange.toFixed(2)}%)
                </span>
              )}
            </p>
            
            {context && (
              <p className="text-xs text-gray-500 mt-1 ml-4">{context}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function KPITestPage() {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const ticker = (params?.ticker as string) || 'AAPL';
  const [data, setData] = useState<KPITimeseriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('stacked-bars');
  const [aggregationMode, setAggregationMode] = useState<AggregationMode>('quarterly');
  const [changeType, setChangeType] = useState<'qoq' | 'yoy'>('yoy'); // Toggle between QoQ and YoY
  // Track visibility of series per group
  const [visibleSeries, setVisibleSeries] = useState<Record<string, Record<string, boolean>>>({});
  // Track focused series per group (the first one clicked)
  const [focusedSeries, setFocusedSeries] = useState<Record<string, string | null>>({});

  const fetchKPIData = async (tickerSymbol: string) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/tickers/timeseries/kpi/${tickerSymbol}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || errorData.message || `Failed to fetch: ${response.status}`);
      }
      
      const kpiData: KPITimeseriesResponse = await response.json();
      setData(kpiData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch KPI data');
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (ticker) {
      fetchKPIData(ticker);
    }
  }, [ticker]);

  // Initialize visibility state when data changes
  useEffect(() => {
    if (data) {
      const groupedKPIs = data.kpis.reduce((acc, kpi) => {
        const group = kpi.group || 'Other';
        if (!acc[group]) {
          acc[group] = [];
        }
        acc[group].push(kpi);
        return acc;
      }, {} as Record<string, typeof data.kpis>);

      setVisibleSeries(prev => {
        const newVisibleSeries: Record<string, Record<string, boolean>> = { ...prev };
        let hasChanges = false;
        
        Object.keys(groupedKPIs).forEach(groupName => {
          if (!newVisibleSeries[groupName]) {
            const initial: Record<string, boolean> = {};
            groupedKPIs[groupName].forEach(kpi => {
              const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
              initial[key] = true;
            });
            newVisibleSeries[groupName] = initial;
            hasChanges = true;
          }
        });
        
        return hasChanges ? newVisibleSeries : prev;
      });
      
      // Reset focused series when data changes
      setFocusedSeries({});
    }
  }, [data]);


  const formatValue = (value: number | null | string | undefined, unit: string): string => {
    if (value === null || value === undefined) return 'N/A';
    
    // Convert to number if it's a string (handle comma-separated numbers)
    let numValue: number;
    if (typeof value === 'string') {
      // Remove commas and other formatting, then parse
      const cleaned = value.replace(/,/g, '').trim();
      numValue = parseFloat(cleaned);
    } else {
      numValue = value;
    }
    
    // Check if conversion resulted in a valid number
    if (isNaN(numValue) || typeof numValue !== 'number') {
      return String(value);
    }
    
    if (unit === '%') {
      return `${numValue.toFixed(2)}%`;
    }
    if (unit === '$B' || unit === 'B') {
      return `$${numValue.toFixed(2)}B`;
    }
    if (unit === '$M' || unit === 'M') {
      return `$${numValue.toFixed(2)}M`;
    }
    if (unit === 'ratio' || unit === '') {
      return numValue.toFixed(2);
    }
    return `${numValue.toFixed(2)} ${unit}`;
  };

  const formatChange = (change: number | string | null | undefined, changeType: string | null | undefined): string => {
    if (change === null || change === undefined) return '';
    
    // Convert to number if it's a string
    const numChange = typeof change === 'string' ? parseFloat(change) : change;
    
    // Check if conversion resulted in a valid number
    if (isNaN(numChange) || typeof numChange !== 'number') {
      return String(change);
    }
    
    const sign = numChange >= 0 ? '+' : '';
    const type = changeType ? ` (${changeType})` : '';
    return `${sign}${numChange.toFixed(2)}${type}`;
  };

  // Calculate annual total (sum of Q1+Q2+Q3+Q4 for a given year)
  const calculateAnnualTotal = (
    values: KPITimeseriesValue[],
    currentQuarter: string
  ): number | null => {
    if (!currentQuarter) return null;
    
    // Check if it's Q4 (handle formats like "2024Q4", "2024-Q4", etc.)
    const isQ4 = currentQuarter.includes('Q4') || currentQuarter.endsWith('Q4');
    if (!isQ4) return null;
    
    // Extract year from quarter string (handle formats like "2024Q4", "2024-Q4", etc.)
    const yearMatch = currentQuarter.match(/(\d{4})/);
    if (!yearMatch) return null;
    
    const year = yearMatch[1];
    
    // Find all quarters for this year (Q1, Q2, Q3, Q4)
    const yearQuarters = values.filter(v => {
      if (!v.quarter) return false;
      return v.quarter.includes(year) && (v.quarter.includes('Q1') || v.quarter.includes('Q2') || v.quarter.includes('Q3') || v.quarter.includes('Q4'));
    });
    
    if (yearQuarters.length === 0) return null;
    
    // Sum all quarter values for the year
    let annualTotal = 0;
    let hasValidValue = false;
    
    yearQuarters.forEach(q => {
      if (q.value !== null && q.value !== undefined) {
        let numValue: number;
        if (typeof q.value === 'string') {
          const cleaned = q.value.replace(/,/g, '').trim();
          numValue = parseFloat(cleaned);
        } else {
          numValue = q.value;
        }
        
        if (!isNaN(numValue)) {
          annualTotal += numValue;
          hasValidValue = true;
        }
      }
    });
    
    return hasValidValue ? annualTotal : null;
  };

  // Calculate quarter-over-quarter change (from previous quarter)
  const calculateQuarterOverQuarterChange = (
    values: KPITimeseriesValue[],
    currentQuarter: string
  ): { change: number; previousQuarter: string } | null => {
    if (!currentQuarter) return null;
    
    // Find current quarter index
    const currentIndex = values.findIndex(v => v.quarter === currentQuarter);
    if (currentIndex < 0 || currentIndex === 0) return null; // No previous quarter
    
    const currentValue = values[currentIndex];
    const previousValue = values[currentIndex - 1];
    
    if (!currentValue || !previousValue) return null;
    if (currentValue.value === null || currentValue.value === undefined) return null;
    if (previousValue.value === null || previousValue.value === undefined) return null;
    
    // Convert to numbers
    let currentNum: number;
    let previousNum: number;
    
    if (typeof currentValue.value === 'string') {
      const cleaned = currentValue.value.replace(/,/g, '').trim();
      currentNum = parseFloat(cleaned);
    } else {
      currentNum = currentValue.value;
    }
    
    if (typeof previousValue.value === 'string') {
      const cleaned = previousValue.value.replace(/,/g, '').trim();
      previousNum = parseFloat(cleaned);
    } else {
      previousNum = previousValue.value;
    }
    
    if (isNaN(currentNum) || isNaN(previousNum) || previousNum === 0) {
      return null;
    }
    
    const change = ((currentNum - previousNum) / previousNum) * 100;
    return { change, previousQuarter: previousValue.quarter };
  };

  // Calculate year-over-year change (same quarter, previous year)
  const calculateYearOverYearChange = (
    values: KPITimeseriesValue[],
    currentQuarter: string
  ): { change: number; previousYearQuarter: string } | null => {
    if (!currentQuarter) return null;
    
    // Extract year and quarter from current quarter string
    const yearMatch = currentQuarter.match(/(\d{4})/);
    if (!yearMatch) return null;
    
    const currentYear = parseInt(yearMatch[1], 10);
    const previousYear = currentYear - 1;
    
    // Extract quarter number (Q1, Q2, Q3, Q4)
    const quarterMatch = currentQuarter.match(/Q(\d)/);
    if (!quarterMatch) return null;
    const quarterNum = quarterMatch[1];
    
    // Find previous year's same quarter
    const previousYearQuarterOptions = [
      `${previousYear}Q${quarterNum}`,
      `${previousYear}-Q${quarterNum}`,
      `${previousYear} Q${quarterNum}`
    ];
    
    const currentValue = values.find(v => v.quarter === currentQuarter);
    let previousYearValue: KPITimeseriesValue | undefined;
    
    for (const option of previousYearQuarterOptions) {
      previousYearValue = values.find(v => v.quarter === option);
      if (previousYearValue) break;
    }
    
    // If not found, try flexible matching
    if (!previousYearValue) {
      previousYearValue = values.find(v => {
        if (!v.quarter) return false;
        const match = v.quarter.match(/(\d{4})/);
        return match && parseInt(match[1], 10) === previousYear && v.quarter.includes(`Q${quarterNum}`);
      });
    }
    
    if (!currentValue || !previousYearValue) return null;
    if (currentValue.value === null || currentValue.value === undefined) return null;
    if (previousYearValue.value === null || previousYearValue.value === undefined) return null;
    
    // Convert to numbers
    let currentNum: number;
    let previousNum: number;
    
    if (typeof currentValue.value === 'string') {
      const cleaned = currentValue.value.replace(/,/g, '').trim();
      currentNum = parseFloat(cleaned);
    } else {
      currentNum = currentValue.value;
    }
    
    if (typeof previousYearValue.value === 'string') {
      const cleaned = previousYearValue.value.replace(/,/g, '').trim();
      previousNum = parseFloat(cleaned);
    } else {
      previousNum = previousYearValue.value;
    }
    
    if (isNaN(currentNum) || isNaN(previousNum) || previousNum === 0) {
      return null;
    }
    
    const change = ((currentNum - previousNum) / previousNum) * 100;
    return { change, previousYearQuarter: previousYearValue.quarter };
  };

  // Calculate annual percent change for Q4 quarters (comparing to Q4 of previous year)
  const calculateAnnualPercentChange = (
    values: KPITimeseriesValue[],
    currentQuarter: string
  ): number | null => {
    if (!currentQuarter) return null;
    
    // Check if it's Q4 (handle formats like "2024Q4", "2024-Q4", etc.)
    const isQ4 = currentQuarter.includes('Q4') || currentQuarter.endsWith('Q4');
    if (!isQ4) return null;
    
    // Extract year from quarter string (handle formats like "2024Q4", "2024-Q4", etc.)
    const yearMatch = currentQuarter.match(/(\d{4})/);
    if (!yearMatch) return null;
    
    const currentYear = parseInt(yearMatch[1], 10);
    const previousYear = currentYear - 1;
    
    // Find previous year's Q4 (try different formats)
    const previousYearQ4Options = [
      `${previousYear}Q4`,
      `${previousYear}-Q4`,
      `${previousYear} Q4`
    ];
    
    let previousYearQ4: string | null = null;
    for (const option of previousYearQ4Options) {
      const found = values.find(v => v.quarter === option || v.quarter?.includes(`${previousYear}`) && v.quarter?.includes('Q4'));
      if (found) {
        previousYearQ4 = found.quarter;
        break;
      }
    }
    
    if (!previousYearQ4) {
      // Try to find any Q4 from previous year
      const prevYearQ4 = values.find(v => {
        if (!v.quarter) return false;
        const match = v.quarter.match(/(\d{4})/);
        return match && parseInt(match[1], 10) === previousYear && (v.quarter.includes('Q4') || v.quarter.endsWith('Q4'));
      });
      if (prevYearQ4) {
        previousYearQ4 = prevYearQ4.quarter;
      }
    }
    
    if (!previousYearQ4) return null;
    
    // Calculate annual totals for current and previous year
    const currentAnnualTotal = calculateAnnualTotal(values, currentQuarter);
    const previousAnnualTotal = calculateAnnualTotal(values, previousYearQ4);
    
    if (currentAnnualTotal === null || previousAnnualTotal === null || previousAnnualTotal === 0) {
      return null;
    }
    
    // Calculate annual percent change based on annual totals
    const annualChange = ((currentAnnualTotal - previousAnnualTotal) / previousAnnualTotal) * 100;
    return annualChange;
  };

  // Generate colors for KPIs
  const getKPIColor = (index: number, total: number): string => {
    const colors = [
      '#3b82f6', // blue
      '#10b981', // green
      '#f59e0b', // amber
      '#ef4444', // red
      '#8b5cf6', // purple
      '#ec4899', // pink
      '#06b6d4', // cyan
      '#84cc16', // lime
    ];
    return colors[index % colors.length];
  };

  // Calculate average value for a KPI (used for sorting stacked charts)
  const calculateKPIAverage = (kpi: KPITimeseries, useAnnual: boolean = false): number => {
    const values = useAnnual ? aggregateToAnnual(kpi.values, kpi.name, kpi.unit) : kpi.values;
    const numericValues: number[] = [];
    
    values.forEach(v => {
      if (v.value !== null && v.value !== undefined) {
        let numValue: number;
        if (typeof v.value === 'string') {
          const cleaned = v.value.replace(/,/g, '').trim();
          numValue = parseFloat(cleaned);
        } else {
          numValue = v.value;
        }
        if (!isNaN(numValue)) {
          numericValues.push(numValue);
        }
      }
    });
    
    if (numericValues.length === 0) return 0;
    return numericValues.reduce((sum, val) => sum + val, 0) / numericValues.length;
  };

  // Sort KPIs by average value (descending) for stacked charts
  const sortKPIsByValue = (kpis: KPITimeseries[], useAnnual: boolean = false): KPITimeseries[] => {
    return [...kpis].sort((a, b) => {
      const avgA = calculateKPIAverage(a, useAnnual);
      const avgB = calculateKPIAverage(b, useAnnual);
      return avgB - avgA; // Descending order (bigger values first)
    });
  };

  // Aggregate quarterly values into annual values
  const aggregateToAnnual = (values: KPITimeseriesValue[], kpiName: string, unit: string): KPITimeseriesValue[] => {
    // Group by year
    const byYear: Record<string, KPITimeseriesValue[]> = {};
    
    values.forEach(v => {
      if (v.value === null || v.value === undefined) return;
      const year = v.quarter.substring(0, 4);
      if (!byYear[year]) {
        byYear[year] = [];
      }
      byYear[year].push(v);
    });
    
    // Aggregate each year
    const annualValues: KPITimeseriesValue[] = [];
    Object.keys(byYear).sort().forEach(year => {
      const quarters = byYear[year].sort((a, b) => a.quarter.localeCompare(b.quarter));
      
      // Determine if this is a revenue-type KPI (should sum) or ratio-type (should average)
      const isRevenueType = kpiName.toLowerCase().includes('revenue') || 
                           kpiName.toLowerCase().includes('sales') ||
                           unit.toLowerCase().includes('million') ||
                           unit.toLowerCase().includes('billion') ||
                           unit.toLowerCase().includes('$');
      
      let aggregatedValue: number | null = null;
      let aggregatedContext = '';
      
      if (quarters.length > 0) {
        const numericValues: number[] = [];
        const contexts: string[] = [];
        
        quarters.forEach(q => {
          let numValue: number | null = null;
          if (q.value !== null && q.value !== undefined) {
            if (typeof q.value === 'string') {
              const cleaned = q.value.replace(/,/g, '').trim();
              numValue = parseFloat(cleaned);
            } else {
              numValue = q.value;
            }
          }
          
          if (numValue !== null && !isNaN(numValue)) {
            numericValues.push(numValue);
            if (q.context) {
              contexts.push(q.context);
            }
          }
        });
        
        if (numericValues.length > 0) {
          if (isRevenueType) {
            // Sum for revenue-type KPIs
            aggregatedValue = numericValues.reduce((sum, val) => sum + val, 0);
          } else {
            // Average for ratio/percentage KPIs
            aggregatedValue = numericValues.reduce((sum, val) => sum + val, 0) / numericValues.length;
          }
          
          if (contexts.length > 0) {
            aggregatedContext = `Annual aggregate (${quarters.length} quarters): ${contexts[0]}`;
          }
        }
      }
      
      annualValues.push({
        quarter: `${year} Annual`,
        value: aggregatedValue,
        unit: unit,
        change: null,
        change_type: null,
        frequency: quarters.length,
        context: aggregatedContext || null,
        source: null
      });
    });
    
    return annualValues;
  };

  // Prepare combined data for a group
  const prepareCombinedData = (kpis: KPITimeseries[], useAnnual: boolean = false, currentChangeType: 'qoq' | 'yoy' = 'yoy') => {
    // Get all unique quarters or years
    const allPeriods = new Set<string>();
    
    kpis.forEach(kpi => {
      const values = useAnnual ? aggregateToAnnual(kpi.values, kpi.name, kpi.unit) : kpi.values;
      values.forEach(v => allPeriods.add(v.quarter));
    });
    
    const sortedPeriods = Array.from(allPeriods).sort((a, b) => {
      // Sort annual periods correctly
      if (a.includes('Annual') && b.includes('Annual')) {
        return a.substring(0, 4).localeCompare(b.substring(0, 4));
      }
      return a.localeCompare(b);
    });

    // Create data points for each period
    const dataPoints = sortedPeriods.map(period => {
      const dataPoint: any = { quarter: period };
      
      kpis.forEach(kpi => {
        const values = useAnnual ? aggregateToAnnual(kpi.values, kpi.name, kpi.unit) : kpi.values;
        const value = values.find(v => v.quarter === period);
        let numValue: number | null = null;
        
        if (value?.value !== null && value?.value !== undefined) {
          if (typeof value.value === 'string') {
            // Handle comma-separated numbers
            const cleaned = value.value.replace(/,/g, '').trim();
            numValue = parseFloat(cleaned);
          } else {
            numValue = value.value;
          }
        }
        
        // Use a safe key (sanitize KPI name)
        const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
        dataPoint[key] = numValue !== null && !isNaN(numValue) ? numValue : 0;
        dataPoint[`${key}_context`] = value?.context || '';
        dataPoint[`${key}_unit`] = value?.unit || kpi.unit;
        dataPoint[`${key}_change`] = value?.change || null;
        dataPoint[`${key}_changeType`] = value?.change_type || null;
        
        // Calculate verbose changes for quarterly mode
        if (!useAnnual) {
          const qoqChange = calculateQuarterOverQuarterChange(kpi.values, period);
          const yoyChange = calculateYearOverYearChange(kpi.values, period);
          
          dataPoint[`${key}_qoqChange`] = qoqChange?.change || null;
          dataPoint[`${key}_qoqPreviousQuarter`] = qoqChange?.previousQuarter || null;
          dataPoint[`${key}_yoyChange`] = yoyChange?.change || null;
          dataPoint[`${key}_yoyPreviousQuarter`] = yoyChange?.previousYearQuarter || null;
          
          // Calculate display values for tooltip top line (always show both)
          dataPoint[`${key}_displayYoY`] = yoyChange?.change || null;
          dataPoint[`${key}_displayQoQ`] = qoqChange?.change || null;
          
          // Calculate selected change value (for bar labels and tooltip consistency)
          dataPoint[`${key}_selectedChangeValue`] = currentChangeType === 'qoq'
            ? (qoqChange?.change || null)
            : (yoyChange?.change || null);
        }
      });
      
      return dataPoint;
    });
    
    // Calculate aggregate display values for tooltip top line (sum across all KPIs)
    if (!useAnnual) {
      dataPoints.forEach((dataPoint, idx) => {
        // Calculate current total (sum of all KPI values)
        let currentTotal = 0;
        kpis.forEach(kpi => {
          const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
          currentTotal += dataPoint[key] || 0;
        });
        
        // Parse quarter string once for both QoQ and YoY calculations
        const quarterStr = dataPoint.quarter ? String(dataPoint.quarter) : '';
        const yearMatch = quarterStr.match(/(\d{4})/);
        const quarterMatch = quarterStr.match(/Q(\d)/);
        
        // Calculate QoQ: find previous quarter and sum its values
        let qoqValue: number | null = null;
        if (yearMatch && quarterMatch) {
          const currentYear = parseInt(yearMatch[1], 10);
          const currentQuarterNum = parseInt(quarterMatch[1], 10);
          
          // Calculate previous quarter
          let previousYear = currentYear;
          let previousQuarterNum = currentQuarterNum - 1;
          
          if (previousQuarterNum < 1) {
            previousQuarterNum = 4;
            previousYear = currentYear - 1;
          }
          
          const previousQuarter = `${previousYear}Q${previousQuarterNum}`;
          
          // Find previous quarter's data point
          const prevQuarterDataPoint = dataPoints.find(d => 
            d.quarter === previousQuarter || 
            (d.quarter && String(d.quarter).includes(`${previousYear}`) && String(d.quarter).includes(`Q${previousQuarterNum}`))
          );
          
          if (prevQuarterDataPoint) {
            let prevTotal = 0;
            kpis.forEach(kpi => {
              const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
              prevTotal += prevQuarterDataPoint[key] || 0;
            });
            if (prevTotal > 0) {
              qoqValue = ((currentTotal - prevTotal) / prevTotal) * 100;
            }
          }
        }
        
        // Calculate YoY: find previous year's same quarter and sum its values
        let yoyValue: number | null = null;
        if (yearMatch && quarterMatch) {
          const currentYear = parseInt(yearMatch[1], 10);
          const previousYear = currentYear - 1;
          const quarterNum = quarterMatch[1];
          const previousYearQuarter = `${previousYear}Q${quarterNum}`;
          
          // Find previous year's same quarter
          const prevYearDataPoint = dataPoints.find(d => 
            d.quarter === previousYearQuarter || 
            (d.quarter && String(d.quarter).includes(`${previousYear}`) && String(d.quarter).includes(`Q${quarterNum}`))
          );
          
          if (prevYearDataPoint) {
            let prevYearTotal = 0;
            kpis.forEach(kpi => {
              const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
              prevYearTotal += prevYearDataPoint[key] || 0;
            });
            if (prevYearTotal > 0) {
              yoyValue = ((currentTotal - prevYearTotal) / prevYearTotal) * 100;
            }
          }
        }
        
        // Store aggregate values
        dataPoint._aggregateDisplayYoY = yoyValue;
        dataPoint._aggregateDisplayQoQ = qoqValue;
      });
    } else {
      // Calculate annual percent change (comparing annual totals year-over-year)
      dataPoints.forEach((dataPoint, idx) => {
        // Calculate current annual total (sum of all KPI values for this year)
        let currentTotal = 0;
        kpis.forEach(kpi => {
          const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
          currentTotal += dataPoint[key] || 0;
        });
        
        // Parse year from period string (e.g., "2024 Annual")
        const periodStr = dataPoint.quarter ? String(dataPoint.quarter) : '';
        const yearMatch = periodStr.match(/(\d{4})/);
        
        if (yearMatch && currentTotal > 0) {
          const currentYear = parseInt(yearMatch[1], 10);
          const previousYear = currentYear - 1;
          const previousYearPeriod = `${previousYear} Annual`;
          
          // Find previous year's annual data point
          const prevYearDataPoint = dataPoints.find(d => 
            d.quarter === previousYearPeriod || 
            (d.quarter && String(d.quarter).includes(`${previousYear}`) && String(d.quarter).includes('Annual'))
          );
          
          if (prevYearDataPoint) {
            let prevYearTotal = 0;
            kpis.forEach(kpi => {
              const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
              prevYearTotal += prevYearDataPoint[key] || 0;
            });
            
            if (prevYearTotal > 0) {
              const annualPercentChange = ((currentTotal - prevYearTotal) / prevYearTotal) * 100;
              dataPoint._annualPercentChange = annualPercentChange;
            } else {
              dataPoint._annualPercentChange = null;
            }
          } else {
            dataPoint._annualPercentChange = null;
          }
        } else {
          dataPoint._annualPercentChange = null;
        }
      });
    }
    
    return dataPoints;
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      {/* Top Navigation Bar */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="w-full max-w-none px-6 py-3">
          <div className="flex items-center gap-6">
            {/* Logo/Brand */}
            <div className="flex-shrink-0">
              <div className="text-lg font-bold text-blue-600 tracking-tight">StockAnalysis</div>
            </div>
            {/* Ticker Search Bar */}
            <div className="flex-1 max-w-md">
              <TickerSearch 
                selectedTicker={ticker}
                onTickerChange={(newTicker) => {
                  router.push(`/${newTicker}/kpi`);
                }}
              />
            </div>
            {/* Navigation Items */}
            <nav className="flex items-center gap-6 flex-shrink-0">
              <Link
                href={`/${ticker}/value`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${ticker}/value`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                Value
              </Link>
              <Link
                href={`/${ticker}/kpi`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${ticker}/kpi`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                KPI
              </Link>
              <Link
                href={`/${ticker}/documents`}
                className={`pb-3 px-1 border-b-2 transition-colors text-sm font-medium ${
                  pathname === `/${ticker}/documents`
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-700 hover:text-gray-900'
                }`}
              >
                Documents
              </Link>
            </nav>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full max-w-none px-6 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
          {/* Main Content Area - 3/4 width */}
          <div className="xl:col-span-3">
            {/* Page Title and Controls */}
            <div className="flex items-center justify-between mb-6">
              <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                KPI Timeseries Analysis
              </h1>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">Chart:</span>
                  <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => setDisplayMode('separate')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                        displayMode === 'separate'
                          ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      Separate
                    </button>
                    <button
                      onClick={() => setDisplayMode('combined-bars')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                        displayMode === 'combined-bars'
                          ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      Combined Bars
                    </button>
                    <button
                      onClick={() => setDisplayMode('stacked-area')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                        displayMode === 'stacked-area'
                          ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      Stacked Area
                    </button>
                    <button
                      onClick={() => setDisplayMode('stacked-bars')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                        displayMode === 'stacked-bars'
                          ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      Stacked Bars
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">Period:</span>
                  <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => setAggregationMode('quarterly')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                        aggregationMode === 'quarterly'
                          ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      Quarterly
                    </button>
                    <button
                      onClick={() => setAggregationMode('annual')}
                      className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                        aggregationMode === 'annual'
                          ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      Annual
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-700">Change:</span>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={changeType === 'yoy'}
                      onChange={() => setChangeType(changeType === 'yoy' ? 'qoq' : 'yoy')}
                      className="sr-only"
                    />
                    <div className={`w-7 h-4 rounded-full transition-colors ${
                      changeType === 'yoy' ? 'bg-gray-400' : 'bg-gray-200'
                    }`}>
                      <div className={`absolute top-[1px] left-[1px] bg-white border border-gray-300 rounded-full h-3 w-3 transition-transform ${
                        changeType === 'yoy' ? 'translate-x-3' : 'translate-x-0'
                      }`}></div>
                    </div>
                    <span className="ml-2 text-xs text-gray-600 font-medium">
                      {changeType === 'yoy' ? 'YoY' : 'QoQ'}
                    </span>
                  </label>
                </div>
              </div>
            </div>

            {/* Loading State */}
            {loading && (
              <div className="bg-white rounded-lg shadow-sm p-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
                <p className="text-gray-600">Loading KPI data...</p>
              </div>
            )}

            {/* Error State */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
                <p className="text-red-800 font-medium">Error: {error}</p>
              </div>
            )}

            {/* Data Display */}
            {!loading && !error && data && (
              <>

            {/* KPIs List - Grouped by Group */}
            <div className="space-y-8">
              {(() => {
                // Group KPIs by their group property
                const groupedKPIs = data.kpis.reduce((acc, kpi) => {
                  const group = kpi.group || 'Other';
                  if (!acc[group]) {
                    acc[group] = [];
                  }
                  acc[group].push(kpi);
                  return acc;
                }, {} as Record<string, typeof data.kpis>);

                // Sort groups by number of KPIs (descending), then alphabetically
                const sortedGroups = Object.keys(groupedKPIs).sort((a, b) => {
                  const countA = groupedKPIs[a].length;
                  const countB = groupedKPIs[b].length;
                  // Sort by count first (descending)
                  if (countA !== countB) {
                    return countB - countA;
                  }
                  // If counts are equal, sort alphabetically
                  return a.localeCompare(b);
                });

                return sortedGroups.map((groupName) => {
                  const groupKPIs = groupedKPIs[groupName];
                  const combinedData = prepareCombinedData(groupKPIs, aggregationMode === 'annual', changeType);
                  
                  // Get visibility state for this group (defaults to all visible)
                  const groupVisibleSeries = visibleSeries[groupName] || (() => {
                    const initial: Record<string, boolean> = {};
                    groupKPIs.forEach(kpi => {
                      const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                      initial[key] = true; // All visible by default
                    });
                    return initial;
                  })();
                  
                const toggleSeries = (seriesKey: string) => {
                  setVisibleSeries(prev => {
                    const currentGroup = prev[groupName] || {};
                    const currentFocused = focusedSeries[groupName];
                    
                    // Check if all series are currently visible
                    const allVisible = groupKPIs.every(kpi => {
                      const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                      return currentGroup[key] !== false;
                    });
                    
                    // Count how many series are currently visible
                    const visibleCount = groupKPIs.filter(kpi => {
                      const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                      return currentGroup[key] !== false;
                    }).length;
                    
                    // If all series are visible (no focus state), focus on this one
                    if (allVisible && !currentFocused) {
                      const newGroup: Record<string, boolean> = {};
                      groupKPIs.forEach(kpi => {
                        const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                        newGroup[key] = key === seriesKey; // Only the clicked one is visible
                      });
                      
                      setFocusedSeries(prevFocused => ({
                        ...prevFocused,
                        [groupName]: seriesKey
                      }));
                      
                      return {
                        ...prev,
                        [groupName]: newGroup
                      };
                    }
                    
                    // If this is the focused series
                    if (currentFocused === seriesKey) {
                      // If it's the only visible series, reset to all visible
                      if (visibleCount === 1) {
                        const newGroup: Record<string, boolean> = {};
                        groupKPIs.forEach(kpi => {
                          const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                          newGroup[key] = true; // Show all
                        });
                        
                        setFocusedSeries(prevFocused => ({
                          ...prevFocused,
                          [groupName]: null
                        }));
                        
                        return {
                          ...prev,
                          [groupName]: newGroup
                        };
                      } else {
                        // Otherwise, just toggle it off (hide it)
                        const updatedGroup = {
                          ...currentGroup,
                          [seriesKey]: false
                        };
                        
                        return {
                          ...prev,
                          [groupName]: updatedGroup
                        };
                      }
                    }
                    
                    // Otherwise, toggle this series (add/remove from visible set)
                    const currentValue = currentGroup[seriesKey];
                    const newValue = currentValue === false ? true : false;
                    const updatedGroup = {
                      ...currentGroup,
                      [seriesKey]: newValue
                    };
                    
                    // Check if all series are now visible after this toggle
                    const allVisibleAfterToggle = groupKPIs.every(kpi => {
                      const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                      return updatedGroup[key] !== false;
                    });
                    
                    // If all are visible again, clear the focus state
                    if (allVisibleAfterToggle && currentFocused) {
                      setFocusedSeries(prevFocused => ({
                        ...prevFocused,
                        [groupName]: null
                      }));
                    }
                    
                    return {
                      ...prev,
                      [groupName]: updatedGroup
                    };
                  });
                };
                  
                  return (
                    <div key={groupName} className="space-y-4">
                      {/* Group Header */}
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-500 rounded-lg p-4">
                        <h2 className="text-2xl font-bold text-gray-900">{groupName}</h2>
                      </div>

                      {/* Render based on display mode */}
                      {displayMode === 'separate' && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          {groupKPIs.map((kpi, index) => (
                            <div key={index} className="bg-white rounded-lg shadow-sm p-6">
                              <div className="mb-4">
                                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                                  {kpi.name}
                                  {kpi.unit && (
                                    <span className="ml-2 text-xs font-normal text-gray-400">
                                      ({kpi.unit})
                                    </span>
                                  )}
                                </h3>
                              </div>

                              {/* Bar Chart */}
                              <div>
                                <ResponsiveContainer width="100%" height={250}>
                                  <BarChart
                                    data={(aggregationMode === 'annual' 
                                      ? aggregateToAnnual(kpi.values, kpi.name, kpi.unit)
                                      : kpi.values
                                    ).map((v, idx) => {
                                      // Handle string values with commas
                                      let numValue: number | null = null;
                                      if (v.value !== null && v.value !== undefined) {
                                        if (typeof v.value === 'string') {
                                          const cleaned = v.value.replace(/,/g, '').trim();
                                          numValue = parseFloat(cleaned);
                                        } else {
                                          numValue = v.value;
                                        }
                                      }
                                      
                                      // Calculate various changes for display
                                      const qoqChange = aggregationMode === 'quarterly' 
                                        ? calculateQuarterOverQuarterChange(kpi.values, v.quarter)
                                        : null;
                                      const yoyChange = aggregationMode === 'quarterly' 
                                        ? calculateYearOverYearChange(kpi.values, v.quarter)
                                        : null;
                                      
                                      // Calculate annual percent change for annual mode
                                      let annualPercentChange: number | null = null;
                                      if (aggregationMode === 'annual') {
                                        const periodStr = v.quarter ? String(v.quarter) : '';
                                        const yearMatch = periodStr.match(/(\d{4})/);
                                        
                                        if (yearMatch && numValue !== null && !isNaN(numValue) && numValue > 0) {
                                          const currentYear = parseInt(yearMatch[1], 10);
                                          const previousYear = currentYear - 1;
                                          const previousYearPeriod = `${previousYear} Annual`;
                                          
                                          // Find previous year's annual value
                                          const annualValues = aggregateToAnnual(kpi.values, kpi.name, kpi.unit);
                                          const prevYearValue = annualValues.find(av => 
                                            av.quarter === previousYearPeriod || 
                                            (av.quarter && String(av.quarter).includes(`${previousYear}`) && String(av.quarter).includes('Annual'))
                                          );
                                          
                                          if (prevYearValue && prevYearValue.value !== null && prevYearValue.value !== undefined) {
                                            let prevNumValue: number;
                                            if (typeof prevYearValue.value === 'string') {
                                              const cleaned = prevYearValue.value.replace(/,/g, '').trim();
                                              prevNumValue = parseFloat(cleaned);
                                            } else {
                                              prevNumValue = prevYearValue.value;
                                            }
                                            
                                            if (!isNaN(prevNumValue) && prevNumValue > 0) {
                                              annualPercentChange = ((numValue - prevNumValue) / prevNumValue) * 100;
                                            }
                                          }
                                        }
                                      }
                                      
                                      // Calculate the selected change value (for bar labels and tooltip consistency)
                                      const selectedChangeValue = aggregationMode === 'annual'
                                        ? annualPercentChange
                                        : (changeType === 'qoq'
                                          ? (qoqChange?.change || null)
                                          : (yoyChange?.change || null));
                                      
                                      return {
                                        quarter: v.quarter,
                                        value: numValue !== null && !isNaN(numValue) ? numValue : 0,
                                        context: v.context || '',
                                        change: v.change,
                                        changeType: v.change_type,
                                        unit: v.unit || kpi.unit,
                                        hasValue: v.value !== null && v.value !== undefined,
                                        qoqChange: qoqChange?.change || null,
                                        qoqPreviousQuarter: qoqChange?.previousQuarter || null,
                                        yoyChange: yoyChange?.change || null,
                                        yoyPreviousQuarter: yoyChange?.previousYearQuarter || null,
                                        annualPercentChange: annualPercentChange,
                                        selectedChangeValue: selectedChangeValue,
                                        // For tooltip top line - always show both
                                        displayYoY: yoyChange?.change || null,
                                        displayQoQ: qoqChange?.change || null
                                      };
                                    })}
                                    margin={{ top: 40, right: 30, left: 20, bottom: 5 }}
                                  >
                                    <XAxis 
                                      dataKey="quarter" 
                                      angle={-45}
                                      textAnchor="end"
                                      height={80}
                                      tick={{ fontSize: 12 }}
                                    />
                                    <YAxis 
                                      tick={{ fontSize: 12 }}
                                      label={{ value: kpi.unit || 'Value', angle: -90, position: 'insideLeft' }}
                                    />
                                    <Tooltip
                                      wrapperStyle={{ zIndex: 1000 }}
                                      content={(props: any) => (
                                        <KPITooltip {...props} changeType={changeType} formatValue={formatValue} formatChange={formatChange} aggregationMode={aggregationMode} />
                                      )}
                                    />
                                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                                      <LabelList
                                        dataKey="quarter"
                                        position="top"
                                        content={(props: any) => {
                                          const { x, y, width, payload } = props;
                                          
                                          if (!payload || !payload.quarter) return null;
                                          const quarterStr = String(payload.quarter);
                                          const isQ4 = quarterStr.includes('Q4') || quarterStr.endsWith('Q4');
                                          
                                          // Use pre-calculated selected change value
                                          const changeValue = payload.selectedChangeValue !== null && payload.selectedChangeValue !== undefined && !isNaN(Number(payload.selectedChangeValue))
                                            ? Number(payload.selectedChangeValue)
                                            : null;
                                          const changeLabel = aggregationMode === 'annual' ? 'Annual' : (changeType === 'qoq' ? 'QoQ' : 'YoY');
                                          
                                          // Only render if we have a change value to show
                                          if (changeValue === null) return null;
                                          
                                          // Calculate center x position of the bar
                                          const centerX = x + (width / 2);
                                          
                                          return (
                                            <text
                                              x={centerX}
                                              y={y - 5}
                                              fill={changeValue >= 0 ? '#10b981' : '#ef4444'}
                                              fontSize={11}
                                              fontWeight={600}
                                              textAnchor="middle"
                                            >
                                              {changeValue >= 0 ? '+' : ''}{changeValue.toFixed(1)}% {changeLabel}
                                            </text>
                                          );
                                        }}
                                      />
                                      {kpi.values.map((entry, index) => {
                                        const hasValue = entry.value !== null && entry.value !== undefined;
                                        return (
                                          <Cell 
                                            key={`cell-${index}`} 
                                            fill={hasValue ? '#3b82f6' : '#e5e7eb'}
                                            opacity={hasValue ? 1 : 0.5}
                                          />
                                        );
                                      })}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {displayMode === 'combined-bars' && (
                        <div className="bg-white rounded-lg shadow-sm p-6">
                          <ResponsiveContainer width="100%" height={400}>
                            <BarChart
                              maxBarSize={aggregationMode === 'annual' ? 80 : undefined}
                              data={combinedData}
                              margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
                            >
                              <XAxis 
                                dataKey="quarter" 
                                angle={-45}
                                textAnchor="end"
                                height={100}
                                tick={{ fontSize: 12 }}
                              />
                              <YAxis 
                                tick={{ fontSize: 12 }}
                              />
                              <Tooltip
                                wrapperStyle={{ zIndex: 1000 }}
                                content={(props: any) => (
                                  <KPITooltip {...props} changeType={changeType} formatValue={formatValue} formatChange={formatChange} aggregationMode={aggregationMode} />
                                )}
                              />
                              <Legend 
                                onClick={(e: any) => {
                                  if (e.dataKey) {
                                    toggleSeries(e.dataKey);
                                  }
                                }}
                                wrapperStyle={{ cursor: 'pointer' }}
                                iconType="line"
                                formatter={(value: string, entry: any) => {
                                  const key = entry.dataKey || entry.payload?.dataKey;
                                  const isHidden = key ? groupVisibleSeries[key] === false : false;
                                  const isFocused = key ? focusedSeries[groupName] === key : false;
                                  return (
                                    <span style={{ 
                                      opacity: isHidden ? 0.5 : 1,
                                      textDecoration: isHidden ? 'line-through' : 'none',
                                      fontWeight: isFocused ? 'bold' : 'normal',
                                      cursor: 'pointer',
                                      borderBottom: isFocused ? '2px solid currentColor' : 'none',
                                      paddingBottom: isFocused ? '2px' : '0'
                                    }}>
                                      {value}
                                    </span>
                                  );
                                }}
                              />
                              {groupKPIs.map((kpi, index) => {
                                const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                const isHidden = groupVisibleSeries[key] === false;
                                return (
                                  <Bar 
                                    key={index}
                                    dataKey={key} 
                                    name={kpi.name}
                                    fill={getKPIColor(index, groupKPIs.length)}
                                    radius={[4, 4, 0, 0]}
                                    hide={isHidden}
                                    opacity={isHidden ? 0 : 1}
                                  />
                                );
                              })}
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {displayMode === 'stacked-area' && (() => {
                        // Sort KPIs by average value (descending) for stacked charts
                        const sortedKPIs = sortKPIsByValue(groupKPIs, aggregationMode === 'annual');
                        
                        return (
                          <div className="bg-white rounded-lg shadow-sm p-6">
                            <ResponsiveContainer width="100%" height={400}>
                              <AreaChart
                                data={combinedData.map((item, idx) => {
                                  // For annual mode, calculate percent change based on visible series
                                  if (aggregationMode === 'annual') {
                                    // Calculate total for this period (sum of visible series)
                                    let total = 0;
                                    sortedKPIs.forEach(kpi => {
                                      const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                      if (groupVisibleSeries[key] !== false && item[key] !== undefined) {
                                        total += item[key] || 0;
                                      }
                                    });
                                    
                                    const periodStr = item.quarter ? String(item.quarter) : '';
                                    const yearMatch = periodStr.match(/(\d{4})/);
                                    
                                    let annualPercentChange: number | null = null;
                                    if (yearMatch && total > 0) {
                                      const currentYear = parseInt(yearMatch[1], 10);
                                      const previousYear = currentYear - 1;
                                      const previousYearPeriod = `${previousYear} Annual`;
                                      
                                      // Find previous year's annual data point
                                      const prevYearItem = combinedData.find(d => 
                                        d.quarter === previousYearPeriod || 
                                        (d.quarter && String(d.quarter).includes(`${previousYear}`) && String(d.quarter).includes('Annual'))
                                      );
                                      
                                      if (prevYearItem) {
                                        let prevYearTotal = 0;
                                        sortedKPIs.forEach(kpi => {
                                          const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                          if (groupVisibleSeries[key] !== false && prevYearItem[key] !== undefined) {
                                            prevYearTotal += prevYearItem[key] || 0;
                                          }
                                        });
                                        
                                        if (prevYearTotal > 0) {
                                          annualPercentChange = ((total - prevYearTotal) / prevYearTotal) * 100;
                                        }
                                      }
                                    }
                                    
                                    return {
                                      ...item,
                                      _total: total,
                                      _percentChange: annualPercentChange,
                                      _annualPercentChange: annualPercentChange
                                    };
                                  }
                                  return item;
                                })}
                                margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
                              >
                                <defs>
                                  {sortedKPIs.map((kpi, index) => {
                                    const color = getKPIColor(index, sortedKPIs.length);
                                    return (
                                      <linearGradient key={index} id={`color${index}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                                        <stop offset="95%" stopColor={color} stopOpacity={0.1}/>
                                      </linearGradient>
                                    );
                                  })}
                                </defs>
                                <XAxis 
                                  dataKey="quarter" 
                                  angle={-45}
                                  textAnchor="end"
                                  height={100}
                                  tick={{ fontSize: 12 }}
                                />
                                <YAxis 
                                  tick={{ fontSize: 12 }}
                                />
                              <Tooltip
                                wrapperStyle={{ zIndex: 1000 }}
                                content={(props: any) => (
                                  <KPITooltip {...props} changeType={changeType} formatValue={formatValue} formatChange={formatChange} aggregationMode={aggregationMode} />
                                )}
                              />
                              <Legend 
                                onClick={(e: any) => {
                                  if (e.dataKey) {
                                    toggleSeries(e.dataKey);
                                  }
                                }}
                                wrapperStyle={{ cursor: 'pointer' }}
                                iconType="line"
                                formatter={(value: string, entry: any) => {
                                  const key = entry.dataKey || entry.payload?.dataKey;
                                  const isHidden = key ? groupVisibleSeries[key] === false : false;
                                  const isFocused = key ? focusedSeries[groupName] === key : false;
                                  return (
                                    <span style={{ 
                                      opacity: isHidden ? 0.5 : 1,
                                      textDecoration: isHidden ? 'line-through' : 'none',
                                      fontWeight: isFocused ? 'bold' : 'normal',
                                      cursor: 'pointer',
                                      borderBottom: isFocused ? '2px solid currentColor' : 'none',
                                      paddingBottom: isFocused ? '2px' : '0'
                                    }}>
                                      {value}
                                    </span>
                                  );
                                }}
                              />
                              {sortedKPIs.map((kpi, index) => {
                                const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                const isHidden = groupVisibleSeries[key] === false;
                                return (
                                  <Area
                                      key={index}
                                      type="monotone"
                                      dataKey={key}
                                      name={kpi.name}
                                      stackId="1"
                                      stroke={getKPIColor(index, sortedKPIs.length)}
                                      fill={`url(#color${index})`}
                                      hide={isHidden}
                                      opacity={isHidden ? 0 : 1}
                                    />
                                  );
                                })}
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        );
                      })()}

                      {displayMode === 'stacked-bars' && (() => {
                        // Sort KPIs by average value (descending) for stacked charts
                        const sortedKPIs = sortKPIsByValue(groupKPIs, aggregationMode === 'annual');
                        
                        return (
                          <div className="bg-white rounded-lg shadow-sm p-6">
                            <ResponsiveContainer width="100%" height={400}>
                              <BarChart
                                maxBarSize={aggregationMode === 'annual' ? 80 : undefined}
                                data={combinedData.map((item, idx) => {
                                  // Calculate total for this period (sum of visible series)
                                  let total = 0;
                                  sortedKPIs.forEach(kpi => {
                                    const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                    if (groupVisibleSeries[key] !== false && item[key] !== undefined) {
                                      total += item[key] || 0;
                                    }
                                  });
                                  
                                  // Calculate percent change based on toggle
                                  let percentChange: number | null = null;
                                  const quarterStr = item.quarter ? String(item.quarter) : '';
                                  
                                  if (changeType === 'qoq') {
                                    // Quarter-over-quarter: find previous quarter and compare
                                    const yearMatch = quarterStr.match(/(\d{4})/);
                                    const quarterMatch = quarterStr.match(/Q(\d)/);
                                    
                                    if (yearMatch && quarterMatch) {
                                      const currentYear = parseInt(yearMatch[1], 10);
                                      const currentQuarterNum = parseInt(quarterMatch[1], 10);
                                      
                                      // Calculate previous quarter
                                      let previousYear = currentYear;
                                      let previousQuarterNum = currentQuarterNum - 1;
                                      
                                      if (previousQuarterNum < 1) {
                                        previousQuarterNum = 4;
                                        previousYear = currentYear - 1;
                                      }
                                      
                                      const previousQuarter = `${previousYear}Q${previousQuarterNum}`;
                                      
                                      // Find previous quarter's data point
                                      const prevQuarterItem = combinedData.find(d => 
                                        d.quarter === previousQuarter || 
                                        (d.quarter && String(d.quarter).includes(`${previousYear}`) && String(d.quarter).includes(`Q${previousQuarterNum}`))
                                      );
                                      
                                      if (prevQuarterItem) {
                                        let prevTotal = 0;
                                        sortedKPIs.forEach(kpi => {
                                          const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                          if (groupVisibleSeries[key] !== false && prevQuarterItem[key] !== undefined) {
                                            prevTotal += prevQuarterItem[key] || 0;
                                          }
                                        });
                                        
                                        if (prevTotal > 0) {
                                          percentChange = ((total - prevTotal) / prevTotal) * 100;
                                        }
                                      }
                                    }
                                  } else {
                                    // Year-over-year: find same quarter previous year
                                    if (quarterStr) {
                                      const yearMatch = quarterStr.match(/(\d{4})/);
                                      if (yearMatch) {
                                        const currentYear = parseInt(yearMatch[1], 10);
                                        const previousYear = currentYear - 1;
                                        
                                        // Extract quarter number
                                        const quarterMatch = quarterStr.match(/Q(\d)/);
                                        if (quarterMatch) {
                                          const quarterNum = quarterMatch[1];
                                          const previousYearQuarter = `${previousYear}Q${quarterNum}`;
                                          
                                          // Find previous year's same quarter
                                          const prevYearItem = combinedData.find(d => 
                                            d.quarter === previousYearQuarter || 
                                            (d.quarter && String(d.quarter).includes(`${previousYear}`) && String(d.quarter).includes(`Q${quarterNum}`))
                                          );
                                          
                                          if (prevYearItem) {
                                            let prevYearTotal = 0;
                                            sortedKPIs.forEach(kpi => {
                                              const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                              if (groupVisibleSeries[key] !== false && prevYearItem[key] !== undefined) {
                                                prevYearTotal += prevYearItem[key] || 0;
                                              }
                                            });
                                            
                                            if (prevYearTotal > 0) {
                                              percentChange = ((total - prevYearTotal) / prevYearTotal) * 100;
                                            }
                                          }
                                        }
                                      }
                                    }
                                  }
                                  
                                  // For annual mode, calculate percent change based on visible series
                                  let annualPercentChange: number | null = null;
                                  if (aggregationMode === 'annual') {
                                    const periodStr = item.quarter ? String(item.quarter) : '';
                                    const yearMatch = periodStr.match(/(\d{4})/);
                                    
                                    if (yearMatch && total > 0) {
                                      const currentYear = parseInt(yearMatch[1], 10);
                                      const previousYear = currentYear - 1;
                                      const previousYearPeriod = `${previousYear} Annual`;
                                      
                                      // Find previous year's annual data point
                                      const prevYearItem = combinedData.find(d => 
                                        d.quarter === previousYearPeriod || 
                                        (d.quarter && String(d.quarter).includes(`${previousYear}`) && String(d.quarter).includes('Annual'))
                                      );
                                      
                                      if (prevYearItem) {
                                        let prevYearTotal = 0;
                                        sortedKPIs.forEach(kpi => {
                                          const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                          if (groupVisibleSeries[key] !== false && prevYearItem[key] !== undefined) {
                                            prevYearTotal += prevYearItem[key] || 0;
                                          }
                                        });
                                        
                                        if (prevYearTotal > 0) {
                                          annualPercentChange = ((total - prevYearTotal) / prevYearTotal) * 100;
                                        }
                                      }
                                    }
                                  }
                                  
                                  // For annual mode, use the calculated annual percent change based on visible series
                                  const finalPercentChange = aggregationMode === 'annual' 
                                    ? annualPercentChange
                                    : percentChange;
                                  
                                  return {
                                    ...item,
                                    _total: total,
                                    _percentChange: finalPercentChange,
                                    _annualPercentChange: aggregationMode === 'annual' ? annualPercentChange : null
                                  };
                                })}
                                margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
                              >
                                <XAxis 
                                  dataKey="quarter" 
                                  angle={-45}
                                  textAnchor="end"
                                  height={100}
                                  tick={{ fontSize: 12 }}
                                />
                                <YAxis 
                                  tick={{ fontSize: 12 }}
                                />
                                <Tooltip
                                  wrapperStyle={{ zIndex: 1000 }}
                                  content={(props: any) => (
                                    <KPITooltip {...props} changeType={changeType} formatValue={formatValue} formatChange={formatChange} aggregationMode={aggregationMode} />
                                  )}
                                />
                                <Legend 
                                  onClick={(e: any) => {
                                    if (e.dataKey) {
                                      toggleSeries(e.dataKey);
                                    }
                                  }}
                                  wrapperStyle={{ cursor: 'pointer' }}
                                  iconType="line"
                                  formatter={(value: string, entry: any) => {
                                    const key = entry.dataKey || entry.payload?.dataKey;
                                    const isHidden = key ? groupVisibleSeries[key] === false : false;
                                    const isFocused = key ? focusedSeries[groupName] === key : false;
                                    return (
                                      <span style={{ 
                                        opacity: isHidden ? 0.5 : 1,
                                        textDecoration: isHidden ? 'line-through' : 'none',
                                        fontWeight: isFocused ? 'bold' : 'normal',
                                        cursor: 'pointer',
                                        borderBottom: isFocused ? '2px solid currentColor' : 'none',
                                        paddingBottom: isFocused ? '2px' : '0'
                                      }}>
                                        {value}
                                      </span>
                                    );
                                  }}
                                />
                                {sortedKPIs.map((kpi, index) => {
                                  const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                  const isHidden = groupVisibleSeries[key] === false;
                                  // Find the last visible series for rounded corners and label
                                  const visibleIndices = sortedKPIs
                                    .map((k, i) => ({ key: k.name.replace(/[^a-zA-Z0-9]/g, '_'), index: i }))
                                    .filter(({ key: k }) => groupVisibleSeries[k] !== false)
                                    .map(({ index: i }) => i);
                                  const isLastVisible = visibleIndices.length > 0 && visibleIndices[visibleIndices.length - 1] === index;
                                  return (
                                    <Bar 
                                      key={index}
                                      dataKey={key}
                                      name={kpi.name}
                                      stackId="1"
                                      fill={getKPIColor(index, sortedKPIs.length)}
                                      radius={isLastVisible ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                                      hide={isHidden}
                                      opacity={isHidden ? 0 : 1}
                                    >
                                      {isLastVisible && (
                                        <LabelList
                                          dataKey={aggregationMode === 'annual' ? "_annualPercentChange" : "_percentChange"}
                                          position="top"
                                          content={(props: any) => {
                                            const { x, y, width, value, payload } = props;
                                            if (value === null || value === undefined || isNaN(value)) return null;
                                            const change = parseFloat(value);
                                            const sign = change >= 0 ? '+' : '';
                                            const color = change >= 0 ? '#10b981' : '#ef4444';
                                            const changeLabel = aggregationMode === 'annual' ? 'Annual' : (changeType === 'qoq' ? 'QoQ' : 'YoY');
                                            
                                            // Calculate center x position of the bar
                                            const centerX = x + (width / 2);
                                            
                                            return (
                                              <text
                                                x={centerX}
                                                y={y - 5}
                                                fill={color}
                                                fontSize={12}
                                                fontWeight={600}
                                                textAnchor="middle"
                                              >
                                                {sign}{change.toFixed(1)}% {changeLabel}
                                              </text>
                                            );
                                          }}
                                        />
                                      )}
                                    </Bar>
                                  );
                                })}
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        );
                      })()}
                    </div>
                  );
                });
              })()}
            </div>

            {/* Empty State */}
            {data.kpis.length === 0 && (
              <div className="bg-white rounded-lg shadow-sm p-8 text-center">
                <p className="text-gray-600">No KPI data available for {data.symbol}</p>
              </div>
            )}
          </>
        )}
          </div>

          {/* Right Sidebar - 1/4 width */}
          <div className="xl:col-span-1">
            <div className="sticky top-6 space-y-6">
              {/* Company Info */}
              <CompanyInfoCard ticker={ticker} showPrice={true} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
