import { NextRequest, NextResponse } from 'next/server';
import { getPortfolio } from '../../../../lib/services/portfolioService';
import { getDailyPricesForTicker, getStartDateFromPeriod } from '../../../../lib/dailyPrices';
import type { Position } from '../../../../lib/services/portfolioService';

const VALID_BENCHMARKS = ['SPY', 'QQQ', 'GLD'] as const;
type BenchmarkTicker = (typeof VALID_BENCHMARKS)[number];

function normalizeTo100(values: number[]): number[] {
  if (values.length === 0) return values;
  const firstNonZero = values.find((v) => v > 0);
  const base = firstNonZero ?? 1;
  const baseIdx = firstNonZero !== undefined ? values.indexOf(firstNonZero) : 0;
  return values.map((v, i) => {
    if (i < baseIdx || base === 0) return 100;
    return (v / base) * 100;
  });
}

function buildPriceMap(points: { date: string; price: number }[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of points) {
    map.set(p.date, p.price);
  }
  return map;
}

/**
 * Get portfolio value for a date. Uses forward-fill for missing prices
 * (previous known price) and only includes positions held at that date.
 */
function getPortfolioValueAtDate(
  dateStr: string,
  positions: Position[],
  priceMaps: Map<string, Map<string, number>>,
  periodStart: Date
): number {
  const date = new Date(dateStr);
  let total = 0;

  for (const pos of positions) {
    const posStart = pos.purchaseDate ? new Date(pos.purchaseDate) : periodStart;
    if (date < posStart) continue;

    const map = priceMaps.get(pos.ticker.toUpperCase());
    if (!map) continue;

    // Use exact date or find nearest earlier date (forward-fill)
    let price = map.get(dateStr);
    if (price === undefined) {
      const sortedDates = Array.from(map.keys()).sort();
      const idx = sortedDates.findIndex((d) => d >= dateStr);
      if (idx > 0) {
        price = map.get(sortedDates[idx - 1]) ?? 0;
      } else if (idx === 0) {
        price = map.get(sortedDates[0]) ?? 0;
      } else {
        price = map.get(sortedDates[sortedDates.length - 1]) ?? 0;
      }
    }
    if (price > 0) {
      total += pos.quantity * price;
    }
  }
  return total;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '5y';
    const benchmarkParam = searchParams.get('benchmark')?.toUpperCase();

    if (!portfolioId) {
      return NextResponse.json({ error: 'Portfolio ID is required' }, { status: 400 });
    }

    if (!benchmarkParam || !VALID_BENCHMARKS.includes(benchmarkParam as BenchmarkTicker)) {
      return NextResponse.json(
        { error: 'Valid benchmark required (spy, qqq, or gld)' },
        { status: 400 }
      );
    }

    const benchmark = benchmarkParam as BenchmarkTicker;

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
    }

    const positions = portfolio.positions || [];
    const periodStart = getStartDateFromPeriod(period);

    // Fetch prices for all position tickers and the benchmark in parallel
    const tickersToFetch = [
      ...new Set([...positions.map((p) => p.ticker.toUpperCase()), benchmark]),
    ];

    const priceResults = await Promise.all(
      tickersToFetch.map((t) => getDailyPricesForTicker(t, period))
    );

    const priceMaps = new Map<string, Map<string, number>>();
    tickersToFetch.forEach((t, i) => {
      priceMaps.set(t, buildPriceMap(priceResults[i]));
    });

    const benchmarkMap = priceMaps.get(benchmark);
    if (!benchmarkMap || benchmarkMap.size === 0) {
      return NextResponse.json(
        { error: `No price data found for benchmark ${benchmark}. Ensure it is bootstrapped.` },
        { status: 404 }
      );
    }

    // Build union of all dates (from benchmark and any position)
    const dateSet = new Set<string>();
    for (const map of priceMaps.values()) {
      for (const d of map.keys()) {
        if (new Date(d) >= periodStart) dateSet.add(d);
      }
    }
    const dates = Array.from(dateSet).sort();

    if (dates.length === 0) {
      return NextResponse.json(
        { error: 'No price data available for the selected period' },
        { status: 404 }
      );
    }

    const portfolioValues = dates.map((d) =>
      getPortfolioValueAtDate(d, positions, priceMaps, periodStart)
    );
    const benchmarkValues = dates.map((d) => {
      let v = benchmarkMap.get(d);
      if (v === undefined) {
        const sorted = Array.from(benchmarkMap.keys()).sort();
        const idx = sorted.findIndex((x) => x >= d);
        if (idx > 0) v = benchmarkMap.get(sorted[idx - 1]);
        else if (idx === 0) v = benchmarkMap.get(sorted[0]);
        else v = benchmarkMap.get(sorted[sorted.length - 1]);
      }
      return v ?? 0;
    });

    // If portfolio has no positions or no value, use flat 100
    const hasPortfolioData = positions.length > 0 && portfolioValues.some((v) => v > 0);
    const normPortfolio = hasPortfolioData
      ? normalizeTo100(portfolioValues)
      : portfolioValues.map(() => 100);
    const normBenchmark = normalizeTo100(benchmarkValues);

    return NextResponse.json({
      dates,
      series: {
        portfolio: normPortfolio,
        benchmark: normBenchmark,
      },
      benchmark,
    });
  } catch (error) {
    console.error('Portfolio performance API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch portfolio performance',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
