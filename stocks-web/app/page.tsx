'use client';

import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  ComposedChart,
  Bar,
  Area,
  AreaChart
} from 'recharts';

// Sample data for stock prices vs earnings with additional detailed fields
const stockData = [
  {
    date: '2023-Q1',
    stockPrice: 150.25,
    earnings: 2.45,
    volume: 1250000,
    month: 'Jan',
    peRatio: 61.3,
    marketCap: 18.8,
    revenue: 12.5,
    dividend: 0.85,
    analyst: 'Buy'
  },
  {
    date: '2023-Q2',
    stockPrice: 165.80,
    earnings: 2.78,
    volume: 1380000,
    month: 'Apr',
    peRatio: 59.6,
    marketCap: 20.7,
    revenue: 14.2,
    dividend: 0.88,
    analyst: 'Buy'
  },
  {
    date: '2023-Q3',
    stockPrice: 142.60,
    earnings: 2.12,
    volume: 1100000,
    month: 'Jul',
    peRatio: 67.3,
    marketCap: 17.8,
    revenue: 11.8,
    dividend: 0.82,
    analyst: 'Hold'
  },
  {
    date: '2023-Q4',
    stockPrice: 178.90,
    earnings: 3.25,
    volume: 1650000,
    month: 'Oct',
    peRatio: 55.0,
    marketCap: 22.3,
    revenue: 16.7,
    dividend: 0.92,
    analyst: 'Buy'
  },
  {
    date: '2024-Q1',
    stockPrice: 185.45,
    earnings: 3.42,
    volume: 1720000,
    month: 'Jan',
    peRatio: 54.2,
    marketCap: 23.1,
    revenue: 17.8,
    dividend: 0.95,
    analyst: 'Buy'
  },
  {
    date: '2024-Q2',
    stockPrice: 172.30,
    earnings: 3.15,
    volume: 1580000,
    month: 'Apr',
    peRatio: 54.7,
    marketCap: 21.5,
    revenue: 16.2,
    dividend: 0.90,
    analyst: 'Hold'
  },
  {
    date: '2024-Q3',
    stockPrice: 195.75,
    earnings: 3.89,
    volume: 1890000,
    month: 'Jul',
    peRatio: 50.3,
    marketCap: 24.4,
    revenue: 19.5,
    dividend: 0.98,
    analyst: 'Strong Buy'
  },
  {
    date: '2024-Q4',
    stockPrice: 208.20,
    earnings: 4.12,
    volume: 2100000,
    month: 'Oct',
    peRatio: 50.5,
    marketCap: 26.0,
    revenue: 21.3,
    dividend: 1.02,
    analyst: 'Strong Buy'
  }
];

// Data for scatter plot showing price vs earnings correlation
const priceEarningsData = stockData.map(item => ({
  earnings: item.earnings,
  stockPrice: item.stockPrice,
  date: item.date,
  volume: item.volume
}));

