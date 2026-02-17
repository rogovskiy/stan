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

/**
 * Compute YTD realized capital gains from sell transactions.
 * Uses snapshot before each sell date for cost basis (average cost method).
 */
export function computeYtdRealizedGains(
  transactions: Transaction[],
  snapshotsAsc: PortfolioSnapshot[],
  currentYear: number
): number {
  let total = 0;
  for (const tx of transactions) {
    if (tx.type !== 'sell' || !tx.ticker || tx.price == null) continue;
    const txYear = new Date(tx.date).getFullYear();
    if (txYear !== currentYear) continue;
    const sharesSold = Math.abs(tx.quantity);
    if (sharesSold <= 0) continue;
    const snapshotBefore = getSnapshotBeforeDate(snapshotsAsc, tx.date);
    const costBasis = getCostBasisFromSnapshot(snapshotBefore, tx.ticker);
    const proceeds = sharesSold * tx.price;
    const cost = sharesSold * costBasis;
    total += proceeds - cost;
  }
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
 * Realized gains are treated as one bucket (no ST/LT split in v1).
 */
export function estimateTaxDue(
  realizedGainsYtd: number,
  dividendIncomeYtd: number,
  rates: typeof TAX_RATES = TAX_RATES
): { taxOnGains: number; taxOnDividends: number; estimatedTaxDue: number } {
  const taxOnGains = Math.max(0, realizedGainsYtd) * rates.shortTermCapitalGains;
  const taxOnDividends = Math.max(0, dividendIncomeYtd) * rates.qualifiedDividend;
  return {
    taxOnGains,
    taxOnDividends,
    estimatedTaxDue: taxOnGains + taxOnDividends,
  };
}
