import { NextResponse } from 'next/server';
import { getAllWatchlistItems, addWatchlistItem } from '../../lib/services/watchlistService';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId'); // For future multi-user support
    
    const items = await getAllWatchlistItems(userId || undefined);
    
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
  try {
    const body = await request.json();
    const { ticker, notes, thesisId, targetPrice, priority, userId } = body;
    
    if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Ticker is required',
        },
        { status: 400 }
      );
    }
    
    // Validate targetPrice if provided
    if (targetPrice !== undefined && (typeof targetPrice !== 'number' || targetPrice < 0)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Target price must be a non-negative number',
        },
        { status: 400 }
      );
    }
    
    // Validate priority if provided
    if (priority && !['low', 'medium', 'high'].includes(priority)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Priority must be one of: low, medium, high',
        },
        { status: 400 }
      );
    }
    
    const itemId = await addWatchlistItem({
      ticker: ticker.trim(),
      notes: notes?.trim() || '',
      thesisId: thesisId || undefined,
      targetPrice: targetPrice || undefined,
      priority: priority || 'medium',
      userId: userId || undefined,
    });
    
    return NextResponse.json({
      success: true,
      data: { 
        id: itemId, 
        ticker: ticker.trim().toUpperCase(), 
        notes: notes?.trim() || '',
        thesisId: thesisId || undefined,
        targetPrice: targetPrice || undefined,
        priority: priority || 'medium',
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


