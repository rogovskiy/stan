import { NextResponse } from 'next/server';
import { 
  getPortfolio, 
  updatePortfolio, 
  deletePortfolio,
  addPosition,
  updatePosition,
  deletePosition
} from '../../../lib/services/portfolioService';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    const portfolio = await getPortfolio(portfolioId);
    
    if (!portfolio) {
      return NextResponse.json(
        {
          success: false,
          error: 'Portfolio not found',
        },
        { status: 404 }
      );
    }
    
    return NextResponse.json({
      success: true,
      data: portfolio,
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
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    const body = await request.json();
    const { name, description, accountType } = body;
    
    const updates: Record<string, unknown> = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        return NextResponse.json(
          {
            success: false,
            error: 'Portfolio name cannot be empty',
          },
          { status: 400 }
        );
      }
      updates.name = name.trim();
    }
    if (description !== undefined) {
      updates.description = description?.trim() || '';
    }
    if (accountType !== undefined) {
      if (accountType !== 'taxable' && accountType !== 'ira') {
        return NextResponse.json(
          { success: false, error: 'accountType must be taxable or ira' },
          { status: 400 }
        );
      }
      updates.accountType = accountType;
    }
    
    await updatePortfolio(portfolioId, updates);
    
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
  { params }: { params: Promise<{ portfolioId: string }> }
) {
  try {
    const { portfolioId } = await params;
    await deletePortfolio(portfolioId);
    
    return NextResponse.json({
      success: true,
      message: 'Portfolio deleted successfully',
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

