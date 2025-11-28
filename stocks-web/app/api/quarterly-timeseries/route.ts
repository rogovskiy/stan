import { NextRequest, NextResponse } from 'next/server';
import { firebaseService } from '../../lib/firebaseService';
import { QuarterlyDataResponse, QuarterlyDataPoint } from '../../types/api';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const maxAgeHours = parseInt(searchParams.get('maxAge') || '24');
    const period = searchParams.get('period') || '5y'; // Add period parameter

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker parameter is required' },
        { status: 400 }
      );
    }

    console.log(`Quarterly API Request: ${ticker}, period: ${period}, maxAge: ${maxAgeHours}`);

    // Try to get cached quarterly time series data
    const timeseriesData = await firebaseService.getQuarterlyTimeseries(ticker, maxAgeHours);

    if (!timeseriesData) {
      return NextResponse.json(
        { 
          error: 'Quarterly time series data not found',
          message: `No time series data found for ${ticker}. Run the quarterly time series generator script first.`,
          suggestion: `python generate_quarterly_timeseries.py ${ticker}`
        },
        { status: 404 }
      );
    }

    // Transform data to our new quarterly format
    const quarterlyDataPoints: QuarterlyDataPoint[] = [];
    
    // Calculate date range based on period
    const endDate = new Date();
    let startDate = new Date();
    
    const normalizedPeriod = period.toLowerCase();
    
    switch (normalizedPeriod) {
      case '6m':
        startDate.setMonth(endDate.getMonth() - 6);
        break;
      case '1y':
        startDate.setFullYear(endDate.getFullYear() - 1);
        break;
      case '2y':
        startDate.setFullYear(endDate.getFullYear() - 2);
        break;
      case '3y':
        startDate.setFullYear(endDate.getFullYear() - 3);
        break;
      case '4y':
        startDate.setFullYear(endDate.getFullYear() - 4);
        break;
      case '5y':
        startDate.setFullYear(endDate.getFullYear() - 5);
        break;
      case '6y':
        startDate.setFullYear(endDate.getFullYear() - 6);
        break;
      case '7y':
        startDate.setFullYear(endDate.getFullYear() - 7);
        break;
      case '8y':
        startDate.setFullYear(endDate.getFullYear() - 8);
        break;
      case '9y':
        startDate.setFullYear(endDate.getFullYear() - 9);
        break;
      case '10y':
        startDate.setFullYear(endDate.getFullYear() - 10);
        break;
      case 'max':
        startDate.setFullYear(endDate.getFullYear() - 50);
        break;
      default:
        startDate.setFullYear(endDate.getFullYear() - 5);
    }

    console.log(`Filtering quarterly data from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    if (Array.isArray(timeseriesData) && timeseriesData.length > 0) {
      console.log(`Sample data point keys: ${Object.keys(timeseriesData[0]).join(', ')}`);
    }

    // Handle new format: timeseriesData is an array with all metrics combined
    // Check if it's the new format (array) or old format (object with eps.data)
    let dataToProcess: any[] = [];

    if (timeseriesData.data && Array.isArray(timeseriesData.data)) {
      // Alternative format: data property contains array
      dataToProcess = normalizedPeriod === 'max'
        ? timeseriesData.data
        : timeseriesData.data.filter((item: any) => {
            const itemDate = new Date(item.date || item.period_end_date);
            return itemDate >= startDate && itemDate <= endDate;
          });
    }
    // sort by date 
    dataToProcess.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    // Process each data point
    dataToProcess.forEach((item: any, index: number) => {
      const eps = item.eps;
      
      // Extract date fields - handle different property names
      const date = item.date || item.period_end_date;
      const year = item.year || new Date(date).getFullYear();
      const quarter = item.quarter || `Q${item.fiscal_quarter || 1}`;
      
      // Extract dividend_per_share if available (new format)
      const dividendPerShare = item.dividend_per_share;
      
      let currentPE = item.normalPE || item.pe_ratio || 18.0;
      
      // sum of last 4 quarters before the current item
      const annualEps = dataToProcess.slice(Math.max(0, index - 4), index).reduce((sum, item) => sum + item.eps, 0);
      const fairValue = annualEps * currentPE;
      
      // Calculate dividendsPOR (Payout Ratio) from dividend_per_share if available
      const dividendsPOR = dataToProcess.slice(Math.max(0, index - 4), index).reduce((sum, item) => sum + item.dividend_per_share, 0);
      quarterlyDataPoints.push({
        date: date,
        fyDate: date,
        year: year,
        quarter: quarter,
        eps: eps,
        normalPE: Math.round(currentPE * 100) / 100,
        fairValue: fairValue ? Math.round(fairValue * 100) / 100 : undefined,
        dividendsPOR: Math.round(dividendsPOR * 100) / 100,
        estimated: item.estimated || false
      });
    });
    
    // Extract ticker symbol - handle both old and new format
    const tickerSymbol = Array.isArray(timeseriesData) 
      ? (timeseriesData[0]?.ticker || ticker.toUpperCase())
      : (timeseriesData.ticker || timeseriesData.metadata?.ticker || ticker.toUpperCase());
    
    // Extract metadata - handle both old and new format
    const metadata = Array.isArray(timeseriesData)
      ? { updated_at: new Date().toISOString() }
      : (timeseriesData.metadata || { updated_at: new Date().toISOString() });
    
    const response: QuarterlyDataResponse = {
      symbol: tickerSymbol,
      data: quarterlyDataPoints,
      metadata: {
        lastUpdated: metadata.updated_at || metadata.generated_at || new Date().toISOString(),
        dataRange: {
          start: quarterlyDataPoints.length > 0 ? quarterlyDataPoints[0].date : '',
          end: quarterlyDataPoints.length > 0 ? quarterlyDataPoints[quarterlyDataPoints.length - 1].date : ''
        }
      }
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching quarterly time series:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quarterly time series data' },
      { status: 500 }
    );
  }
}