import { NextRequest, NextResponse } from 'next/server';
import { firebaseService } from '../../../lib/firebaseService';

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

    console.log(`Company Summary API Request: ${ticker}`);

    // Get company summary data
    const summaryData = await firebaseService.getCompanySummary(ticker);

    if (!summaryData) {
      return NextResponse.json(
        { 
          error: 'Company summary not found',
          message: `No company summary found for ${ticker}. Run the company summary generator script first.`,
          suggestion: `python generate_company_summary.py ${ticker}`
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      ticker: ticker.toUpperCase(),
      data: summaryData
    });
    
  } catch (error) {
    console.error('Error in company summary API:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}


