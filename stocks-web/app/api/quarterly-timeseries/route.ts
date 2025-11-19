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
    const cacheKey = `${ticker.toUpperCase()}_quarterly_timeseries`;
    const timeseriesData = await firebaseService.getCustomData(cacheKey, maxAgeHours);

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

    // Process EPS data and calculate additional metrics
    // For 'max' period, don't filter by date - return all available data
    if (timeseriesData.eps && timeseriesData.eps.data) {
      const dataToProcess = normalizedPeriod === 'max' 
        ? timeseriesData.eps.data
        : timeseriesData.eps.data.filter((item: any) => {
            const itemDate = new Date(item.period_end_date);
            return itemDate >= startDate && itemDate <= endDate;
          });
          
      dataToProcess.forEach((item: any) => {
          // Calculate metrics similar to the original YFinance service
          const currentPE = 15 + Math.random() * 20; // Generate PE between 15-35
          const eps = item.value || 0;
          const fairValue = eps * currentPE;
          const dividendsPOR = Math.random() * 15 + 10; // Random value between 10-25
          
          quarterlyDataPoints.push({
            date: item.period_end_date,
            fyDate: item.period_end_date,
            year: item.year,
            quarter: item.quarter,
            eps: eps,
            normalPE: Math.round(currentPE * 100) / 100,
            fairValue: Math.round(fairValue * 100) / 100,
            dividendsPOR: Math.round(dividendsPOR * 100) / 100,
            estimated: item.estimated
          });
        });
    }
    
    // TODO: Merge in other quarterly data (revenue, dividends, etc.) if available
    
    const response: QuarterlyDataResponse = {
      symbol: timeseriesData.ticker,
      data: quarterlyDataPoints,
      metadata: {
        lastUpdated: timeseriesData.metadata?.updated_at || new Date().toISOString(),
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