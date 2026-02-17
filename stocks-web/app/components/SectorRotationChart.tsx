'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  ZAxis,
  Cell,
} from 'recharts';

export interface SectorRotationData {
  dates: string[];
  series: Record<string, number[]>;
  labels: Record<string, string>;
  rsRatio?: Record<string, number[]>;
  rsMomentum?: Record<string, number[]>;
}

interface SectorRotationChartProps {
  data: SectorRotationData | null;
  loading?: boolean;
  error?: string | null;
}

type RRGPoint = { x: number; y: number; date: string; ticker: string };

const SECTOR_COLORS: Record<string, string> = {
  XLF: '#3b82f6',
  XLE: '#ef4444',
  XLK: '#22c55e',
  XLV: '#06b6d4',
  XLI: '#f59e0b',
  XLY: '#ec4899',
  XLP: '#6366f1',
  XLU: '#84cc16',
  XLB: '#f97316',
  XLC: '#8b5cf6',
};

const TRAIL_WEEKS = 10; // 10 weekly points per symbol for RRG trail

const RRG_RISK_ON_TICKERS = ['XLK', 'XLY', 'XLI', 'XLF', 'XLB'];
const RRG_RISK_OFF_TICKERS = ['XLP', 'XLU', 'XLV'];
const RRG_WX = 0.6;
const RRG_WY = 0.4;
const RRG_THRESHOLD = 1.5;

