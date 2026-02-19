import type { Transaction } from './services/portfolioService';
import type { PortfolioSnapshot } from './services/portfolioService';

/** A single lot (purchase) for cost-basis tracking. FIFO order. */
export interface Lot {
  purchaseDate: string; // ISO date
  quantity: number;
  costBasisPerShare: number;
}

/**
 * Build open lots for a ticker from transaction history (FIFO).
 * Buys add lots; sells consume from the oldest lots first.
 */
export function buildOpenLots(
  transactions: Transaction[],
  ticker: string
): Lot[] {
  const upper = ticker.toUpperCase();
  const sorted = [...transactions]
    .filter((tx) => tx.ticker?.toUpperCase() === upper)
    .sort((a, b) => a.date.localeCompare(b.date));

  const lots: Lot[] = [];

  for (const tx of sorted) {
    if ((tx.type === 'buy' || tx.type === 'dividend_reinvest') && tx.quantity > 0 && tx.price != null) {
      lots.push({
        purchaseDate: tx.date,
        quantity: tx.quantity,
        costBasisPerShare: tx.price,
      });
    } else if (tx.type === 'sell' && tx.quantity < 0) {
      let toSell = Math.abs(tx.quantity);
      while (toSell > 0 && lots.length > 0) {
        const lot = lots[0];
        if (lot.quantity <= toSell) {
          toSell -= lot.quantity;
          lots.shift();
        } else {
          lot.quantity -= toSell;
          toSell = 0;
        }
      }
    }
  }

  return lots.filter((l) => l.quantity > 0);
}

const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

function isLongTerm(purchaseDate: string, saleDate: string): boolean {
  return new Date(saleDate).getTime() - new Date(purchaseDate).getTime() > ONE_YEAR_MS;
}

/** One chunk of a sale attributed to a lot (or part of a lot). */
export interface SaleChunk {
  purchaseDate: string;
  quantity: number;
  costBasisPerShare: number;
  proceeds: number;
  gain: number;
  longTerm: boolean;
}

/**
 * Simulate selling shares from lots (FIFO) and compute short-term vs long-term gains.
 * saleDate defaults to today (ISO date).
 */
export function computeTaxImpactFromLots(
  lots: Lot[],
  sharesToSell: number,
  salePrice: number,
  saleDate: string = new Date().toISOString().slice(0, 10),
  rates: typeof TAX_RATES = TAX_RATES
): {
  shortTermGain: number;
  longTermGain: number;
  totalGain: number;
  estimatedTax: number;
  breakdown: SaleChunk[];
} {
  const breakdown: SaleChunk[] = [];
  let remaining = sharesToSell;
  const lotsCopy = lots.map((l) => ({ ...l, quantity: l.quantity }));

  for (const lot of lotsCopy) {
    if (remaining <= 0) break;
    const sellFromLot = Math.min(remaining, lot.quantity);
    const costBasis = sellFromLot * lot.costBasisPerShare;
    const proceeds = sellFromLot * salePrice;
    const gain = proceeds - costBasis;
    const longTerm = isLongTerm(lot.purchaseDate, saleDate);
    breakdown.push({
      purchaseDate: lot.purchaseDate,
      quantity: sellFromLot,
      costBasisPerShare: lot.costBasisPerShare,
      proceeds,
      gain,
      longTerm,
    });
    remaining -= sellFromLot;
  }

  const shortTermGain = breakdown.filter((c) => !c.longTerm).reduce((s, c) => s + c.gain, 0);
  const longTermGain = breakdown.filter((c) => c.longTerm).reduce((s, c) => s + c.gain, 0);
  const totalGain = shortTermGain + longTermGain;
  const estimatedTax =
    Math.max(0, shortTermGain) * rates.shortTermCapitalGains +
    Math.max(0, longTermGain) * rates.longTermCapitalGains;

  return {
    shortTermGain,
    longTermGain,
    totalGain,
    estimatedTax,
    breakdown,
  };
}

/** Placeholder federal rates (estimate only; user should verify with CPA). */
export const TAX_RATES = {
  longTermCapitalGains: 0.15,
  shortTermCapitalGains: 0.24,
  qualifiedDividend: 0.15,
} as const;

/** Snapshot with date strictly before the given date (largest date < beforeDate). */
export function getSnapshotBeforeDate(
  snapshotsAsc: PortfolioSnapshot[],
  beforeDate: string
): PortfolioSnapshot | null {
  let best: PortfolioSnapshot | null = null;
  for (const snap of snapshotsAsc) {
    if (snap.date < beforeDate) best = snap;
  }
  return best;
}

/** Cost basis for a ticker from a snapshot (average cost per share). */
function getCostBasisFromSnapshot(snapshot: PortfolioSnapshot | null, ticker: string): number {
  if (!snapshot) return 0;
  const pos = snapshot.positions.find(
    (p) => p.ticker.toUpperCase() === ticker.toUpperCase()
  );
  return pos?.costBasis ?? 0;
}

export type TermType = 'short-term' | 'long-term' | 'mixed';

export interface GainsByTicker {
  realizedGain: number;
  shortTermGain: number;
  longTermGain: number;
  termType: TermType;
  taxOnGains: number;
}

