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
  calculateFiscalYearStartDate,
  getTrailing4QuartersEps,
  calculateAnnualEps,
  QuarterlyDataPoint
} from '../lib/calculations';
import { TransformedDataPoint, transformApiDataForChart } from './stockChartTransform';

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
  fairValueEpsAdjusted: boolean;
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
    fairValueEpsAdjusted: true,
    dividendsPOR: true
  });

  // Transform raw API data into chart data owned by this component
  const stockData: TransformedDataPoint[] = useMemo(() => {
    return transformApiDataForChart(dailyData, quarterlyData, fairValueRatio);
  }, [dailyData, quarterlyData, fairValueRatio]);

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

  // Filter stock data to start from the fiscal year Q1 date
  const filteredStockData = useMemo(() => {
    if (!fiscalYearStartDate) return stockData;
    
    const startDate = new Date(fiscalYearStartDate);
    return stockData.filter(item => {
      const itemDate = new Date(item.fullDate);
      return itemDate >= startDate;
    });
  }, [stockData, fiscalYearStartDate]);


  // Create chart data with scaled dividends and calculate fairValueEpsAdjusted using trailing 4 quarters
  const chartDataWithScaledDividends = useMemo(() => {
    return filteredStockData.map((item, index) => {
      // Calculate trailing 4 quarters EPS adjusted for fairValueEpsAdjusted
      let fairValueEpsAdjusted: number | null = null;
      
      if (item.hasQuarterlyData && normalPERatio !== null) {
        const currentDate = new Date(item.fullDate);
        // Get all quarterly data points up to and including this date
        const trailing4Quarters = filteredStockData
          .filter(d => {
            const dDate = new Date(d.fullDate);
            return dDate <= currentDate && d.hasQuarterlyData;
          })
          .sort((a, b) => new Date(b.fullDate).getTime() - new Date(a.fullDate).getTime())
          .slice(0, 4);
        
        if (trailing4Quarters.length > 0) {
          const trailingEps = trailing4Quarters.reduce((sum, d) => {
            const epsValue = d.eps_adjusted !== null && d.eps_adjusted !== undefined 
              ? d.eps_adjusted 
              : (d.earnings || 0);
            return sum + epsValue;
          }, 0);
          
          // If we have less than 4 quarters, annualize
          let annualEps: number;
          if (trailing4Quarters.length < 4) {
            annualEps = (trailingEps / trailing4Quarters.length) * 4;
          } else {
            annualEps = trailingEps;
          }
          
          // Use normal PE ratio from props
          fairValueEpsAdjusted = annualEps * normalPERatio;
        }
      }
      
      return {
        ...item,
        fairValueEpsAdjusted: fairValueEpsAdjusted !== null ? fairValueEpsAdjusted : item.fairValueEpsAdjusted,
        calculatedNormalPE: item.hasQuarterlyData ? normalPERatio : null, // Store normal PE for tooltip
        dividendScaled: item.dividend !== null && item.dividend !== undefined && item.peRatio !== null && item.peRatio !== undefined
          ? item.dividend * item.peRatio
          : null
      };
    });
  }, [filteredStockData, normalPERatio]);

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
    if (xAxisTicks.length === 0) return [];
    
    // If quarterly mode, filter by exact tick dates
    if (isQuarterlyMode) {
      const tickDatesSet = new Set(xAxisTicks);
      return filteredStockData.filter(item => 
        tickDatesSet.has(item.fullDate) && item.hasQuarterlyData
      );
    }
    
    // If yearly mode, extract fiscal years from ticks and get ALL quarterly data for those fiscal years
    const tickFiscalYears = new Set(
      xAxisTicks.map(dateStr => {
        const date = new Date(dateStr);
        return getFiscalYearAndQuarter(date, fiscalYearEndMonth).fiscalYear;
      })
    );
    
    // Get all quarterly data points for the fiscal years in ticks
    const quarterlyDataPoints = filteredStockData.filter(item => {
      if (!item.hasQuarterlyData) return false;
      const date = new Date(item.fullDate);
      const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
      return tickFiscalYears.has(fiscalInfo.fiscalYear);
    });
    
    // Aggregate data by fiscal year
    const yearlyData = new Map<number, {
      fullDate: string;
      fiscalYear: number;
      stockPrice: number | null;
      earnings: number[];
      eps_adjusted: number[];
      dividend: number[];
      quarterCount: number; // Track number of quarters for this fiscal year
    }>();
    
    quarterlyDataPoints.forEach(item => {
      const date = new Date(item.fullDate);
      const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
      const fiscalYear = fiscalInfo.fiscalYear;
      
      if (!yearlyData.has(fiscalYear)) {
        yearlyData.set(fiscalYear, {
          fullDate: item.fullDate, // Keep the last date of the fiscal year
          fiscalYear,
          stockPrice: null,
          earnings: [],
          eps_adjusted: [],
          dividend: [],
          quarterCount: 0
        });
      }
      
      const yearData = yearlyData.get(fiscalYear)!;
      
      // Use stock price from the last quarter of the fiscal year
      if (item.stockPrice !== null && item.stockPrice !== undefined) {
        // Update to the latest stock price in the fiscal year
        if (yearData.stockPrice === null || new Date(item.fullDate) > new Date(yearData.fullDate)) {
          yearData.stockPrice = item.stockPrice;
        }
      }
      
      if (item.earnings !== null && item.earnings !== undefined) {
        yearData.earnings.push(item.earnings);
        yearData.quarterCount++;
      }
      // Use eps_adjusted if available, otherwise fall back to earnings
      const epsAdjustedValue = item.eps_adjusted !== null && item.eps_adjusted !== undefined 
        ? item.eps_adjusted 
        : item.earnings;
      if (epsAdjustedValue !== null && epsAdjustedValue !== undefined) {
        // Only increment once per quarter (earnings already counted)
        if (item.earnings === null || item.earnings === undefined) {
          yearData.quarterCount++;
        }
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
    const sortedYearlyData = Array.from(yearlyData.values())
      .sort((a, b) => a.fiscalYear - b.fiscalYear);
    
    return sortedYearlyData.map((yearData, index) => {
      const isLastYear = index === sortedYearlyData.length - 1;
      const hasIncompleteYear = isLastYear && yearData.quarterCount < 4;
      
      // Calculate annual EPS
      let annualEps: number | null = null;
      if (yearData.eps_adjusted.length > 0) {
        const sumEps = yearData.eps_adjusted.reduce((sum, val) => sum + val, 0);
        // If incomplete year (less than 4 quarters), project full year by annualizing
        if (hasIncompleteYear && yearData.quarterCount > 0) {
          annualEps = (sumEps / yearData.quarterCount) * 4;
        } else {
          annualEps = sumEps;
        }
      }
      
      return {
        fullDate: yearData.fullDate,
        date: yearData.fiscalYear.toString(),
        stockPrice: yearData.stockPrice,
        estimated: hasIncompleteYear, // Mark as estimated if incomplete year
        year: yearData.fiscalYear,
        frequency: 'yearly',
        marketCap: null,
        volume: 0,
        fairValue: null,
        fairValueEpsAdjusted: null, // Quarterly metric, not applicable for yearly aggregation
        earnings: yearData.earnings.length > 0 
          ? (hasIncompleteYear && yearData.quarterCount > 0
              ? (yearData.earnings.reduce((sum, val) => sum + val, 0) / yearData.quarterCount) * 4
              : yearData.earnings.reduce((sum, val) => sum + val, 0))
          : null,
        eps_adjusted: annualEps,
        normalPE: null,
        dividendsPOR: null,
        hasQuarterlyData: true,
        peRatio: null, // Will be calculated in the table display
        revenue: null,
        dividend: yearData.dividend.length > 0 
          ? yearData.dividend.reduce((sum, val) => sum + val, 0) 
          : null
      };
    });
  }, [filteredStockData, xAxisTicks, isQuarterlyMode, fiscalYearEndMonth]);

  // Format date for table header (matches chart tick formatter)
  const formatTableDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (isQuarterlyMode) {
      const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
      return `${fiscalInfo.fiscalYear}Q${fiscalInfo.fiscalQuarter}`;
    } else {
      const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
      return fiscalInfo.fiscalYear.toString();
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
            // For fairValueEpsAdjusted, show the PE value instead of dollar value
            if (entry.dataKey === 'fairValueEpsAdjusted' && entry.payload) {
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

  // Custom blue dot component for fair value EPS adjusted line
  const BlueQuarterlyDot = (props: any) => {
    const { cx, cy, payload } = props;
    
    // Only show dot if this data point has quarterly data and fairValueEpsAdjusted
    if (!payload || !payload.hasQuarterlyData || payload.fairValueEpsAdjusted === null) {
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
            <ComposedChart data={chartDataWithScaledDividends} margin={{ bottom: 20 }}>
              <XAxis 
                dataKey="fullDate" 
                type="category"
                scale="point"
                tick={{ fontSize: 12 }}
                ticks={xAxisTicks}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  const fiscalInfo = getFiscalYearAndQuarter(date, fiscalYearEndMonth);
                  if (isQuarterlyMode) {
                    // Format as fiscal year and quarter (e.g., "2024Q1")
                    return `${fiscalInfo.fiscalYear}Q${fiscalInfo.fiscalQuarter}`;
                  } else {
                    // Format as fiscal year only (e.g., "2024")
                    return fiscalInfo.fiscalYear.toString();
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
              
              {/* Fair Value (EPS Adjusted × Normal PE) Line - blue */}
              {visibleSeries.fairValueEpsAdjusted && (
                <Line
                  type="linear"
                  dataKey="fairValueEpsAdjusted"
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
              { dataKey: 'fairValueEpsAdjusted', color: '#3b82f6', name: 'Normal PE' },
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
                  {tableData.map((item, index) => {
                    // Calculate actual P/E: price / annual EPS
                    let actualPE: number | null = null;
                    let isEstimated = item.estimated;
                    
                    if (item.stockPrice !== null && item.stockPrice !== undefined && item.stockPrice > 0) {
                      let annualEps: number | null = null;
                      
                      if (isQuarterlyMode) {
                        // For quarterly mode, use trailing 4 quarters EPS for P/E calculation
                        const currentDate = new Date(item.fullDate);
                        // Extract quarterly data from full stockData for trailing calculation
                        const allQuarterlyData: QuarterlyDataPoint[] = stockData
                          .filter(d => d.hasQuarterlyData)
                          .map(d => ({
                            date: d.fullDate,
                            eps_adjusted: d.eps_adjusted,
                            earnings: d.earnings,
                            stockPrice: d.stockPrice ?? null
                          }));
                        
                        const trailing4Quarters = getTrailing4QuartersEps(allQuarterlyData, currentDate);
                        
                        // If we have less than 4 quarters, this is estimated
                        if (trailing4Quarters.length < 4) {
                          isEstimated = true;
                        }
                        
                        if (trailing4Quarters.length > 0) {
                          const quarterlyEpsValues = trailing4Quarters.map(q => {
                            return q.eps_adjusted !== null && q.eps_adjusted !== undefined 
                              ? q.eps_adjusted 
                              : (q.earnings || 0);
                          });
                          annualEps = calculateAnnualEps(quarterlyEpsValues);
                        }
                      } else {
                        // For yearly mode, use the projected annual EPS (already calculated in tableData)
                        annualEps = item.eps_adjusted !== null && item.eps_adjusted !== undefined 
                          ? item.eps_adjusted 
                          : (item.earnings || null);
                      }
                      
                      if (annualEps !== null && annualEps > 0) {
                        actualPE = item.stockPrice / annualEps;
                      }
                    }
                    
                    return (
                      <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                        {actualPE !== null ? (
                          <span>
                            {actualPE.toFixed(1)}
                            {isEstimated && <span className="text-gray-500 text-xs ml-1">(proj.)</span>}
                          </span>
                        ) : '-'}
                      </td>
                    );
                  })}
                </tr>
                <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white">
                  <td className="py-3 px-1.5 font-bold text-gray-900 tracking-wide">EPS</td>
                  {tableData.map((item, index) => {
                    const isEstimated = item.estimated;
                    return (
                      <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                        {item.earnings !== null && item.earnings !== undefined ? (
                          <span>
                            ${item.earnings.toFixed(2)}
                            {isEstimated && <span className="text-gray-500 text-xs ml-1">(proj.)</span>}
                          </span>
                        ) : '-'}
                      </td>
                    );
                  })}
                </tr>
                <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white">
                  <td className="py-3 px-1.5 font-bold text-gray-900 tracking-wide">EPS Split Adjusted</td>
                  {tableData.map((item, index) => {
                    const isEstimated = item.estimated;
                    return (
                      <td key={item.fullDate} className={`text-left text-gray-700 ${index === tableData.length - 1 ? 'py-3 px-1.5' : 'py-3 px-3'}`}>
                        {item.eps_adjusted !== null && item.eps_adjusted !== undefined ? (
                          <span>
                            ${item.eps_adjusted.toFixed(2)}
                            {isEstimated && <span className="text-gray-500 text-xs ml-1">(proj.)</span>}
                          </span>
                        ) : '-'}
                      </td>
                    );
                  })}
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