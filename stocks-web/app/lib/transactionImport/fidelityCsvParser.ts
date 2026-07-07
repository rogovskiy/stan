import type { BrokerCsvParser, ParseResult, TransactionPayload } from './types';
import { isMoneyMarketSweepTicker } from '../moneyMarketSweep';
import {
  colIndex,
  headerColumns,
  isBond,
  isTicker,
  parseCsvRow,
  parseDateMmDdYyyy,
  parseMoney,
} from './csvUtils';
import { resolveRsuGrantPrices } from './fidelityRsu';

const FIDELITY_DATE_RE = /^\d{2}-\d{2}-\d{4}$/;

type FidelityFieldLayout = {
  /** Fixed columns from Symbol through Settlement Date (Action may contain commas). */
  trailingFieldCount: number;
  priceOffset: number;
  quantityOffset: number;
  feesOffset: number;
  amountOffset: number;
};

/** Legacy export: Price ($), Amount ($), etc. */
const FIDELITY_LEGACY_LAYOUT: FidelityFieldLayout = {
  trailingFieldCount: 11,
  priceOffset: 3,
  quantityOffset: 4,
  feesOffset: 6,
  amountOffset: 8,
};

/** Current export: Exchange Quantity/Currency columns before Price/Quantity. */
const FIDELITY_EXTENDED_LAYOUT: FidelityFieldLayout = {
  trailingFieldCount: 15,
  priceOffset: 6,
  quantityOffset: 7,
  feesOffset: 10,
  amountOffset: 12,
};

function hasFidelityAmountColumn(header: string[]): boolean {
  return colIndex(header, 'Amount ($)') >= 0 || colIndex(header, 'Amount') >= 0;
}

function fidelityFieldLayout(header: string[]): FidelityFieldLayout {
  if (colIndex(header, 'Exchange Quantity') >= 0) return FIDELITY_EXTENDED_LAYOUT;
  if (colIndex(header, 'Amount ($)') >= 0) return FIDELITY_LEGACY_LAYOUT;
  // Amount without ($) and without Exchange Quantity — treat as extended if Currency column present.
  if (colIndex(header, 'Currency') >= 0) return FIDELITY_EXTENDED_LAYOUT;
  return FIDELITY_LEGACY_LAYOUT;
}

/** Fidelity cash sweep / money market — not equity positions. */
export { MONEY_MARKET_SWEEP_TICKERS as FIDELITY_MONEY_MARKET_TICKERS } from '../moneyMarketSweep';

function isFidelityMoneyMarketSweep(symbol: string): boolean {
  return isMoneyMarketSweepTicker(symbol);
}

function detectFidelityCsv(csvText: string): boolean {
  const cols = headerColumns(csvText);
  return cols.includes('Run Date') && cols.includes('Action') && hasFidelityAmountColumn(cols);
}

function mapFidelityAction(action: string): 'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash' | null {
  const upper = action.toUpperCase();
  if (upper.startsWith('YOU BOUGHT')) return 'buy';
  if (upper.startsWith('YOU SOLD')) return 'sell';
  if (upper.startsWith('DIVIDEND RECEIVED') || upper.startsWith('INTEREST EARNED')) return 'dividend';
  if (upper.startsWith('REINVESTMENT')) return 'dividend_reinvest';
  return null;
}

/** Right-anchored parse: Action may contain unquoted commas (e.g. "NEW RELIC, INC."). */
function parseFidelityDataFields(
  row: string[],
  layout: FidelityFieldLayout
): {
  action: string;
  symbol: string;
  description: string;
  priceRaw: string;
  quantityRaw: string;
  feesRaw: string;
  amountRaw: string;
} | null {
  if (row.length < 1 + layout.trailingFieldCount) return null;
  const n = row.length;
  const tailStart = n - layout.trailingFieldCount;
  return {
    action: row.slice(1, tailStart).join(', ').trim(),
    symbol: (row[tailStart] ?? '').trim(),
    description: (row[tailStart + 1] ?? '').trim(),
    priceRaw: row[tailStart + layout.priceOffset] ?? '',
    quantityRaw: row[tailStart + layout.quantityOffset] ?? '',
    feesRaw: row[tailStart + layout.feesOffset] ?? '',
    amountRaw: row[tailStart + layout.amountOffset] ?? '',
  };
}

