import { NextResponse } from 'next/server';
import { getPortfolio, recomputeAndWriteAggregates } from '../../../../lib/services/portfolioService';

/**
 * POST /api/portfolios/[portfolioId]/recompute
 * Recalculates snapshots and positions from transactions.
 * Call this after bulk-importing transactions or if snapshots seem stale.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    if (!portfolioId) {
      return NextResponse.json({ error: 'Portfolio ID is required' }, { status: 400 });
    }

    const portfolio = await getPortfolio(portfolioId);
    if (!portfolio) {
      return NextResponse.json({ error: 'Portfolio not found' }, { status: 404 });
    }

    await recomputeAndWriteAggregates(portfolioId);
    return NextResponse.json({ success: true, message: 'Snapshots recalculated.' });
  } catch (error) {
    console.error('Recompute error:', error);
    return NextResponse.json(
      {
        error: 'Failed to recalculate snapshots',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