export default function Home() {
  // State to track visibility of data series
  const [visibleSeries, setVisibleSeries] = useState({
    stockPrice: true,
    earnings: true,
    volume: true
  });

  // Handle legend click to toggle series visibility
  const handleLegendClick = (dataKey: string) => {
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
            visibleSeries[item.dataKey as keyof typeof visibleSeries] ? 'opacity-100' : 'opacity-50'
          }`}
          onClick={() => handleLegendClick(item.dataKey)}
        >
          <div
            className="w-4 h-0.5 rounded"
            style={{ backgroundColor: item.color }}
          />
          <span className={`text-sm ${
            visibleSeries[item.dataKey as keyof typeof visibleSeries] 
              ? 'text-gray-700 font-medium' 
              : 'text-gray-400 line-through'
          }`}>
            {item.name}
          </span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      {/* Top Navigation Bar */}
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="w-full max-w-none px-6 py-2.5">
          <div className="flex items-center justify-between">
            {/* Logo/Brand */}
            <div className="flex items-center gap-3">
              <div className="text-lg font-bold text-blue-600 tracking-tight">StockAnalysis</div>
            </div>
            
            {/* Search Bar */}
            <div className="flex-1 max-w-md mx-8">
              <div className="relative">
                <input
                  type="text"
                  placeholder="Search stocks, ETFs..."
                  className="w-full px-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-gray-400 bg-gray-50 focus:bg-white transition-colors"
                />
                <div className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
              </div>
            </div>

            {/* User Actions */}
            <div className="flex items-center gap-3">
              <button className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">
                Watchlist
              </button>
              <button className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-50 rounded-lg transition-colors">
                Portfolio
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stock Header Section */}
      <div className="bg-white border-b border-gray-200">
        <div className="w-full max-w-none px-6 py-4">
          {/* Single Row: Company Info, Quick Stats, and Price */}
          <div className="flex items-center justify-between mb-5">
            {/* Left: Company Info */}
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center shadow-md">
                <span className="text-white font-bold text-lg tracking-tight">AAPL</span>
              </div>
              <div>
                <div className="flex items-center gap-3 mb-1">
                  <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Apple Inc.</h1>
                  <select className="text-base text-gray-600 bg-transparent border-none focus:outline-none cursor-pointer font-medium">
                    <option>AAPL</option>
                    <option>MSFT</option>
                    <option>GOOGL</option>
                    <option>TSLA</option>
                    <option>AMZN</option>
                  </select>
                </div>
                <p className="text-gray-500 text-sm font-medium">NASDAQ: AAPL • USD</p>
              </div>
            </div>

            {/* Center: Quick Stats */}
            <div className="flex items-center gap-8">
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">Open</div>
                <div className="text-sm font-bold text-gray-900">$195.75</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">High</div>
                <div className="text-sm font-bold text-gray-900">$210.45</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">Low</div>
                <div className="text-sm font-bold text-gray-900">$194.20</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">Volume</div>
                <div className="text-sm font-bold text-gray-900">2.1M</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">Market Cap</div>
                <div className="text-sm font-bold text-gray-900">$26.0B</div>
              </div>
              <div className="text-center">
                <div className="text-xs text-gray-500 mb-1 font-semibold uppercase tracking-wide">P/E</div>
                <div className="text-sm font-bold text-gray-900">50.5</div>
              </div>
            </div>
            
            {/* Right: Price Info */}
            <div className="text-right">
              <div className="text-3xl font-bold text-gray-900 mb-1 tracking-tight">$208.20</div>
              <div className="flex items-center justify-end gap-2 mb-1">
                <span className="text-green-600 text-lg font-bold">+12.45</span>
                <span className="text-green-600 text-base font-semibold">(+6.35%)</span>
                <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-bold rounded-md">
                  ↗ Today
                </span>
              </div>
              <div className="text-xs text-gray-500 font-medium">
                Last updated: Nov 11, 2025 4:00 PM EST
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-8 border-b border-gray-200">
            <button className="pb-3 px-1 border-b-2 border-blue-600 text-blue-600 font-bold text-base">
              Summary
            </button>
            <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
              Chart
            </button>
            <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
              Statistics
            </button>
            <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
              Historical Data
            </button>
            <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
              Profile
            </button>
            <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
              Financials
            </button>
            <button className="pb-3 px-1 text-gray-600 hover:text-gray-900 font-semibold text-base transition-colors">
              Analysis
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="w-full max-w-none px-6 py-6">
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-8">
          {/* Main Chart Area - 3/4 width */}
          <div className="xl:col-span-3 space-y-8">
            {/* Line Chart - Stock Price and Earnings Over Time with Data Table */}
            <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 tracking-tight">
                Stock Price and Earnings Trend
              </h2>

              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={stockData} margin={{ bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip 
                    formatter={(value, name) => [
                      name === 'stockPrice' ? `$${value}` : `$${value}`,
                      name === 'stockPrice' ? 'Stock Price' : 'Earnings per Share'
                    ]}
                  />
                  {visibleSeries.stockPrice && (
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="stockPrice" 
                      stroke="#2563eb" 
                      strokeWidth={3}
                      name="Stock Price ($)"
                    />
                  )}
                  {visibleSeries.earnings && (
                    <Line 
                      yAxisId="right"
                      type="monotone" 
                      dataKey="earnings" 
                      stroke="#dc2626" 
                      strokeWidth={3}
                      name="Earnings per Share ($)"
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>

              {/* Custom Legend for Line Chart */}
              <CustomLegend 
                legendItems={[
                  { dataKey: 'stockPrice', color: '#2563eb', name: 'Stock Price ($)' },
                  { dataKey: 'earnings', color: '#dc2626', name: 'Earnings per Share ($)' }
                ]} 
              />
              
              {/* Detailed Data Table aligned with X-axis */}
              <div className="mt-6 overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b-2 border-gray-200">
                      <th className="text-left py-3 px-2 font-bold text-gray-900 w-20 text-sm uppercase tracking-wide">Metric</th>
                      {stockData.map((item, index) => (
                        <th key={item.date} className="text-center py-3 px-3 font-bold text-gray-900 text-sm tracking-tight" 
                            style={{ width: `${100 / stockData.length}%` }}>
                          {item.date}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="text-sm">
                    <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white transition-colors">
                      <td className="py-3 px-2 font-bold text-gray-900 uppercase tracking-wide">P/E</td>
                      {stockData.map((item) => (
                        <td key={item.date} className="py-3 px-3 text-center text-gray-700 font-semibold">
                          {item.peRatio}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-gray-100 hover:bg-gray-50 bg-gray-50">
                      <td className="py-3 px-2 font-bold text-gray-900 uppercase tracking-wide">Cap</td>
                      {stockData.map((item) => (
                        <td key={item.date} className="py-3 px-3 text-center text-gray-700 font-semibold">
                          ${item.marketCap}B
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white">
                      <td className="py-3 px-2 font-bold text-gray-900 uppercase tracking-wide">Rev</td>
                      {stockData.map((item) => (
                        <td key={item.date} className="py-3 px-3 text-center text-gray-700 font-semibold">
                          ${item.revenue}B
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-gray-100 hover:bg-gray-50 bg-gray-50">
                      <td className="py-3 px-2 font-bold text-gray-900 uppercase tracking-wide">Div</td>
                      {stockData.map((item) => (
                        <td key={item.date} className="py-3 px-3 text-center text-gray-700 font-semibold">
                          ${item.dividend}
                        </td>
                      ))}
                    </tr>
                    <tr className="border-b border-gray-100 hover:bg-gray-50 bg-white">
                      <td className="py-3 px-2 font-bold text-gray-900 uppercase tracking-wide">Rating</td>
                      {stockData.map((item) => (
                        <td key={item.date} className="py-3 px-3 text-center">
                          <span className={`px-1 py-0.5 rounded text-xs font-medium ${
                            item.analyst === 'Strong Buy' ? 'bg-green-100 text-green-800' :
                            item.analyst === 'Buy' ? 'bg-blue-100 text-blue-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {item.analyst === 'Strong Buy' ? 'S.Buy' : 
                             item.analyst === 'Buy' ? 'Buy' : 'Hold'}
                          </span>
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Combined Chart - Price, Earnings, and Volume */}
            <div className="bg-white rounded-2xl shadow-lg p-8 border border-gray-100">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 tracking-tight">
                Comprehensive Stock Analysis
              </h2>

              <ResponsiveContainer width="100%" height={400}>
                <ComposedChart data={stockData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis yAxisId="left" />
                  <YAxis yAxisId="right" orientation="right" />
                  <Tooltip 
                    formatter={(value, name) => {
                      if (name === 'volume') return [value.toLocaleString(), 'Volume'];
                      return [`$${value}`, name === 'stockPrice' ? 'Stock Price' : 'Earnings per Share'];
                    }}
                  />
                  {visibleSeries.volume && (
                    <Bar 
                      yAxisId="right" 
                      dataKey="volume" 
                      fill="#fbbf24" 
                      opacity={0.6}
                      name="Volume"
                    />
                  )}
                  {visibleSeries.stockPrice && (
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="stockPrice" 
                      stroke="#2563eb" 
                      strokeWidth={3}
                      name="Stock Price ($)"
                    />
                  )}
                  {visibleSeries.earnings && (
                    <Line 
                      yAxisId="left"
                      type="monotone" 
                      dataKey="earnings" 
                      stroke="#dc2626" 
                      strokeWidth={3}
                      name="Earnings per Share ($)"
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>

              {/* Custom Legend for Combined Chart */}
              <CustomLegend 
                legendItems={[
                  { dataKey: 'stockPrice', color: '#2563eb', name: 'Stock Price ($)' },
                  { dataKey: 'earnings', color: '#dc2626', name: 'Earnings per Share ($)' },
                  { dataKey: 'volume', color: '#fbbf24', name: 'Volume' }
                ]} 
              />
            </div>
          </div>

          {/* Right Sidebar - 1/4 width */}
          <div className="xl:col-span-1 space-y-6">
            {/* Statistics Card */}
            <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
              <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">Key Statistics</h3>
              <div className="space-y-5">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 font-semibold">52W High</span>
                  <span className="font-bold text-gray-900 text-lg">$215.50</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 font-semibold">52W Low</span>
                  <span className="font-bold text-gray-900 text-lg">$138.20</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 font-semibold">Volume</span>
                  <span className="font-bold text-gray-900 text-lg">2.1M</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 font-semibold">Avg Volume</span>
                  <span className="font-bold text-gray-900 text-lg">1.8M</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 font-semibold">Beta</span>
                  <span className="font-bold text-gray-900 text-lg">1.24</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 font-semibold">EPS</span>
                  <span className="font-bold text-gray-900 text-lg">4.12</span>
                </div>
              </div>
            </div>

            {/* Analyst Ratings Card */}
            <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
              <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">Analyst Ratings</h3>
              <div className="space-y-4">
                <div className="flex items-center gap-4">
                  <div className="w-4 h-4 bg-green-500 rounded-full"></div>
                  <span className="text-gray-700 font-semibold">Strong Buy</span>
                  <span className="ml-auto font-bold text-gray-900 text-lg">8</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-4 h-4 bg-blue-500 rounded-full"></div>
                  <span className="text-gray-700 font-semibold">Buy</span>
                  <span className="ml-auto font-bold text-gray-900 text-lg">12</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-4 h-4 bg-yellow-500 rounded-full"></div>
                  <span className="text-gray-700 font-semibold">Hold</span>
                  <span className="ml-auto font-bold text-gray-900 text-lg">5</span>
                </div>
                <div className="flex items-center gap-4">
                  <div className="w-4 h-4 bg-red-500 rounded-full"></div>
                  <span className="text-gray-700 font-semibold">Sell</span>
                  <span className="ml-auto font-bold text-gray-900 text-lg">1</span>
                </div>
              </div>
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600 font-semibold">Price Target</span>
                  <span className="font-bold text-gray-900 text-lg">$225.00</span>
                </div>
              </div>
            </div>

            {/* Additional Charts */}
            <div className="space-y-6">
              {/* Scatter Plot */}
              <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">
                  Price vs Earnings Correlation
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis 
                      type="number" 
                      dataKey="earnings" 
                      name="Earnings per Share"
                    />
                    <YAxis 
                      type="number" 
                      dataKey="stockPrice" 
                      name="Stock Price"
                    />
                    <Tooltip 
                      cursor={{ strokeDasharray: '3 3' }}
                      formatter={(value, name) => [
                        `$${value}`,
                        name === 'stockPrice' ? 'Stock Price' : 'Earnings per Share'
                      ]}
                    />
                    <Scatter 
                      data={priceEarningsData} 
                      fill="#8884d8" 
                      name="Price vs Earnings"
                    />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>

              {/* Area Chart */}
              <div className="bg-white rounded-2xl shadow-lg p-7 border border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 mb-6 tracking-tight">
                  Stock Price Area Chart
                </h3>
                <ResponsiveContainer width="100%" height={250}>
                  <AreaChart data={stockData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis />
                    <Tooltip 
                      formatter={(value) => [`$${value}`, 'Stock Price']}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="stockPrice" 
                      stroke="#2563eb" 
                      fill="#3b82f6"
                      fillOpacity={0.6}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
