import { NextRequest, NextResponse } from 'next/server';
import { firebaseService } from '../../../../lib/firebaseService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker parameter is required' },
        { status: 400 }
      );
    }

    console.log(`KPI Timeseries API Request: ${ticker}`);

    // Try to get cached KPI timeseries data
    const kpiData = await firebaseService.getKPITimeseries(ticker);

    if (!kpiData) {
      return NextResponse.json(
        { 
          error: 'KPI timeseries data not found',
          message: `No KPI timeseries data found for ${ticker}. Run the KPI extraction script first.`,
          suggestion: `python extract_kpis.py ${ticker}`
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      symbol: ticker.toUpperCase(),
      ...kpiData
    });
  } catch (error) {
    console.error('Error fetching KPI timeseries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch KPI timeseries data' },
      { status: 500 }
    );
  }
}
