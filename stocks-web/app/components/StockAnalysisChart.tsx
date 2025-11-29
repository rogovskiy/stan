'use client';

import { useState, useMemo, useEffect } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Area
} from 'recharts';
import { transformApiDataForChart, TransformedDataPoint } from '../lib/dataTransform';
import { DailyPriceResponse, QuarterlyDataResponse } from '../types/api';

interface StockAnalysisChartProps {
  stockData: TransformedDataPoint[];
  onPeriodChange?: (period: string) => void;
  currentPeriod?: string;
}

interface VisibleSeries {
  price: boolean;
  fairValue: boolean;
  dividendsPOR: boolean;
}

type IntervalOption = {
  value: string;
  label: string;
  months?: number;
};

const INTERVAL_OPTIONS = [
  { value: 'max', label: 'Max' },
  { value: '10y', label: '10Y' },
  { value: '9y', label: '9Y' },
  { value: '8y', label: '8Y' },
  { value: '7y', label: '7Y' },
  { value: '6y', label: '6Y' },
  { value: '5y', label: '5Y' },
  { value: '4y', label: '4Y' },
  { value: '3y', label: '3Y' },
  { value: '2y', label: '2Y' },
  { value: '1y', label: '1Y' }
];

export default function StockAnalysisChart({ stockData, onPeriodChange, currentPeriod = '8y' }: StockAnalysisChartProps) {
  // State to track visibility of data series
  const [visibleSeries, setVisibleSeries] = useState<VisibleSeries>({
    price: true,
    fairValue: true,
    dividendsPOR: true
  });

  // Use currentPeriod prop instead of local state
  const selectedInterval = currentPeriod;

  // Use stockData directly - no client-side filtering since API handles period filtering
  const filteredStockData = stockData;

  // Create chart data with scaled dividends for proportional display
  // Dividends are scaled by PE ratio to match the scale of fairValue (which is EPS * PE)
  const chartDataWithScaledDividends = useMemo(() => {
    return filteredStockData.map(item => ({
      ...item,
      dividendScaled: item.dividend !== null && item.dividend !== undefined && item.peRatio !== null && item.peRatio !== undefined
        ? item.dividend * item.peRatio
        : null
    }));
  }, [filteredStockData]);

  // Calculate ticks based on time range: quarterly for <=3 years, yearly (Q4 only) for >3 years
  const { xAxisTicks, isQuarterlyMode } = useMemo(() => {
    if (filteredStockData.length === 0) return { xAxisTicks: [], isQuarterlyMode: true };
    
    const quarterlyDates = filteredStockData
      .filter(item => item.hasQuarterlyData)
      .map(item => item.fullDate);
    
    if (quarterlyDates.length === 0) return { xAxisTicks: [], isQuarterlyMode: true };
    
    // Calculate time range in years
    const firstDate = new Date(quarterlyDates[0]);
    const lastDate = new Date(quarterlyDates[quarterlyDates.length - 1]);
    const yearsDiff = (lastDate.getTime() - firstDate.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
    
    // If <= 3 years, show all quarterly ticks
    if (yearsDiff <= 3) {
      return { xAxisTicks: quarterlyDates, isQuarterlyMode: true };
    }
    
    // If > 3 years, show only Q4 dates (last quarter of each year)
    // Group by year and take the last quarterly date from each year
    const quarterlyByYear = new Map<number, string[]>();
    quarterlyDates.forEach(dateStr => {
      const date = new Date(dateStr);
      const year = date.getFullYear();
      if (!quarterlyByYear.has(year)) {
        quarterlyByYear.set(year, []);
      }
      quarterlyByYear.get(year)!.push(dateStr);
    });
    
    // Get the last quarterly date from each year (sorted to ensure we get the latest)
    const q4Dates = Array.from(quarterlyByYear.values())
      .map(yearDates => yearDates.sort().pop()!)
      .filter(Boolean)
      .sort();
    
    return { xAxisTicks: q4Dates, isQuarterlyMode: false };
  }, [filteredStockData]);

  // Helper function to get quarter number from date (1-4)
  const getQuarter = (date: Date): number => {
    const month = date.getMonth() + 1; // getMonth() returns 0-11
    return Math.ceil(month / 3);
  };

  // Filter table data to match chart ticks and aggregate when in yearly mode
  const tableData = useMemo(() => {
    if (xAxisTicks.length === 0) return [];
    
    // If quarterly mode, filter by exact tick dates
    if (isQuarterlyMode) {
      const tickDatesSet = new Set(xAxisTicks);
      return filteredStockData.filter(item => 
        tickDatesSet.has(item.fullDate) && item.hasQuarterlyData
      );
    }
    
    // If yearly mode, extract years from ticks and get ALL quarterly data for those years
    const tickYears = new Set(xAxisTicks.map(dateStr => new Date(dateStr).getFullYear()));
    
    // Get all quarterly data points for the years in ticks
    const quarterlyDataPoints = filteredStockData.filter(item => {
      if (!item.hasQuarterlyData) return false;
      const itemYear = new Date(item.fullDate).getFullYear();
      return tickYears.has(itemYear);
    });
    
    // Aggregate data by year
    const yearlyData = new Map<number, {
      fullDate: string;
      year: number;
      peRatio: number[];
      earnings: number[];
      eps_adjusted: number[];
      dividend: number[];
    }>();
    
    quarterlyDataPoints.forEach(item => {
      const year = new Date(item.fullDate).getFullYear();
      
      if (!yearlyData.has(year)) {
        yearlyData.set(year, {
          fullDate: item.fullDate, // Keep the last date of the year
          year,
          peRatio: [],
          earnings: [],
          eps_adjusted: [],
          dividend: []
        });
      }
      
      const yearData = yearlyData.get(year)!;
      
      if (item.peRatio !== null) {
        yearData.peRatio.push(item.peRatio);
      }
      if (item.earnings !== null && item.earnings !== undefined) {
        yearData.earnings.push(item.earnings);
      }
      // Use eps_adjusted if available, otherwise fall back to earnings
      const epsAdjustedValue = item.eps_adjusted !== null && item.eps_adjusted !== undefined 
        ? item.eps_adjusted 
        : item.earnings;
      if (epsAdjustedValue !== null && epsAdjustedValue !== undefined) {
        yearData.eps_adjusted.push(epsAdjustedValue);
      }
      if (item.dividend !== null && item.dividend !== undefined) {
        yearData.dividend.push(item.dividend);
      }
      
      // Update fullDate to the latest date in the year
      if (new Date(item.fullDate) > new Date(yearData.fullDate)) {
        yearData.fullDate = item.fullDate;
      }
    });
    console.log('Yearly data:', yearlyData);
    // Convert aggregated data back to TransformedDataPoint format
    return Array.from(yearlyData.values())
      .sort((a, b) => a.year - b.year)
      .map(yearData => ({
        fullDate: yearData.fullDate,
        date: yearData.year.toString(),
        stockPrice: null,
        estimated: false,
        year: yearData.year,
        frequency: 'yearly',
        marketCap: null,
        volume: 0,
        earnings: yearData.earnings.length > 0 
          ? yearData.earnings.reduce((sum, val) => sum + val, 0) 
          : null,
        eps_adjusted: yearData.eps_adjusted.length > 0 
          ? yearData.eps_adjusted.reduce((sum, val) => sum + val, 0) 
          : null,
        normalPE: null,
        dividendsPOR: null,
        hasQuarterlyData: true,
        peRatio: yearData.peRatio.length > 0 
          ? yearData.peRatio.reduce((sum, val) => sum + val, 0) / yearData.peRatio.length 
          : null,
        revenue: null,
        dividend: yearData.dividend.length > 0 
          ? yearData.dividend.reduce((sum, val) => sum + val, 0) 
          : null
      }));
  }, [filteredStockData, xAxisTicks, isQuarterlyMode]);

  // Format date for table header (matches chart tick formatter)
  const formatTableDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (isQuarterlyMode) {
      const year = date.getFullYear();
      const quarter = getQuarter(date);
      return `${year}Q${quarter}`;
    } else {
      return date.getFullYear().toString();
    }
  };

  // Debug logging for chart data
  console.log('Chart data debug:', {
    totalPoints: filteredStockData.length,
    firstDate: filteredStockData.length > 0 ? filteredStockData[0].fullDate : 'none',
    lastDate: filteredStockData.length > 0 ? filteredStockData[filteredStockData.length - 1].fullDate : 'none',
    sampleDates: filteredStockData.slice(0, 5).map(p => p.fullDate),
    xAxisTicksCount: xAxisTicks.length
  });

  // Handle legend click to toggle series visibility
  const handleLegendClick = (dataKey: keyof VisibleSeries) => {
    setVisibleSeries(prev => ({
      ...prev,
      [dataKey]: !prev[dataKey]
    }));
  };

  // Handle interval change - notify parent component to refetch data
  const handleIntervalChange = (interval: string) => {
    console.log(`Chart: handleIntervalChange called with: ${interval}`);
    if (onPeriodChange) {
      console.log(`Chart: Calling onPeriodChange(${interval})`);
      onPeriodChange(interval);
    } else {
      console.log(`Chart: onPeriodChange callback is not provided`);
    }
  };

  // Custom Legend Component
  const CustomLegend = ({ legendItems }: { legendItems: Array<{ dataKey: string; color: string; name: string }> }) => (
    <div className="flex justify-center gap-6 mb-4">
      {legendItems.map((item) => (
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
      ))}
    </div>
  );

  // Custom tooltip for the main chart
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-4 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-semibold text-gray-900 mb-2">{label}</p>
          {payload.map((entry: any, index: number) => {
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
        fill="#f97316"
        stroke="#fff"
        strokeWidth={2}
      />
    );
  };

  return (
    <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
      {/* Header with title and interval picker */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900 tracking-tight">
          Stock Price and Fair Value Analysis
        </h2>
        
        {/* Interval Picker */}
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
          {INTERVAL_OPTIONS.map((option) => (
            <button
              key={option.value}
              onClick={() => handleIntervalChange(option.value)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${
                selectedInterval === option.value
                  ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                  : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

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
            <ComposedChart data={chartDataWithScaledDividends} margin={{ bottom: 20 }}>
              <XAxis 
                dataKey="fullDate" 
                type="category"
                scale="point"
                tick={{ fontSize: 12 }}
                ticks={xAxisTicks}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  if (isQuarterlyMode) {
                    // Format as yyyyQQ (e.g., "2024Q1")
                    const year = date.getFullYear();
                    const quarter = getQuarter(date);
                    return `${year}Q${quarter}`;
                  } else {
                    // Format as year only (e.g., "2024")
                    return date.getFullYear().toString();
                  }
                }}
              />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              
              {/* Fair Value Area */}
              {visibleSeries.fairValue && (
                <Area
                  type="linear"
                  dataKey="fairValue"
                  stroke="#f97316"
                  fill="#f97316"
                  fillOpacity={0.15}
                  strokeWidth={1}
                  name="Fair Value"
                  connectNulls={true}
                  dot={<QuarterlyDot />}
                />
              )}
              
              {/* Dividends Line - scaled by PE ratio for proportional display */}
              {visibleSeries.dividendsPOR && (
                <Line
                  type="linear"
                  dataKey="dividendScaled"
                  stroke="#fbbf24"
                  fill="#fbbf24"
                  fillOpacity={0.1}
                  strokeWidth={1}
                  name="Dividend"
                  connectNulls={true}
                  dot={false}
                />
              )}
              
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
            </ComposedChart>
          </ResponsiveContainer>

          {/* Custom Legend */}
          <CustomLegend 
            legendItems={[
              { dataKey: 'price', color: '#000000', name: 'Stock Price ($)' },
              { dataKey: 'fairValue', color: '#f97316', name: 'Fair Value ($)' },
              { dataKey: 'dividendsPOR', color: '#fbbf24', name: 'Dividend ($)' }
            ]} 
          />
          
          {/* Data Table */}
          <div className="mt-6 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b-2 border-gray-200">
                  <th className="text-left py-3 px-1.5 font-bold text-gray-900 w-16 text-sm uppercase tracking-wide">&nbsp;</th>
                  {tableData.map((item, index) => (
                    <th key={item.fullDate} className={`text-left py-3 font-bold text-gray-900 text-sm tracking-tight ${index === tableData.length - 1 ? 'w-16 px-1.5' : 'px-3'}`}
                        style={index === tableData.length - 1 ? {} : { width: `${100 / tableData.length}%` }}>
                      {formatTableDate(item.fullDate)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-sm">
                <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white transition-colors">
                  <td className="py-3 px-1.5 font-bold text-gray-900 tracking-wide">PE</td>
                  {tableData.map((item, index) => (
                    <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                      {item.peRatio?.toFixed(1) || '0.0'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white">
                  <td className="py-3 px-1.5 font-bold text-gray-900 tracking-wide">EPS</td>
                  {tableData.map((item, index) => (
                    <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                      ${item.earnings?.toFixed(2) || '-'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white">
                  <td className="py-3 px-1.5 font-bold text-gray-900 tracking-wide">EPS Split Adjusted</td>
                  {tableData.map((item, index) => (
                    <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                      {item.eps_adjusted !== null && item.eps_adjusted !== undefined 
                        ? `$${item.eps_adjusted.toFixed(2)}` 
                        : '-'}
                    </td>
                  ))}
                </tr>
                <tr className="border-b border-gray-100 hover:bg-gray-50 bg-gray-50">
                  <td className="py-3 px-1.5 font-bold text-gray-900 tracking-wide">Dividend</td>
                  {tableData.map((item, index) => (
                    <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                      ${item.dividend?.toFixed(2) || '-'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}