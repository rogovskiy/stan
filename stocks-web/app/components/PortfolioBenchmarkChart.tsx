'use client';

import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { PortfolioPerformanceResponse, BenchmarkTicker } from '../types/api';

interface PortfolioBenchmarkChartProps {
  portfolioId: string;
}

const PERIOD_OPTIONS = [
  { value: '1y', label: '1Y' },
  { value: '3y', label: '3Y' },
  { value: '5y', label: '5Y' },
];

const BENCHMARK_OPTIONS: { value: Lowercase<BenchmarkTicker>; label: string }[] = [
  { value: 'spy', label: 'SPY' },
  { value: 'qqq', label: 'QQQ' },
  { value: 'gld', label: 'GLD' },
];

function formatDate(label: string | number): string {
  const d = typeof label === 'number' ? new Date(label) : new Date(label);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function PortfolioBenchmarkChart({ portfolioId }: PortfolioBenchmarkChartProps) {
  const [period, setPeriod] = useState('5y');
  const [benchmark, setBenchmark] = useState<Lowercase<BenchmarkTicker>>('spy');
  const [data, setData] = useState<PortfolioPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/portfolios/${portfolioId}/performance?period=${period}&benchmark=${benchmark}`
        );
        const json = await res.json();

        if (cancelled) return;

        if (!res.ok) {
          setError(json.error || 'Failed to load performance data');
          setData(null);
          return;
        }

        setData(json);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load data');
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [portfolioId, period, benchmark]);

  const chartData =
    data?.dates.map((date, i) => ({
      date,
      portfolio: data.series.portfolio[i],
      benchmark: data.series.benchmark[i],
    })) ?? [];

  if (loading && !data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-center h-80 text-gray-500">
          Loading chart...
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-center justify-center h-80 text-red-600">
          <p>{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
        <h3 className="text-lg font-semibold text-gray-900">Portfolio vs Benchmark</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Period:</span>
            <div className="flex rounded-lg bg-gray-100 p-0.5">
              {PERIOD_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setPeriod(opt.value)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    period === opt.value
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">Benchmark:</span>
            <div className="flex rounded-lg bg-gray-100 p-0.5">
              {BENCHMARK_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setBenchmark(opt.value)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    benchmark === opt.value
                      ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {chartData.length === 0 ? (
        <div className="flex items-center justify-center h-80 text-gray-500">
          No data available for the selected period
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => {
                const d = new Date(v);
                return d.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
              }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={['auto', 'auto']}
              tickFormatter={(v) => `${Math.round(v)}`}
            />
            <Tooltip
              labelFormatter={(label) => formatDate(label)}
              formatter={(value: number) => [`${value.toFixed(1)}`, '']}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length || !label) return null;
                const p = payload[0]?.payload;
                return (
                  <div className="bg-white rounded-lg shadow-lg border border-gray-200 px-4 py-2">
                    <p className="text-sm font-medium text-gray-700 mb-2">
                      {formatDate(label)}
                    </p>
                    <div className="space-y-1">
                      <p className="text-sm">
                        <span className="text-blue-600 font-medium">Portfolio:</span>{' '}
                        {(p?.portfolio ?? 0).toFixed(1)}
                      </p>
                      <p className="text-sm">
                        <span className="text-gray-600 font-medium">{data?.benchmark}:</span>{' '}
                        {(p?.benchmark ?? 0).toFixed(1)}
                      </p>
                    </div>
                  </div>
                );
              }}
            />
            <Legend />
            <Line
              type="monotone"
              dataKey="portfolio"
              name="Portfolio"
              stroke="#2563eb"
              strokeWidth={2}
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="benchmark"
              name={data?.benchmark ?? 'Benchmark'}
              stroke="#6b7280"
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
