import { NextRequest, NextResponse } from 'next/server';
import { getPortfolio, getTransactions, getSnapshotsUpToDate } from '../../../../lib/services/portfolioService';
import type { PortfolioSnapshot } from '../../../../lib/services/portfolioService';
import { getDailyPricesForTicker, getStartDateFromPeriod } from '../../../../lib/dailyPrices';
import { computeBandExpectedReturn } from '../../../../lib/portfolioKpis';

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

/** Get price from map for dateStr; if missing, use latest date on or before dateStr. */
function getPriceAtDate(
  dateStr: string,
  map: Map<string, number>
): number {
  const price = map.get(dateStr);
  if (price !== undefined) return price;
  const sortedDates = Array.from(map.keys()).sort();
  const onOrBefore = sortedDates.filter((d) => d <= dateStr);
  const useDate = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : sortedDates[0];
  return useDate != null ? (map.get(useDate) ?? 0) : 0;
}

/** Latest snapshot with snapshot.date <= dateStr from list sorted by date asc. */
function getSnapshotForDate(snapshotsAsc: PortfolioSnapshot[], dateStr: string): PortfolioSnapshot | null {
  for (let i = snapshotsAsc.length - 1; i >= 0; i--) {
    if (snapshotsAsc[i].date <= dateStr) return snapshotsAsc[i];
  }
  return null;
}

/** Portfolio value at valueDate using snapshot positions and cash, valued at valueDate prices. */
function valueFromSnapshot(
  snapshot: PortfolioSnapshot,
  valueDate: string,
  priceMaps: Map<string, Map<string, number>>
): number {
  let total = snapshot.cashBalance;
  for (const p of snapshot.positions) {
    if (p.quantity <= 0) continue;
    const map = priceMaps.get(p.ticker);
    if (!map) continue;
    const price = getPriceAtDate(valueDate, map);
    if (price > 0) total += p.quantity * price;
  }
  return total;
}

