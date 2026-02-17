import { NextResponse } from 'next/server';
import { 
  updatePosition,
  deletePosition,
  getPortfolio,
  type Position
} from '../../../../../lib/services/portfolioService';

/**
 * PUT position: metadata only (thesisId, notes, bandId). Quantity and cost come from transactions via recomputeAndWriteAggregates.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string; positionId: string }> }
) {
  try {
    const { portfolioId, positionId } = await params;
    const body = await request.json();
    const { thesisId, notes, bandId } = body;

    const updates: Partial<Position> = {};
    if (thesisId !== undefined) {
      updates.thesisId = thesisId === null || thesisId === '' ? undefined : String(thesisId);
    }
    if (notes !== undefined) {
      updates.notes = typeof notes === 'string' ? notes : '';
    }
    if (bandId !== undefined) {
      updates.bandId = bandId === null || bandId === '' ? undefined : String(bandId);
    }

    if (Object.keys(updates).length === 0) {
      const updatedPortfolio = await getPortfolio(portfolioId);
      return NextResponse.json({ success: true, data: updatedPortfolio });
    }

    await updatePosition(portfolioId, positionId, updates);
    const updatedPortfolio = await getPortfolio(portfolioId);
    return NextResponse.json({ success: true, data: updatedPortfolio });
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

