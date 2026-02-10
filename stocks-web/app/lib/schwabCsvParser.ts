/**
 * Parse Schwab transactions CSV and output equity + cash transaction payloads
 * for POST /api/portfolios/[id]/transactions.
 */

export type TransactionPayload = {
  type: 'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash';
  ticker: string | null;
  date: string; // YYYY-MM-DD
  quantity: number;
  price: number | null;
  amount: number;
  notes?: string;
};

export type ParseResult = {
  equity: TransactionPayload[];
  cash: TransactionPayload[];
};

const EQUITY_ACTIONS = new Set([
  'Buy',
  'Sell',
  'Cash Dividend',
  'Pr Yr Cash Div',
  'Qualified Dividend',
  'Non-Qualified Div',
  'Reinvest Dividend',
  'Reinvest Shares',
]);
const REINVEST_SHARES_ACTION = 'Reinvest Shares';
const DIVIDEND_ACTIONS = new Set([
  'Cash Dividend',
  'Pr Yr Cash Div',
  'Qualified Dividend',
  'Non-Qualified Div',
  'Reinvest Dividend',
]);

function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (inQuotes) {
      current += c;
    } else if (c === ',') {
      result.push(current.trim());
      current = '';
    } else {
      current += c;
    }
  }
  result.push(current.trim());
  return result;
}

function parseDate(raw: string): string {
  const s = (raw || '').trim();
  const asOf = s.indexOf(' as of ');
  const dateStr = asOf >= 0 ? s.slice(0, asOf).trim() : s;
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return '';
  const [mm, dd, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function parseMoney(raw: string): number | null {
  const s = (raw || '').trim().replace(/\$/g, '').replace(/,/g, '');
  if (s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function isTicker(symbol: string | undefined): boolean {
  if (symbol == null || typeof symbol !== 'string') return false;
  const s = symbol.trim();
  return s.length > 0 && !s.includes(' ');
}

/** Bonds (e.g. CUSIP like 46656MH95) expire; we have no expiration logic, so treat as cash only, no position. */
function isBond(symbol: string | undefined): boolean {
  if (symbol == null || typeof symbol !== 'string') return false;
  const s = symbol.trim();
  return /^[A-Z0-9]{9}$/i.test(s);
}

/**
 * Parse Schwab transactions CSV text.
 * Returns equity transactions (buy/sell/dividend/dividend_reinvest) and
 * cash transactions (options, bonds, deposits, etc.).
 */
export function parseSchwabTransactionsCsv(csvText: string): ParseResult {
  const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return { equity: [], cash: [] };

  const headerRow = parseCsvRow(lines[0]);
  const col = (name: string): number => {
    const i = headerRow.findIndex((h) => h.replace(/^\s+|\s+$/g, '') === name);
    return i >= 0 ? i : -1;
  };
  const dateCol = col('Date');
  const actionCol = col('Action');
  const symbolCol = col('Symbol');
  const descCol = col('Description');
  const qtyCol = col('Quantity');
  const priceCol = col('Price');
  const amountCol = col('Amount');

  if (dateCol < 0 || actionCol < 0 || amountCol < 0) {
    return { equity: [], cash: [] };
  }

  const get = (row: string[], i: number): string => (i >= 0 && row[i] !== undefined ? row[i] : '');

  const equity: TransactionPayload[] = [];
  const cash: TransactionPayload[] = [];

  for (let r = 1; r < lines.length; r++) {
    const row = parseCsvRow(lines[r]);
    const date = parseDate(get(row, dateCol));
    const action = get(row, actionCol).trim();
    const symbol = get(row, symbolCol).trim();
    const symbolUpper = symbol.toUpperCase();
    const description = get(row, descCol).trim();
    const amountVal = parseMoney(get(row, amountCol));
    const qtyVal = parseMoney(get(row, qtyCol));
    const priceVal = parseMoney(get(row, priceCol));
    const quantity = qtyVal ?? 0;
    const price = priceVal;
    const amount = amountVal ?? 0;

    if (!date) continue;

    const notesForCash = [action, symbol || description].filter(Boolean).join(' – ');

    // Equity: ticker actions (buy/sell/dividends including Reinvest Dividend and Non-Qualified Div) so they show in ticker history and in cash total
    if (isTicker(symbol) && !isBond(symbol) && EQUITY_ACTIONS.has(action)) {
      if (action === 'Buy') {
        equity.push({
          type: 'buy',
          ticker: symbolUpper,
          date,
          quantity: quantity > 0 ? quantity : 0,
          price,
          amount: amount !== 0 ? amount : (price != null && quantity > 0 ? -(quantity * price) : 0),
          notes: '',
        });
      } else if (action === 'Sell') {
        equity.push({
          type: 'sell',
          ticker: symbolUpper,
          date,
          quantity: quantity > 0 ? -quantity : quantity,
          price,
          amount: amount !== 0 ? amount : (price != null && quantity > 0 ? quantity * price : 0),
          notes: '',
        });
      } else if (DIVIDEND_ACTIONS.has(action)) {
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
      } else if (action === REINVEST_SHARES_ACTION) {
        if (amountVal == null) continue;
        equity.push({
          type: 'dividend_reinvest',
          ticker: symbolUpper,
          date,
          quantity: quantity > 0 ? quantity : 0,
          price: price ?? null,
          amount: amountVal,
          notes: '',
        });
      }
      continue;
    }

    if (amountVal != null) {
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

  return { equity, cash };
}
