'use client';

import { useState, useMemo } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Area,
  ReferenceLine,
  ReferenceArea
} from 'recharts';
import { DailyDataPoint, QuarterlyDataPoint as ApiQuarterlyDataPoint } from '../types/api';
import { 
  getFiscalYearAndQuarter, 
  inferFiscalYearEndMonth, 
  calculateFiscalYearStartDate
} from '../lib/calculations';

// Helper function to infer fiscal year end month from raw quarterly data
function inferFiscalYearEndMonthFromRaw(quarterlyData: ApiQuarterlyDataPoint[]): number {
  if (quarterlyData.length === 0) return 12; // Default to December
  
  // First, try to infer from the raw data if it has fiscal_year and fiscal_quarter info
  // by looking at the pattern of dates and their fiscal quarters
  // For AAPL (fiscal year ends in September), Q4 dates should be in September
  const q4Dates = quarterlyData.filter(q => {
    // Check if we can determine Q4 from the date pattern
    // Q4 of a fiscal year ending in September would be dates in Jul-Aug-Sep
    const month = new Date(q.date).getMonth() + 1; // getMonth() returns 0-11
    return month >= 7 && month <= 9; // Jul, Aug, Sep
  });
  
  if (q4Dates.length > 0) {
    // Check if September (month 9) is the most common Q4 month
    const sepCount = q4Dates.filter(q => new Date(q.date).getMonth() === 8).length; // month 8 = September
    if (sepCount > q4Dates.length * 0.5) {
      return 9; // September
    }
  }
  
  // Fallback to the original inference method
  const quarterlyDates = quarterlyData.map(q => q.date);
  return inferFiscalYearEndMonth(quarterlyDates);
}
import { 
  TransformedDataPoint, 
  enrichQuarterlyWithPrices,
  calculateQuarterlyMetrics,
  combineDataForCharting,
  calculateTableData
} from './stockChartTransform';
import StockDataTable from './StockDataTable';

interface AnalystPriceTargets {
  targetHigh?: number;
  targetLow?: number;
  targetMedian?: number;
}

interface StockAnalysisChartProps {
  dailyData: DailyDataPoint[];
  quarterlyData: ApiQuarterlyDataPoint[];
  currentPeriod?: string;
  normalPERatio: number | null;
  fairValueRatio: number;
  growthRate: number | null;
  quarterlyGrowthRate: number | null;
  forecastYears: number;
  analystPriceTargets?: AnalystPriceTargets | null;
}

interface VisibleSeries {
  price: boolean;
  fairValue: boolean;
  fairValuePlusDividend: boolean;
  normalPEValue: boolean;
  dividendsPOR: boolean;
}

