import { NextResponse } from 'next/server';
import { getRawKPIs, getAllRawKPIs } from '../../../lib/services/rawKpiService';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const { searchParams } = new URL(request.url);
    const quarterKey = searchParams.get('quarter');
    
    if (!ticker) {
      return NextResponse.json(
        { success: false, error: 'Ticker is required' },
        { status: 400 }
      );
    }
    
    if (quarterKey) {
      // Get specific quarter
      const rawKpis = await getRawKPIs(ticker, quarterKey);
      
      if (!rawKpis) {
        return NextResponse.json(
          { success: false, error: 'Raw KPIs not found for this quarter' },
          { status: 404 }
        );
      }
      
      return NextResponse.json({
        success: true,
        data: rawKpis
      });
    } else {
      // Get all quarters
      const allRawKpis = await getAllRawKPIs(ticker);
      
      return NextResponse.json({
        success: true,
        data: allRawKpis,
        count: allRawKpis.length
      });
    }
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

