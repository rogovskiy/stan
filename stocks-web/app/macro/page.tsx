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
  articleRefs: { url?: string; title?: string; source?: string; publishedAt?: string }[];
  asOf?: string;
  fetchedAt?: string;
  timeline?: MarketShiftTimeline;
  analyzedAt?: string;
  momentumScore: number;
  momentumScorePrev: number;
  momentumLabel: string;
  firstSeenAt?: string;
}

interface MarketShiftsResponse {
  shifts: MarketShift[];
  meta: { asOf?: string; count?: number } | null;
}

interface SummaryDriver {
  headline: string;
  detail: string;
}

interface MarketSummary {
  mood: string;
  moodDetail: string;
  drivers: SummaryDriver[];
}

interface MarketSummariesResponse {
  asOf: string | null;
  fetchedAt: string | null;
  yesterdayToday: MarketSummary | null;
  lastWeek: MarketSummary | null;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function daysAgo(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

const MOMENTUM_LABEL_STYLES: Record<string, string> = {
  'Accelerating': 'bg-amber-100 text-amber-800',
  'Entrenched': 'bg-orange-100 text-orange-800',
  'Picking up steam': 'bg-blue-100 text-blue-800',
  'Fading — was strong': 'bg-gray-200 text-gray-500',
  'Fading': 'bg-gray-100 text-gray-500',
  'Just surfaced': 'bg-gray-100 text-gray-400',
};

function MomentumBadge({ label }: { label: string }) {
  const cls = MOMENTUM_LABEL_STYLES[label] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

const MOOD_STYLES: Record<string, { badge: string; border: string }> = {
  Confident: { badge: 'bg-green-100 text-green-800', border: 'border-green-300' },
  Optimistic: { badge: 'bg-emerald-100 text-emerald-800', border: 'border-emerald-300' },
  Calm: { badge: 'bg-sky-100 text-sky-800', border: 'border-sky-300' },
  Mixed: { badge: 'bg-gray-100 text-gray-700', border: 'border-gray-300' },
  Cautious: { badge: 'bg-amber-100 text-amber-800', border: 'border-amber-300' },
  Nervous: { badge: 'bg-orange-100 text-orange-800', border: 'border-orange-300' },
  Worried: { badge: 'bg-red-100 text-red-800', border: 'border-red-300' },
  Fearful: { badge: 'bg-red-200 text-red-900', border: 'border-red-400' },
};

const MODE_COLORS: Record<string, string> = {
  RISK_ON: 'bg-green-100 text-green-800',
  RISK_OFF: 'bg-red-100 text-red-800',
  MIXED: 'bg-amber-100 text-amber-800',
};

function SummaryCard({
  summaries,
  summaryTab,
  onTabChange,
  reasons,
  latest,
}: {
  summaries: MarketSummariesResponse | null;
  summaryTab: 'today' | 'week';
  onTabChange: (tab: 'today' | 'week') => void;
  reasons?: string[];
  latest?: MacroScorePayload | null;
}) {
  const active = summaryTab === 'today' ? summaries?.yesterdayToday : summaries?.lastWeek;

  if (!summaries?.yesterdayToday && !summaries?.lastWeek) {
    if (reasons && reasons.length > 0) {
      return (
        <div className="rounded-lg bg-white border border-gray-200 p-6 shadow-sm md:col-span-2 lg:col-span-1">
          {latest && (
            <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-gray-100">
              <div className="flex items-baseline gap-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Score</span>
                <span className="text-xl font-bold text-gray-900 tabular-nums">
                  {latest.globalScore >= 0 ? '+' : ''}{latest.globalScore.toFixed(2)}
                </span>
                <span className={`px-2 py-0.5 rounded text-xs font-semibold ${MODE_COLORS[latest.macroMode] ?? 'bg-gray-100 text-gray-800'}`}>
                  {latest.macroMode.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Transition</span>
                <span className="text-sm font-semibold text-gray-900">{latest.transition}</span>
                <span className="text-xs text-gray-500">({(latest.confidence * 100).toFixed(0)}%)</span>
              </div>
            </div>
          )}
          <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
            Top drivers
          </h2>
          <ul className="text-sm text-gray-700 space-y-1">
            {reasons.map((r, i) => (
              <li key={i} className="flex gap-1">
                <span className="text-gray-400">&bull;</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      );
    }
    return (
      <div className="rounded-lg bg-white border border-gray-200 p-6 shadow-sm md:col-span-2 lg:col-span-1">
        {latest && (
          <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-gray-100">
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Score</span>
              <span className="text-xl font-bold text-gray-900 tabular-nums">
                {latest.globalScore >= 0 ? '+' : ''}{latest.globalScore.toFixed(2)}
              </span>
              <span className={`px-2 py-0.5 rounded text-xs font-semibold ${MODE_COLORS[latest.macroMode] ?? 'bg-gray-100 text-gray-800'}`}>
                {latest.macroMode.replace('_', ' ')}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Transition</span>
              <span className="text-sm font-semibold text-gray-900">{latest.transition}</span>
              <span className="text-xs text-gray-500">({(latest.confidence * 100).toFixed(0)}%)</span>
            </div>
          </div>
        )}
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide mb-2">
          Market summary
        </h2>
        <p className="text-sm text-gray-400">
          No summary available yet. Run the market shift scanner to generate.
        </p>
      </div>
    );
  }

  const moodStyle = active?.mood
    ? MOOD_STYLES[active.mood] ?? { badge: 'bg-gray-100 text-gray-700', border: 'border-gray-300' }
    : { badge: 'bg-gray-100 text-gray-700', border: 'border-gray-300' };

  return (
    <div className="rounded-lg bg-white border border-gray-200 p-6 shadow-sm md:col-span-2 lg:col-span-1">
      {latest && (
        <div className="flex flex-wrap items-center gap-3 mb-4 pb-4 border-b border-gray-100">
          <div className="flex items-baseline gap-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Score</span>
            <span className="text-xl font-bold text-gray-900 tabular-nums">
              {latest.globalScore >= 0 ? '+' : ''}{latest.globalScore.toFixed(2)}
            </span>
            <span className={`px-2 py-0.5 rounded text-xs font-semibold ${MODE_COLORS[latest.macroMode] ?? 'bg-gray-100 text-gray-800'}`}>
              {latest.macroMode.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Transition</span>
            <span className="text-sm font-semibold text-gray-900">{latest.transition}</span>
            <span className="text-xs text-gray-500">({(latest.confidence * 100).toFixed(0)}%)</span>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wide">
          Market summary
        </h2>
        <div className="flex rounded-md border border-gray-200 text-xs">
          <button
            type="button"
            onClick={() => onTabChange('today')}
            className={`px-2.5 py-1 rounded-l-md font-medium transition-colors ${
              summaryTab === 'today'
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            Today
          </button>
          <button
            type="button"
            onClick={() => onTabChange('week')}
            className={`px-2.5 py-1 rounded-r-md font-medium transition-colors ${
              summaryTab === 'week'
                ? 'bg-gray-900 text-white'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            This week
          </button>
        </div>
      </div>

      {active ? (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${moodStyle.badge}`}>
              {active.mood}
            </span>
            <span className="text-sm text-gray-600">{active.moodDetail}</span>
          </div>

          {active.drivers.length > 0 && (
            <div className="space-y-2">
              {active.drivers.map((d, i) => (
                <div
                  key={i}
                  className={`border-l-2 ${moodStyle.border} pl-3 py-1`}
                >
                  <p className="text-sm font-medium text-gray-900">{d.headline}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{d.detail}</p>
                </div>
              ))}
            </div>
          )}

        </>
      ) : (
        <p className="text-sm text-gray-400">
          No summary for this period yet.
        </p>
      )}
    </div>
  );
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

  const [summaries, setSummaries] = useState<MarketSummariesResponse | null>(null);
  const [summaryTab, setSummaryTab] = useState<'today' | 'week'>('today');

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

  useEffect(() => {
    let cancelled = false;
    async function fetchSummaries() {
      try {
        const res = await fetch('/api/macro/market-summaries');
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (!cancelled) setSummaries(json);
      } catch {
        // non-critical — summaries card just won't render
      }
    }
    fetchSummaries();
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

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation selectedTicker={selectedTicker} onTickerChange={setSelectedTicker} />

      <div className="w-full max-w-none px-6 py-6">
        {!loading && !error && data?.latest && (
          <div className="mb-6">
            <h1 className="text-xl font-bold text-gray-900 tracking-tight">Macro</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Risk-on/off score · 10 channels: equities, credit, vol, rates, USD, oil, gold, inflation, global
            </p>
          </div>
        )}

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
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              <SummaryCard
                summaries={summaries}
                summaryTab={summaryTab}
                onTabChange={setSummaryTab}
                reasons={data.latest.reasons}
                latest={data.latest}
              />
              <div className="lg:col-span-2 rounded-lg bg-white border border-gray-200 p-6 shadow-sm">
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
                                    <MomentumBadge label={shift.momentumLabel} />
                                    {shift.firstSeenAt && (
                                      <span className="text-xs text-gray-400">
                                        First detected {daysAgo(shift.firstSeenAt)}
                                      </span>
                                    )}
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
