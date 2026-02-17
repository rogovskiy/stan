import { NextResponse } from 'next/server';
import { getTransactions } from '../../../../lib/services/portfolioService';
import { buildOpenLots } from '../../../../lib/taxEstimator';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');

    if (!portfolioId) {
      return NextResponse.json(
        { success: false, error: 'Portfolio ID is required' },
        { status: 400 }
      );
    }
    if (!ticker || !ticker.trim()) {
      return NextResponse.json(
        { success: false, error: 'ticker query is required' },
        { status: 400 }
      );
    }

    const transactions = await getTransactions(portfolioId, null);
    const lots = buildOpenLots(transactions, ticker.trim());

    return NextResponse.json({ success: true, data: { lots } });
  } catch (err) {
    console.error('Lots API error:', err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to get lots',
      },
      { status: 500 }
    );
  }
}
