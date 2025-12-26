import { NextResponse } from 'next/server';
import { 
  getWatchlistItem,
  updateWatchlistItem,
  deleteWatchlistItem
} from '../../../lib/services/watchlistService';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  try {
    const { itemId } = await params;
    const item = await getWatchlistItem(itemId);
    
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
  try {
    const { itemId } = await params;
    const body = await request.json();
    const { ticker, notes, thesisId, targetPrice, priority } = body;
    
    const updates: any = {};
    
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
      updates.notes = notes || '';
    }
    
    if (thesisId !== undefined) {
      updates.thesisId = thesisId || null;
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
      updates.targetPrice = targetPrice || null;
    }
    
    if (priority !== undefined) {
      if (!['low', 'medium', 'high'].includes(priority)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Priority must be one of: low, medium, high',
          },
          { status: 400 }
        );
      }
      updates.priority = priority;
    }
    
    await updateWatchlistItem(itemId, updates);
    
    const updatedItem = await getWatchlistItem(itemId);
    
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
  try {
    const { itemId } = await params;
    await deleteWatchlistItem(itemId);
    
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


