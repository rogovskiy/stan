import { NextRequest, NextResponse } from 'next/server';
import { getAnalystData } from '../../../lib/services/analystDataService';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker parameter is required' },
        { status: 400 }
      );
    }

    console.log(`Analyst API Request: ${ticker}`);

    // Get latest consolidated analyst data
    const analystData = await getAnalystData(ticker);

    if (!analystData) {
      return NextResponse.json(
        { 
          error: 'Analyst data not found',
          message: `No analyst data found for ${ticker}. Run the analyst data fetcher script first.`,
          suggestion: `python fetch_analyst_data.py ${ticker}`
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      ticker: ticker.toUpperCase(),
      data: analystData,
      fetched_at: analystData.fetched_at || null
    });
    
  } catch (error) {
    console.error('Error in analyst API:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}





