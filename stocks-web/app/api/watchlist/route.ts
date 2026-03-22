import { NextResponse } from 'next/server';
import {
  addWatchlistItem,
  getAllWatchlistItems,
  isWatchlistStatus,
  type WatchlistStatus,
} from '../../lib/services/watchlistService';
import { requireUidFromRequest } from '../../lib/requireAuth';

export async function GET(request: Request) {
  const auth = await requireUidFromRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const items = await getAllWatchlistItems(auth.uid);
    return NextResponse.json({
      success: true,
      data: items,
      count: items.length,
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

export async function POST(request: Request) {
  const auth = await requireUidFromRequest(request);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { ticker, notes, thesisId, targetPrice, status } = body;

    if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Ticker is required',
        },
        { status: 400 }
      );
    }

    if (targetPrice !== undefined && targetPrice !== null) {
      if (typeof targetPrice !== 'number' || targetPrice < 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Target price must be a non-negative number',
          },
          { status: 400 }
        );
      }
    }

    let resolvedStatus: WatchlistStatus = 'thesis_needed';
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
      resolvedStatus = status;
    }

    const itemId = await addWatchlistItem({
      ticker: ticker.trim(),
      notes: typeof notes === 'string' ? notes.trim() : '',
      thesisId: typeof thesisId === 'string' && thesisId.trim() ? thesisId.trim() : undefined,
      targetPrice: typeof targetPrice === 'number' ? targetPrice : undefined,
      status: resolvedStatus,
      userId: auth.uid,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: itemId,
        ticker: ticker.trim().toUpperCase(),
        notes: typeof notes === 'string' ? notes.trim() : '',
        thesisId: typeof thesisId === 'string' && thesisId.trim() ? thesisId.trim() : undefined,
        targetPrice: typeof targetPrice === 'number' ? targetPrice : undefined,
        status: resolvedStatus,
      },
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
