'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { DailyDataPoint } from '../types/api';

interface MajorDevelopment {
  date: string;
  description: string;
  articleRef?: { url?: string; title?: string; source?: string; publishedAt?: string };
}

interface MarketShiftTimeline {
  canonicalDriver?: string;
  canonicalDriverRationale?: string;
  firstSurfacedAt: string;
  majorDevelopments: MajorDevelopment[];
}

interface MarketShift {
  id: string;
  type: string;
  category: string;
  headline: string;
  summary: string;
  primaryChannel?: string | null;
  secondaryChannels?: string[];
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

interface MarketShiftDrawerProps {
  shift: MarketShift;
  onClose: () => void;
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

const CHANNEL_TO_TICKER: Record<string, string> = {
  EQUITIES_US: 'SPY',
  CREDIT: 'HYG',
  VOL: '^VIX',
  RATES_SHORT: '^IRX',
  RATES_LONG: 'IEF',
  USD: 'UUP',
  OIL: 'USO',
  GOLD: 'GLD',
  INFLATION: 'TIP',
  GLOBAL_RISK: 'EEM',
};

const CHANNEL_LABELS: Record<string, string> = {
  EQUITIES_US: 'Equity market',
  CREDIT: 'Credit',
  VOL: 'Volatility',
  RATES_SHORT: 'Short rates',
  RATES_LONG: 'Long rates',
  USD: 'USD',
  OIL: 'Oil',
  GOLD: 'Gold',
  INFLATION: 'Inflation',
  GLOBAL_RISK: 'Global risk',
};

function MomentumBadge({ label }: { label: string }) {
  const cls = MOMENTUM_LABEL_STYLES[label] ?? 'bg-gray-100 text-gray-600';
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

function formatFriendlyDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function MarketShiftDrawer({ shift, onClose }: MarketShiftDrawerProps) {
  const hasTimeline = shift.timeline && (shift.timeline.canonicalDriver || shift.timeline.firstSurfacedAt || (shift.timeline.majorDevelopments?.length ?? 0) > 0);

  const primaryChannel = shift.primaryChannel ?? null;
  const chartTicker = primaryChannel ? CHANNEL_TO_TICKER[primaryChannel] : null;
  const [chartData, setChartData] = useState<DailyDataPoint[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  useEffect(() => {
    if (!chartTicker) {
      setChartData([]);
      setChartLoading(false);
      setChartError(null);
      return;
    }
    const ac = new AbortController();
    setChartLoading(true);
    setChartError(null);
    fetch(`/api/daily-prices/${encodeURIComponent(chartTicker)}?period=2y`, {
      signal: ac.signal,
      cache: 'no-store',
      headers: { Pragma: 'no-cache', 'Cache-Control': 'no-cache' },
    })
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) throw new Error('not_found');
          throw new Error(res.statusText || 'Failed to load chart');
        }
        return res.json();
      })
      .then((body: { data?: DailyDataPoint[] }) => {
        if (ac.signal.aborted) return;
        const data = body.data ?? [];
        setChartData(Array.isArray(data) ? data : []);
        setChartLoading(false);
        setChartError(null);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setChartData([]);
        setChartLoading(false);
        setChartError(err?.message === 'not_found' ? 'Chart not available for this channel.' : 'Failed to load chart.');
      });
    return () => ac.abort();
  }, [chartTicker]);

  const { chartDataFiltered, timelineLineDate } = useMemo(() => {
    const empty = { chartDataFiltered: [] as DailyDataPoint[], timelineLineDate: null as string | null };
    if (chartData.length === 0) return empty;
    const tl = shift.timeline;
    const firstSurfaced = tl?.firstSurfacedAt;
    const devDates = tl?.majorDevelopments?.map((d) => d.date).filter(Boolean) ?? [];
    const candidates = [firstSurfaced, ...devDates].filter((s): s is string => typeof s === 'string' && s.length > 0);
    if (candidates.length === 0) return { chartDataFiltered: chartData, timelineLineDate: null };
    const timelineStartStr = candidates.sort()[0];
    const timelineStart = new Date(timelineStartStr);
    if (Number.isNaN(timelineStart.getTime())) return { chartDataFiltered: chartData, timelineLineDate: null };
    const twoMonthsBefore = new Date(timelineStart);
    twoMonthsBefore.setMonth(twoMonthsBefore.getMonth() - 2);
    const startStr = twoMonthsBefore.toISOString().slice(0, 10);
    const filtered = chartData.filter((d) => d.date >= startStr);
    const lineDate = filtered.some((d) => d.date === timelineStartStr)
      ? timelineStartStr
      : filtered.find((d) => d.date >= timelineStartStr)?.date ?? null;
    return { chartDataFiltered: filtered, timelineLineDate: lineDate };
  }, [chartData, shift.timeline]);

