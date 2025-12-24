'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell
} from 'recharts';
import { ChartSpec, QuarterlyDataPoint } from '../types/api';

interface AnalysisChartProps {
  chartSpec: ChartSpec;
  ticker: string;
  title?: string;
  height?: number;
}

interface ChartDataPoint {
  period: string;
  [key: string]: string | number;
}

// Color palette for different metrics
const METRIC_COLORS: { [key: string]: string } = {
  'EPS': '#3b82f6',
  'FCF': '#10b981',
  'Revenue': '#f59e0b',
  'default': '#6b7280'
};

// Extended color palette for multiple metrics
const COLOR_PALETTE = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // purple
  '#06b6d4', // cyan
  '#f97316', // orange
  '#ec4899', // pink
  '#14b8a6', // teal
  '#6366f1', // indigo
];

// Standard metrics that come from quarterly timeseries
const STANDARD_METRICS = ['EPS', 'FCF', 'Revenue'];

export default function AnalysisChart({
  chartSpec,
  ticker,
  title,
  height = 300
}: AnalysisChartProps) {
  const [quarterlyData, setQuarterlyData] = useState<QuarterlyDataPoint[]>([]);
  const [kpiTimeseriesData, setKpiTimeseriesData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Track which metrics are visible (all visible by default)
  const [visibleMetrics, setVisibleMetrics] = useState<Set<string>>(() => {
    return new Set(chartSpec.metrics);
  });

  // Update visible metrics when chartSpec.metrics changes
  useEffect(() => {
    setVisibleMetrics(new Set(chartSpec.metrics));
  }, [chartSpec.metrics]);

  // Check if we need custom KPI data
  const hasCustomMetrics = useMemo(() => {
    return chartSpec.metrics.some(metric => !STANDARD_METRICS.includes(metric));
  }, [chartSpec.metrics]);

  // Toggle metric visibility
  const toggleMetric = (metric: string) => {
    setVisibleMetrics(prev => {
      const next = new Set(prev);
      if (next.has(metric)) {
        next.delete(metric);
        // If all metrics are now hidden, show all again
        if (next.size === 0) {
          return new Set(chartSpec.metrics);
        }
      } else {
        next.add(metric);
      }
      return next;
    });
  };

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

  // Build a map of quarter_key -> KPI values for each custom metric
  const kpiDataMap = useMemo(() => {
    const map = new Map<string, Map<string, number>>(); // metric -> quarter_key -> value
    
    if (!kpiTimeseriesData?.kpis) return map;
    
    chartSpec.metrics.forEach(metric => {
      if (STANDARD_METRICS.includes(metric)) return;
      
      const kpi = findKPIByName(metric);
      if (!kpi || !kpi.values) return;
      
      const metricMap = new Map<string, number>();
      kpi.values.forEach((valueObj: any) => {
        if (valueObj.quarter && valueObj.value !== null && valueObj.value !== undefined) {
          metricMap.set(valueObj.quarter, valueObj.value);
        }
      });
      
      map.set(metric, metricMap);
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

    if (chartSpec.frequency === 'annual') {
      // Group by fiscal year and aggregate
      const annualMap = new Map<string, { [key: string]: number[] }>();
      
      sortedData.forEach(point => {
        const year = point.year;
        const yearKey = year.toString();
        
        // Build quarter_key from point
        const quarterMatch = point.quarter?.match(/Q(\d)/);
        const quarterNum = quarterMatch ? quarterMatch[1] : '';
        const quarterKey = `${year}Q${quarterNum}`;
        
        if (!annualMap.has(yearKey)) {
          annualMap.set(yearKey, {});
        }
        
        const yearData = annualMap.get(yearKey)!;
        
        chartSpec.metrics.forEach(metric => {
          if (!yearData[metric]) {
            yearData[metric] = [];
          }
          
          let value: number | null = null;
          
          // Map standard metrics to data fields
          if (metric === 'EPS') {
            value = point.eps_adjusted ?? point.eps ?? null;
          } else if (metric === 'FCF') {
            // FCF would need to be added to QuarterlyDataPoint type
            value = null;
          } else if (metric === 'Revenue') {
            // Revenue would need to be added to QuarterlyDataPoint type
            value = null;
          } else {
            // Custom KPI - look it up in KPI data map
            const metricMap = kpiDataMap.get(metric);
            if (metricMap) {
              value = metricMap.get(quarterKey) ?? null;
            }
          }
          
          if (value !== null) {
            yearData[metric].push(value);
          }
        });
      });
      
      // Convert to chart data format and aggregate (sum for annual)
      const result: ChartDataPoint[] = [];
      annualMap.forEach((yearData, yearKey) => {
        const dataPoint: ChartDataPoint = { period: yearKey };
        
        chartSpec.metrics.forEach(metric => {
          const values = yearData[metric];
          if (values.length > 0) {
            // Sum quarterly values for annual total
            dataPoint[metric] = values.reduce((sum, val) => sum + val, 0);
          }
        });
        
        result.push(dataPoint);
      });
      
      // Sort by year and take last 10 years
      return result.sort((a, b) => parseInt(a.period) - parseInt(b.period)).slice(-10);
    } else {
      // Quarterly frequency - use data as-is, take last 10 quarters
      return sortedData.slice(-10).map(point => {
        const quarterMatch = point.quarter?.match(/Q(\d)/);
        const quarterNum = quarterMatch ? quarterMatch[1] : '';
        const period = `${point.year} Q${quarterNum}`;
        const quarterKey = `${point.year}Q${quarterNum}`;
        
        const dataPoint: ChartDataPoint = { period };
        
        chartSpec.metrics.forEach(metric => {
          let value: number | null = null;
          
          if (metric === 'EPS') {
            value = point.eps_adjusted ?? point.eps ?? null;
          } else if (metric === 'FCF') {
            // FCF would need to be added to QuarterlyDataPoint
            value = null;
          } else if (metric === 'Revenue') {
            // Revenue would need to be added to QuarterlyDataPoint
            value = null;
          } else {
            // Custom KPI - look it up in KPI data map
            const metricMap = kpiDataMap.get(metric);
            if (metricMap) {
              value = metricMap.get(quarterKey) ?? null;
            }
          }
          
          dataPoint[metric] = value ?? 0;
        });
        
        return dataPoint;
      });
    }
  }, [quarterlyData, chartSpec.frequency, chartSpec.metrics, kpiDataMap]);

  // Get color for a metric by index
  const getMetricColor = (metricName: string, index: number): string => {
    // Use predefined color if available
    if (METRIC_COLORS[metricName]) {
      return METRIC_COLORS[metricName];
    }
    // Otherwise use color palette with index
    return COLOR_PALETTE[index % COLOR_PALETTE.length];
  };

  // Get unit for a metric (for custom KPIs)
  const getMetricUnit = (metricName: string): string => {
    if (STANDARD_METRICS.includes(metricName)) {
      if (metricName === 'Revenue') return '$B';
      if (metricName === 'EPS' || metricName === 'FCF') return '$';
      return '';
    }
    
    const kpi = findKPIByName(metricName);
    return kpi?.unit || '';
  };

  // Format value based on unit
  const formatValue = (value: number, metricName: string): string => {
    const unit = getMetricUnit(metricName);
    
    if (unit === '%') {
      return (value >= 0 ? '+' : '') + value.toFixed(1) + '%';
    } else if (unit === '$B' || metricName === 'Revenue') {
      return `$${(value / 1e9).toFixed(2)}B`;
    } else if (unit === '$' || metricName === 'EPS' || metricName === 'FCF') {
      return `$${value.toFixed(2)}`;
    }
    return value.toLocaleString();
  };

  // Custom tooltip
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="text-sm font-semibold text-gray-900 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => (
            <p key={index} className="text-sm" style={{ color: entry.color }}>
              <span className="font-medium">{entry.name}:</span>{' '}
              {typeof entry.value === 'number' 
                ? formatValue(entry.value, entry.name)
                : 'N/A'}
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // Custom legend with click handler - shows all metrics, not just visible ones
  const CustomLegend = () => {
    return (
      <div className="flex flex-wrap items-center justify-center gap-4 mt-4">
        {chartSpec.metrics.map((metric, index) => {
          const isVisible = visibleMetrics.has(metric);
          const color = getMetricColor(metric, index);
          return (
            <div
              key={metric}
              onClick={() => toggleMetric(metric)}
              className="flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity"
              style={{ opacity: isVisible ? 1 : 0.4 }}
            >
              <div
                className="w-4 h-4 rounded"
                style={{ backgroundColor: color }}
              />
              <span className="text-sm text-gray-700">{metric}</span>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg border border-gray-200">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-2"></div>
          <p className="text-sm text-gray-600">Loading chart data...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 bg-red-50 rounded-lg border border-red-200">
        <p className="text-sm text-red-600">Error: {error}</p>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm text-gray-600">No data available for chart</p>
      </div>
    );
  }

  // Determine Y-axis domain (only for visible metrics)
  const allValues = chartData.flatMap(d => 
    Array.from(visibleMetrics).map(metric => d[metric] as number).filter(v => typeof v === 'number')
  );
  const maxValue = allValues.length > 0 ? Math.max(...allValues, 0) : 0;
  const minValue = allValues.length > 0 ? Math.min(...allValues, 0) : 0;
  const yAxisDomain = [Math.max(0, minValue * 0.9), maxValue * 1.15];

  // Format Y-axis tick
  const formatYAxisTick = (value: number) => {
    // Check if any metric uses percentage
    const hasPercentage = chartSpec.metrics.some(m => {
      if (STANDARD_METRICS.includes(m)) return false;
      const kpi = findKPIByName(m);
      return kpi?.unit === '%';
    });
    
    if (hasPercentage) {
      return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    }
    
    if (chartSpec.metrics.some(m => m === 'Revenue')) {
      return `$${(value / 1e9).toFixed(1)}B`;
    }
    if (chartSpec.metrics.some(m => m === 'EPS' || m === 'FCF')) {
      return `$${value.toFixed(2)}`;
    }
    return value.toLocaleString();
  };

  const chartContent = (
    <ResponsiveContainer width="100%" height={height}>
      {chartSpec.type === 'line' ? (
        <LineChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 60 }}>
          <XAxis
            dataKey="period"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis
            domain={yAxisDomain}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            tickFormatter={formatYAxisTick}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ display: 'none' }} />
          {chartSpec.metrics.map((metric, index) => {
            if (!visibleMetrics.has(metric)) return null;
            return (
              <Line
                key={metric}
                type="monotone"
                dataKey={metric}
                stroke={getMetricColor(metric, index)}
                strokeWidth={2}
                dot={{ r: 4 }}
                name={metric}
              />
            );
          })}
        </LineChart>
      ) : chartSpec.type === 'stacked_bar' ? (
        <BarChart 
          data={chartData} 
          margin={{ top: 10, right: 10, left: 10, bottom: 60 }}
          barCategoryGap="5%"
          barGap={4}
        >
          <XAxis
            dataKey="period"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis
            domain={yAxisDomain}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            tickFormatter={formatYAxisTick}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ display: 'none' }} />
          {chartSpec.metrics.map((metric, index) => {
            if (!visibleMetrics.has(metric)) return null;
            return (
              <Bar
                key={metric}
                dataKey={metric}
                stackId="a"
                fill={getMetricColor(metric, index)}
                name={metric}
              />
            );
          })}
        </BarChart>
      ) : (
        <BarChart 
          data={chartData} 
          margin={{ top: 10, right: 10, left: 10, bottom: 60 }}
          barCategoryGap="5%"
          barGap={4}
        >
          <XAxis
            dataKey="period"
            tick={{ fontSize: 12, fill: '#6b7280' }}
            angle={-45}
            textAnchor="end"
            height={60}
          />
          <YAxis
            domain={yAxisDomain}
            tick={{ fontSize: 12, fill: '#6b7280' }}
            tickFormatter={formatYAxisTick}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ display: 'none' }} />
          {chartSpec.metrics.map((metric, index) => {
            if (!visibleMetrics.has(metric)) return null;
            return (
              <Bar
                key={metric}
                dataKey={metric}
                fill={getMetricColor(metric, index)}
                radius={[4, 4, 0, 0]}
                name={metric}
              />
            );
          })}
        </BarChart>
      )}
    </ResponsiveContainer>
  );

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4">
      {chartContent}
      <CustomLegend />
    </div>
  );
}

