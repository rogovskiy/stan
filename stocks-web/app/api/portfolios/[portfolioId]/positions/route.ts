import { NextResponse } from 'next/server';
import { 
  addPosition,
  updatePosition,
  deletePosition,
  getPortfolio
} from '../../../../lib/services/portfolioService';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    const body = await request.json();
    const { ticker, quantity, purchaseDate, purchasePrice, thesisId, notes } = body;
    
    if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Ticker is required',
        },
        { status: 400 }
      );
    }
    
    if (!quantity || typeof quantity !== 'number' || quantity <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Quantity must be a positive number',
        },
        { status: 400 }
      );
    }
    
    // Validate purchaseDate if provided
    if (purchaseDate && isNaN(Date.parse(purchaseDate))) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid purchase date format',
        },
        { status: 400 }
      );
    }
    
    // Validate purchasePrice if provided
    if (purchasePrice !== undefined && (typeof purchasePrice !== 'number' || purchasePrice < 0)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Purchase price must be a non-negative number',
        },
        { status: 400 }
      );
    }
    
    const positionId = await addPosition(portfolioId, {
      ticker: ticker.trim().toUpperCase(),
      quantity,
      purchaseDate: purchaseDate || undefined,
      purchasePrice: purchasePrice || undefined,
      thesisId: thesisId || undefined,
      notes: notes || '',
    });
    
    const updatedPortfolio = await getPortfolio(portfolioId);
    
    return NextResponse.json({
      success: true,
      data: {
        id: positionId,
        ticker: ticker.trim().toUpperCase(),
        quantity,
        purchaseDate: purchaseDate || undefined,
        purchasePrice: purchasePrice || undefined,
        thesisId: thesisId || undefined,
        notes: notes || '',
      },
      portfolio: updatedPortfolio,
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

