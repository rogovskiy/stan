'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
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

const VIEW_MODE_OPTIONS = [
  { value: 'absolute', label: 'Absolute' },
  { value: 'relative', label: 'Relative' },
] as const;
type ViewMode = (typeof VIEW_MODE_OPTIONS)[number]['value'];

function formatDate(label: string | number): string {
  const d = typeof label === 'number' ? new Date(label) : new Date(label);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Round step for relative Y-axis (e.g. 5 → -20, -15, -10, ..., 40). */
function getRelativeYAxisTicks(min: number, max: number, count = 6): number[] {
  const range = Math.max(max - min, 1);
  const step = Math.ceil(range / (count - 1) / 5) * 5 || 5;
  const floor = Math.floor(min / step) * step;
  const ceiling = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = floor; v <= ceiling; v += step) ticks.push(v);
  return ticks.length > 0 ? ticks : [min, 0, max];
}

export default function PortfolioBenchmarkChart({ portfolioId }: PortfolioBenchmarkChartProps) {
  const [period, setPeriod] = useState('5y');
  const [benchmark, setBenchmark] = useState<Lowercase<BenchmarkTicker>>('spy');
  const [viewMode, setViewMode] = useState<ViewMode>('absolute');
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

  const chartData = useMemo(() => {
    if (!data) return [];
    if (viewMode === 'absolute') {
      return data.dates.map((date, i) => ({
        date,
        portfolio: data.series.portfolio[i],
        benchmark: data.series.benchmark[i],
      }));
    }
    return data.dates.map((date, i) => {
      const rel = data.series.portfolio[i] - data.series.benchmark[i];
      return {
        date,
        benchmark: 0,
        relative: rel,
        above: rel >= 0 ? rel : null,
        below: rel < 0 ? rel : null,
      };
    });
  }, [data, viewMode]);

  /** X-axis ticks ~every 3 months (≈63 trading days) to avoid crowding. */
  const xAxisTicks = useMemo(() => {
    if (chartData.length === 0) return undefined;
    const step = 63; // ~3 months in trading days
    const ticks: string[] = [chartData[0].date];
    for (let i = step; i < chartData.length - 1; i += step) {
      ticks.push(chartData[i].date);
    }
    if (chartData.length > 1) ticks.push(chartData[chartData.length - 1].date);
    return ticks;
  }, [chartData]);

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
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">View:</span>
            <div className="flex rounded-lg bg-gray-100 p-0.5">
              {VIEW_MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setViewMode(opt.value)}
                  className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                    viewMode === opt.value
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
              ticks={xAxisTicks}
              tick={{ fontSize: 11 }}
              tickFormatter={(v) => {
                const d = new Date(v);
                return d.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
              }}
            />
            <YAxis
              tick={{ fontSize: 11 }}
              domain={
                viewMode === 'relative' && chartData.length > 0
                  ? (() => {
                      const relValues = chartData.map((d) => (d as { relative?: number }).relative ?? 0);
                      const min = Math.min(0, ...relValues);
                      const max = Math.max(0, ...relValues);
                      const pad = Math.max((max - min) * 0.1, 1);
                      return [min - pad, max + pad];
                    })()
                  : ['auto', 'auto']
              }
              ticks={
                viewMode === 'relative' && chartData.length > 0
                  ? (() => {
                      const relValues = chartData.map((d) => (d as { relative?: number }).relative ?? 0);
                      const min = Math.min(0, ...relValues);
                      const max = Math.max(0, ...relValues);
                      return getRelativeYAxisTicks(min, max);
                    })()
                  : undefined
              }
              tickFormatter={(v) =>
                viewMode === 'relative' ? (v >= 0 ? `+${Math.round(v)}%` : `${Math.round(v)}%`) : `${Math.round(v)}`
              }
            />
            {viewMode === 'relative' && <ReferenceLine y={0} stroke="#9ca3af" strokeDasharray="3 3" />}
            <Tooltip
              labelFormatter={(label) => formatDate(label)}
              formatter={(value: number) => [`${value.toFixed(1)}`, '']}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length || !label) return null;
                const p = payload[0]?.payload as Record<string, unknown>;
                if (viewMode === 'relative') {
                  const rel = (p?.relative as number) ?? 0;
                  const relStr = rel >= 0 ? `+${rel.toFixed(1)}%` : `${rel.toFixed(1)}%`;
                  return (
                    <div className="bg-white rounded-lg shadow-lg border border-gray-200 px-4 py-2">
                      <p className="text-sm font-medium text-gray-700 mb-2">{formatDate(label)}</p>
                      <p className={`text-sm ${rel >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                        <span className="font-medium">Portfolio:</span> {relStr}
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="bg-white rounded-lg shadow-lg border border-gray-200 px-4 py-2">
                    <p className="text-sm font-medium text-gray-700 mb-2">{formatDate(label)}</p>
                    <div className="space-y-1">
                      <p className="text-sm">
                        <span className="text-blue-600 font-medium">Portfolio:</span>{' '}
                        {(p?.portfolio as number ?? 0).toFixed(1)}
                      </p>
                      <p className="text-sm">
                        <span className="text-gray-600 font-medium">{data?.benchmark}:</span>{' '}
                        {(p?.benchmark as number ?? 0).toFixed(1)}
                      </p>
                    </div>
                  </div>
                );
              }}
            />
            <Legend />
            {viewMode === 'absolute' ? (
              <>
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
              </>
            ) : (
              <>
                <Line
                  type="monotone"
                  dataKey="benchmark"
                  name={data?.benchmark ?? 'Benchmark'}
                  stroke="#6b7280"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="above"
                  name="Portfolio (above)"
                  stroke="#16a34a"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="below"
                  name="Portfolio (below)"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                />
              </>
            )}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
