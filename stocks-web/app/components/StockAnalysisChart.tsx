'use client';

import { useState, useMemo } from 'react';
import {
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Area
} from 'recharts';
import { DailyDataPoint, QuarterlyDataPoint as ApiQuarterlyDataPoint } from '../types/api';
import { 
  getFiscalYearAndQuarter, 
  inferFiscalYearEndMonth, 
  calculateFiscalYearStartDate
} from '../lib/calculations';
import { 
  TransformedDataPoint, 
  enrichQuarterlyWithPrices,
  calculateQuarterlyMetrics,
  combineDataForCharting,
  calculateTableData
} from './stockChartTransform';
import StockDataTable from './StockDataTable';

interface StockAnalysisChartProps {
  dailyData: DailyDataPoint[];
  quarterlyData: ApiQuarterlyDataPoint[];
  currentPeriod?: string;
  normalPERatio: number | null;
  fairValueRatio: number;
}

interface VisibleSeries {
  price: boolean;
  fairValue: boolean;
  normalPEValue: boolean;
  dividendsPOR: boolean;
}

export default function StockAnalysisChart({ 
  dailyData, 
  quarterlyData, 
  currentPeriod = '8y', 
  normalPERatio,
  fairValueRatio
}: StockAnalysisChartProps) {
  // State to track visibility of data series
  const [visibleSeries, setVisibleSeries] = useState<VisibleSeries>({
    price: true,
    fairValue: true,
    normalPEValue: true,
    dividendsPOR: true
  });

  // Transform raw API data into chart data using the new streamlined sequence
  const stockData: TransformedDataPoint[] = useMemo(() => {
    // Step 1: Enrich quarterly data with prices
    const enrichedQuarterly = enrichQuarterlyWithPrices(quarterlyData, dailyData);
    // Step 2: Calculate derived metrics on enriched quarterly data
    const calculatedQuarterly = calculateQuarterlyMetrics(enrichedQuarterly, normalPERatio, fairValueRatio);
    // Step 3: Combine enriched quarterly data with daily price data for charting
    return combineDataForCharting(calculatedQuarterly, dailyData, normalPERatio);
  }, [dailyData, quarterlyData, normalPERatio, fairValueRatio]);

  // Extract quarterly date strings for fiscal year calculations
  const quarterlyDateStrings = useMemo(() => {
    return stockData
      .filter(item => item.hasQuarterlyData)
      .map(item => item.fullDate);
  }, [stockData]);

  // Infer fiscal year end month from quarterly dates
  const fiscalYearEndMonth = useMemo(() => {
    return inferFiscalYearEndMonth(quarterlyDateStrings);
  }, [quarterlyDateStrings]);


  // Calculate the start date as Q1 of N fiscal years back
  const fiscalYearStartDate = useMemo(() => {
    if (quarterlyDateStrings.length === 0) return null;
    return calculateFiscalYearStartDate(quarterlyDateStrings, currentPeriod, fiscalYearEndMonth);
  }, [quarterlyDateStrings, currentPeriod, fiscalYearEndMonth]);

  // Filter stock data to start from the fiscal year Q1 date and add fiscal info to quarterly data points
  const filteredStockData = useMemo(() => {
    if (!fiscalYearStartDate) {
      // Add fiscal info to quarterly data points even if not filtering
      return stockData.map(item => {
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
      });
    }
    
    const startDate = new Date(fiscalYearStartDate);
    return stockData
      .filter(item => {
        const itemDate = new Date(item.fullDate);
        return itemDate >= startDate;
      })
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
      });
  }, [stockData, fiscalYearStartDate, fiscalYearEndMonth]);



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
    const fiscalYears = quarterlyDates.map(q => q.fiscalYear);
    const minFiscalYear = Math.min(...fiscalYears);
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
  }, [filteredStockData, fiscalYearEndMonth]);

  // Filter table data to match chart ticks and aggregate when in yearly mode
  const tableData = useMemo(() => {
    return calculateTableData(filteredStockData, xAxisTicks, isQuarterlyMode, fiscalYearEndMonth);
  }, [filteredStockData, xAxisTicks, isQuarterlyMode, fiscalYearEndMonth]);

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
        fill="#f97316"
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
            <ComposedChart data={filteredStockData} margin={{ bottom: 20 }}>
              <XAxis 
                dataKey="fullDate" 
                type="category"
                scale="point"
                tick={{ fontSize: 12 }}
                ticks={xAxisTicks}
                tickFormatter={(value) => {
                  // Find the data point to access stored fiscal info
                  const dataPoint = filteredStockData.find(d => d.fullDate === value);
                  if (dataPoint && dataPoint.fiscalYear !== undefined) {
                    if (isQuarterlyMode && dataPoint.fiscalQuarter !== undefined) {
                      return `${dataPoint.fiscalYear}Q${dataPoint.fiscalQuarter}`;
                    } else {
                      return dataPoint.fiscalYear.toString();
                    }
                  }
                  // Fallback: should not happen since we set fiscal info on all quarterly data points
                  return value;
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
              
              {/* Normal PE Value Line - blue */}
              {visibleSeries.normalPEValue && (
                <Line
                  type="linear"
                  dataKey="normalPEValue"
                  stroke="#3b82f6"
                  strokeWidth={1}
                  name="Normal PE"
                  connectNulls={true}
                  dot={<BlueQuarterlyDot />}
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
              { dataKey: 'normalPEValue', color: '#3b82f6', name: 'Normal PE' },
              { dataKey: 'dividendsPOR', color: '#fbbf24', name: 'Dividend ($)' }
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