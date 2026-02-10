import { NextRequest, NextResponse } from 'next/server';
import { getTransactions, addTransaction, getPortfolio } from '../../../../lib/services/portfolioService';
import type { TransactionType } from '../../../../lib/services/portfolioService';

const VALID_TYPES: TransactionType[] = ['buy', 'sell', 'dividend', 'dividend_reinvest', 'cash'];

function validateTransactionBody(body: Record<string, unknown>): { error?: string; data?: Record<string, unknown> } {
  const { type, ticker, date, quantity, price, amount, notes } = body;

  if (!type || !VALID_TYPES.includes(type as TransactionType)) {
    return { error: `type is required and must be one of: ${VALID_TYPES.join(', ')}` };
  }
  const t = type as TransactionType;

  if (t !== 'cash' && (ticker == null || typeof ticker !== 'string' || ticker.trim().length === 0)) {
    return { error: 'ticker is required for non-cash transactions' };
  }
  if (t === 'cash' && ticker != null && ticker !== '') {
    return { error: 'ticker must be null or empty for cash transactions' };
  }

  if (!date || typeof date !== 'string' || isNaN(Date.parse(date))) {
    return { error: 'date is required and must be a valid ISO date (YYYY-MM-DD)' };
  }

  if (typeof quantity !== 'number') {
    return { error: 'quantity must be a number' };
  }
  if (t === 'buy' || t === 'dividend_reinvest') {
    if (quantity <= 0) return { error: 'quantity must be positive for buy/dividend_reinvest' };
  }
  if (t === 'sell') {
    if (quantity >= 0) return { error: 'quantity must be negative for sell' };
  }
  if (t === 'dividend' || t === 'cash') {
    if (quantity !== 0) return { error: 'quantity must be 0 for dividend/cash' };
  }

  const priceVal = price != null ? Number(price) : null;
  if (price != null && (typeof price !== 'number' && typeof price !== 'string')) {
    return { error: 'price must be a number or null' };
  }
  if (priceVal != null && (isNaN(priceVal) || priceVal < 0)) {
    return { error: 'price must be a non-negative number or null' };
  }

  const amountVal = amount != null ? Number(amount) : null;
  if (amount == null || typeof amountVal !== 'number' || isNaN(amountVal)) {
    return { error: 'amount is required and must be a number' };
  }

  const notesStr = notes != null ? String(notes) : '';

  const tickerNorm = t === 'cash' ? null : (ticker as string).trim().toUpperCase();
  return {
    data: {
      type: t,
      ticker: tickerNorm,
      date: (date as string).trim(),
      quantity,
      price: priceVal,
      amount: amountVal,
      notes: notesStr,
    },
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker') ?? undefined;

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ success: false, error: 'Portfolio not found' }, { status: 404 });
    }

    const transactions = await getTransactions(portfolioId, ticker || null);
    return NextResponse.json({ success: true, data: transactions });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    const body = await request.json();
    const validated = validateTransactionBody(body);
    if (validated.error) {
      return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
    }
    const data = validated.data!;

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ success: false, error: 'Portfolio not found' }, { status: 404 });
    }

    const transactionId = await addTransaction(portfolioId, {
      type: data.type as TransactionType,
      ticker: data.ticker as string | null,
      date: data.date as string,
      quantity: data.quantity as number,
      price: data.price as number | null,
      amount: data.amount as number,
      notes: data.notes as string,
    });

    const updatedPortfolio = await getPortfolio(portfolioId);
    return NextResponse.json({
      success: true,
      data: { id: transactionId, ...data },
      portfolio: updatedPortfolio,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
