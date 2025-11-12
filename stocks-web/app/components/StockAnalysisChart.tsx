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

interface StockAnalysisChartProps {
  stockData: any[];
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

const INTERVAL_OPTIONS: IntervalOption[] = [
  { value: 'max', label: 'MAX' },
  { value: '10y', label: '10Y', months: 120 },
  { value: '5y', label: '5Y', months: 60 },
  { value: '4y', label: '4Y', months: 48 },
  { value: '3y', label: '3Y', months: 36 },
  { value: '2y', label: '2Y', months: 24 },
  { value: '1y', label: '1Y', months: 12 }
];

export default function StockAnalysisChart({ stockData }: StockAnalysisChartProps) {
  // State to track visibility of data series
  const [visibleSeries, setVisibleSeries] = useState<VisibleSeries>({
    price: true,
    fairValue: true,
    dividendsPOR: true
  });

  // State for selected interval
  const [selectedInterval, setSelectedInterval] = useState<string>('max');

  // Filter data based on selected interval
  const filteredStockData = useMemo(() => {
    if (selectedInterval === 'max' || !stockData.length) {
      return stockData;
    }

    const selectedOption = INTERVAL_OPTIONS.find(opt => opt.value === selectedInterval);
    if (!selectedOption?.months) {
      return stockData;
    }

    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - selectedOption.months);

    return stockData.filter(item => {
      const itemDate = new Date(item.date);
      return itemDate >= cutoffDate;
    });
  }, [stockData, selectedInterval]);

  // Handle legend click to toggle series visibility
  const handleLegendClick = (dataKey: keyof VisibleSeries) => {
    setVisibleSeries(prev => ({
      ...prev,
      [dataKey]: !prev[dataKey]
    }));
  };

  // Handle interval change
  const handleIntervalChange = (interval: string) => {
    setSelectedInterval(interval);
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
          {payload.map((entry: any, index: number) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: ${typeof entry.value === 'number' ? entry.value.toFixed(2) : entry.value}
            </p>
          ))}
        </div>
      );
    }
    return null;
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

      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart data={filteredStockData} margin={{ bottom: 20 }}>
          <XAxis 
            dataKey="fullDate" 
            interval={Math.max(1, Math.floor(filteredStockData.length / 8))}
            tick={{ fontSize: 12 }}
            tickFormatter={(value, index) => {
              const dataPoint = filteredStockData[index];
              if (dataPoint?.fairValue !== null) {
                return dataPoint.fullDate;
              }
              return '';
            }}
          />
          <YAxis tick={{ fontSize: 12 }} />
          <Tooltip content={<CustomTooltip />} />
          {visibleSeries.fairValue && (
            <Area 
              type="monotone"
              dataKey="fairValue" 
              stroke="#f97316" 
              fill="#f97316"
              fillOpacity={0.15}
              strokeWidth={1}
              name="Fair Value (Quarterly)"
              connectNulls={true}
            />
          )}
          {visibleSeries.dividendsPOR && (
            <Line 
              type="linear"
              dataKey="dividend" 
              stroke="#fbbf24" 
              fill="#fbbf24"
              fillOpacity={0.1}
              strokeWidth={1}
              name="Dividend (Quarterly)"
              connectNulls={true}
              dot={false}
            />
          )}
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

      {/* Custom Legend for Area Chart */}
      <CustomLegend 
        legendItems={[
          { dataKey: 'price', color: '#000000', name: 'Stock Price ($)' },
          { dataKey: 'fairValue', color: '#f97316', name: 'Fair Value ($)' },
          { dataKey: 'dividendsPOR', color: '#fbbf24', name: 'Dividend ($)' }
        ]} 
      />
      
      {/* Detailed Data Table aligned with X-axis */}
      <div className="mt-6 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="text-left py-3 px-2 font-bold text-gray-900 w-20 text-sm uppercase tracking-wide">Metric</th>
              {filteredStockData.filter(item => item.fairValue !== null).map((item, index) => (
                <th key={item.date} className="text-center py-3 px-3 font-bold text-gray-900 text-sm tracking-tight" 
                    style={{ width: `${100 / filteredStockData.filter(item => item.fairValue !== null).length}%` }}>
                  {item.fullDate}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-sm">
            <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white transition-colors">
              <td className="py-3 px-2 font-bold text-gray-900 uppercase tracking-wide">P/E</td>
              {filteredStockData.filter(item => item.fairValue !== null).map((item) => (
                <td key={item.date} className="py-3 px-3 text-center text-gray-700 font-semibold">
                  {item.peRatio?.toFixed(1) || '0.0'}
                </td>
              ))}
            </tr>
            <tr className="border-b border-gray-100 hover:bg-gray-50 bg-gray-50">
              <td className="py-3 px-2 font-bold text-gray-900 uppercase tracking-wide">Fair Val</td>
              {filteredStockData.filter(item => item.fairValue !== null).map((item) => (
                <td key={item.date} className="py-3 px-3 text-center text-gray-700 font-semibold">
                  ${item.fairValue?.toFixed(0) || '0'}
                </td>
              ))}
            </tr>
            <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white">
              <td className="py-3 px-2 font-bold text-gray-900 uppercase tracking-wide">EPS</td>
              {filteredStockData.filter(item => item.fairValue !== null).map((item) => (
                <td key={item.date} className="py-3 px-3 text-center text-gray-700 font-semibold">
                  ${item.earnings?.toFixed(2) || '0.00'}
                </td>
              ))}
            </tr>
            <tr className="border-b border-gray-100 hover:bg-gray-50 bg-gray-50">
              <td className="py-3 px-2 font-bold text-gray-900 uppercase tracking-wide">Div</td>
              {filteredStockData.filter(item => item.fairValue !== null).map((item) => (
                <td key={item.date} className="py-3 px-3 text-center text-gray-700 font-semibold">
                  ${item.dividend?.toFixed(2) || '0.00'}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}