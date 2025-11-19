import { NextRequest, NextResponse } from 'next/server';
import { FirebaseCache } from '../../lib/cache';
import { DailyPriceResponse } from '../../types/api';

const cache = new FirebaseCache();

// Helper function to calculate date range based on period
function getPeriodDateRange(period: string): { startDate: Date; endDate: Date } {
  const endDate = new Date();
  const startDate = new Date();
  
  const normalizedPeriod = period.toLowerCase();
  
  switch (normalizedPeriod) {
    case '6m': startDate.setMonth(endDate.getMonth() - 6); break;
    case '1y': startDate.setFullYear(endDate.getFullYear() - 1); break;
    case '2y': startDate.setFullYear(endDate.getFullYear() - 2); break;
    case '3y': startDate.setFullYear(endDate.getFullYear() - 3); break;
    case '4y': startDate.setFullYear(endDate.getFullYear() - 4); break;
    case '5y': startDate.setFullYear(endDate.getFullYear() - 5); break;
    case '6y': startDate.setFullYear(endDate.getFullYear() - 6); break;
    case '7y': startDate.setFullYear(endDate.getFullYear() - 7); break;
    case '8y': startDate.setFullYear(endDate.getFullYear() - 8); break;
    case '9y': startDate.setFullYear(endDate.getFullYear() - 9); break;
    case '10y': startDate.setFullYear(endDate.getFullYear() - 10); break;
    case 'max': startDate.setFullYear(endDate.getFullYear() - 50); break; // Max available data
    default: startDate.setFullYear(endDate.getFullYear() - 5);
  }
  
  return { startDate, endDate };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const period = searchParams.get('period') || '5y';

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker symbol is required' },
        { status: 400 }
      );
    }

    console.log(`Daily Prices API Request: ${ticker}, period: ${period} - using cached data only`);

    try {
      // Get ticker metadata from cache
      const metadata = await cache.getTickerMetadata(ticker);
      if (!metadata) {
        return NextResponse.json(
          { error: `No cached data found for ticker ${ticker}. Please run data fetcher first.` },
          { status: 404 }
        );
      }

      // Calculate date range based on period
      const { startDate, endDate } = getPeriodDateRange(period);
      
      console.log(`Fetching cached price data for ${ticker} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);

      // Get cached price data for the specified date range
      const priceData = await cache.getPriceDataRange(ticker, startDate, endDate);
      console.log(`Received ${Object.keys(priceData).length} cached price data points`);
      
      // Transform cached data to match API format
      const dailyPriceData = Object.entries(priceData)
        .map(([date, data]: [string, any]) => ({
          date: date,
          fyDate: date, // Use same date for fiscal year date
          year: new Date(date).getFullYear(),
          price: data.c, // Close price
          estimated: false // Cached data is real, not estimated
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); // Sort by date ascending
      
      console.log(`Retrieved ${dailyPriceData.length} cached daily price points for ${ticker}`);
      
      const response: DailyPriceResponse = {
        symbol: ticker.toUpperCase(),
        companyName: metadata.name,
        currency: 'USD', // Default to USD since currency not stored in metadata
        data: dailyPriceData,
        metadata: {
          lastUpdated: new Date().toISOString(),
          dataRange: {
            start: dailyPriceData.length > 0 ? dailyPriceData[0].date : '',
            end: dailyPriceData.length > 0 ? dailyPriceData[dailyPriceData.length - 1].date : ''
          }
        }
      };

      return NextResponse.json(response);
      
    } catch (error) {
      console.error(`Failed to fetch cached daily price data for ${ticker}:`, error);
      return NextResponse.json(
        { error: 'Failed to fetch cached daily price data', details: error instanceof Error ? error.message : 'Unknown error' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Unexpected error in daily prices API:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}