export function parseFidelityTransactionsCsv(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { equity: [], cash: [] };

  const headerRow = parseCsvRow(lines[0]);
  if (colIndex(headerRow, 'Run Date') < 0 || !hasFidelityAmountColumn(headerRow)) {
    return { equity: [], cash: [] };
  }
  const layout = fidelityFieldLayout(headerRow);

  const equity: TransactionPayload[] = [];
  const cash: TransactionPayload[] = [];

  for (let r = 1; r < lines.length; r++) {
    const row = parseCsvRow(lines[r]);
    const runDateRaw = (row[0] ?? '').trim();
    if (!FIDELITY_DATE_RE.test(runDateRaw)) break;

    const date = parseDateMmDdYyyy(runDateRaw);
    if (!date) continue;

    const fields = parseFidelityDataFields(row, layout);
    if (!fields) continue;

    const { action, symbol, description, priceRaw, quantityRaw, feesRaw, amountRaw } = fields;
    const symbolUpper = symbol.toUpperCase();
    const amountVal = parseMoney(amountRaw);
    const qtyVal = parseMoney(quantityRaw);
    const priceVal = parseMoney(priceRaw);
    const feesVal = parseMoney(feesRaw);
    const quantity = qtyVal ?? 0;
    const price = priceVal;
    const txType = mapFidelityAction(action);

    // Cash sweep (FCASH, SPAXX, …): all amounts hit cash balance — never equity positions.
    if (isFidelityMoneyMarketSweep(symbol)) {
      if (amountVal != null && amountVal !== 0) {
        cash.push({
          type: 'cash',
          ticker: null,
          date,
          quantity: 0,
          price: null,
          amount: amountVal,
          notes: [action, symbol || description].filter(Boolean).join(' – '),
        });
      }
      continue;
    }

    if (txType && txType !== 'cash' && isTicker(symbol) && !isBond(symbol)) {
      if (txType === 'buy') {
        const buyQty = quantity !== 0 ? Math.abs(quantity) : 0;
        let buyPrice = price;
        if (buyPrice == null && buyQty > 0 && amountVal != null && amountVal !== 0) {
          buyPrice = Math.abs(amountVal / buyQty);
        }
        const isRsuGrant = action.toUpperCase().includes('RSU');
        equity.push({
          type: 'buy',
          ticker: symbolUpper,
          date,
          quantity: buyQty,
          price: buyPrice,
          amount:
            amountVal !== null && amountVal !== 0
              ? amountVal
              : buyPrice != null && buyQty > 0 && buyPrice !== 0
                ? -(buyQty * buyPrice)
                : 0,
          notes: isRsuGrant ? 'RSU grant' : '',
        });
      } else if (txType === 'sell') {
        const sellQty = quantity < 0 ? quantity : quantity > 0 ? -quantity : 0;
        const feeNote = feesVal != null && feesVal !== 0 ? `Fees: $${feesVal}` : '';
        equity.push({
          type: 'sell',
          ticker: symbolUpper,
          date,
          quantity: sellQty,
          price,
          amount:
            amountVal !== null && amountVal !== 0
              ? amountVal
              : price != null && sellQty !== 0
                ? Math.abs(sellQty) * price
                : 0,
          notes: feeNote,
        });
      } else if (txType === 'dividend') {
        if (amountVal == null) continue;
        equity.push({
          type: 'dividend',
          ticker: symbolUpper,
          date,
          quantity: 0,
          price: null,
          amount: amountVal,
          notes: '',
        });
      } else if (txType === 'dividend_reinvest') {
        if (amountVal == null) continue;
        equity.push({
          type: 'dividend_reinvest',
          ticker: symbolUpper,
          date,
          quantity: quantity !== 0 ? Math.abs(quantity) : 0,
          price: price ?? null,
          amount: amountVal,
          notes: '',
        });
      }
      continue;
    }

    if (amountVal != null) {
      const notesForCash = [action, symbol || description].filter(Boolean).join(' – ');
      cash.push({
        type: 'cash',
        ticker: null,
        date,
        quantity: 0,
        price: null,
        amount: amountVal,
        notes: notesForCash,
      });
    }
  }

  resolveRsuGrantPrices(equity);

  return { equity, cash };
}

export const fidelityCsvParser: BrokerCsvParser = {
  id: 'fidelity',
  detect: detectFidelityCsv,
  parse: parseFidelityTransactionsCsv,
};
