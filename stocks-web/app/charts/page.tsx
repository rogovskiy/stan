'use client';

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

// Sample data for stock prices vs earnings
const stockData = [
  {
    date: '2023-Q1',
    stockPrice: 150.25,
    earnings: 2.45,
    volume: 1250000,
    month: 'Jan'
  },
  {
    date: '2023-Q2',
    stockPrice: 165.80,
    earnings: 2.78,
    volume: 1380000,
    month: 'Apr'
  },
  {
    date: '2023-Q3',
    stockPrice: 142.60,
    earnings: 2.12,
    volume: 1100000,
    month: 'Jul'
  },
  {
    date: '2023-Q4',
    stockPrice: 178.90,
    earnings: 3.25,
    volume: 1650000,
    month: 'Oct'
  },
  {
    date: '2024-Q1',
    stockPrice: 185.45,
    earnings: 3.42,
    volume: 1720000,
    month: 'Jan'
  },
  {
    date: '2024-Q2',
    stockPrice: 172.30,
    earnings: 3.15,
    volume: 1580000,
    month: 'Apr'
  },
  {
    date: '2024-Q3',
    stockPrice: 195.75,
    earnings: 3.89,
    volume: 1890000,
    month: 'Jul'
  },
  {
    date: '2024-Q4',
    stockPrice: 208.20,
    earnings: 4.12,
    volume: 2100000,
    month: 'Oct'
  }
];

// Data for scatter plot showing price vs earnings correlation
const priceEarningsData = stockData.map(item => ({
  earnings: item.earnings,
  stockPrice: item.stockPrice,
  date: item.date,
  volume: item.volume
}));

export default function ChartsPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-bold text-gray-900 mb-8 text-center">
          Stock Price vs Earnings Analysis
        </h1>
        
        {/* Line Chart - Stock Price and Earnings Over Time */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Stock Price and Earnings Trend
          </h2>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={stockData}>
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
              <Legend />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="stockPrice" 
                stroke="#2563eb" 
                strokeWidth={3}
                name="Stock Price ($)"
              />
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="earnings" 
                stroke="#dc2626" 
                strokeWidth={3}
                name="Earnings per Share ($)"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Scatter Plot - Price vs Earnings Correlation */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Price vs Earnings Correlation
          </h2>
          <ResponsiveContainer width="100%" height={400}>
            <ScatterChart>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                type="number" 
                dataKey="earnings" 
                name="Earnings per Share"
                label={{ value: 'Earnings per Share ($)', position: 'insideBottom', offset: -5 }}
              />
              <YAxis 
                type="number" 
                dataKey="stockPrice" 
                name="Stock Price"
                label={{ value: 'Stock Price ($)', angle: -90, position: 'insideLeft' }}
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

        {/* Combined Chart - Price, Earnings, and Volume */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-8">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Comprehensive Stock Analysis
          </h2>
          <ResponsiveContainer width="100%" height={500}>
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
              <Legend />
              <Bar 
                yAxisId="right" 
                dataKey="volume" 
                fill="#fbbf24" 
                opacity={0.6}
                name="Volume"
              />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="stockPrice" 
                stroke="#2563eb" 
                strokeWidth={3}
                name="Stock Price ($)"
              />
              <Line 
                yAxisId="left"
                type="monotone" 
                dataKey="earnings" 
                stroke="#dc2626" 
                strokeWidth={3}
                name="Earnings per Share ($)"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Area Chart - Stock Price Trend */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Stock Price Area Chart
          </h2>
          <ResponsiveContainer width="100%" height={400}>
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

        {/* Navigation back to home */}
        <div className="text-center mt-8">
          <a 
            href="/"
            className="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
}