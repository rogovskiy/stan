'use client';

import { useState, useEffect, useMemo } from 'react';
import { ChartSpec, QuarterlyDataPoint } from '../types/api';

interface CompactChartProps {
  chartSpec: ChartSpec;
  ticker: string;
  renderingMode?: 'small' | 'medium' | 'large';
}

// Standard metrics that come from quarterly timeseries
const STANDARD_METRICS = ['EPS', 'FCF', 'Revenue'];

export default function CompactChart({
  chartSpec,
  ticker,
  renderingMode = 'small'
}: CompactChartProps) {
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyDataPoint[]>([]);
  const [kpiTimeseriesData, setKpiTimeseriesData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Check if we need custom KPI data
  const hasCustomMetrics = useMemo(() => {
    return chartSpec.metrics.some(metric => !STANDARD_METRICS.includes(metric));
  }, [chartSpec.metrics]);

  // Fetch quarterly timeseries data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      setError(null);
      
      try {
        // Always fetch quarterly data
        const quarterlyResponse = await fetch(`/api/quarterly-timeseries/${ticker}`);
        if (!quarterlyResponse.ok) {
          throw new Error('Failed to fetch quarterly data');
        }
        
        const quarterlyResult = await quarterlyResponse.json();
        setQuarterlyData(quarterlyResult.data || []);

        // Fetch KPI timeseries if we have custom metrics
        if (hasCustomMetrics) {
          try {
            const kpiResponse = await fetch(`/api/tickers/timeseries/kpi/${ticker}`);
            if (kpiResponse.ok) {
              const kpiResult = await kpiResponse.json();
              setKpiTimeseriesData(kpiResult);
            } else {
              console.warn('KPI timeseries not available, custom metrics may not render');
            }
          } catch (kpiErr) {
            console.warn('Error fetching KPI timeseries:', kpiErr);
            // Don't fail the whole chart if KPI fetch fails
          }
        }
      } catch (err) {
        console.error('Error fetching quarterly data:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    if (ticker && chartSpec.metrics.length > 0) {
      fetchData();
    }
  }, [ticker, chartSpec.metrics, hasCustomMetrics]);

  // Helper function to find KPI by name (flexible matching)
  const findKPIByName = (metricName: string): any => {
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

  // Build a map of quarter_key -> KPI values for the primary metric
  const kpiDataMap = useMemo(() => {
    const map = new Map<string, number>(); // quarter_key -> value
    
    if (!kpiTimeseriesData?.kpis) return map;
    
    const primaryMetric = chartSpec.metrics[0];
    if (!primaryMetric || STANDARD_METRICS.includes(primaryMetric)) return map;
    
    const kpi = findKPIByName(primaryMetric);
    if (!kpi || !kpi.values) return map;
    
    kpi.values.forEach((valueObj: any) => {
      if (valueObj.quarter && valueObj.value !== null && valueObj.value !== undefined) {
        map.set(valueObj.quarter, valueObj.value);
      }
    });
    
    return map;
  }, [kpiTimeseriesData, chartSpec.metrics]);

  // Transform data based on frequency and metrics
  const chartData = useMemo(() => {
    if (!quarterlyData || quarterlyData.length === 0) return [];

    // Filter and sort data
    const sortedData = [...quarterlyData]
      .filter(d => d.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Use the first metric from the chart spec
    const primaryMetric = chartSpec.metrics[0];
    if (!primaryMetric) return [];

    if (chartSpec.frequency === 'annual') {
      // Group by fiscal year and aggregate
      const annualMap = new Map<number, number[]>();
      
      sortedData.forEach(point => {
        const year = point.year;
        
        // Build quarter_key from point
        const quarterMatch = point.quarter?.match(/Q(\d)/);
        const quarterNum = quarterMatch ? quarterMatch[1] : '';
        const quarterKey = `${year}Q${quarterNum}`;
        
        if (!annualMap.has(year)) {
          annualMap.set(year, []);
        }
        
        const yearData = annualMap.get(year)!;
        
        let value: number | null = null;
        
        // Map standard metrics to data fields
        if (primaryMetric === 'EPS') {
          value = point.eps_adjusted ?? point.eps ?? null;
        } else if (primaryMetric === 'FCF') {
          // FCF would need to be added to QuarterlyDataPoint type
          value = (point as any).fcf ?? (point as any).free_cash_flow ?? null;
        } else if (primaryMetric === 'Revenue') {
          // Revenue would need to be added to QuarterlyDataPoint type
          value = (point as any).revenue ?? (point as any).total_revenue ?? null;
        } else {
          // Custom KPI - look it up in KPI data map
          value = kpiDataMap.get(quarterKey) ?? null;
        }
        
        if (value !== null) {
          yearData.push(value);
        }
      });
      
      // Convert to chart data format and aggregate (sum for annual)
      const result: Array<{ year: number; value: number; yearLabel: string }> = [];
      annualMap.forEach((yearData, year) => {
        if (yearData.length > 0) {
          // Sum quarterly values for annual total
          const annualValue = yearData.reduce((sum, val) => sum + val, 0);
          result.push({
            year,
            value: annualValue,
            yearLabel: year.toString().slice(-2) // Last 2 digits of year
          });
        }
      });
      
      // Sort by year and take last 10 years
      return result.sort((a, b) => a.year - b.year).slice(-10);
    } else {
      // Quarterly frequency - use data as-is, take last 10 quarters
      return sortedData.slice(-10).map(point => {
        let value: number | null = null;
        
        const quarterMatch = point.quarter?.match(/Q(\d)/);
        const quarterNum = quarterMatch ? quarterMatch[1] : '';
        const quarterKey = `${point.year}Q${quarterNum}`;
        
        if (primaryMetric === 'EPS') {
          value = point.eps_adjusted ?? point.eps ?? null;
        } else if (primaryMetric === 'FCF') {
          value = (point as any).fcf ?? (point as any).free_cash_flow ?? null;
        } else if (primaryMetric === 'Revenue') {
          value = (point as any).revenue ?? (point as any).total_revenue ?? null;
        } else {
          // Custom KPI - look it up in KPI data map
          value = kpiDataMap.get(quarterKey) ?? null;
        }
        
        const yearLabel = point.year.toString().slice(-2);
        
        return {
          year: point.year,
          value: value ?? 0,
          yearLabel: `${yearLabel}Q${quarterNum}`
        };
      });
    }
  }, [quarterlyData, chartSpec.frequency, chartSpec.metrics, kpiDataMap]);

  if (loading) {
    return (
      <div className="w-full flex items-center justify-center h-16">
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-400"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full flex items-center justify-center h-16 text-xs text-red-600">
        Error loading chart
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="w-full flex items-center justify-center h-16 text-xs text-gray-400">
        No data available
      </div>
    );
  }

  const maxValue = Math.max(...chartData.map(d => d.value), 0);
  const chartHeight = renderingMode === 'small' ? 60 : renderingMode === 'medium' ? 80 : 100;
  const primaryMetric = chartSpec.metrics[0] || 'Value';

  return (
    <div className="w-full">
      <div className="flex items-end justify-center h-16 gap-1.5">
        {chartData.map((data, idx) => {
          const barHeight = maxValue > 0 ? (data.value / maxValue) * chartHeight : 0;
          const isLatest = idx === chartData.length - 1;
          
          return (
            <div key={idx} className="flex flex-col items-center justify-end" style={{ width: '10px' }}>
              <div
                className={`w-full rounded-sm transition-all ${
                  isLatest ? 'bg-green-500' : 'bg-gray-300'
                }`}
                style={{ 
                  height: `${Math.max(barHeight, 3)}px`,
                  minHeight: '3px'
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between mt-1.5 px-1 text-[9px] text-gray-400">
        <span>{chartSpec.frequency === 'annual' ? `FY${chartData[0]?.yearLabel}` : chartData[0]?.yearLabel}</span>
        <span className="text-green-600 font-medium">
          {chartSpec.frequency === 'annual' ? `FY${chartData[chartData.length - 1]?.yearLabel}` : chartData[chartData.length - 1]?.yearLabel}
        </span>
      </div>
    </div>
  );
}

