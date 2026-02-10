import { NextRequest, NextResponse } from 'next/server';
import {
  getTransaction,
  updateTransaction,
  deleteTransaction,
  getPortfolio,
} from '../../../../../lib/services/portfolioService';
import type { TransactionType } from '../../../../../lib/services/portfolioService';

const VALID_TYPES: TransactionType[] = ['buy', 'sell', 'dividend', 'dividend_reinvest', 'cash'];

function validateTransactionUpdates(body: Record<string, unknown>): { error?: string; data?: Record<string, unknown> } {
  const { type, ticker, date, quantity, price, amount, notes } = body;

  if (type !== undefined) {
    if (!VALID_TYPES.includes(type as TransactionType)) {
      return { error: `type must be one of: ${VALID_TYPES.join(', ')}` };
    }
  }
  const t = type as TransactionType | undefined;

  if (ticker !== undefined) {
    if (t === 'cash' && ticker != null && ticker !== '') {
      return { error: 'ticker must be null or empty for cash transactions' };
    }
    if (t !== 'cash' && t !== undefined && (ticker == null || typeof ticker !== 'string' || ticker.trim().length === 0)) {
      return { error: 'ticker is required for non-cash transactions' };
    }
  }

  if (date !== undefined && (typeof date !== 'string' || isNaN(Date.parse(date)))) {
    return { error: 'date must be a valid ISO date (YYYY-MM-DD)' };
  }

  if (quantity !== undefined) {
    if (typeof quantity !== 'number') return { error: 'quantity must be a number' };
    if (t === 'buy' || t === 'dividend_reinvest') {
      if (quantity <= 0) return { error: 'quantity must be positive for buy/dividend_reinvest' };
    }
    if (t === 'sell') {
      if (quantity >= 0) return { error: 'quantity must be negative for sell' };
    }
    if (t === 'dividend' || t === 'cash') {
      if (quantity !== 0) return { error: 'quantity must be 0 for dividend/cash' };
    }
  }

  if (price !== undefined && price !== null) {
    const priceVal = Number(price);
    if (isNaN(priceVal) || priceVal < 0) {
      return { error: 'price must be a non-negative number or null' };
    }
  }

  if (amount !== undefined) {
    const amountVal = Number(amount);
    if (typeof amountVal !== 'number' || isNaN(amountVal)) {
      return { error: 'amount must be a number' };
    }
  }

  const updates: Record<string, unknown> = {};
  if (type !== undefined) updates.type = type;
  if (ticker !== undefined) updates.ticker = t === 'cash' ? null : (ticker as string).trim().toUpperCase();
  if (date !== undefined) updates.date = (date as string).trim();
  if (quantity !== undefined) updates.quantity = quantity;
  if (price !== undefined) updates.price = price === null ? null : Number(price);
  if (amount !== undefined) updates.amount = Number(amount);
  if (notes !== undefined) updates.notes = String(notes);

  return { data: updates };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ portfolioId: string; transactionId: string }> }
) {
  try {
    const { portfolioId, transactionId } = await params;

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ success: false, error: 'Portfolio not found' }, { status: 404 });
    }

    const transaction = await getTransaction(portfolioId, transactionId);
    if (!transaction) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: transaction });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string; transactionId: string }> }
) {
  try {
    const { portfolioId, transactionId } = await params;
    const body = await request.json();

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ success: false, error: 'Portfolio not found' }, { status: 404 });
    }

    const existing = await getTransaction(portfolioId, transactionId);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 });
    }

    const validated = validateTransactionUpdates(body);
    if (validated.error) {
      return NextResponse.json({ success: false, error: validated.error }, { status: 400 });
    }
    const updates = validated.data!;
    if (Object.keys(updates).length === 0) {
      const updatedPortfolio = await getPortfolio(portfolioId);
      return NextResponse.json({ success: true, data: updatedPortfolio, portfolio: updatedPortfolio });
    }

    await updateTransaction(portfolioId, transactionId, updates as Parameters<typeof updateTransaction>[2]);
    const updatedPortfolio = await getPortfolio(portfolioId);
    return NextResponse.json({ success: true, data: updatedPortfolio, portfolio: updatedPortfolio });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ portfolioId: string; transactionId: string }> }
) {
  try {
    const { portfolioId, transactionId } = await params;

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ success: false, error: 'Portfolio not found' }, { status: 404 });
    }

    const existing = await getTransaction(portfolioId, transactionId);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'Transaction not found' }, { status: 404 });
    }

    await deleteTransaction(portfolioId, transactionId);
    const updatedPortfolio = await getPortfolio(portfolioId);
    return NextResponse.json({
      success: true,
      message: 'Transaction deleted successfully',
      data: updatedPortfolio,
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
