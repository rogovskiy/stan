import { NextResponse } from 'next/server';
import {
  addWatchlistItem,
  getAllWatchlistItems,
  getWatchlistItem,
  isWatchlistStatus,
  upsertWatchlistItemWithYoutubeLink,
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
    const { ticker, notes, thesisId, targetPrice, status, youtubeVideoId } = body;

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

    const trimmedNotes = typeof notes === 'string' ? notes.trim() : '';
    const trimmedThesisId =
      typeof thesisId === 'string' && thesisId.trim() ? thesisId.trim() : undefined;
    const videoId =
      typeof youtubeVideoId === 'string' && youtubeVideoId.trim() ? youtubeVideoId.trim() : '';

    if (videoId) {
      const { id: itemId, action } = await upsertWatchlistItemWithYoutubeLink({
        userId: auth.uid,
        ticker: ticker.trim(),
        youtubeVideoId: videoId,
        notes: trimmedNotes,
        thesisId: trimmedThesisId,
        targetPrice: typeof targetPrice === 'number' ? targetPrice : undefined,
        status: resolvedStatus,
      });
      const item = await getWatchlistItem(itemId, auth.uid);
      if (!item) {
        return NextResponse.json({ success: false, error: 'Watchlist item not found' }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        data: {
          ...item,
          action,
        },
      });
    }

    const itemId = await addWatchlistItem({
      ticker: ticker.trim(),
      notes: trimmedNotes,
      thesisId: trimmedThesisId,
      targetPrice: typeof targetPrice === 'number' ? targetPrice : undefined,
      status: resolvedStatus,
      userId: auth.uid,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: itemId,
        ticker: ticker.trim().toUpperCase(),
        notes: trimmedNotes,
        thesisId: trimmedThesisId,
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