export default function StockAnalysisChart({ 
  dailyData, 
  quarterlyData, 
  currentPeriod = '8y', 
  normalPERatio,
  fairValueRatio,
  growthRate,
  quarterlyGrowthRate,
  forecastYears,
  analystPriceTargets
}: StockAnalysisChartProps) {
  // State to track visibility of data series
  const [visibleSeries, setVisibleSeries] = useState<VisibleSeries>({
    price: true,
    fairValue: true,
    fairValuePlusDividend: true,
    normalPEValue: true,
    dividendsPOR: true
  });

  // Infer fiscal year end month from raw quarterly data (needed for forecast generation)
  const fiscalYearEndMonth = useMemo(() => {
    return inferFiscalYearEndMonthFromRaw(quarterlyData);
  }, [quarterlyData]);

  // Transform raw API data into chart data using the new streamlined sequence
  const stockData: TransformedDataPoint[] = useMemo(() => {
    // Step 1: Enrich quarterly data with prices
    const enrichedQuarterly = enrichQuarterlyWithPrices(quarterlyData, dailyData);
    // Step 2: Calculate derived metrics on enriched quarterly data
    const calculatedQuarterly = calculateQuarterlyMetrics(enrichedQuarterly, normalPERatio, fairValueRatio);
    // Step 3: Combine enriched quarterly data with daily price data for charting
    // Step 4: Generate future forecasts will be handled inside combineDataForCharting
    return combineDataForCharting(
      calculatedQuarterly, 
      dailyData, 
      normalPERatio, 
      quarterlyGrowthRate, 
      forecastYears,
      fiscalYearEndMonth
    );
  }, [dailyData, quarterlyData, normalPERatio, fairValueRatio, quarterlyGrowthRate, forecastYears, fiscalYearEndMonth]);

  // Extract quarterly date strings for fiscal year calculations
  const quarterlyDateStrings = useMemo(() => {
    return stockData
      .filter(item => item.hasQuarterlyData)
      .map(item => item.fullDate);
  }, [stockData]);


  // Calculate the start date as Q1 of N fiscal years back
  const fiscalYearStartDate = useMemo(() => {
    if (quarterlyDateStrings.length === 0) return null;
    return calculateFiscalYearStartDate(quarterlyDateStrings, currentPeriod, fiscalYearEndMonth);
  }, [quarterlyDateStrings, currentPeriod, fiscalYearEndMonth]);

  // Calculate target fiscal year based on period start date
  // The fiscalYearStartDate is the Q1 quarter-end date of the target fiscal year
  const targetFiscalYear = useMemo(() => {
    if (!fiscalYearStartDate) return null;
    
    // Find the fiscal year of the start date (which is Q1 quarter-end date)
    const startDate = new Date(fiscalYearStartDate);
    const fiscalInfo = getFiscalYearAndQuarter(startDate, fiscalYearEndMonth);
    return fiscalInfo.fiscalYear;
  }, [fiscalYearStartDate, fiscalYearEndMonth]);

  // Filter stock data to start from the fiscal year Q1 date and add fiscal info to quarterly data points
  // IMPORTANT: Always include ALL daily price data (don't filter daily data by start date - only filter quarterly)
  const filteredStockData = useMemo(() => {
    // Strategy: Include ALL points with stockPrice (actual price data), then filter only quarterly metrics by period
    // This ensures daily price data extends to the latest available date
    
    // Filter quarterly data based on target fiscal year (for period selection)
    // This only affects which quarterly metrics to show, NOT which daily prices to show
    // Filter by fiscal year rather than date to ensure we include all quarters of that fiscal year starting from Q1
    // Since quarterly data uses quarter-end dates, we need to include all quarters (Q1-Q4) of the target fiscal year
    // Also include Q4 of the previous fiscal year to have data at the fiscal year boundary
    let filteredQuarterly = stockData.filter(item => {
      if (!item.hasQuarterlyData) return false;
      if (!targetFiscalYear) return true; // Include all if no target year
      
      // Get fiscal year and quarter of this item
      const itemDate = new Date(item.fullDate);
      const itemFiscalInfo = getFiscalYearAndQuarter(itemDate, fiscalYearEndMonth);
      
      // Include if fiscal year >= target fiscal year
      if (itemFiscalInfo.fiscalYear >= targetFiscalYear) {
        return true;
      }
      
      // Also include Q4 of the fiscal year immediately before the target
      // This ensures we have quarterly data at the fiscal year boundary (Q4 ends at fiscal year end)
      if (itemFiscalInfo.fiscalYear === targetFiscalYear - 1 && itemFiscalInfo.fiscalQuarter === 4) {
        return true;
      }
      
      // Exclude all other previous fiscal years
      return false;
    });
    
    // Get ALL points with actual stock prices (this includes all daily price data)
    // These should NOT be filtered by period - we want all available price data
    const priceDataPoints = stockData.filter(item => 
      item.stockPrice !== undefined && item.stockPrice !== null && !item.estimated
    );
    
    // Combine: Use Map with price data as base, then overlay quarterly metrics
    const combinedDataMap = new Map<string, TransformedDataPoint>();
    
    // First, add ALL price data points (this ensures all daily prices are included)
    priceDataPoints.forEach(item => {
      combinedDataMap.set(item.fullDate, item);
    });
    
    // Then, overlay quarterly metrics on matching dates (this adds EPS, fair value, etc.)
    filteredQuarterly.forEach(item => {
      const existing = combinedDataMap.get(item.fullDate);
      if (existing) {
        // Merge quarterly metrics into existing price point
        combinedDataMap.set(item.fullDate, {
          ...existing,
          // Add quarterly metrics
          fairValue: item.fairValue,
          normalPEValue: item.normalPEValue,
          earnings: item.earnings,
          eps_adjusted: item.eps_adjusted,
          normalPE: item.normalPE,
          dividendsPOR: item.dividendsPOR,
          hasQuarterlyData: true,
          peRatio: item.peRatio,
          revenue: item.revenue,
          dividend: item.dividend,
          dividendScaled: item.dividendScaled,
          calculatedNormalPE: item.calculatedNormalPE,
          // Preserve stock price from existing (daily price takes precedence)
          stockPrice: existing.stockPrice ?? item.stockPrice,
        });
      } else {
        // Standalone quarterly point (no price data) - include it (not just forecasts)
        // This ensures Q4 from previous fiscal year is included even if there's no price data on that exact date
        combinedDataMap.set(item.fullDate, item);
      }
      });
    
    // Convert back to array and add fiscal info
    return Array.from(combinedDataMap.values())
      .map(item => {
        // Add fiscal info to quarterly data points if not already present
        if (item.hasQuarterlyData && (item.fiscalYear === undefined || item.fiscalQuarter === undefined)) {
          const date = new Date(item.fullDate);
          const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
          return {
            ...item,
            fiscalYear: fiscalInfo.fiscalYear,
            fiscalQuarter: fiscalInfo.fiscalQuarter
          };
        }
        return item;
      })
      .sort((a, b) => new Date(a.fullDate).getTime() - new Date(b.fullDate).getTime());
  }, [stockData, targetFiscalYear, fiscalYearEndMonth]);

  // Calculate ticks based on time range: quarterly for <=3 years, yearly (Q4 only) for >3 years
  // Now aligned with fiscal year boundaries
  const { xAxisTicks, isQuarterlyMode } = useMemo(() => {
    if (filteredStockData.length === 0) return { xAxisTicks: [], isQuarterlyMode: true };
    
    const quarterlyDates = filteredStockData
      .filter(item => item.hasQuarterlyData)
      .map(item => {
        const date = new Date(item.fullDate);
        const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
        return {
          fullDate: item.fullDate,
          date,
          fiscalYear: fiscalInfo.fiscalYear,
          fiscalQuarter: fiscalInfo.fiscalQuarter
        };
      });
    
    if (quarterlyDates.length === 0) return { xAxisTicks: [], isQuarterlyMode: true };
    
    // Calculate time range in fiscal years
    // Use targetFiscalYear as the start if available, otherwise use min fiscal year
    // This excludes the previous year's Q4 from the range calculation
    const fiscalYears = quarterlyDates.map(q => q.fiscalYear);
    const minFiscalYear = targetFiscalYear || Math.min(...fiscalYears);
    const maxFiscalYear = Math.max(...fiscalYears);
    const fiscalYearsDiff = maxFiscalYear - minFiscalYear + 1;
    
    // If <= 3 fiscal years, show all quarterly ticks
    if (fiscalYearsDiff <= 3) {
      return { 
        xAxisTicks: quarterlyDates.map(q => q.fullDate).sort(), 
        isQuarterlyMode: true 
      };
    }
    
    // If > 3 fiscal years, show only Q4 dates (last quarter of each fiscal year)
    // Group by fiscal year and take the last quarterly date from each fiscal year
    const quarterlyByFiscalYear = new Map<number, typeof quarterlyDates>();
    quarterlyDates.forEach(q => {
      if (!quarterlyByFiscalYear.has(q.fiscalYear)) {
        quarterlyByFiscalYear.set(q.fiscalYear, []);
      }
      quarterlyByFiscalYear.get(q.fiscalYear)!.push(q);
    });
    
    // Get the last quarterly date (Q4) from each fiscal year
    const q4Dates = Array.from(quarterlyByFiscalYear.values())
      .map(yearQuarters => {
        // Find Q4, or if not available, the latest quarter
        const q4 = yearQuarters.find(q => q.fiscalQuarter === 4);
        if (q4) return q4.fullDate;
        // If no Q4, return the latest quarter
        return yearQuarters.sort((a, b) => b.date.getTime() - a.date.getTime())[0].fullDate;
      })
      .filter(Boolean)
      .sort();
    
    return { xAxisTicks: q4Dates, isQuarterlyMode: false };
  }, [filteredStockData, fiscalYearEndMonth, targetFiscalYear]);

  // Convert data to use timestamps for x-axis (needed for proper time scale)
  // Also compute fairValuePlusDividend for the stacked area (using dividendScaled from the yellow line)
  const chartDataWithTimestamps = useMemo(() => {
    return filteredStockData.map(point => ({
      ...point,
      timestamp: new Date(point.fullDate).getTime(),
      fairValuePlusDividend: point.fairValue !== null && point.fairValue !== undefined && 
                             point.dividendScaled !== null && point.dividendScaled !== undefined
        ? point.fairValue + point.dividendScaled 
        : null
    }));
  }, [filteredStockData]);
  
  // Calculate chart domain - start from fiscal year start date if it's earlier than first data point
  const chartDomain = useMemo(() => {
    if (chartDataWithTimestamps.length === 0) return ['dataMin', 'dataMax'];
    
    const dataMin = Math.min(...chartDataWithTimestamps.map(d => d.timestamp));
    const dataMax = Math.max(...chartDataWithTimestamps.map(d => d.timestamp));
    
    // If we have a fiscal year start date, use it as the minimum if it's before the first data point
    let domainMin = dataMin;
    if (fiscalYearStartDate) {
      const fiscalYearStartTimestamp = new Date(fiscalYearStartDate).getTime();
      if (fiscalYearStartTimestamp < dataMin) {
        domainMin = fiscalYearStartTimestamp;
      }
    }
    
    return [domainMin, dataMax];
  }, [chartDataWithTimestamps, fiscalYearStartDate]);
  
  // Convert xAxisTicks to timestamps for proper rendering
  const xAxisTickTimestamps = useMemo(() => {
    return xAxisTicks.map(date => new Date(date).getTime());
  }, [xAxisTicks]);
  
  // Get estimated data points for overlay rendering
  const estimatedPoints = useMemo(() => {
    return chartDataWithTimestamps.filter(p => p.estimated && p.hasQuarterlyData);
  }, [chartDataWithTimestamps]);
  
  // Find the transition timestamp for reference line (last actual quarterly point before first estimated)
  const forecastStartTimestamp = useMemo(() => {
    if (estimatedPoints.length === 0) return null;
    const sortedData = [...chartDataWithTimestamps].sort((a, b) => 
      a.timestamp - b.timestamp
    );
    
    // Find the last actual quarterly data point (not estimated, has quarterly data)
    const actualQuarterlyPoints = sortedData.filter(p => 
      !p.estimated && p.hasQuarterlyData && 
      (p.fairValue !== null || p.normalPEValue !== null || p.dividendScaled !== null)
    );
    
    if (actualQuarterlyPoints.length === 0) return null;
    
    // Get the last actual quarterly point's timestamp
    const lastActualQuarterly = actualQuarterlyPoints[actualQuarterlyPoints.length - 1];
    return lastActualQuarterly.timestamp;
  }, [chartDataWithTimestamps, estimatedPoints]);

  // Find last known price point and create analyst price target lines
  const analystPriceLines = useMemo(() => {
    if (!analystPriceTargets || (!analystPriceTargets.targetHigh && !analystPriceTargets.targetLow && !analystPriceTargets.targetMedian)) {
      return null;
    }

    // Find the last known price point (most recent non-estimated price)
    const sortedData = [...chartDataWithTimestamps].sort((a, b) => 
      a.timestamp - b.timestamp
    );
    
    const lastPricePoint = sortedData
      .filter(p => p.stockPrice !== null && p.stockPrice !== undefined && !p.estimated)
      .slice(-1)[0];
    
    if (!lastPricePoint) return null;

    const lastPriceTimestamp = lastPricePoint.timestamp;
    const lastPrice = lastPricePoint.stockPrice!;
    
    // Extend to the end of the chart domain (or 1 year ahead if domain not available)
    const futureTimestamp = typeof chartDomain[1] === 'number' 
      ? chartDomain[1] 
      : lastPriceTimestamp + (365 * 24 * 60 * 60 * 1000); // 1 year in milliseconds
    
    // Create data points for each target line
    const lines: Array<{ data: Array<{ timestamp: number; price: number }>; color: string; name: string }> = [];
    
    if (analystPriceTargets.targetHigh) {
      lines.push({
        data: [
          { timestamp: lastPriceTimestamp, price: lastPrice },
          { timestamp: futureTimestamp, price: analystPriceTargets.targetHigh }
        ],
        color: '#d1d5db', // lighter gray
        name: 'Analyst High (est.)'
      });
    }
    
    if (analystPriceTargets.targetMedian) {
      lines.push({
        data: [
          { timestamp: lastPriceTimestamp, price: lastPrice },
          { timestamp: futureTimestamp, price: analystPriceTargets.targetMedian }
        ],
        color: '#000000', // black
        name: 'Analyst Median (est.)'
      });
    }
    
    if (analystPriceTargets.targetLow) {
      lines.push({
        data: [
          { timestamp: lastPriceTimestamp, price: lastPrice },
          { timestamp: futureTimestamp, price: analystPriceTargets.targetLow }
        ],
        color: '#d1d5db', // lighter gray
        name: 'Analyst Low (est.)'
      });
    }
    
    return lines.length > 0 ? lines : null;
  }, [chartDataWithTimestamps, analystPriceTargets, chartDomain]);

  // Helper function to split data into actual and estimated segments for a given dataKey
  // Includes the transition point (last actual point) in estimated data for smooth connection
  const splitDataByEstimated = useMemo(() => {
    return (dataKey: string) => {
      const sortedData = [...chartDataWithTimestamps].sort((a, b) => a.timestamp - b.timestamp);
      const actualData: any[] = [];
      const estimatedData: any[] = [];
      
      // Separate actual and estimated points
      sortedData.forEach((point) => {
        const value = (point as any)[dataKey];
        const hasValue = value !== null && value !== undefined;
        
        if (!hasValue) return;
        
        if (point.estimated) {
          estimatedData.push(point);
        } else {
          actualData.push(point);
        }
      });
      
      // If we have both actual and estimated data, add the last actual point to estimated data
      // to ensure the lines connect smoothly
      if (actualData.length > 0 && estimatedData.length > 0) {
        const lastActual = actualData[actualData.length - 1];
        // Only add if not already in estimated data (shouldn't happen, but safe check)
        if (!estimatedData.some(p => p.timestamp === lastActual.timestamp)) {
          estimatedData.unshift(lastActual);
        }
      }
      
      return { actualData, estimatedData };
    };
  }, [chartDataWithTimestamps]);

  // Filter table data to match chart ticks and aggregate when in yearly mode
  const tableData = useMemo(() => {
    return calculateTableData(filteredStockData, xAxisTicks, isQuarterlyMode, fiscalYearEndMonth);
  }, [filteredStockData, xAxisTicks, isQuarterlyMode, fiscalYearEndMonth]);

  // Handle legend click to toggle series visibility
  const handleLegendClick = (dataKey: keyof VisibleSeries) => {
    setVisibleSeries(prev => ({
      ...prev,
      [dataKey]: !prev[dataKey]
    }));
  };


  // Custom Legend Component
  const CustomLegend = ({ legendItems }: { legendItems: Array<{ dataKey: string; color: string; name: string }> }) => (
    <div className="flex justify-center gap-6 mb-4 flex-wrap">
      {legendItems.map((item) => {
        // Special handling for Fair Value with toggle
        if (item.dataKey === 'fairValue') {
          return (
            <div
              key={item.dataKey}
              className="flex items-center gap-2 select-none"
            >
              <div
                className={`flex items-center gap-2 cursor-pointer transition-opacity ${
                  visibleSeries.fairValue ? 'opacity-100' : 'opacity-50'
                }`}
                onClick={() => handleLegendClick('fairValue')}
              >
                <div
                  className="w-4 h-0.5 rounded"
                  style={{ backgroundColor: item.color }}
                />
                <span className={`text-sm ${
                  visibleSeries.fairValue 
                    ? 'text-gray-700 font-medium' 
                    : 'text-gray-400 line-through'
                }`}>
                  {item.name}
                </span>
              </div>
              <label className="relative inline-flex items-center cursor-pointer ml-1">
                <input
                  type="checkbox"
                  checked={visibleSeries.fairValuePlusDividend}
                  onChange={() => handleLegendClick('fairValuePlusDividend')}
                  className="sr-only"
                />
                <div className={`w-7 h-4 rounded-full transition-colors ${
                  visibleSeries.fairValuePlusDividend ? 'bg-gray-400' : 'bg-gray-200'
                }`}>
                  <div className={`absolute top-[1px] left-[1px] bg-white border border-gray-300 rounded-full h-3 w-3 transition-transform ${
                    visibleSeries.fairValuePlusDividend ? 'translate-x-3' : 'translate-x-0'
                  }`}></div>
                </div>
                <span className="ml-2 text-xs text-gray-600 font-medium">+ Div</span>
              </label>
            </div>
          );
        }
        
        // Regular legend items
        return (
          <div
            key={item.dataKey}
            className={`flex items-center gap-2 cursor-pointer select-none transition-opacity ${
              visibleSeries[item.dataKey as keyof VisibleSeries] ? 'opacity-100' : 'opacity-50'
            }`}
            onClick={() => handleLegendClick(item.dataKey as keyof VisibleSeries)}
          >
            <div
              className="w-4 h-0.5 rounded"
              style={{ backgroundColor: item.color }}
            />
            <span className={`text-sm ${
              visibleSeries[item.dataKey as keyof VisibleSeries] 
                ? 'text-gray-700 font-medium' 
                : 'text-gray-400 line-through'
            }`}>
              {item.name}
            </span>
          </div>
        );
      })}
    </div>
  );

  // Custom tooltip for the main chart
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      // Format the label (timestamp) as a date string
      let formattedLabel = label;
      if (typeof label === 'number') {
        // It's a timestamp, convert to date string
        const date = new Date(label);
        formattedLabel = date.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
      } else if (typeof label === 'string' && !isNaN(Date.parse(label))) {
        // It's a date string, format it nicely
        const date = new Date(label);
        formattedLabel = date.toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        });
      }
      
      // Get fiscal quarter info from the payload data point
      let fiscalQuarterLabel = '';
      if (payload && payload.length > 0 && payload[0].payload) {
        const dataPoint = payload[0].payload;
        if (dataPoint.fiscalYear !== undefined && dataPoint.fiscalQuarter !== undefined) {
          fiscalQuarterLabel = ` ${dataPoint.fiscalYear}Q${dataPoint.fiscalQuarter}`;
        }
      }
      
      // Filter payload to exclude "Fair Value" when "Fair Value + Dividend" is also present
      const hasFairValuePlusDividend = payload.some((entry: any) => 
        entry.dataKey === 'fairValuePlusDividend'
      );
      const filteredPayload = hasFairValuePlusDividend
        ? payload.filter((entry: any) => entry.dataKey !== 'fairValue')
        : payload;
      
      return (
        <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-900 mb-2">{formattedLabel}{fiscalQuarterLabel}</p>
          {filteredPayload.map((entry: any, index: number) => {
            // For dividend, show the actual value (not scaled) in the tooltip
            // The payload contains the full data point, so we can access the original dividend
            if (entry.dataKey === 'dividendScaled' && entry.payload) {
              const actualDividend = entry.payload.dividend;
              return (
                <p key={index} style={{ color: entry.color }} className="text-sm">
                  {entry.name}: ${actualDividend !== null && actualDividend !== undefined 
                    ? actualDividend.toFixed(2) 
                    : '-'}
                </p>
              );
            }
            // For normalPEValue, show the PE value instead of dollar value
            if (entry.dataKey === 'normalPEValue' && entry.payload) {
              const normalPE = entry.payload.calculatedNormalPE;
              return (
                <p key={index} style={{ color: entry.color }} className="text-sm">
                  {entry.name}: {normalPE !== null && normalPE !== undefined 
                    ? normalPE.toFixed(2) + 'x' 
                    : '-'}
                </p>
              );
            }
            return (
              <p key={index} style={{ color: entry.color }} className="text-sm">
                {entry.name}: ${typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
              </p>
            );
          })}
        </div>
      );
    }
    return null;
  };

  // Custom dot component for quarterly data points on the area chart
  const QuarterlyDot = (props: any) => {
    const { cx, cy, payload } = props;
    
    // Only show dot if this data point has quarterly data
    if (!payload || !payload.hasQuarterlyData) {
      return null;
    }
    
    return (
      <circle
        cx={cx}
        cy={cy}
        r={5}
        fill="#ea580c"
        stroke="#fff"
        strokeWidth={2}
      />
    );
  };

  // Custom blue dot component for normal PE value line
  const BlueQuarterlyDot = (props: any) => {
    const { cx, cy, payload } = props;
    
    // Only show dot if this data point has quarterly data and normalPEValue
    if (!payload || !payload.hasQuarterlyData || payload.normalPEValue === null) {
      return null;
    }
    
    return (
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill="#3b82f6"
        stroke="#fff"
        strokeWidth={2}
      />
    );
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">

            {/* No Data State */}
      {filteredStockData.length === 0 && (
        <div className="flex items-center justify-center h-96 text-gray-500">
          <p>No data available for the selected period</p>
        </div>
      )}

      {/* Chart and Data */}
      {filteredStockData.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={chartDataWithTimestamps} margin={{ bottom: 20 }}>
              <defs>
                <linearGradient id="estimatedAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
                  <stop offset="30%" stopColor="#e5e7eb" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#9ca3af" stopOpacity={0.35} />
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="timestamp" 
                type="number"
                scale="time"
                domain={chartDomain}
                tick={{ fontSize: 12 }}
                ticks={xAxisTickTimestamps.length > 0 ? xAxisTickTimestamps : undefined}
                tickFormatter={(value) => {
                  // Convert timestamp back to date string
                  const dateStr = new Date(value).toISOString().split('T')[0];
                  
                  // Only show labels for quarterly data points (check if in xAxisTicks)
                  if (xAxisTicks.length > 0 && !xAxisTicks.includes(dateStr)) {
                    return ''; // Return empty string to hide non-quarterly ticks
                  }
                  
                  // Find the data point to access stored fiscal info
                  const dataPoint = chartDataWithTimestamps.find(d => d.timestamp === value);
                  if (dataPoint && dataPoint.fiscalYear !== undefined) {
                    if (isQuarterlyMode && dataPoint.fiscalQuarter !== undefined) {
                      return `${dataPoint.fiscalYear}Q${dataPoint.fiscalQuarter}`;
                    } else {
                      return dataPoint.fiscalYear.toString();
                    }
                  }
                  // Fallback: format date
                  const date = new Date(value);
                  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
                }}
              />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip 
                content={<CustomTooltip />}
                labelFormatter={(value) => {
                  const date = new Date(value);
                  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                }}
              />
              
              {/* Reference line to mark start of forecasts */}
              {forecastStartTimestamp && (
                <ReferenceLine 
                  x={forecastStartTimestamp} 
                  stroke="#999" 
                  strokeDasharray="3 3" 
                  strokeWidth={1}
                  opacity={0.5}
                />
              )}
              
              {/* Background overlay for estimated/future period */}
              {forecastStartTimestamp && chartDomain[1] && (
                <ReferenceArea
                  x1={forecastStartTimestamp}
                  x2={chartDomain[1]}
                  fill="url(#estimatedAreaGradient)"
                  stroke="none"
                />
              )}
              
              {/* Fair Value Area - Actual (solid) */}
              {visibleSeries.fairValue && (() => {
                const { actualData, estimatedData } = splitDataByEstimated('fairValue');
                return (
                  <>
                    {actualData.length > 0 && (
                      <Area
                        type="linear"
                        dataKey="fairValue"
                        stroke="#ea580c"
                        fill="#ea580c"
                        fillOpacity={0.2}
                        strokeWidth={1}
                        name="Fair Value"
                        connectNulls={true}
                        dot={<QuarterlyDot />}
                        data={actualData}
                      />
                    )}
                    {estimatedData.length > 0 && (
                      <Area
                        type="linear"
                        dataKey="fairValue"
                        stroke="#ea580c"
                        fill="#ea580c"
                        fillOpacity={0.2}
                        strokeWidth={1}
                        name="Fair Value (est.)"
                        connectNulls={true}
                        strokeDasharray="5 5"
                        dot={<QuarterlyDot />}
                        data={estimatedData}
                      />
                    )}
                  </>
                );
              })()}
              
              {/* Simple area on top of Fair Value (dividendScaled high) */}
              {visibleSeries.fairValuePlusDividend && (() => {
                const { actualData, estimatedData } = splitDataByEstimated('fairValuePlusDividend');
                return (
                  <>
                    {actualData.length > 0 && (
                      <Area
                        type="linear"
                        dataKey="fairValuePlusDividend"
                        stroke="#f97316"
                        fill="#f97316"
                        fillOpacity={0.1}
                        strokeWidth={0.5}
                        name="Fair Value + Dividend"
                        connectNulls={true}
                        dot={false}
                        data={actualData}
                      />
                    )}
                    {estimatedData.length > 0 && (
                      <Area
                        type="linear"
                        dataKey="fairValuePlusDividend"
                        stroke="#f97316"
                        fill="#f97316"
                        fillOpacity={0.1}
                        strokeWidth={0.5}
                        name="Fair Value + Dividend (est.)"
                        connectNulls={true}
                        strokeDasharray="5 5"
                        dot={false}
                        data={estimatedData}
                      />
                    )}
                  </>
                );
              })()}
              
              {/* Normal PE Value Line - Actual (solid) */}
              {visibleSeries.normalPEValue && (() => {
                const { actualData, estimatedData } = splitDataByEstimated('normalPEValue');
                return (
                  <>
                    {actualData.length > 0 && (
                      <Line
                        type="linear"
                        dataKey="normalPEValue"
                        stroke="#3b82f6"
                        strokeWidth={1}
                        name="Normal PE"
                        connectNulls={true}
                        dot={<BlueQuarterlyDot />}
                        data={actualData}
                      />
                    )}
                    {estimatedData.length > 0 && (
                      <Line
                        type="linear"
                        dataKey="normalPEValue"
                        stroke="#3b82f6"
                        strokeWidth={1}
                        name="Normal PE (est.)"
                        connectNulls={true}
                        strokeDasharray="5 5"
                        dot={<BlueQuarterlyDot />}
                        data={estimatedData}
                      />
                    )}
                  </>
                );
              })()}
              
              {/* Dividends Line - Actual (solid) */}
              {visibleSeries.dividendsPOR && (() => {
                const { actualData, estimatedData } = splitDataByEstimated('dividendScaled');
                return (
                  <>
                    {actualData.length > 0 && (
                      <Line
                        type="linear"
                        dataKey="dividendScaled"
                        stroke="#8b5a3c"
                        fill="#8b5a3c"
                        fillOpacity={0.15}
                        strokeWidth={1.5}
                        name="Dividend"
                        connectNulls={true}
                        dot={false}
                        data={actualData}
                      />
                    )}
                    {estimatedData.length > 0 && (
                      <Line
                        type="linear"
                        dataKey="dividendScaled"
                        stroke="#8b5a3c"
                        fill="#8b5a3c"
                        fillOpacity={0.15}
                        strokeWidth={1.5}
                        name="Dividend (est.)"
                        connectNulls={true}
                        strokeDasharray="5 5"
                        dot={false}
                        data={estimatedData}
                      />
                    )}
                  </>
                );
              })()}
              
              {/* Stock Price Line - on top */}
              {visibleSeries.price && (
                <Line
                  type="monotone"
                  dataKey="stockPrice"
                  stroke="#000000"
                  strokeWidth={1}
                  name="Stock Price (Daily)"
                  dot={false}
                />
              )}
              
              {/* Analyst Price Target Lines - dashed lines from last price to targets */}
              {analystPriceLines && analystPriceLines.map((line, index) => (
                <Line
                  key={`analyst-${index}`}
                  type="linear"
                  data={line.data}
                  dataKey="price"
                  stroke={line.color}
                  strokeWidth={1.5}
                  strokeDasharray="5 5"
                  name={line.name}
                  dot={false}
                  connectNulls={true}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Custom Legend */}
          <CustomLegend 
            legendItems={[
              { dataKey: 'price', color: '#000000', name: 'Stock Price ($)' },
              { dataKey: 'fairValue', color: '#ea580c', name: 'Fair Value ($)' },
              { dataKey: 'normalPEValue', color: '#3b82f6', name: 'Normal PE' },
              { dataKey: 'dividendsPOR', color: '#8b5a3c', name: 'Dividend ($)' }
            ]} 
          />
          
          {/* Data Table */}
          <StockDataTable
            tableData={tableData}
            isQuarterlyMode={isQuarterlyMode}
            stockData={stockData}
          />
        </>
      )}
    </div>
  );
}