/**
 * Parse Schwab transactions CSV and output equity + cash transaction payloads
 * for POST /api/portfolios/[id]/transactions.
 */

import type { BrokerCsvParser, ParseResult, TransactionPayload } from './transactionImport/types';
import {
  colIndex,
  getCell,
  isBond,
  isTicker,
  parseCsvRow,
  parseMoney,
} from './transactionImport/csvUtils';

export type { ParseResult, TransactionPayload } from './transactionImport/types';

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

function parseSchwabDate(raw: string): string {
  const s = (raw || '').trim();
  const asOf = s.indexOf(' as of ');
  const dateStr = asOf >= 0 ? s.slice(0, asOf).trim() : s;
  if (!dateStr) return '';
  const parts = dateStr.split('/');
  if (parts.length !== 3) return '';
  const [mm, dd, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function detectSchwabCsv(csvText: string): boolean {
  const header = csvText.split(/\r?\n/).find((l) => l.trim().length > 0);
  if (!header) return false;
  const cols = parseCsvRow(header).map((h) => h.replace(/^\s+|\s+$/g, ''));
  return (
    cols.includes('Date') &&
    cols.includes('Action') &&
    cols.includes('Amount') &&
    !cols.includes('Run Date')
  );
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
  const dateCol = colIndex(headerRow, 'Date');
  const actionCol = colIndex(headerRow, 'Action');
  const symbolCol = colIndex(headerRow, 'Symbol');
  const descCol = colIndex(headerRow, 'Description');
  const qtyCol = colIndex(headerRow, 'Quantity');
  const priceCol = colIndex(headerRow, 'Price');
  const amountCol = colIndex(headerRow, 'Amount');

  if (dateCol < 0 || actionCol < 0 || amountCol < 0) {
    return { equity: [], cash: [] };
  }

  const equity: TransactionPayload[] = [];
  const cash: TransactionPayload[] = [];

  for (let r = 1; r < lines.length; r++) {
    const row = parseCsvRow(lines[r]);
    const date = parseSchwabDate(getCell(row, dateCol));
    const action = getCell(row, actionCol).trim();
    const symbol = getCell(row, symbolCol).trim();
    const symbolUpper = symbol.toUpperCase();
    const description = getCell(row, descCol).trim();
    const amountVal = parseMoney(getCell(row, amountCol));
    const qtyVal = parseMoney(getCell(row, qtyCol));
    const priceVal = parseMoney(getCell(row, priceCol));
    const quantity = qtyVal ?? 0;
    const price = priceVal;
    const amount = amountVal ?? 0;

    if (!date) continue;

    const notesForCash = [action, symbol || description].filter(Boolean).join(' – ');

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

export const schwabCsvParser: BrokerCsvParser = {
  id: 'schwab',
  detect: detectSchwabCsv,
  parse: parseSchwabTransactionsCsv,
};
