import { NextResponse } from 'next/server';
import {
  getTransactions,
  getPortfolio,
  addTransactionsBatch,
  recomputeAndWriteAggregates,
} from '../../../../../lib/services/portfolioService';
import type { TransactionType } from '../../../../../lib/services/portfolioService';
import {
  parseTransactionsCsvs,
  type BrokerProvider,
  type TransactionPayload,
} from '../../../../../lib/transactionImport';
import { getMissingPriceTickers } from '../../../../../lib/server/missingPriceTickers';

const VALID_TYPES: TransactionType[] = ['buy', 'sell', 'dividend', 'dividend_reinvest', 'cash'];

function normalizeCsvInputs(body: unknown): string[] | null {
  if (body == null || typeof body !== 'object') return null;
  const { csv, csvs } = body as { csv?: unknown; csvs?: unknown };
  if (Array.isArray(csvs)) {
    const texts = csvs.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
    return texts.length > 0 ? texts : null;
  }
  if (typeof csv === 'string' && csv.trim()) {
    return [csv];
  }
  return null;
}

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
    const csvTexts = normalizeCsvInputs(body);
    if (!csvTexts) {
      return NextResponse.json(
        {
          success: false,
          error: 'Request body must include a non-empty "csv" string or "csvs" string array',
        },
        { status: 400 }
      );
    }

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ success: false, error: 'Portfolio not found' }, { status: 404 });
    }

    let parseResults;
    try {
      parseResults = parseTransactionsCsvs(csvTexts);
    } catch (parseError) {
      return NextResponse.json(
        {
          success: false,
          error: parseError instanceof Error ? parseError.message : 'Failed to parse CSV',
        },
        { status: 400 }
      );
    }

    const { merged, results } = parseResults;
    const all: TransactionPayload[] = [...merged.equity, ...merged.cash];

    const providerCounts: Record<BrokerProvider, number> = { schwab: 0, fidelity: 0 };
    results.forEach(({ provider }) => {
      providerCounts[provider] += 1;
    });

    const existing = await getTransactions(portfolioId, null);
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
    } else {
      await recomputeAndWriteAggregates(portfolioId);
    }

    const updatedPortfolio = await getPortfolio(portfolioId);
    const positionTickers = (updatedPortfolio?.positions ?? [])
      .filter((p) => (Number(p.quantity) || 0) > 0.0001)
      .map((p) => p.ticker.toUpperCase());
    const missingPriceTickers = await getMissingPriceTickers(positionTickers);

    return NextResponse.json({
      success: true,
      data: {
        equityOk,
        cashOk,
        skipped,
        failed,
        filesProcessed: csvTexts.length,
        providers: providerCounts,
        missingPriceTickers,
      },
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
