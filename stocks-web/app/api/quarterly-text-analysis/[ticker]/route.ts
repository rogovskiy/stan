import { NextResponse } from 'next/server';
import { getQuarterlyTextAnalysis } from '../../../lib/firebaseService';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const { searchParams } = new URL(request.url);
    const quarterKey = searchParams.get('quarterKey') || undefined;

    if (!ticker) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Ticker is required' 
        }, 
        { status: 400 }
      );
    }

    const analysis = await getQuarterlyTextAnalysis(ticker, quarterKey);

    if (!analysis) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Quarterly text analysis not found' 
        }, 
        { status: 404 }
      );
    }

    return NextResponse.json({ 
      success: true, 
      data: analysis
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

