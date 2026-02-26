'use client';

import { useState, useEffect, useMemo } from 'react';
import AppNavigation from '../components/AppNavigation';
import { MarketShiftDrawer } from '../components/MarketShiftDrawer';
import SectorRotationChart from '../components/SectorRotationChart';
import type { SectorRotationData } from '../components/SectorRotationChart';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

interface MacroScorePayload {
  asOf: string;
  macroMode: string;
  globalScore: number;
  confidence: number;
  transition: string;
  channelScores?: Record<string, number>;
  reasons?: string[];
}

interface MacroRiskScoresResponse {
  latest: MacroScorePayload | null;
  history: MacroScorePayload[];
}

interface MajorDevelopment {
  date: string;
  description: string;
  articleRef?: { url?: string; title?: string; source?: string; publishedAt?: string };
}

interface MarketShiftTimeline {
  firstSurfacedAt: string;
  majorDevelopments: MajorDevelopment[];
}

interface MarketShift {
  id: string;
  type: string;
  category: string;
  headline: string;
  summary: string;
  channelIds: string[];
  status: string;
  articleRefs: { url?: string; title?: string; source?: string; publishedAt?: string }[];
  asOf?: string;
  fetchedAt?: string;
  timeline?: MarketShiftTimeline;
  analyzedAt?: string;
}

interface MarketShiftsResponse {
  shifts: MarketShift[];
  meta: { asOf?: string; count?: number } | null;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function MacroPage() {
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [data, setData] = useState<MacroRiskScoresResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sectorRotationData, setSectorRotationData] =
    useState<SectorRotationData | null>(null);
  const [sectorRotationLoading, setSectorRotationLoading] = useState(true);
  const [sectorRotationError, setSectorRotationError] = useState<string | null>(null);