  const priceDomain = useMemo(() => {
    if (chartDataFiltered.length === 0) return undefined;
    const prices = chartDataFiltered.map((d) => d.price).filter((p): p is number => typeof p === 'number');
    if (prices.length === 0) return undefined;
    const minP = Math.min(...prices);
    const maxP = Math.max(...prices);
    const range = maxP - minP || 1;
    const padding = Math.max(range * 0.05, range * 0.02 + 0.5);
    return [minP - padding, maxP + padding] as [number, number];
  }, [chartDataFiltered]);

  return (
    <>
      <div
        className="fixed inset-0 bg-black/20 z-40 transition-opacity duration-300"
        onClick={onClose}
      />
      <div className="fixed right-0 top-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 overflow-y-auto">
        <div className="p-6">
          <div className="flex items-start justify-between gap-4 mb-4 pb-4 border-b border-gray-200">
            <h2 className="text-xl font-bold text-gray-900">
              {shift.timeline?.canonicalDriver ?? shift.headline}
            </h2>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors shrink-0"
              aria-label="Close"
            >
              <svg className="w-6 h-6 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-4">
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
              <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                First detected {daysAgo(shift.firstSeenAt)}
              </span>
            )}
          </div>

          {shift.summary && (
            <div className="mb-6">
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                Summary
              </h4>
              <p className="text-gray-700 leading-relaxed">
                {shift.summary}
              </p>
            </div>
          )}

          {chartTicker && (
            <div className="mb-6">
              <p className="text-xs text-gray-500 mb-2">
                {CHANNEL_LABELS[primaryChannel!] ?? primaryChannel} — {chartTicker}
              </p>
              {chartLoading ? (
                <div className="flex items-center justify-center h-[220px] text-gray-500">
                  <span className="animate-pulse">Loading chart…</span>
                </div>
              ) : chartError ? (
                <div className="flex items-center justify-center h-[220px] rounded border border-gray-200 bg-gray-50 text-gray-500 text-sm">
                  {chartError}
                </div>
              ) : chartData.length === 0 ? (
                <div className="flex items-center justify-center h-[220px] rounded border border-gray-200 bg-gray-50 text-gray-500 text-sm">
                  Chart not available for this channel.
                </div>
              ) : (
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartDataFiltered} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => {
                          const d = new Date(v);
                          return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                        }}
                      />
                      <YAxis
                        domain={priceDomain ?? ['auto', 'auto']}
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => (typeof v === 'number' ? v.toFixed(0) : v)}
                      />
                      {timelineLineDate && (
                        <ReferenceLine x={timelineLineDate} stroke="#64748b" strokeDasharray="3 3" strokeWidth={1} />
                      )}
                      <Tooltip
                        formatter={(value: number) => [typeof value === 'number' ? value.toFixed(2) : value, 'Price']}
                        labelFormatter={(label) => formatFriendlyDate(label)}
                      />
                      <Line
                        type="monotone"
                        dataKey="price"
                        stroke="#2563eb"
                        strokeWidth={2}
                        dot={false}
                        name="Price"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          )}

          <div className="mb-6">
            <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-3">
              Timeline
            </h4>
            {hasTimeline ? (
              <div className="space-y-4">
                {shift.timeline!.canonicalDriver && (
                  <p className="text-sm text-gray-700">
                    <span className="font-medium text-gray-600">Canonical driver: </span>
                    {shift.timeline!.canonicalDriver}
                  </p>
                )}
                {shift.timeline!.canonicalDriverRationale && (
                  <p className="text-sm text-gray-600 italic">
                    {shift.timeline!.canonicalDriverRationale}
                  </p>
                )}
                {shift.timeline!.firstSurfacedAt && (
                  <p className="text-sm text-gray-600">
                    First surfaced: {formatFriendlyDate(shift.timeline!.firstSurfacedAt)}
                  </p>
                )}
                {shift.timeline!.majorDevelopments && shift.timeline!.majorDevelopments.length > 0 ? (
                  <ul className="space-y-3">
                    {shift.timeline!.majorDevelopments.map((d, i) => (
                      <li key={i} className="flex gap-3">
                        <span className="text-gray-500 text-sm shrink-0 w-24">{formatFriendlyDate(d.date)}</span>
                        <span className="text-gray-700 text-sm">
                          {d.description}
                          {d.articleRef?.url && (
                            <a
                              href={d.articleRef.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="ml-1.5 text-blue-600 hover:underline"
                            >
                              {d.articleRef.title || d.articleRef.source || 'Source'}
                            </a>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">
                Timeline not yet analyzed.
              </p>
            )}
          </div>

          {shift.articleRefs && shift.articleRefs.length > 0 && (
            <div>
              <h4 className="text-sm font-bold text-gray-700 uppercase tracking-wide mb-2">
                Sources
              </h4>
              <ul className="space-y-1.5 text-sm">
                {shift.articleRefs.map((ref, i) => (
                  <li key={i}>
                    {ref.url ? (
                      <a
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 hover:underline"
                      >
                        {ref.title || ref.source || 'Source'}
                      </a>
                    ) : (
                      <span className="text-gray-600">{ref.title || ref.source || 'Source'}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
