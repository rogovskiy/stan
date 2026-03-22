import type { Band, Portfolio, Position, Transaction } from '@/app/lib/services/portfolioService';

export function resolveBandForPosition(
  portfolio: Portfolio,
  position: Position
): Band | null {
  const bid = position.bandId;
  if (!bid || !portfolio.bands?.length) return null;
  return portfolio.bands.find((b) => b.id === bid) ?? null;
}

/** Min/max buy dates from buy and dividend_reinvest rows for this ticker. */
export function buyDateRangeFromTransactions(
  transactions: Transaction[],
  tickerUpper: string
): { buyDateMin?: string; buyDateMax?: string } {
  const dates: string[] = [];
  for (const tx of transactions) {
    if (!tx.ticker || tx.ticker.toUpperCase() !== tickerUpper) continue;
    if (tx.type !== 'buy' && tx.type !== 'dividend_reinvest') continue;
    if (tx.date) dates.push(tx.date);
  }
  if (dates.length === 0) return {};
  dates.sort();
  return { buyDateMin: dates[0], buyDateMax: dates[dates.length - 1] };
}

function bandSummary(band: Band): string {
  const parts: string[] = [];
  parts.push(`target sleeve ${band.sizeMinPct}–${band.sizeMaxPct}% of portfolio`);
  if (band.maxPositionSizePct != null) {
    parts.push(`max single position ${band.maxPositionSizePct}%`);
  }
  if (band.expectedReturnMinPct != null || band.expectedReturnMaxPct != null) {
    const lo = band.expectedReturnMinPct ?? '—';
    const hi = band.expectedReturnMaxPct ?? '—';
    parts.push(`expected return range ~${lo}–${hi}%/y`);
  }
  return parts.join('; ');
}

/**
 * Human-readable block for thesis coach prompts (onboard + builder).
 */
export function buildPortfolioThesisContext(params: {
  portfolio: Portfolio;
  position: Position;
  band: Band | null;
  buyDateMin?: string;
  buyDateMax?: string;
  retroactive?: boolean;
}): string {
  const { portfolio, position, band, buyDateMin, buyDateMax, retroactive } = params;
  const lines: string[] = [];
  const pname = portfolio.name?.trim() || 'Portfolio';
  lines.push(`Portfolio: ${pname}`);
  if (retroactive) {
    lines.push('Context: retroactive — user is documenting an existing position; help recall and structure without inventing motives.');
  }
  if (band) {
    lines.push(`Risk band: ${band.name || 'Band'} (${bandSummary(band)})`);
  } else {
    lines.push('Risk band: (none assigned)');
  }
  const qty = position.quantity;
  const avg = position.purchasePrice;
  const firstBuy = position.purchaseDate;
  lines.push(
    `Position: ${position.ticker.toUpperCase()} — ${qty.toLocaleString()} sh @ avg ${
      avg != null ? `$${avg.toFixed(2)}` : 'n/a'
    }${firstBuy ? `; earliest buy (aggregate) ${firstBuy}` : ''}`
  );
  if (buyDateMin && buyDateMax && buyDateMin !== buyDateMax) {
    lines.push(`Buy activity dates (from transactions): ${buyDateMin} … ${buyDateMax}`);
  }
  if (position.notes?.trim()) {
    lines.push(`Position notes: ${position.notes.trim()}`);
  }
  return lines.join('\n');
}

/** Labels + values for UI (onboarding / builder headers) — same inputs as coach context, no model-only lines. */
export interface PortfolioPositionUserFact {
  label: string;
  value: string;
}

export function buildPortfolioPositionUserFacts(params: {
  position: Position;
  band: Band | null;
  buyDateMin?: string;
  buyDateMax?: string;
}): PortfolioPositionUserFact[] {
  const { position, band, buyDateMin, buyDateMax } = params;
  const facts: PortfolioPositionUserFact[] = [];

  if (band) {
    facts.push({
      label: 'Risk band',
      value: `${band.name || 'Band'} — ${bandSummary(band)}`,
    });
  } else {
    facts.push({ label: 'Risk band', value: 'None assigned' });
  }

  facts.push({
    label: 'Shares',
    value: position.quantity.toLocaleString(),
  });

  facts.push({
    label: 'Avg cost',
    value:
      position.purchasePrice != null && position.purchasePrice >= 0
        ? `$${position.purchasePrice.toFixed(2)}`
        : '—',
  });

  if (position.purchaseDate?.trim()) {
    facts.push({
      label: 'Earliest buy (book)',
      value: position.purchaseDate.trim(),
    });
  }

  if (buyDateMin && buyDateMax) {
    if (buyDateMin === buyDateMax) {
      facts.push({ label: 'Buy activity', value: buyDateMin });
    } else {
      facts.push({
        label: 'Buy activity',
        value: `${buyDateMin} → ${buyDateMax}`,
      });
    }
  }

  if (position.notes?.trim()) {
    facts.push({ label: 'Position notes', value: position.notes.trim() });
  }

  return facts;
}
