import { NextResponse } from 'next/server';
import { linkRawKPIToDefinition } from '../../../../lib/firebaseService';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const body = await request.json();
    const { rawKpi, definitionId, quarterKey } = body;
    
    if (!ticker || !rawKpi || !definitionId || !quarterKey) {
      return NextResponse.json(
        { success: false, error: 'Ticker, rawKpi, definitionId, and quarterKey are required' },
        { status: 400 }
      );
    }
    
    await linkRawKPIToDefinition(ticker, rawKpi, definitionId, quarterKey);
    
    return NextResponse.json({
      success: true,
      data: {
        definition_id: definitionId,
        linked: true
      }
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

