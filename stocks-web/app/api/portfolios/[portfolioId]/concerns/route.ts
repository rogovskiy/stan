import { NextRequest, NextResponse } from 'next/server';
import { getPortfolio } from '../../../../lib/services/portfolioService';
import { getDailyPricesForTicker } from '../../../../lib/dailyPrices';
import type { Band, Position } from '../../../../lib/services/portfolioService';

export type ConcernSeverity = 'high' | 'medium' | 'low';

/** One prompt = a clickable question that starts a chat. Context is for the bot, not shown in UI. */
export interface PortfolioConcern {
  id: string;
  severity: ConcernSeverity;
  /** Short, friendly question the user can click to start the chat */
  prompt: string;
  /** First message the bot sends when user opens this topic (conversational, not data-nerdy) */
  opener: string;
  /** Internal context for mock/LLM replies (ticker, band, etc.) */
  ticker?: string;
  bandId?: string | null;
  bandName?: string;
  suggestion?: string;
}

function latestPrice(points: { date: string; price: number }[]): number | null {
  if (!points.length) return null;
  const last = points[points.length - 1];
  return last?.price ?? null;
}

/** Fetch portfolio vs benchmark (normalized to 100). Returns null on failure. */
async function fetchPerformanceSeries(
  origin: string,
  portfolioId: string,
  period: string = '1y',
  benchmark: string = 'SPY'
): Promise<{ portfolio: number[]; benchmark: number[] } | null> {
  try {
    const url = `${origin}/api/portfolios/${portfolioId}/performance?period=${period}&benchmark=${benchmark}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const series = json?.series;
    if (!series?.portfolio?.length || !series?.benchmark?.length) return null;
    return { portfolio: series.portfolio, benchmark: series.benchmark };
  } catch {
    return null;
  }
}

/**
 * GET /api/portfolios/[portfolioId]/concerns
 * Returns agent-raised concerns for the portfolio (concentration, band violations, underperformance, rates risk, etc.)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    const origin = request.nextUrl?.origin ?? (typeof request.url === 'string' ? new URL(request.url).origin : '');
    if (!portfolioId) {
      return NextResponse.json({ error: 'Portfolio ID is required' }, { status: 400 });
    }

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
    }

    const positions = portfolio.positions ?? [];
    if (positions.length === 0) {
      return NextResponse.json({
        success: true,
        data: [
          {
            id: 'no-positions',
            severity: 'low' as ConcernSeverity,
            prompt: 'How do I get started with this portfolio?',
            opener: "This portfolio doesn't have any positions yet. You can add a transaction or import from a CSV to start tracking — I can walk you through either.",
          },
        ],
      });
    }

    // Optional: underperformance vs benchmark (1y). Fetch if we have an origin (same host).
    let underperformancePct: number | null = null;
    if (origin) {
      const perf = await fetchPerformanceSeries(origin, portfolioId, '1y', 'SPY');
      if (perf && perf.portfolio.length > 0 && perf.benchmark.length > 0) {
        const pLast = perf.portfolio[perf.portfolio.length - 1];
        const bLast = perf.benchmark[perf.benchmark.length - 1];
        if (typeof pLast === 'number' && typeof bLast === 'number' && bLast > 0) {
          const diff = ((pLast - bLast) / bLast) * 100;
          if (diff < -5) underperformancePct = Math.round(diff * 10) / 10; // e.g. -8.3
        }
      }
    }

    const tickers = [...new Set(positions.map((p) => p.ticker.toUpperCase()))];
    const priceByTicker: Record<string, number> = {};
    await Promise.all(
      tickers.map(async (ticker) => {
        const points = await getDailyPricesForTicker(ticker, '1y');
        const price = latestPrice(points);
        if (price != null) priceByTicker[ticker] = price;
      })
    );

    let totalValue = 0;
    const positionValues: { position: Position; value: number; weightPct: number }[] = [];
    for (const p of positions) {
      const price = priceByTicker[p.ticker.toUpperCase()];
      if (price == null) continue;
      const value = p.quantity * price;
      totalValue += value;
      positionValues.push({ position: p, value, weightPct: 0 });
    }
    for (const row of positionValues) {
      row.weightPct = totalValue > 0 ? (row.value / totalValue) * 100 : 0;
    }

    const bands = portfolio.bands ?? [];
    const concerns: PortfolioConcern[] = [];
    let concernIndex = 0;
    const id = () => `c-${concernIndex++}`;

    // 1) High concentration: single position > 25%
    const sortedByWeight = [...positionValues].sort((a, b) => b.weightPct - a.weightPct);
    for (const { position, weightPct } of sortedByWeight) {
      if (weightPct > 25) {
        concerns.push({
          id: id(),
          severity: weightPct > 40 ? 'high' : 'medium',
          prompt: weightPct > 40
            ? `Concentration risk: is ${position.ticker} too large?`
            : 'Concentration risk: should we rebalance?',
          opener: `One holding is a large share of the portfolio, which increases concentration risk. We can talk about trimming it or adding elsewhere to improve risk control.`,
          ticker: position.ticker,
          suggestion: 'Consider reducing the position size or adding other holdings to diversify.',
        });
      }
    }

    // 2) Band allocation violations
    for (const band of bands) {
      const bandPositions = positionValues.filter((pv) => pv.position.bandId === band.id);
      const bandValue = bandPositions.reduce((s, pv) => s + pv.value, 0);
      const bandPct = totalValue > 0 ? (bandValue / totalValue) * 100 : 0;
      const inRange =
        bandPct >= band.sizeMinPct && bandPct <= band.sizeMaxPct;
      if (!inRange && bandPositions.length > 0) {
        concerns.push({
          id: id(),
          severity: 'medium',
          prompt: `Allocation risk: is "${band.name}" off target?`,
          opener: `Your "${band.name}" allocation has drifted from your target range. We can talk through rebalancing to get risk and exposure back in line.`,
          bandId: band.id,
          bandName: band.name,
          suggestion: 'Rebalance so this band falls within its target allocation.',
        });
      }
      for (const { position, weightPct } of bandPositions) {
        const maxPos = band.maxPositionSizePct;
        if (maxPos != null && weightPct > maxPos) {
          concerns.push({
            id: id(),
            severity: 'medium',
            prompt: `Position size risk: one name in "${band.name}" too big?`,
            opener: `One "${band.name}" holding has grown past your size limit for that bucket. We can discuss trimming for risk management or keeping it if the thesis still justifies it.`,
            ticker: position.ticker,
            bandId: band.id,
            bandName: band.name,
            suggestion: 'Trim the position or move part of it to a different band.',
          });
        }
      }
    }

    // 3) Underperformance vs benchmark (1y)
    if (underperformancePct != null && underperformancePct < -5) {
      concerns.push({
        id: id(),
        severity: underperformancePct < -15 ? 'high' : 'medium',
        prompt: 'Portfolio lagging the market — what should we do?',
        opener: `Over the last year your portfolio has trailed the market. We can look at why — whether it's sector mix, stock selection, or timing — and what, if anything, you want to change.`,
        suggestion: 'Review holdings and allocation; consider whether to tilt toward stronger names or adjust risk.',
      });
    }

    // 4) Interest rate risk (always offer when there are positions)
    if (totalValue > 0) {
      concerns.push({
        id: id(),
        severity: 'medium',
        prompt: 'How exposed are we to interest rate risk?',
        opener: "Rates affect bonds and growth stocks. We can talk about how much rate sensitivity you have and whether you want to hedge or adjust duration.",
        suggestion: 'Review duration and rate-sensitive holdings; consider diversification or hedges if needed.',
      });
    }

    // 5) Low diversification: very few positions
    if (positions.length < 5 && totalValue > 0) {
      concerns.push({
        id: id(),
        severity: 'low',
        prompt: 'Diversification risk: too few holdings?',
        opener: "You're in a small number of names, so single-stock risk is higher. We can chat about whether adding a few more would improve risk control.",
        suggestion: 'Add more positions over time if you want to reduce single-name risk.',
      });
    }

    // 6) Positions with no band assigned (if bands are defined)
    if (bands.length > 0) {
      const unassigned = positions.filter((p) => !p.bandId);
      if (unassigned.length > 0) {
        concerns.push({
          id: id(),
          severity: 'low',
          prompt: 'Risk buckets: assign missing holdings?',
          opener: "Some positions aren't in a risk bucket yet. If you use buckets to manage allocation, we can assign them so your risk view stays accurate.",
          suggestion: 'Edit each position and assign a band in the position settings.',
        });
      }
    }

    return NextResponse.json({ success: true, data: concerns });
  } catch (err) {
    console.error('Portfolio concerns error:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Failed to compute concerns' },
      { status: 500 }
    );
  }
}