/**
 * Compute YTD realized capital gains from sell transactions, grouped by ticker.
 * Uses lot-level FIFO to attribute gains as short-term vs long-term.
 */
export function computeYtdRealizedGainsByTicker(
  transactions: Transaction[],
  _snapshotsAsc: PortfolioSnapshot[],
  currentYear: number,
  rates: typeof TAX_RATES = TAX_RATES
): { total: number; totalShortTerm: number; totalLongTerm: number; byTicker: Record<string, GainsByTicker> } {
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  const lotsByTicker: Record<string, Lot[]> = {};
  const byTicker: Record<string, { shortTermGain: number; longTermGain: number }> = {};

  for (const tx of sorted) {
    if (!tx.ticker) continue;
    const ticker = tx.ticker.toUpperCase();

    if ((tx.type === 'buy' || tx.type === 'dividend_reinvest') && tx.quantity > 0 && tx.price != null) {
      if (!lotsByTicker[ticker]) lotsByTicker[ticker] = [];
      lotsByTicker[ticker].push({
        purchaseDate: tx.date,
        quantity: tx.quantity,
        costBasisPerShare: tx.price,
      });
    } else if (tx.type === 'sell' && tx.quantity < 0 && tx.price != null) {
      const txYear = new Date(tx.date).getFullYear();
      const saleDate = tx.date;
      let toSell = Math.abs(tx.quantity);
      const lots = lotsByTicker[ticker] ?? [];
      if (!lotsByTicker[ticker]) lotsByTicker[ticker] = lots;

      if (txYear === currentYear) {
        if (!byTicker[ticker]) byTicker[ticker] = { shortTermGain: 0, longTermGain: 0 };
      }

      while (toSell > 0 && lots.length > 0) {
        const lot = lots[0];
        const sellFromLot = Math.min(toSell, lot.quantity);
        const costBasis = sellFromLot * lot.costBasisPerShare;
        const proceeds = sellFromLot * tx.price!;
        const gain = proceeds - costBasis;
        if (txYear === currentYear) {
          const lt = isLongTerm(lot.purchaseDate, saleDate);
          if (lt) byTicker[ticker].longTermGain += gain;
          else byTicker[ticker].shortTermGain += gain;
        }
        toSell -= sellFromLot;
        if (lot.quantity <= sellFromLot) {
          lots.shift();
        } else {
          lot.quantity -= sellFromLot;
        }
      }
    }
  }

  let total = 0;
  let totalShortTerm = 0;
  let totalLongTerm = 0;
  const result: Record<string, GainsByTicker> = {};
  for (const [ticker, { shortTermGain, longTermGain }] of Object.entries(byTicker)) {
    const realizedGain = shortTermGain + longTermGain;
    total += realizedGain;
    totalShortTerm += shortTermGain;
    totalLongTerm += longTermGain;
    const termType: TermType =
      shortTermGain !== 0 && longTermGain !== 0
        ? 'mixed'
        : shortTermGain !== 0
          ? 'short-term'
          : 'long-term';
    const taxOnGains =
      Math.max(0, shortTermGain) * rates.shortTermCapitalGains +
      Math.max(0, longTermGain) * rates.longTermCapitalGains;
    result[ticker] = {
      realizedGain,
      shortTermGain,
      longTermGain,
      termType,
      taxOnGains,
    };
  }
  return { total, totalShortTerm, totalLongTerm, byTicker: result };
}

/**
 * Compute YTD realized capital gains from sell transactions.
 * Uses snapshot before each sell date for cost basis (average cost method).
 */
export function computeYtdRealizedGains(
  transactions: Transaction[],
  snapshotsAsc: PortfolioSnapshot[],
  currentYear: number
): number {
  const { total } = computeYtdRealizedGainsByTicker(
    transactions,
    snapshotsAsc,
    currentYear
  );
  return total;
}

/**
 * Sum YTD taxable dividend income (type === 'dividend').
 */
export function computeYtdDividendIncome(
  transactions: Transaction[],
  currentYear: number
): number {
  return transactions
    .filter(
      (tx) =>
        tx.type === 'dividend' &&
        new Date(tx.date).getFullYear() === currentYear
    )
    .reduce((sum, tx) => sum + tx.amount, 0);
}

/**
 * Apply placeholder rates to get estimated federal tax on gains and dividends.
 * Uses short-term vs long-term split when provided for accurate tax estimate.
 */
export function estimateTaxDue(
  realizedGainsYtd: number,
  dividendIncomeYtd: number,
  rates: typeof TAX_RATES = TAX_RATES,
  shortTermGains?: number,
  longTermGains?: number
): { taxOnGains: number; taxOnDividends: number; estimatedTaxDue: number } {
  const taxOnGains =
    shortTermGains != null && longTermGains != null
      ? Math.max(0, shortTermGains) * rates.shortTermCapitalGains +
        Math.max(0, longTermGains) * rates.longTermCapitalGains
      : Math.max(0, realizedGainsYtd) * rates.shortTermCapitalGains;
  const taxOnDividends = Math.max(0, dividendIncomeYtd) * rates.qualifiedDividend;
  return {
    taxOnGains,
    taxOnDividends,
    estimatedTaxDue: taxOnGains + taxOnDividends,
  };
}
