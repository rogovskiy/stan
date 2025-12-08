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

export default function KPITestPage() {
  const pathname = usePathname();
  const params = useParams();
  const router = useRouter();
  const ticker = (params?.ticker as string) || 'AAPL';
  const [data, setData] = useState<KPITimeseriesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<DisplayMode>('separate');
  const [aggregationMode, setAggregationMode] = useState<AggregationMode>('quarterly');
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
  const prepareCombinedData = (kpis: KPITimeseries[], useAnnual: boolean = false) => {
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
    return sortedPeriods.map(period => {
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
      });
      
      return dataPoint;
    });
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
                  const combinedData = prepareCombinedData(groupKPIs, aggregationMode === 'annual');
                  
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
                                    ).map(v => {
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
                                      return {
                                        quarter: v.quarter,
                                        value: numValue !== null && !isNaN(numValue) ? numValue : 0,
                                        context: v.context || '',
                                        change: v.change,
                                        changeType: v.change_type,
                                        unit: v.unit || kpi.unit,
                                        hasValue: v.value !== null && v.value !== undefined
                                      };
                                    })}
                                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
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
                                      content={({ active, payload }: any) => {
                                        if (active && payload && payload.length) {
                                          const data = payload[0].payload;
                                          return (
                                            <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
                                              <p className="font-semibold text-gray-900 mb-1">
                                                {data.quarter}
                                              </p>
                                              <p className="text-sm text-gray-700 mb-1">
                                                <span className="font-medium">Value:</span> {formatValue(data.value, data.unit)}
                                              </p>
                                              {data.change !== null && data.change !== undefined && (
                                                <p className="text-sm text-gray-700 mb-1">
                                                  <span className="font-medium">Change:</span> {formatChange(data.change, data.changeType)}
                                                </p>
                                              )}
                                              {data.context && (
                                                <p className="text-sm text-gray-600 mt-2 pt-2 border-t border-gray-200 max-w-xs">
                                                  <span className="font-medium">Context:</span> {data.context}
                                                </p>
                                              )}
                                            </div>
                                          );
                                        }
                                        return null;
                                      }}
                                    />
                                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
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
                                content={({ active, payload }: any) => {
                                  if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-md">
                                        <p className="font-semibold text-gray-900 mb-2">
                                          {data.quarter}
                                        </p>
                                        {payload.map((entry: any, idx: number) => {
                                          const kpiName = entry.dataKey.replace(/_/g, ' ');
                                          const context = data[`${entry.dataKey}_context`];
                                          const unit = data[`${entry.dataKey}_unit`] || '';
                                          return (
                                            <div key={idx} className="mb-2 pb-2 border-b border-gray-100 last:border-0">
                                              <p className="text-sm font-medium text-gray-700">
                                                <span style={{ color: entry.color }}>●</span> {kpiName}: {formatValue(entry.value, unit)}
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
                                  return null;
                                }}
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

                      {displayMode === 'stacked-area' && (
                        <div className="bg-white rounded-lg shadow-sm p-6">
                          <ResponsiveContainer width="100%" height={400}>
                            <AreaChart
                              data={combinedData}
                              margin={{ top: 20, right: 30, left: 20, bottom: 80 }}
                            >
                              <defs>
                                {groupKPIs.map((kpi, index) => {
                                  const color = getKPIColor(index, groupKPIs.length);
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
                                content={({ active, payload }: any) => {
                                  if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-md">
                                        <p className="font-semibold text-gray-900 mb-2">
                                          {data.quarter}
                                        </p>
                                        {payload.map((entry: any, idx: number) => {
                                          const kpiName = entry.dataKey.replace(/_/g, ' ');
                                          const context = data[`${entry.dataKey}_context`];
                                          const unit = data[`${entry.dataKey}_unit`] || '';
                                          return (
                                            <div key={idx} className="mb-2 pb-2 border-b border-gray-100 last:border-0">
                                              <p className="text-sm font-medium text-gray-700">
                                                <span style={{ color: entry.color }}>●</span> {kpiName}: {formatValue(entry.value, unit)}
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
                                  return null;
                                }}
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
                                  <Area 
                                    key={index}
                                    type="monotone"
                                    dataKey={key}
                                    name={kpi.name}
                                    stackId="1"
                                    stroke={getKPIColor(index, groupKPIs.length)}
                                    fill={`url(#color${index})`}
                                    hide={isHidden}
                                    opacity={isHidden ? 0 : 1}
                                  />
                                );
                              })}
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}

                      {displayMode === 'stacked-bars' && (
                        <div className="bg-white rounded-lg shadow-sm p-6">
                          <ResponsiveContainer width="100%" height={400}>
                            <BarChart
                              data={combinedData.map((item, idx) => {
                                // Calculate total for this period (sum of visible series)
                                let total = 0;
                                groupKPIs.forEach(kpi => {
                                  const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                  if (groupVisibleSeries[key] !== false && item[key] !== undefined) {
                                    total += item[key] || 0;
                                  }
                                });
                                
                                // Calculate percent change from previous period
                                let percentChange: number | null = null;
                                if (idx > 0) {
                                  let prevTotal = 0;
                                  groupKPIs.forEach(kpi => {
                                    const key = kpi.name.replace(/[^a-zA-Z0-9]/g, '_');
                                    if (groupVisibleSeries[key] !== false && combinedData[idx - 1][key] !== undefined) {
                                      prevTotal += combinedData[idx - 1][key] || 0;
                                    }
                                  });
                                  
                                  if (prevTotal > 0) {
                                    percentChange = ((total - prevTotal) / prevTotal) * 100;
                                  }
                                }
                                
                                return {
                                  ...item,
                                  _total: total,
                                  _percentChange: percentChange
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
                                content={({ active, payload }: any) => {
                                  if (active && payload && payload.length) {
                                    const data = payload[0].payload;
                                    return (
                                      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 max-w-md">
                                        <p className="font-semibold text-gray-900 mb-2">
                                          {data.quarter}
                                        </p>
                                        {data._percentChange !== null && (
                                          <p className={`text-sm font-medium mb-2 ${
                                            data._percentChange >= 0 ? 'text-green-600' : 'text-red-600'
                                          }`}>
                                            Change: {data._percentChange >= 0 ? '+' : ''}{data._percentChange.toFixed(1)}%
                                          </p>
                                        )}
                                        {payload.map((entry: any, idx: number) => {
                                          const kpiName = entry.dataKey.replace(/_/g, ' ');
                                          const context = data[`${entry.dataKey}_context`];
                                          const unit = data[`${entry.dataKey}_unit`] || '';
                                          return (
                                            <div key={idx} className="mb-2 pb-2 border-b border-gray-100 last:border-0">
                                              <p className="text-sm font-medium text-gray-700">
                                                <span style={{ color: entry.color }}>●</span> {kpiName}: {formatValue(entry.value, unit)}
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
                                  return null;
                                }}
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
                                // Find the last visible series for rounded corners and label
                                const visibleIndices = groupKPIs
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
                                    fill={getKPIColor(index, groupKPIs.length)}
                                    radius={isLastVisible ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                                    hide={isHidden}
                                    opacity={isHidden ? 0 : 1}
                                  >
                                    {isLastVisible && (
                                      <LabelList
                                        dataKey="_percentChange"
                                        position="top"
                                        content={(props: any) => {
                                          const { x, y, width, value, payload } = props;
                                          if (value === null || value === undefined || isNaN(value)) return null;
                                          const change = parseFloat(value);
                                          const sign = change >= 0 ? '+' : '';
                                          const color = change >= 0 ? '#10b981' : '#ef4444';
                                          
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
                                              {sign}{change.toFixed(1)}%
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
                      )}
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
