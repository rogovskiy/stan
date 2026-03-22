import { NextResponse } from 'next/server';
import {
  deleteWatchlistItem,
  getWatchlistItem,
  isWatchlistStatus,
  updateWatchlistItem,
  type WatchlistItemUpdates,
  type WatchlistStatus,
} from '../../../lib/services/watchlistService';
import { requireUidFromRequest } from '../../../lib/requireAuth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await requireUidFromRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const { itemId } = await params;
    const item = await getWatchlistItem(itemId, auth.uid);

    if (!item) {
      return NextResponse.json(
        {
          success: false,
          error: 'Watchlist item not found',
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: item,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await requireUidFromRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const { itemId } = await params;
    const body = await request.json();
    const { ticker, notes, thesisId, targetPrice, status } = body;

    const updates: WatchlistItemUpdates = {};

    if (ticker !== undefined) {
      if (typeof ticker !== 'string' || ticker.trim().length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Ticker cannot be empty',
          },
          { status: 400 }
        );
      }
      updates.ticker = ticker.trim();
    }

    if (notes !== undefined) {
      updates.notes = typeof notes === 'string' ? notes : '';
    }

    if (thesisId !== undefined) {
      updates.thesisId =
        thesisId === null || thesisId === '' ? null : String(thesisId);
    }

    if (targetPrice !== undefined) {
      if (targetPrice !== null && (typeof targetPrice !== 'number' || targetPrice < 0)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Target price must be a non-negative number',
          },
          { status: 400 }
        );
      }
      updates.targetPrice = targetPrice === null ? null : targetPrice;
    }

    if (status !== undefined && status !== null && status !== '') {
      if (!isWatchlistStatus(status)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid status',
          },
          { status: 400 }
        );
      }
      updates.status = status;
    }

    try {
      await updateWatchlistItem(itemId, auth.uid, updates);
    } catch (e) {
      if (e instanceof Error && e.message === 'Watchlist item not found') {
        return NextResponse.json(
          { success: false, error: 'Watchlist item not found' },
          { status: 404 }
        );
      }
      throw e;
    }

    const updatedItem = await getWatchlistItem(itemId, auth.uid);

    return NextResponse.json({
      success: true,
      data: updatedItem,
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await requireUidFromRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const { itemId } = await params;
    try {
      await deleteWatchlistItem(itemId, auth.uid);
    } catch (e) {
      if (e instanceof Error && e.message === 'Watchlist item not found') {
        return NextResponse.json(
          { success: false, error: 'Watchlist item not found' },
          { status: 404 }
        );
      }
      throw e;
    }

    return NextResponse.json({
      success: true,
      message: 'Watchlist item deleted successfully',
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error',
      },
      { status: 500 }
    );
  }
}