/** Position breakdown at dateStr from snapshot (price from priceMaps). */
function getBreakdownFromSnapshot(
  snapshot: PortfolioSnapshot | null,
  dateStr: string,
  priceMaps: Map<string, Map<string, number>>
): { ticker: string; quantity: number; price: number; value: number }[] {
  if (!snapshot) return [];
  const result: { ticker: string; quantity: number; price: number; value: number }[] = [];
  for (const p of snapshot.positions) {
    if (p.quantity <= 0) continue;
    const map = priceMaps.get(p.ticker);
    if (!map) continue;
    const price = getPriceAtDate(dateStr, map);
    if (price > 0) {
      result.push({ ticker: p.ticker, quantity: p.quantity, price, value: p.quantity * price });
    }
  }
  return result.sort((a, b) => a.ticker.localeCompare(b.ticker));
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
    const debug = searchParams.get('debug') === '1' || searchParams.get('debug') === 'true';

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

    const periodStart = getStartDateFromPeriod(period);
    const transactions = await getTransactions(portfolioId, null);

    const transactionTickers = [
      ...new Set(
        transactions.filter((t) => t.ticker != null).map((t) => t.ticker!.toUpperCase())
      ),
    ];
    const positions = portfolio.positions || [];
    const tickersToFetch = [
      ...new Set(
        transactionTickers.length > 0
          ? [...transactionTickers, benchmark]
          : [...positions.map((p) => p.ticker.toUpperCase()), benchmark]
      ),
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

    const dateMax = dates[dates.length - 1];
    const snapshotsAsc = await getSnapshotsUpToDate(portfolioId, dateMax);
    const portfolioValues = dates.map((d) => {
      const snap = getSnapshotForDate(snapshotsAsc, d);
      return snap ? valueFromSnapshot(snap, d, priceMaps) : 0;
    });
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

    const hasPortfolioData = portfolioValues.some((v) => v > 0);
    const dateMin = dates[0];

    // Time-weighted return: build growth index so deposits/withdrawals are not counted as returns
    let normPortfolio: number[];
    let debugPayload: Record<string, unknown> | undefined;
    if (!hasPortfolioData) {
      normPortfolio = portfolioValues.map(() => 100);
    } else {
      const cashFlowByDate: Record<string, number> = {};
      for (const tx of transactions) {
        if (tx.type !== 'cash') continue;
        if (tx.date >= dateMin && tx.date <= dateMax) {
          cashFlowByDate[tx.date] = (cashFlowByDate[tx.date] ?? 0) + tx.amount;
        }
      }
      const growthIndex = new Array<number>(dates.length);
      growthIndex[0] = 100;
      const steps: { date: string; V0: number; V1: number; C: number; r: number; index: number }[] = [];
      for (let i = 0; i < dates.length - 1; i++) {
        const V0 = portfolioValues[i];
        const V1 = portfolioValues[i + 1];
        const nextDate = dates[i + 1];
        const C = cashFlowByDate[nextDate] ?? 0;
        if (V0 <= 0) {
          growthIndex[i + 1] = growthIndex[i];
        } else {
          // End-of-period cash flow: deposit/withdrawal happens after the day's return.
          // On a deposit day, return = market move on existing positions only (don't count new buys as return).
          let r: number;
          if (C > 0) {
            const prevSnap = getSnapshotForDate(snapshotsAsc, dates[i]);
            const valueOldAtEnd = prevSnap ? valueFromSnapshot(prevSnap, nextDate, priceMaps) : 0;
            r = valueOldAtEnd > 0 ? valueOldAtEnd / V0 - 1 : 0;
          } else if (C < 0) {
            r = (V1 - C) / V0 - 1; // withdrawal at end of day
          } else {
            r = V1 / V0 - 1;
          }
          growthIndex[i + 1] = growthIndex[i] * (1 + r);
        }
        if (debug && (i < 3 || C !== 0 || i >= dates.length - 4)) {
          const Cval = cashFlowByDate[nextDate] ?? 0;
          const prevSnap = Cval > 0 ? getSnapshotForDate(snapshotsAsc, dates[i]) : null;
          const valueOldAtEnd = prevSnap ? valueFromSnapshot(prevSnap, nextDate, priceMaps) : 0;
          const rComputed =
            V0 <= 0
              ? 0
              : Cval > 0
                ? (valueOldAtEnd > 0 ? valueOldAtEnd / V0 - 1 : 0)
                : Cval < 0
                  ? (portfolioValues[i + 1] - Cval) / V0 - 1
                  : portfolioValues[i + 1] / V0 - 1;
          steps.push({
            date: dates[i + 1],
            V0: Math.round(V0 * 100) / 100,
            V1: Math.round(portfolioValues[i + 1] * 100) / 100,
            C,
            r: Math.round(rComputed * 10000) / 10000,
            index: Math.round(growthIndex[i + 1] * 100) / 100,
          });
        }
      }
      normPortfolio = growthIndex;

      if (debug) {
        // Cumulative net cash (deposits - withdrawals) up to each date, for narrative "under management"
        const cumulativeCashUpTo = (dateStr: string): number => {
          return transactions
            .filter((tx) => tx.type === 'cash' && tx.date <= dateStr)
            .reduce((sum, tx) => sum + tx.amount, 0);
        };
        const allTxInRange = transactions.filter((tx) => tx.date >= dateMin && tx.date <= dateMax);
        const byType = allTxInRange.reduce<Record<string, { count: number; sumAmount: number }>>((acc, tx) => {
          const t = tx.type;
          if (!acc[t]) acc[t] = { count: 0, sumAmount: 0 };
          acc[t].count += 1;
          acc[t].sumAmount += tx.amount;
          return acc;
        }, {});
        const cashFlowEntries = Object.entries(cashFlowByDate).filter(([, v]) => v !== 0);
        const yearBoundaries: { year: number; firstDate: string; lastDate: string; VFirst: number; VLast: number; indexFirst: number; indexLast: number; returnPct: number }[] = [];
        const years = [...new Set(dates.map((d) => new Date(d).getFullYear()))].sort((a, b) => a - b);
        for (const y of years) {
          const indices = dates.map((d, i) => i).filter((i) => new Date(dates[i]).getFullYear() === y);
          if (indices.length === 0) continue;
          const firstIdx = Math.min(...indices);
          const lastIdx = Math.max(...indices);
          const VFirst = portfolioValues[firstIdx];
          const VLast = portfolioValues[lastIdx];
          const indexFirst = growthIndex[firstIdx];
          const indexLast = growthIndex[lastIdx];
          const returnPct = indexFirst > 0 ? ((indexLast / indexFirst - 1) * 100) : 0;
          yearBoundaries.push({
            year: y,
            firstDate: dates[firstIdx],
            lastDate: dates[lastIdx],
            VFirst: Math.round(VFirst * 100) / 100,
            VLast: Math.round(VLast * 100) / 100,
            indexFirst: Math.round(indexFirst * 100) / 100,
            indexLast: Math.round(indexLast * 100) / 100,
            returnPct: Math.round(returnPct * 100) / 100,
          });
        }
        const simpleNorm = normalizeTo100(portfolioValues);
        const simpleReturnPct = simpleNorm.length >= 2 && simpleNorm[0] > 0
          ? ((simpleNorm[simpleNorm.length - 1] / simpleNorm[0] - 1) * 100)
          : null;

        const narrativeLines: string[] = [];
        const firstIdxWithValue = portfolioValues.findIndex((v) => v > 0);
        if (firstIdxWithValue >= 0) {
          const firstDate = dates[firstIdxWithValue];
          const firstValue = portfolioValues[firstIdxWithValue];
          if (firstIdxWithValue > 0) {
            const cashInNoPositionPeriod = cumulativeCashUpTo(dates[firstIdxWithValue - 1]);
            const cashStr = cashInNoPositionPeriod.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            narrativeLines.push(
              cashInNoPositionPeriod > 0
                ? `From ${dates[0]} to ${dates[firstIdxWithValue - 1]} we had $${cashStr} under management (deposits only; no positions yet, so 0% return).`
                : `From ${dates[0]} to ${dates[firstIdxWithValue - 1]} we had $0 under management (no deposits or positions in this period).`
            );
          }
          narrativeLines.push(
            `We started ${firstDate} with $${firstValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} under management.`
          );
          const cashFlowIndices = dates
            .map((d, i) => (i >= firstIdxWithValue && (cashFlowByDate[d] ?? 0) !== 0 ? i : -1))
            .filter((i) => i >= 0)
            .sort((a, b) => a - b);
          const segmentEndIndices = [...cashFlowIndices, dates.length - 1];
          let segmentStartIdx = firstIdxWithValue;
          for (let s = 0; s < segmentEndIndices.length; s++) {
            const segmentEndIdx = segmentEndIndices[s];
            const startDate = dates[segmentStartIdx];
            const endDate = dates[segmentEndIdx];
            const days = segmentEndIdx - segmentStartIdx;
            const indexStart = growthIndex[segmentStartIdx];
            const indexEnd = growthIndex[segmentEndIdx];
            const returnDec = indexStart > 0 ? indexEnd / indexStart - 1 : 0;
            const returnPct = returnDec * 100;
            const dailyPct = days > 0 ? ((Math.pow(1 + returnDec, 1 / days) - 1) * 100) : 0;
            const apyPct = days > 0 ? ((Math.pow(1 + returnDec, 365 / days) - 1) * 100) : 0;
            narrativeLines.push(
              `Between ${startDate} and ${endDate} we made ${returnPct.toFixed(2)}% (${dailyPct.toFixed(4)}% daily, ${apyPct.toFixed(2)}% APY).`
            );
            if (s < cashFlowIndices.length) {
              const cfDate = dates[cashFlowIndices[s]];
              const cfAmount = cashFlowByDate[cfDate] ?? 0;
              const aumAfter = portfolioValues[cashFlowIndices[s]];
              const flowLabel = cfAmount >= 0 ? 'Deposit' : 'Withdrawal';
              narrativeLines.push(
                `${flowLabel} of $${Math.abs(cfAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} was made, we now have $${aumAfter.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} under management.`
              );
              const breakdown = getBreakdownFromSnapshot(getSnapshotForDate(snapshotsAsc, cfDate), cfDate, priceMaps);
              for (const row of breakdown) {
                narrativeLines.push(
                  `  ${row.ticker}: ${row.quantity} @ $${row.price.toFixed(2)} = $${row.value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                );
              }
              narrativeLines.push(
                `  Total: $${aumAfter.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              );
              segmentStartIdx = cashFlowIndices[s];
            } else {
              segmentStartIdx = segmentEndIdx + 1;
            }
          }
          const totalDays = dates.length - 1 - firstIdxWithValue;
          const twrTotalReturn = growthIndex[growthIndex.length - 1] / 100 - 1;
          const twrAnnualizedPct =
            totalDays > 0 ? ((Math.pow(1 + twrTotalReturn, 365 / totalDays) - 1) * 100) : 0;
          narrativeLines.push(
            `Average time-weighted return (annualized): ${twrAnnualizedPct.toFixed(2)}%.`
          );
        } else {
          narrativeLines.push('No portfolio value (positions) in the selected period.');
        }

        debugPayload = {
          dateRange: { dateMin, dateMax, numDays: dates.length },
          narrative: narrativeLines,
          transactionsInRange: { byType, totalCount: allTxInRange.length },
          cashFlowsUsedForTWR: cashFlowEntries.length ? Object.fromEntries(cashFlowEntries) : '(none – only type=cash)',
          portfolioValueRaw: { first: portfolioValues[0], last: portfolioValues[portfolioValues.length - 1] },
          twrGrowthIndex: { first: 100, last: growthIndex[growthIndex.length - 1] },
          simpleNormalizedReturnPct: simpleReturnPct,
          sampleSteps: steps.slice(0, 50),
          yearBoundaries,
        };
        console.log('[performance TWR debug]', JSON.stringify(debugPayload, null, 2));
      }
    }

    const normBenchmark = normalizeTo100(benchmarkValues);

    const bands = portfolio.bands ?? [];
    const expectedReturn = computeBandExpectedReturn(bands);

    const json: Record<string, unknown> = {
      dates,
      series: {
        portfolio: normPortfolio,
        benchmark: normBenchmark,
      },
      benchmark,
    };
    if (expectedReturn) json.expectedReturn = expectedReturn;
    if (debug && debugPayload) json.debug = debugPayload;
    return NextResponse.json(json);
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
