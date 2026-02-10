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
  BarChart,
  Bar,
  Cell,
} from 'recharts';
import type { PortfolioPerformanceResponse, BenchmarkTicker } from '../types/api';
import {
  getForecastDatesDaily,
  projectCone,
  PORTFOLIO_CONE_PARAMS,
  BENCHMARK_CONE_PARAMS,
} from '../lib/portfolioForecast';
import { computePortfolioKpis, computeYearlyAndYtdReturns } from '../lib/portfolioKpis';

/** 2 years in days so forecast has daily resolution and cone lines render as one segment. */
const FORECAST_DAYS = 365 * 2;

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

/** Stress scenario parameters (configurable via gear panel). */
interface StressParams {
  marketDropPct: number;
  betaMultiplier: number;
}

const DEFAULT_STRESS_PARAMS: StressParams = {
  marketDropPct: 20,
  betaMultiplier: 1,
};

export default function PortfolioBenchmarkChart({ portfolioId }: PortfolioBenchmarkChartProps) {
  const [period, setPeriod] = useState('5y');
  const [benchmark, setBenchmark] = useState<Lowercase<BenchmarkTicker>>('spy');
  const [viewMode, setViewMode] = useState<ViewMode>('absolute');
  const [showForecast, setShowForecast] = useState(true);
  const [data, setData] = useState<PortfolioPerformanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stressPanelOpen, setStressPanelOpen] = useState(false);
  const [stressParams, setStressParams] = useState<StressParams>(DEFAULT_STRESS_PARAMS);

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
    const toTimestamp = (dateStr: string) => new Date(dateStr).getTime();

    if (viewMode === 'absolute') {
      const historical = data.dates.map((date, i) => ({
        date,
        timestamp: toTimestamp(date),
        portfolio: data.series.portfolio[i],
        benchmark: data.series.benchmark[i],
      }));
      if (!showForecast || data.dates.length === 0) return historical;

      const lastDate = data.dates[data.dates.length - 1];
      const p0 = data.series.portfolio[data.series.portfolio.length - 1];
      const b0 = data.series.benchmark[data.series.benchmark.length - 1];

      const forecastDates = getForecastDatesDaily(lastDate, FORECAST_DAYS);
      const portfolioCone = projectCone(p0, PORTFOLIO_CONE_PARAMS, FORECAST_DAYS, 365);
      const benchmarkCone = projectCone(b0, BENCHMARK_CONE_PARAMS, FORECAST_DAYS, 365);

      // Merge cone start into last historical point so cone attaches to vertical line with a single point (no duplicate timestamp = single segment)
      const lastWithConeStart = {
        ...historical[historical.length - 1],
        portfolioTop: p0,
        portfolioBottom: p0,
        benchmarkTop: b0,
        benchmarkBottom: b0,
      };
      const forecastRows = forecastDates.map((date, i) => ({
        date,
        timestamp: toTimestamp(date),
        portfolioTop: portfolioCone[i].top,
        portfolioBottom: portfolioCone[i].bottom,
        benchmarkTop: benchmarkCone[i].top,
        benchmarkBottom: benchmarkCone[i].bottom,
      }));
      return [...historical.slice(0, -1), lastWithConeStart, ...forecastRows];
    }
    return data.dates.map((date, i) => {
      const rel = data.series.portfolio[i] - data.series.benchmark[i];
      return {
        date,
        timestamp: toTimestamp(date),
        benchmark: 0,
        relative: rel,
        above: rel >= 0 ? rel : null,
        below: rel < 0 ? rel : null,
      };
    });
  }, [data, viewMode, showForecast]);

  /** X-axis ticks: timestamps for time-scaled axis, spread across range. */
  const xAxisTicks = useMemo(() => {
    if (chartData.length === 0) return undefined;
    const timestamps = chartData.map((d) => (d as { timestamp?: number }).timestamp).filter((t): t is number => typeof t === 'number');
    if (timestamps.length === 0) return undefined;
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    const count = 6;
    const ticks: number[] = [];
    for (let i = 0; i <= count; i++) {
      ticks.push(min + (i / count) * (max - min));
    }
    return ticks;
  }, [chartData]);

  /** Timestamp at end of history / start of forecast (for ReferenceLine). */
  const forecastStartTimestamp = useMemo(() => {
    if (!data || !showForecast || viewMode !== 'absolute' || data.dates.length === 0)
      return null;
    const lastDate = data.dates[data.dates.length - 1];
    return new Date(lastDate).getTime();
  }, [data, showForecast, viewMode]);

  const kpis = useMemo(() => {
    if (!data || data.dates.length < 2) return null;
    return computePortfolioKpis(data.dates, data.series.portfolio, data.series.benchmark);
  }, [data]);

  const yearlyAndYtd = useMemo(() => {
    if (!data || data.dates.length < 2) return null;
    return computeYearlyAndYtdReturns(data.dates, data.series.portfolio);
  }, [data]);

  const returnsBarData = useMemo(() => {
    if (!yearlyAndYtd) return [];
    const currentYear = new Date().getFullYear();
    const rows: { label: string; value: number }[] = yearlyAndYtd.yearly
      .filter(({ year }) => year !== currentYear)
      .map(({ year, returnPct }) => ({
        label: String(year),
        value: returnPct,
      }));
    if (yearlyAndYtd.ytdReturnPct !== null) {
      rows.push({ label: 'YTD', value: yearlyAndYtd.ytdReturnPct });
    }
    return rows;
  }, [yearlyAndYtd]);

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
          {viewMode === 'absolute' && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">2Y forecast:</span>
              <button
                type="button"
                onClick={() => setShowForecast((v) => !v)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  showForecast
                    ? 'bg-white text-gray-900 shadow-sm border border-gray-200'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                {showForecast ? 'On' : 'Off'}
              </button>
            </div>
          )}
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
              dataKey="timestamp"
              type="number"
              domain={['dataMin', 'dataMax']}
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
            {viewMode === 'absolute' && showForecast && forecastStartTimestamp != null && (
              <ReferenceLine
                x={forecastStartTimestamp}
                stroke="#9ca3af"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
            )}
            {viewMode === 'absolute' && showForecast && (
              <>
                <Line
                  type="monotone"
                  dataKey="portfolioTop"
                  name="Portfolio 2Y range (optimistic)"
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                  legendType="none"
                />
                <Line
                  type="monotone"
                  dataKey="portfolioBottom"
                  name="Portfolio 2Y range (max drawdown)"
                  stroke="#2563eb"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                  legendType="none"
                />
                <Line
                  type="monotone"
                  dataKey="benchmarkTop"
                  name={`${data?.benchmark ?? 'Benchmark'} 2Y range (optimistic)`}
                  stroke="#6b7280"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                  legendType="none"
                />
                <Line
                  type="monotone"
                  dataKey="benchmarkBottom"
                  name={`${data?.benchmark ?? 'Benchmark'} 2Y range (max drawdown)`}
                  stroke="#6b7280"
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                  connectNulls={false}
                  legendType="none"
                />
              </>
            )}
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
                const hasForecast =
                  p?.portfolioTop != null &&
                  p?.portfolioBottom != null &&
                  p?.benchmarkTop != null &&
                  p?.benchmarkBottom != null;
                return (
                  <div className="bg-white rounded-lg shadow-lg border border-gray-200 px-4 py-2">
                    <p className="text-sm font-medium text-gray-700 mb-2">{formatDate(label)}</p>
                    {hasForecast ? (
                      <div className="space-y-2">
                        <p className="text-sm font-medium text-gray-600">Portfolio (2Y range)</p>
                        <p className="text-sm text-blue-600">
                          Optimistic: {(p.portfolioTop as number).toFixed(1)}
                        </p>
                        <p className="text-sm text-blue-600">
                          Pessimistic: {(p.portfolioBottom as number).toFixed(1)}
                        </p>
                        <p className="text-sm font-medium text-gray-600 mt-1">
                          {data?.benchmark} (2Y range)
                        </p>
                        <p className="text-sm text-gray-600">
                          Optimistic: {(p.benchmarkTop as number).toFixed(1)}
                        </p>
                        <p className="text-sm text-gray-600">
                          Pessimistic: {(p.benchmarkBottom as number).toFixed(1)}
                        </p>
                      </div>
                    ) : (
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
                    )}
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

      {kpis && (
        <div className="mt-6 border-t border-gray-200 pt-4">
          <div className="grid grid-cols-6 gap-3">
            <div className="rounded-lg bg-gray-50 px-3 py-2 border border-gray-100 flex flex-col min-h-0">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Average return</p>
              <p className="text-lg font-semibold text-gray-900 mt-0.5">
                {kpis.averageReturn != null ? `${kpis.averageReturn.toFixed(1)}%` : '—'}
              </p>
              {returnsBarData.length >= 1 && (
                <div className="mt-1.5 flex-1 min-h-0" style={{ height: 44 }}>
                  <ResponsiveContainer width="100%" height={44}>
                    <BarChart data={returnsBarData} margin={{ top: 2, right: 2, left: 2, bottom: 2 }}>
                      <XAxis dataKey="label" hide />
                      <YAxis hide domain={['auto', 'auto']} />
                      <Tooltip
                        cursor={{ fill: 'rgba(0,0,0,0.06)' }}
                        contentStyle={{ fontSize: 11, padding: '4px 8px' }}
                        formatter={(value: number) => [`${value >= 0 ? '+' : ''}${value.toFixed(2)}%`, 'Return']}
                        labelFormatter={(label) => label}
                      />
                      <Bar dataKey="value" radius={[1, 1, 0, 0]} isAnimationActive={false}>
                        {returnsBarData.map((entry) => (
                          <Cell key={entry.label} fill={entry.value >= 0 ? '#16a34a' : '#dc2626'} />
                        ))}
                      </Bar>
                      <ReferenceLine y={0} stroke="#9ca3af" strokeWidth={1} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 border border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Beta</p>
              <p className="text-lg font-semibold text-gray-900 mt-0.5">
                {kpis.beta != null ? kpis.beta.toFixed(2) : '—'}
              </p>
              {kpis.beta != null && (
                <p className="text-xs text-gray-500 mt-1">
                  {kpis.beta < 0.8
                    ? 'Portfolio tends to move less than the market.'
                    : kpis.beta <= 1.2
                      ? 'Portfolio moves roughly in line with the market.'
                      : 'Portfolio is more volatile than the market.'}
                </p>
              )}
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 border border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Sharpe</p>
              <p className="text-lg font-semibold text-gray-900 mt-0.5">
                {kpis.sharpe != null ? kpis.sharpe.toFixed(2) : '—'}
              </p>
              {kpis.sharpe != null && (
                <p className="text-xs text-gray-500 mt-1">
                  {kpis.sharpe < 0
                    ? 'Return is below the risk-free rate for the volatility taken.'
                    : kpis.sharpe < 1
                      ? 'Modest risk-adjusted return.'
                      : kpis.sharpe < 2
                        ? 'Good risk-adjusted return per unit of risk.'
                        : 'Strong risk-adjusted return per unit of risk.'}
                </p>
              )}
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 border border-gray-100">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Max historical drawdown</p>
              <p className="text-lg font-semibold text-gray-900 mt-0.5">
                {kpis.maxDrawdown != null ? `${kpis.maxDrawdown.toFixed(1)}%` : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 border border-gray-100 flex flex-col">
              <div className="flex items-center justify-between gap-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Expected return</p>
                {data?.expectedReturn?.bandBreakdown && data.expectedReturn.bandBreakdown.length > 0 && (
                  <div className="group relative">
                    <span
                      className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-gray-300 text-gray-600 text-xs font-medium hover:bg-gray-400 cursor-help"
                      aria-label="Expected return breakdown"
                    >
                      i
                    </span>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-10 whitespace-nowrap">
                      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-left text-sm">
                        <p className="text-gray-600 mb-2">Based on band definitions</p>
                        <p className="font-medium text-gray-800 mb-2">
                          {data.expectedReturn.minPct !== 0 || data.expectedReturn.maxPct !== 0
                            ? `${data.expectedReturn.minPct.toFixed(1)}–${data.expectedReturn.maxPct.toFixed(1)}%`
                            : '—'}
                        </p>
                        <table className="text-gray-600">
                          <thead>
                            <tr>
                              <th className="text-left font-medium text-gray-500 pr-3">Band</th>
                              <th className="text-right font-medium text-gray-500 pr-3">Weight</th>
                              <th className="text-right font-medium text-gray-500">Return</th>
                            </tr>
                          </thead>
                          <tbody>
                            {data.expectedReturn.bandBreakdown.map((b) => (
                              <tr key={b.bandId}>
                                <td className="pr-3">{b.bandName}</td>
                                <td className="text-right pr-3">{b.weightPct.toFixed(0)}%</td>
                                <td className="text-right">
                                  {b.expectedReturnMinPct != null && b.expectedReturnMaxPct != null
                                    ? `${b.expectedReturnMinPct.toFixed(0)}–${b.expectedReturnMaxPct.toFixed(0)}%`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-lg font-semibold text-gray-900 mt-0.5">
                {data?.expectedReturn && (data.expectedReturn.minPct !== 0 || data.expectedReturn.maxPct !== 0)
                  ? `${data.expectedReturn.minPct.toFixed(1)}–${data.expectedReturn.maxPct.toFixed(1)}%`
                  : '—'}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 px-3 py-2 border border-gray-100 flex flex-col">
              <div className="flex items-center justify-between gap-1">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Stress drawdown</p>
                <button
                  type="button"
                  onClick={() => setStressPanelOpen((v) => !v)}
                  className="p-1 rounded text-gray-500 hover:text-gray-700 hover:bg-gray-200 transition-colors"
                  title="Configure stress parameters"
                  aria-label="Configure stress parameters"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </button>
              </div>
              <p className="text-lg font-semibold text-gray-900 mt-0.5">
                {kpis.stressDrawdown != null ? `${kpis.stressDrawdown.toFixed(1)}%` : '—'}
              </p>
            </div>
          </div>
          {stressPanelOpen && (
            <div className="mt-4 p-4 rounded-lg border border-gray-200 bg-gray-50">
              <h4 className="text-sm font-semibold text-gray-800 mb-3">Stress scenario parameters</h4>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Market drop %</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={stressParams.marketDropPct}
                    onChange={(e) =>
                      setStressParams((p) => ({ ...p, marketDropPct: Number(e.target.value) || 0 }))
                    }
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </label>
                <label className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Beta multiplier</span>
                  <input
                    type="number"
                    min={0.1}
                    max={3}
                    step={0.1}
                    value={stressParams.betaMultiplier}
                    onChange={(e) =>
                      setStressParams((p) => ({ ...p, betaMultiplier: Number(e.target.value) || 1 }))
                    }
                    className="w-20 px-2 py-1 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setStressParams(DEFAULT_STRESS_PARAMS)}
                  className="text-sm text-gray-600 hover:text-gray-900 underline"
                >
                  Reset to default
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
