import { NextRequest, NextResponse } from 'next/server';
import { DataCache } from '../../lib/cache';
import { YFinanceService } from '../../lib/yfinance';

const cache = new DataCache('./cache');
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

    console.log(`API Request: ${ticker}, period: ${period}, refresh: ${forceRefresh}`);

    // Check cache first (unless force refresh is requested)
    if (!forceRefresh) {
      // Check for complete cached data (includes quarterly earnings)
      const cachedData = await cache.getCachedData(ticker, 'historical');
      if (cachedData) {
        console.log(`Returning cached data for ${ticker}`);
        return NextResponse.json(cachedData);
      }
    }

    console.log(`Fetching fresh data for ${ticker} from Yahoo Finance...`);

    let chartData;
    
    try {
      // Fetch real Yahoo Finance data with quarterly earnings and forecasts
      console.log(`Calling Yahoo Finance for ${ticker} with quarterly EPS data...`);
      chartData = await yfinanceService.fetchStockData(ticker, period);
      
      // Log the quarterly data points we got
      const quarterlyPoints = chartData.data.filter((d: any) => d.frequency === 'quarterly');
      const historicalEarnings = quarterlyPoints.filter((d: any) => !d.estimated);
      const forecastedEarnings = quarterlyPoints.filter((d: any) => d.estimated);
      
      console.log(`Retrieved data for ${ticker}:`);
      console.log(`- Historical quarterly earnings: ${historicalEarnings.length} points`);
      console.log(`- Forecasted quarterly earnings: ${forecastedEarnings.length} points`);
      console.log(`- Total daily price points: ${chartData.data.filter((d: any) => d.frequency === 'daily').length}`);
      
    } catch (error) {
      console.error(`Yahoo Finance failed for ${ticker}:`, error);
      return NextResponse.json(
        { error: `Unable to fetch data for ticker ${ticker}. Please try again.` },
        { status: 500 }
      );
    }

    // Cache the complete result (includes quarterly earnings data)
    await cache.setCachedData(ticker, chartData, 'historical');

    return NextResponse.json(chartData);
    
  } catch (error) {
    console.error('Error generating stock data:', error);
    
    const { searchParams } = new URL(request.url);
    const ticker = searchParams.get('ticker');
    
    return NextResponse.json(
      { error: `Unable to generate data for ticker ${ticker}. Please try again.` },
      { status: 500 }
    );
  }
}

// Optional: Add POST method to clear cache and get earnings summary
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');
    const ticker = searchParams.get('ticker');

    if (action === 'clear-cache') {
      await cache.clearCache(ticker || undefined);
      return NextResponse.json({ 
        message: ticker ? `Cache cleared for ${ticker}` : 'All cache cleared' 
      });
    }

    if (action === 'earnings-summary' && ticker) {
      // Get just the quarterly earnings data for a specific ticker
      try {
        const cachedData = await cache.getCachedData(ticker, 'historical');
        if (cachedData) {
          const quarterlyData = cachedData.data.filter((d: any) => d.frequency === 'quarterly');
          const historical = quarterlyData.filter((d: any) => !d.estimated);
          const forecasted = quarterlyData.filter((d: any) => d.estimated);
          
          return NextResponse.json({
            ticker: ticker.toUpperCase(),
            quarterlyEarnings: {
              historical: historical.map((d: any) => ({
                date: d.date,
                quarter: d.fyDate,
                eps: d.eps,
                fairValue: d.fairValue,
                estimated: false
              })),
              forecasted: forecasted.map((d: any) => ({
                date: d.date,
                quarter: d.fyDate,
                eps: d.eps,
                fairValue: d.fairValue,
                estimated: true
              }))
            }
          });
        } else {
          return NextResponse.json(
            { error: `No cached data found for ${ticker}. Fetch the data first.` },
            { status: 404 }
          );
        }
      } catch (error) {
        console.error('Error getting earnings summary:', error);
        return NextResponse.json(
          { error: 'Failed to get earnings summary' },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Invalid action. Use "clear-cache" or "earnings-summary"' },
      { status: 400 }
    );
    
  } catch (error) {
    console.error('Error in POST request:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}