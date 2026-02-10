import { NextResponse } from 'next/server';
import {
  getTransactions,
  getPortfolio,
  addTransactionsBatch,
} from '../../../../../lib/services/portfolioService';
import type { TransactionType } from '../../../../../lib/services/portfolioService';
import { parseSchwabTransactionsCsv } from '../../../../../lib/schwabCsvParser';
import type { TransactionPayload } from '../../../../../lib/schwabCsvParser';

const VALID_TYPES: TransactionType[] = ['buy', 'sell', 'dividend', 'dividend_reinvest', 'cash'];

function transactionSignature(tx: {
  date: string;
  ticker: string | null;
  type: string;
  amount: number;
  quantity: number;
}): string {
  return `${tx.date}|${tx.ticker ?? ''}|${tx.type}|${tx.amount}|${tx.quantity}`;
}

function isValidPayload(p: TransactionPayload): boolean {
  if (!p.type || !VALID_TYPES.includes(p.type as TransactionType)) return false;
  if (p.type !== 'cash' && (p.ticker == null || p.ticker.trim().length === 0)) return false;
  if (p.type === 'cash' && p.ticker != null && p.ticker !== '') return false;
  if (!p.date || isNaN(Date.parse(p.date))) return false;
  if (typeof p.quantity !== 'number') return false;
  if (typeof p.amount !== 'number' || isNaN(p.amount)) return false;
  return true;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    const body = await _request.json();
    const csv = body?.csv;
    if (typeof csv !== 'string' || !csv.trim()) {
      return NextResponse.json(
        { success: false, error: 'Request body must include a non-empty "csv" string' },
        { status: 400 }
      );
    }

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ success: false, error: 'Portfolio not found' }, { status: 404 });
    }

    const { equity, cash } = parseSchwabTransactionsCsv(csv);
    const all: TransactionPayload[] = [...equity, ...cash];

    const existing = await getTransactions(portfolioId, null);
    // Count occurrences of each signature in DB so we only skip CSV rows that match existing ones.
    // Same signature can appear multiple times (e.g. two identical buys on the same day).
    const signatureCount = new Map<string, number>();
    existing.forEach((tx) => {
      const sig = transactionSignature({
        date: tx.date,
        ticker: tx.ticker,
        type: tx.type,
        amount: tx.amount,
        quantity: tx.quantity,
      });
      signatureCount.set(sig, (signatureCount.get(sig) ?? 0) + 1);
    });

    let equityOk = 0;
    let cashOk = 0;
    let skipped = 0;
    let failed = 0;
    const newTransactions: Array<{
      type: TransactionType;
      ticker: string | null;
      date: string;
      quantity: number;
      price: number | null;
      amount: number;
      notes: string;
    }> = [];

    for (const tx of all) {
      const sig = transactionSignature(tx);
      const count = signatureCount.get(sig) ?? 0;
      if (count > 0) {
        skipped += 1;
        signatureCount.set(sig, count - 1);
        continue;
      }
      if (!isValidPayload(tx)) {
        failed += 1;
        continue;
      }
      newTransactions.push({
        type: tx.type as TransactionType,
        ticker: tx.ticker != null ? tx.ticker.trim().toUpperCase() : null,
        date: tx.date.trim(),
        quantity: tx.quantity,
        price: tx.price ?? null,
        amount: tx.amount,
        notes: tx.notes ?? '',
      });
      if (tx.type === 'cash') cashOk += 1;
      else equityOk += 1;
    }

    if (newTransactions.length > 0) {
      await addTransactionsBatch(portfolioId, newTransactions);
    }

    const updatedPortfolio = await getPortfolio(portfolioId);
    return NextResponse.json({
      success: true,
      data: { equityOk, cashOk, skipped, failed },
      portfolio: updatedPortfolio,
    });
  } catch (error) {
    console.error('Import CSV Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
