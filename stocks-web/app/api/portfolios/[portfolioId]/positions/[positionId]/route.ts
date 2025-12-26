import { NextResponse } from 'next/server';
import { 
  updatePosition,
  deletePosition,
  getPortfolio
} from '../../../../../lib/services/portfolioService';

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string; positionId: string }> }
) {
  try {
    const { portfolioId, positionId } = await params;
    const body = await request.json();
    const { ticker, quantity, purchaseDate, purchasePrice, thesisId, notes } = body;
    
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
      updates.ticker = ticker.trim().toUpperCase();
    }
    
    if (quantity !== undefined) {
      if (typeof quantity !== 'number' || quantity <= 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Quantity must be a positive number',
          },
          { status: 400 }
        );
      }
      updates.quantity = quantity;
    }
    
    if (purchaseDate !== undefined) {
      if (purchaseDate !== null && isNaN(Date.parse(purchaseDate))) {
        return NextResponse.json(
          {
            success: false,
            error: 'Invalid purchase date format',
          },
          { status: 400 }
        );
      }
      updates.purchaseDate = purchaseDate || null;
    }
    
    if (purchasePrice !== undefined) {
      if (purchasePrice !== null && (typeof purchasePrice !== 'number' || purchasePrice < 0)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Purchase price must be a non-negative number',
          },
          { status: 400 }
        );
      }
      updates.purchasePrice = purchasePrice || null;
    }
    
    if (thesisId !== undefined) {
      updates.thesisId = thesisId || null;
    }
    
    if (notes !== undefined) {
      updates.notes = notes || '';
    }
    
    await updatePosition(portfolioId, positionId, updates);
    
    const updatedPortfolio = await getPortfolio(portfolioId);
    
    return NextResponse.json({
      success: true,
      data: updatedPortfolio,
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
  { params }: { params: Promise<{ portfolioId: string; positionId: string }> }
) {
  try {
    const { portfolioId, positionId } = await params;
    await deletePosition(portfolioId, positionId);
    
    const updatedPortfolio = await getPortfolio(portfolioId);
    
    return NextResponse.json({
      success: true,
      message: 'Position deleted successfully',
      data: updatedPortfolio,
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

