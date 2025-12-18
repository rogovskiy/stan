import { NextResponse } from 'next/server';
import { getKPIDefinitions } from '../../../lib/firebaseService';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'Ticker is required' },
        { status: 400 }
      );
    }
    
    const definitions = await getKPIDefinitions(ticker);
    
    return NextResponse.json({
      success: true,
      data: definitions,
      count: definitions.length
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

