'use client';

import { useState, useEffect, useMemo } from 'react';
import AppNavigation from '../components/AppNavigation';
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
            US market risk-on / risk-off score based on equities, credit, volatility, USD, and oil.
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
