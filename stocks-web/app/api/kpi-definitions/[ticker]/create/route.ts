import { NextResponse } from 'next/server';
import { createKPIDefinition } from '../../../../lib/firebaseService';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const body = await request.json();
    const { rawKpi, quarterKey } = body;
    
    if (!ticker || !rawKpi || !quarterKey) {
      return NextResponse.json(
        { success: false, error: 'Ticker, rawKpi, and quarterKey are required' },
        { status: 400 }
      );
    }
    
    const result = await createKPIDefinition(ticker, rawKpi, quarterKey);
    
    return NextResponse.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}