  const [marketShifts, setMarketShifts] = useState<MarketShift[] | null>(null);
  const [marketShiftsMeta, setMarketShiftsMeta] = useState<MarketShiftsResponse['meta']>(null);
  const [marketShiftsLoading, setMarketShiftsLoading] = useState(true);
  const [marketShiftsError, setMarketShiftsError] = useState<string | null>(null);
  const [selectedShift, setSelectedShift] = useState<MarketShift | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/macro/risk-scores');
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(json.error || 'Failed to load macro data');
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
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchSectorRotation() {
      setSectorRotationLoading(true);
      setSectorRotationError(null);
      try {
        const res = await fetch('/api/macro/sector-rotation?period=3y');
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setSectorRotationError(
            json.error || 'Failed to load sector rotation data'
          );
          setSectorRotationData(null);
          return;
        }
        setSectorRotationData(json);
      } catch (err) {
        if (!cancelled) {
          setSectorRotationError(
            err instanceof Error ? err.message : 'Failed to load sector rotation'
          );
          setSectorRotationData(null);
        }
      } finally {
        if (!cancelled) setSectorRotationLoading(false);
      }
    }
    fetchSectorRotation();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchMarketShifts() {
      setMarketShiftsLoading(true);
      setMarketShiftsError(null);
      try {
        const res = await fetch('/api/macro/market-shifts');
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setMarketShiftsError(json.error || 'Failed to load market shifts');
          setMarketShifts(null);
          setMarketShiftsMeta(null);
          return;
        }
        setMarketShifts(json.shifts ?? null);
        setMarketShiftsMeta(json.meta ?? null);
      } catch (err) {
        if (!cancelled) {
          setMarketShiftsError(
            err instanceof Error ? err.message : 'Failed to load market shifts'
          );
          setMarketShifts(null);
          setMarketShiftsMeta(null);
        }
      } finally {
        if (!cancelled) setMarketShiftsLoading(false);
      }
    }
    fetchMarketShifts();
    return () => { cancelled = true; };
  }, []);

  const chartData = useMemo(() => {
    if (!data?.history?.length) return [];
    return data.history.map((h) => ({
      asOf: h.asOf,
      dateLabel: formatDate(h.asOf),
      globalScore: h.globalScore,
      macroMode: h.macroMode,
    }));
  }, [data?.history]);

  const modeColors: Record<string, string> = {
    RISK_ON: 'bg-green-100 text-green-800',
    RISK_OFF: 'bg-red-100 text-red-800',
    MIXED: 'bg-amber-100 text-amber-800',
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation selectedTicker={selectedTicker} onTickerChange={setSelectedTicker} />

      <div className="w-full max-w-none px-6 py-6">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">Macro</h1>
          <p className="text-sm text-gray-600 mt-2">
            US market risk-on / risk-off score across 10 channels: equities, credit, volatility, short &amp; long rates, USD, oil, gold, inflation, and global risk.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
          </div>
        ) : error ? (
          <div className="rounded-lg bg-red-50 p-4 text-red-700">{error}</div>
        ) : !data?.latest ? (
          <div className="rounded-lg bg-gray-100 p-6 text-gray-600">
            No macro data available. Run the macro score refresh to populate data.
          </div>
        ) : (
          <>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mb-8">
              <div className="rounded-lg bg-white border border-gray-200 p-6 shadow-sm">
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Risk-On Score
                </h2>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-bold text-gray-900">
                    {data.latest.globalScore >= 0 ? '+' : ''}
                    {data.latest.globalScore.toFixed(2)}
                  </span>
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                      modeColors[data.latest.macroMode] ?? 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {data.latest.macroMode.replace('_', ' ')}
                  </span>
                </div>
                <p className="text-sm text-gray-500 mt-2">As of {formatDate(data.latest.asOf)}</p>
              </div>

              <div className="rounded-lg bg-white border border-gray-200 p-6 shadow-sm">
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-1">
                  Transition
                </h2>
                <p className="text-lg font-medium text-gray-900">{data.latest.transition}</p>
                <p className="text-sm text-gray-500 mt-1">
                  Signal strength: {(data.latest.confidence * 100).toFixed(0)}%
                </p>
              </div>

              {data.latest.reasons && data.latest.reasons.length > 0 && (
                <div className="rounded-lg bg-white border border-gray-200 p-6 shadow-sm md:col-span-2 lg:col-span-1">
                  <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                    Top drivers
                  </h2>
                  <ul className="text-sm text-gray-700 space-y-1">
                    {data.latest.reasons.map((r, i) => (
                      <li key={i} className="flex gap-1">
                        <span className="text-gray-400">•</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="rounded-lg bg-white border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Score progression</h2>
              {chartData.length === 0 ? (
                <div className="flex items-center justify-center h-80 text-gray-500">
                  No history available. Run weekly backfill to populate the chart.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <XAxis
                      dataKey="asOf"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => {
                        const d = new Date(v);
                        return d.toLocaleDateString('en-US', { year: '2-digit', month: 'short' });
                      }}
                    />
                    <YAxis
                      domain={[-1.05, 1.05]}
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => (v >= 0 ? `+${v}` : `${v}`)}
                    />
                    <ReferenceLine y={0.25} stroke="#16a34a" strokeDasharray="3 3" strokeWidth={1} />
                    <ReferenceLine y={-0.25} stroke="#dc2626" strokeDasharray="3 3" strokeWidth={1} />
                    <Tooltip
                      formatter={(value: number) => [`${value >= 0 ? '+' : ''}${value.toFixed(3)}`, 'Score']}
                      labelFormatter={(label) => formatDate(label)}
                    />
                    <Line
                      type="monotone"
                      dataKey="globalScore"
                      stroke="#2563eb"
                      strokeWidth={2}
                      dot={false}
                      name="Risk-On Score"
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            <div className="mt-8 rounded-lg bg-white border border-gray-200 p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">
                Market shifts
              </h2>
              {marketShiftsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
                </div>
              ) : marketShiftsError ? (
                <div className="rounded-lg bg-red-50 p-4 text-red-700">
                  {marketShiftsError}
                </div>
              ) : !marketShifts?.length ? (
                <div className="rounded-lg bg-gray-100 p-6 text-gray-600">
                  No market shifts available. Run the market shift scanner to populate data.
                </div>
              ) : (
                <>
                  {marketShiftsMeta?.asOf != null && (
                    <p className="text-sm text-gray-500 mb-4">
                      As of {formatDate(marketShiftsMeta.asOf)}
                      {marketShiftsMeta.count != null && ` · ${marketShiftsMeta.count} shifts`}
                    </p>
                  )}
                  <div className="space-y-4">
                    {(['RISK', 'TAILWIND'] as const).map((type) => {
                      const ofType = marketShifts.filter((s) => s.type === type);
                      if (ofType.length === 0) return null;
                      return (
                        <div key={type}>
                          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
                            {type === 'RISK' ? 'Risks' : 'Tailwinds'}
                          </h3>
                          <ul className="space-y-3">
                            {ofType.map((shift) => (
                              <li key={shift.id}>
                                <button
                                  type="button"
                                  onClick={() => setSelectedShift(shift)}
                                  className="w-full text-left rounded-lg border border-gray-200 p-4 bg-gray-50/50 hover:bg-gray-100/80 cursor-pointer transition-colors"
                                >
                                  <p className="font-medium text-gray-900">
                                    {shift.headline}
                                  </p>
                                  {shift.summary && (
                                    <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                                      {shift.summary}
                                    </p>
                                  )}
                                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                    <span
                                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                                        shift.type === 'TAILWIND'
                                          ? 'bg-green-100 text-green-800'
                                          : 'bg-red-100 text-red-800'
                                      }`}
                                    >
                                      {shift.type}
                                    </span>
                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-200 text-gray-700">
                                      {shift.category.replace(/_/g, ' ')}
                                    </span>
                                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                      {shift.status}
                                    </span>
                                    <span className="text-xs text-gray-500 ml-auto">
                                      View timeline →
                                    </span>
                                  </div>
                                </button>
                              </li>
                            ))}
                          </ul>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>

            {selectedShift && (
              <MarketShiftDrawer
                shift={selectedShift}
                onClose={() => setSelectedShift(null)}
              />
            )}
          </>
        )}

        <div className="mt-8 rounded-lg bg-white border border-gray-200 p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Sector rotation (vs SPY)
          </h2>
          <SectorRotationChart
            data={sectorRotationData}
            loading={sectorRotationLoading}
            error={sectorRotationError}
          />
        </div>
      </div>
    </div>
  );
}
