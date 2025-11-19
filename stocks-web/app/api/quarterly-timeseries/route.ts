import { NextRequest, NextResponse } from 'next/server';
import { firebaseService } from '../../lib/firebaseService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const maxAgeHours = parseInt(searchParams.get('maxAge') || '24');

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker parameter is required' },
        { status: 400 }
      );
    }

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

    // Transform data for charting if needed
    const chartReadyData = {
      ticker: timeseriesData.ticker,
      metadata: timeseriesData.metadata,
      series: {
        eps: {
          name: 'Earnings Per Share',
          data: timeseriesData.eps.data.map((item: any) => ({
            x: `${item.year} ${item.quarter}`,
            y: item.value,
            quarter: item.quarter_key,
            date: item.period_end_date,
            estimated: item.estimated,
            source: item.data_source
          })),
          count: timeseriesData.eps.count,
          latest: timeseriesData.eps.latest_value,
          latestQuarter: timeseriesData.eps.latest_quarter
        },
        revenue: {
          name: 'Revenue',
          data: timeseriesData.revenue.data.map((item: any) => ({
            x: `${item.year} ${item.quarter}`,
            y: item.value,
            quarter: item.quarter_key,
            date: item.period_end_date,
            estimated: item.estimated,
            source: item.data_source
          })),
          count: timeseriesData.revenue.count,
          latest: timeseriesData.revenue.latest_value,
          latestQuarter: timeseriesData.revenue.latest_quarter
        },
        dividends: {
          name: 'Dividends Per Share',
          data: timeseriesData.dividends.data.map((item: any) => ({
            x: `${item.year} ${item.quarter}`,
            y: item.value,
            quarter: item.quarter_key,
            date: item.period_end_date,
            estimated: item.estimated,
            source: item.data_source
          })),
          count: timeseriesData.dividends.count,
          latest: timeseriesData.dividends.latest_value,
          latestQuarter: timeseriesData.dividends.latest_quarter
        }
      }
    };

    return NextResponse.json(chartReadyData);
  } catch (error) {
    console.error('Error fetching quarterly time series:', error);
    return NextResponse.json(
      { error: 'Failed to fetch quarterly time series data' },
      { status: 500 }
    );
  }
}