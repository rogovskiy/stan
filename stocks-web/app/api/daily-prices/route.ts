import { NextRequest, NextResponse } from 'next/server';
import { FirebaseCache } from '../../lib/cache';
import { YFinanceService } from '../../lib/yfinance';
import { DailyPriceResponse } from '../../types/api';

const cache = new FirebaseCache();
const yfinanceService = new YFinanceService();

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    const period = searchParams.get('period') || '5y';
    const forceRefresh = searchParams.get('refresh') === 'true';

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker symbol is required' },
        { status: 400 }
      );
    }

    console.log(`Daily Prices API Request: ${ticker}, period: ${period}, refresh: ${forceRefresh}`);

    // Clear cache if force refresh is requested
    if (forceRefresh) {
      console.log(`Force refresh requested - clearing cache for ${ticker}`);
      await cache.clearCache(ticker);
    }

    console.log(`Fetching daily price data for ${ticker} from Yahoo Finance...`);

    try {
      // Fetch the full data and extract only daily prices
      const fullData = await yfinanceService.fetchStockData(ticker, period);
      
      // Filter to get only daily price data
      const dailyPriceData = fullData.data
        .filter((d: any) => d.frequency === 'daily' && d.price !== undefined)
        .map((d: any) => ({
          date: d.date,
          fyDate: d.fyDate,
          year: d.year,
          price: d.price,
          estimated: d.estimated
        }));
      
      console.log(`Retrieved ${dailyPriceData.length} daily price points for ${ticker}`);
      
      const response: DailyPriceResponse = {
        symbol: fullData.symbol,
        companyName: fullData.companyName,
        currency: fullData.currency,
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
      console.error(`Daily price fetch failed for ${ticker}:`, error);
      return NextResponse.json(
        { error: 'Failed to fetch daily price data', details: error instanceof Error ? error.message : 'Unknown error' },
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