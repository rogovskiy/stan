import { NextRequest, NextResponse } from 'next/server';
import { getDailyPricesForTicker, getStartDateFromPeriod } from '@/app/lib/dailyPrices';

const SECTOR_ETFS = [
  { ticker: 'XLF', label: 'Financials' },
  { ticker: 'XLE', label: 'Energy' },
  { ticker: 'XLK', label: 'Technology' },
  { ticker: 'XLV', label: 'Healthcare' },
  { ticker: 'XLI', label: 'Industrials' },
  { ticker: 'XLY', label: 'Consumer Discretionary' },
  { ticker: 'XLP', label: 'Consumer Staples' },
  { ticker: 'XLU', label: 'Utilities' },
  { ticker: 'XLB', label: 'Materials' },
  { ticker: 'XLC', label: 'Communications' },
] as const;

const BENCHMARK = 'SPY';

function buildPriceMap(points: { date: string; price: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of points) {
    map.set(p.date, p.price);
  }
  return map;
}

/** Get price from map for dateStr; if missing, use latest date on or before dateStr. */
function getPriceAtDate(dateStr: string, map: Map<string, number>): number {
  const price = map.get(dateStr);
  if (price !== undefined) return price;
  const sortedDates = Array.from(map.keys()).sort();
  const onOrBefore = sortedDates.filter((d) => d <= dateStr);
  const useDate = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : sortedDates[0];
  return useDate != null ? (map.get(useDate) ?? 0) : 0;
}

/** Stable week key (UTC week buckets). */
function getWeekKey(dateStr: string): number {
  const d = new Date(`${dateStr}T12:00:00Z`);
  return Math.floor(d.getTime() / (7 * 24 * 60 * 60 * 1000));
}

export interface SectorRotationResponse {
  dates: string[];
  series: Record<string, number[]>;
  labels: Record<string, string>;
  /** JdK RS-Ratio per sector (relative strength vs SPY, ~100 = benchmark). */
  rsRatio: Record<string, number[]>;
  /** JdK RS-Momentum per sector (rate of change of RS-Ratio, ~100 = neutral). */
  rsMomentum: Record<string, number[]>;
}

const RS_WINDOW = 14; // Base smoothing window (weekly periods)
const FINAL_SMOOTH_WINDOW = 3; // Short final smoothing to reduce jagged turns

function sma(arr: number[], window: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    if (i < window - 1) {
      out.push(arr[i]);
    } else {
      let sum = 0;
      for (let j = 0; j < window; j++) sum += arr[i - j];
      out.push(sum / window);
    }
  }
  return out;
}

/** Normalize a series by its own moving average around 100. */
function normalizeByOwnSma(arr: number[], window: number): number[] {
  const baseline = sma(arr, window);
  return arr.map((v, i) => {
    const b = baseline[i];
    if (!isFinite(v) || !isFinite(b) || b <= 0) return 100;
    return (100 * v) / b;
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '3y';

    const tickersToFetch = [BENCHMARK, ...SECTOR_ETFS.map((s) => s.ticker)];

    const priceResults = await Promise.all(
      tickersToFetch.map((t) => getDailyPricesForTicker(t, period))
    );

    const priceMaps = new Map<string, Map<string, number>>();
    tickersToFetch.forEach((t, i) => {
      priceMaps.set(t, buildPriceMap(priceResults[i]));
    });

    const spyMap = priceMaps.get(BENCHMARK);
    if (!spyMap || spyMap.size === 0) {
      return NextResponse.json(
        {
          error: `No price data found for benchmark ${BENCHMARK}. Bootstrap SPY and sector ETFs (XLF, XLE, XLK, etc.) to enable sector rotation.`,
        },
        { status: 404 }
      );
    }

    const periodStart = getStartDateFromPeriod(period);
    const dailyDates = Array.from(spyMap.keys())
      .filter((d) => new Date(d) >= periodStart)
      .sort();

    if (dailyDates.length === 0) {
      return NextResponse.json(
        {
          error: 'No price data available for the selected period.',
        },
        { status: 404 }
      );
    }

    // Build weekly dates from benchmark (last trading day of each week)
    const weekToDate = new Map<number, string>();
    for (const d of dailyDates) {
      const wk = getWeekKey(d);
      const existing = weekToDate.get(wk);
      if (!existing || d > existing) weekToDate.set(wk, d);
    }
    const dates = Array.from(weekToDate.values()).sort();

    if (dates.length === 0) {
      return NextResponse.json(
        {
          error: 'No weekly price data available for the selected period.',
        },
        { status: 404 }
      );
    }

    const spyPrices = dates.map((d) => getPriceAtDate(d, spyMap));
    const spyBase = spyPrices[0] > 0 ? spyPrices[0] : 1;

    const series: Record<string, number[]> = {};
    const labels: Record<string, string> = {};
    const rsRatioRaw: Record<string, number[]> = {};
    const rsMomentumRaw: Record<string, number[]> = {};

    for (const { ticker, label } of SECTOR_ETFS) {
      const sectorMap = priceMaps.get(ticker);
      if (!sectorMap || sectorMap.size === 0) continue;

      labels[ticker] = label;
      const sectorBase = getPriceAtDate(dates[0], sectorMap);
      if (sectorBase <= 0) continue;

      // 1) Relative Strength (RS): instrument / benchmark
      const rawRs = dates.map((dateStr, i) => {
        const sectorPrice = getPriceAtDate(dateStr, sectorMap);
        const spyPrice = spyPrices[i] > 0 ? spyPrices[i] : spyBase;
        if (sectorPrice <= 0 || spyPrice <= 0) return 1;
        return sectorPrice / spyPrice;
      });

      // 2) RS-Ratio ~ 100 * RS / MA(RS), then lightly smooth to reduce pointiness
      const rsRatioBase = normalizeByOwnSma(rawRs, RS_WINDOW);
      const rsRatio = sma(rsRatioBase, FINAL_SMOOTH_WINDOW);

      // 3) RS-Momentum ~ 100 * RS-Ratio / MA(RS-Ratio), then lightly smooth
      const rsMomentumBase = normalizeByOwnSma(rsRatio, RS_WINDOW);
      const rsMomentum = sma(rsMomentumBase, FINAL_SMOOTH_WINDOW);

      series[ticker] = dates.map((dateStr, i) => {
        const sectorPrice = getPriceAtDate(dateStr, sectorMap);
        const spyPrice = spyPrices[i] > 0 ? spyPrices[i] : spyBase;
        if (sectorPrice <= 0) return 100;
        return (100 * (sectorPrice / sectorBase)) / (spyPrice / spyBase);
      });
      rsRatioRaw[ticker] = rsRatio;
      rsMomentumRaw[ticker] = rsMomentum;
    }

    // RS-Ratio and RS-Momentum are both centered on 100 by construction.
    const response: SectorRotationResponse = {
      dates,
      series,
      labels,
      rsRatio: rsRatioRaw,
      rsMomentum: rsMomentumRaw,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Sector rotation API error:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to fetch sector rotation data',
      },
      { status: 500 }
    );
  }
}
