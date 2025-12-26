import { NextResponse } from 'next/server';
import { getAllPortfolios, createPortfolio } from '../../lib/services/portfolioService';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId'); // For future multi-user support
    
    const portfolios = await getAllPortfolios(userId || undefined);
    
    return NextResponse.json({
      success: true,
      data: portfolios,
      count: portfolios.length,
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
    const { name, description, userId } = body;
    
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Portfolio name is required',
        },
        { status: 400 }
      );
    }
    
    const portfolioId = await createPortfolio({
      name: name.trim(),
      description: description?.trim() || '',
      userId: userId || undefined,
    });
    
    return NextResponse.json({
      success: true,
      data: { id: portfolioId, name: name.trim(), description: description?.trim() || '' },
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