/** Week key for grouping (year-week). */
function getWeekKey(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00');
  return Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function SectorRotationChart({
  data,
  loading = false,
  error = null,
}: SectorRotationChartProps) {
  const [windowStart, setWindowStart] = useState(0);
  const [hiddenTickers, setHiddenTickers] = useState<Set<string>>(new Set());
  const hasRRGData =
    data?.rsRatio &&
    data?.rsMomentum &&
    Object.keys(data.rsRatio).length > 0;

  const weeklySeriesByTicker = useMemo(() => {
    if (!hasRRGData || !data?.dates?.length) return [];
    const sectorKeys = Object.keys(data.rsRatio!);
    const n = data.dates.length;
    return sectorKeys.map((ticker) => {
      // Build all daily points, then downsample to weekly (last trading day per week)
      const allPoints: { x: number; y: number; date: string; ticker: string; weekKey: number }[] = [];
      for (let i = 0; i < n; i++) {
        const x = data.rsRatio![ticker]?.[i];
        const y = data.rsMomentum![ticker]?.[i];
        if (x != null && y != null && isFinite(x) && isFinite(y)) {
          allPoints.push({
            x,
            y,
            date: data.dates[i],
            ticker,
            weekKey: getWeekKey(data.dates[i]),
          });
        }
      }
      // Group by week: keep last point (latest date) per week
      const byWeek = new Map<number, { x: number; y: number; date: string; ticker: string }>();
      for (const p of allPoints) {
        const existing = byWeek.get(p.weekKey);
        if (!existing || p.date > existing.date) {
          byWeek.set(p.weekKey, { x: p.x, y: p.y, date: p.date, ticker: p.ticker });
        }
      }
      const weeks = Array.from(byWeek.keys()).sort((a, b) => a - b);
      const points = weeks
        .map((wk) => byWeek.get(wk)!)
        .filter(Boolean)
        .sort((a, b) => a.date.localeCompare(b.date));
      return { ticker, points };
    });
  }, [data, hasRRGData]);

  const maxSeriesLength = useMemo(() => {
    if (!weeklySeriesByTicker.length) return 0;
    return Math.max(...weeklySeriesByTicker.map((s) => s.points.length));
  }, [weeklySeriesByTicker]);

  const maxStartIndex = Math.max(0, maxSeriesLength - TRAIL_WEEKS);

  useEffect(() => {
    // Default to most recent window whenever data shape changes.
    setWindowStart(maxStartIndex);
  }, [maxStartIndex]);

  const scatterData = useMemo(() => {
    return weeklySeriesByTicker.map(({ ticker, points }) => {
      const start = Math.min(windowStart, Math.max(0, points.length - TRAIL_WEEKS));
      const sliced = points.slice(start, start + TRAIL_WEEKS);
      return { ticker, points: sliced };
    });
  }, [weeklySeriesByTicker, windowStart]);

  const visibleScatterData = useMemo(
    () => scatterData.filter(({ ticker }) => !hiddenTickers.has(ticker)),
    [scatterData, hiddenTickers]
  );

  // Single flat array of all points. One Scatter = tooltip shows correct ticker when hovering.
  // (Recharts multi-Scatter passes all series and always shows payload[0] = first sector)
  const allPointsFlat = useMemo(() => {
    const flat: RRGPoint[] = [];
    for (const { ticker, points } of visibleScatterData) {
      for (const p of points) {
        flat.push({ ...p, ticker });
      }
    }
    return flat;
  }, [visibleScatterData]);

  const sliderRangeLabel = useMemo(() => {
    if (allPointsFlat.length === 0) return 'No data';
    const sortedDates = Array.from(new Set(allPointsFlat.map((p) => p.date))).sort();
    const startDate = sortedDates[0];
    const endDate = sortedDates[sortedDates.length - 1];
    if (!startDate || !endDate) return 'No data';
    return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  }, [allPointsFlat]);

  const domain = useMemo(() => {
    if (visibleScatterData.length === 0) return { x: [95, 105], y: [95, 105] };
    let xMin = Infinity,
      xMax = -Infinity,
      yMin = Infinity,
      yMax = -Infinity;
    for (const { points } of visibleScatterData) {
      for (const p of points) {
        if (p.x < xMin) xMin = p.x;
        if (p.x > xMax) xMax = p.x;
        if (p.y < yMin) yMin = p.y;
        if (p.y > yMax) yMax = p.y;
      }
    }
    if (!isFinite(xMin) || !isFinite(xMax) || !isFinite(yMin) || !isFinite(yMax)) {
      return { x: [95, 105], y: [95, 105] };
    }
    const padX = Math.max(2, (xMax - xMin) * 0.2);
    const padY = Math.max(2, (yMax - yMin) * 0.2);
    return {
      x: [Math.floor(xMin - padX), Math.ceil(xMax + padX)] as [number, number],
      y: [Math.floor(yMin - padY), Math.ceil(yMax + padY)] as [number, number],
    };
  }, [visibleScatterData]);

  const sectorKeys = useMemo(
    () => (data?.rsRatio ? Object.keys(data.rsRatio) : []),
    [data?.rsRatio]
  );

  // Risk score for the week at the end of the slider's visible window (same as triangle on chart).
  const rrgRisk = useMemo(() => {
    if (!hasRRGData || !data?.dates?.length) return null;
    const lastPossible = data.dates.length - 1;
    const riskWeekIndex = Math.min(windowStart + TRAIL_WEEKS - 1, lastPossible);
    const getScore = (ticker: string) => {
      const x = data.rsRatio![ticker]?.[riskWeekIndex];
      const y = data.rsMomentum![ticker]?.[riskWeekIndex];
      if (x == null || y == null || !isFinite(x) || !isFinite(y)) return null;
      const dx = x - 100;
      const dy = y - 100;
      return RRG_WX * dx + RRG_WY * dy;
    };
    const onScores = RRG_RISK_ON_TICKERS.map(getScore).filter((s): s is number => s != null);
    const offScores = RRG_RISK_OFF_TICKERS.map(getScore).filter((s): s is number => s != null);
    if (onScores.length === 0 || offScores.length === 0) return null;
    const riskOnIndex = onScores.reduce((a, b) => a + b, 0) / onScores.length;
    const riskOffIndex = offScores.reduce((a, b) => a + b, 0) / offScores.length;
    const signal = riskOnIndex - riskOffIndex;
    const regime =
      signal > RRG_THRESHOLD ? 'Risk-On' : signal < -RRG_THRESHOLD ? 'Risk-Off' : 'Neutral';
    return {
      signal,
      regime,
      asOf: data.dates[riskWeekIndex],
    };
  }, [data, hasRRGData, windowStart]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-80">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-50 p-4 text-red-700 text-sm">{error}</div>
    );
  }

  if (!data || sectorKeys.length === 0 || !hasRRGData) {
    return (
      <div className="flex items-center justify-center h-80 text-gray-500 text-sm">
        No sector rotation data. Bootstrap SPY and sector ETFs (XLF, XLE, XLK,
        XLV, XLI, XLY, XLP, XLU, XLB, XLC) to enable.
      </div>
    );
  }

  const CustomTooltip = ({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{
      name?: string;
      payload: { x: number; y: number; date: string; ticker: string };
    }>;
  }) => {
    if (!active || !payload?.length) return null;
    // Transparent Scatter (all points) is rendered last; its payload has the correct ticker for the hovered point
    const p = payload[payload.length - 1].payload;
    if (!p || p.x == null || p.y == null) return null;
    const label = data.labels[p.ticker] ?? p.ticker;
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-md text-sm">
        <div className="font-medium text-gray-900">{label}</div>
        <div className="text-gray-600">
          RS-Ratio: {p.x.toFixed(2)} · RS-Momentum: {p.y.toFixed(2)}
        </div>
        <div className="text-gray-500 text-xs">{formatDate(p.date)}</div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {rrgRisk && (
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-700">RRG Risk:</span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                rrgRisk.regime === 'Risk-On'
                  ? 'bg-emerald-500/20 text-emerald-600'
                  : rrgRisk.regime === 'Risk-Off'
                    ? 'bg-amber-500/20 text-amber-600'
                    : 'bg-gray-100 text-gray-600'
              }`}
            >
              {rrgRisk.regime}
            </span>
            <span className="text-gray-500 text-xs tabular-nums">{rrgRisk.signal.toFixed(2)}</span>
            <span className="text-gray-400 text-xs">
              (as of {typeof rrgRisk.asOf === 'string' ? rrgRisk.asOf.slice(0, 10) : String(rrgRisk.asOf).slice(0, 10)})
            </span>
          </div>
          <p className="text-gray-400 text-xs">
            Score = risk-on minus risk-off ({RRG_RISK_ON_TICKERS.map((t) => data.labels[t] ?? t).join(', ')} vs{' '}
            {RRG_RISK_OFF_TICKERS.map((t) => data.labels[t] ?? t).join(', ')}). Positive = tilt to risk-on, negative =
            risk-off. Regime: Risk-On if &gt; 1.5, Risk-Off if &lt; −1.5, else Neutral.
          </p>
        </div>
      )}
      <div className="rounded-lg border border-gray-200 bg-white px-3 py-2">
        <div className="text-xs font-medium text-gray-700 mb-2">Series (click to show/hide)</div>
        <div className="flex flex-wrap gap-2">
          {scatterData.map(({ ticker }) => {
            const hidden = hiddenTickers.has(ticker);
            return (
              <button
                key={ticker}
                type="button"
                onClick={() =>
                  setHiddenTickers((prev) => {
                    const next = new Set(prev);
                    if (next.has(ticker)) next.delete(ticker);
                    else next.add(ticker);
                    return next;
                  })
                }
                className={`inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs transition-colors ${
                  hidden
                    ? 'border-gray-300 bg-gray-100 text-gray-400'
                    : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                }`}
                aria-pressed={!hidden}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: SECTOR_COLORS[ticker] ?? '#64748b' }}
                />
                {data.labels[ticker] ?? ticker}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-700">
            Rotation window start week
          </span>
          <span className="text-xs text-gray-500">{sliderRangeLabel}</span>
        </div>
        <div className="text-[11px] text-gray-500 mb-2">
          Direction cue: faded/smaller points are older, brighter points are newer, white-ring point is latest.
        </div>
        <input
          type="range"
          min={0}
          max={maxStartIndex}
          step={1}
          value={Math.min(windowStart, maxStartIndex)}
          onChange={(e) => setWindowStart(Number(e.target.value))}
          className="w-full"
          aria-label="Rotation start week"
        />
      </div>

      <ResponsiveContainer width="100%" height={400}>
        <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
        {/* Quadrant backgrounds - RRG style with labels */}
        <ReferenceArea
          x1={domain.x[0]}
          x2={100}
          y1={100}
          y2={domain.y[1]}
          fill="#dbeafe"
          fillOpacity={0.5}
          label={{
            value: 'Improving',
            position: 'insideTopLeft',
            fontSize: 11,
            fill: '#1e40af',
          }}
        />
        <ReferenceArea
          x1={100}
          x2={domain.x[1]}
          y1={100}
          y2={domain.y[1]}
          fill="#dcfce7"
          fillOpacity={0.5}
          label={{
            value: 'Leading (outperforming with momentum)',
            position: 'insideTopRight',
            fontSize: 10,
            fill: '#15803d',
          }}
        />
        <ReferenceArea
          x1={100}
          x2={domain.x[1]}
          y1={domain.y[0]}
          y2={100}
          fill="#fef9c3"
          fillOpacity={0.5}
          label={{
            value: 'Weakening',
            position: 'insideBottomRight',
            fontSize: 11,
            fill: '#a16207',
          }}
        />
        <ReferenceArea
          x1={domain.x[0]}
          x2={100}
          y1={domain.y[0]}
          y2={100}
          fill="#fee2e2"
          fillOpacity={0.5}
          label={{
            value: 'Lagging (underperforming)',
            position: 'insideBottomLeft',
            fontSize: 10,
            fill: '#b91c1c',
          }}
        />

        <XAxis
          type="number"
          dataKey="x"
          name="RS-Ratio"
          domain={domain.x}
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => `${Math.round(v)}`}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="RS-Momentum"
          domain={domain.y}
          tick={{ fontSize: 11 }}
          tickFormatter={(v) => `${Math.round(v)}`}
        />
        <ZAxis range={[50, 400]} />
        <Tooltip
          content={<CustomTooltip />}
          cursor={{ strokeDasharray: '3 3' }}
          shared={false}
        />

        <ReferenceLine x={100} stroke="#64748b" strokeWidth={1} />
        <ReferenceLine y={100} stroke="#64748b" strokeWidth={1} />

        {visibleScatterData.map(({ ticker, points }) => {
          if (points.length === 0) return null;
          const color = SECTOR_COLORS[ticker] ?? '#64748b';
          return (
            <Scatter
              key={ticker}
              dataKey={ticker}
              name={data.labels[ticker] ?? ticker}
              data={points}
              fill={color}
              line={{ stroke: color, strokeWidth: 1.5 }}
              isAnimationActive={false}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              shape={(props: any) => {
                const cx = typeof props.cx === 'number' ? props.cx : null;
                const cy = typeof props.cy === 'number' ? props.cy : null;
                if (cx == null || cy == null) return null;
                const idx =
                  typeof props.index === 'number'
                    ? props.index
                    : points.findIndex((p) => p.date === props?.payload?.date);
                const safeIdx = idx >= 0 ? idx : 0;
                const total = Math.max(points.length, 1);
                const progress = (safeIdx + 1) / total;
                const isLatest = safeIdx === total - 1;
                const opacity = 0.2 + progress * 0.8;
                const r = isLatest ? 5 : 2.8 + progress * 0.8;
                if (isLatest) {
                  // Triangle pointing up for latest point (same visual weight as circle r=5)
                  const size = 5;
                  const points = [
                    [cx, cy - size].join(','),
                    [cx - size, cy + size].join(','),
                    [cx + size, cy + size].join(','),
                  ].join(' ');
                  return (
                    <polygon
                      points={points}
                      fill={color}
                      opacity={opacity}
                      stroke="#ffffff"
                      strokeWidth={1.8}
                    />
                  );
                }
                return (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={color}
                    opacity={opacity}
                    stroke="none"
                  />
                );
              }}
              label={{
                position: 'right',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                content: (props: any) => {
                  const x = typeof props.x === 'number' ? props.x : null;
                  const y = typeof props.y === 'number' ? props.y : null;
                  const payload = props.payload as { date?: string } | undefined;
                  const lastDate = points[points.length - 1]?.date;
                  if (
                    x == null ||
                    y == null ||
                    !payload?.date ||
                    payload.date !== lastDate
                  )
                    return null;
                  return (
                    <text
                      x={x + 6}
                      y={y}
                      dy={4}
                      fontSize={11}
                      fill={color}
                      fontWeight={600}
                    >
                      {ticker}
                    </text>
                  );
                },
              }}
            />
          );
        })}
        {/* Transparent Scatter with all points on top: captures hover and shows correct ticker in tooltip.
            Recharts multi-Scatter tooltip is broken (always shows first series). */}
        <Scatter
          key="_tooltip"
          dataKey="ticker"
          data={allPointsFlat}
          fill="transparent"
          line={false}
          isAnimationActive={false}
          legendType="none"
        >
          {allPointsFlat.map((entry, i) => (
            <Cell key={`${entry.ticker}-${entry.date}`} fill="transparent" stroke="none" />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
    </div>
  );
}
