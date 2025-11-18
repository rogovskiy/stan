import { NextRequest, NextResponse } from 'next/server';
import { FirebaseCache } from '../../lib/cache';
import { YFinanceService } from '../../lib/yfinance';

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

    console.log(`API Request: ${ticker}, period: ${period}, refresh: ${forceRefresh}`);

    // Clear cache if force refresh is requested
    if (forceRefresh) {
      console.log(`Force refresh requested - clearing cache for ${ticker}`);
      await cache.clearCache(ticker);
    }

    console.log(`Fetching data for ${ticker} from Yahoo Finance with Firebase cache...`);

    let chartData;
    
    try {
      // This will automatically check Firebase cache first and only fetch missing data
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
        message: ticker ? `Cache cleared for ${ticker}` : 'Please specify a ticker to clear cache' 
      });
    }

    if (action === 'cache-status' && ticker) {
      // Check cache status for a ticker
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - 5); // 5 year default
        
        const cacheStatus = await cache.hasCachedDataForRange(ticker, startDate, endDate);
        const metadata = await cache.getTickerMetadata(ticker);
        
        return NextResponse.json({
          ticker: ticker.toUpperCase(),
          metadata: metadata,
          cacheStatus: cacheStatus,
          dateRange: {
            start: startDate.toISOString().split('T')[0],
            end: endDate.toISOString().split('T')[0]
          }
        });
      } catch (error) {
        console.error('Error getting cache status:', error);
        return NextResponse.json(
          { error: 'Failed to get cache status' },
          { status: 500 }
        );
      }
    }

    if (action === 'earnings-summary' && ticker) {
      // Get quarterly financial data for a specific ticker
      try {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setFullYear(endDate.getFullYear() - 5);
        
        const financialData = await cache.getFinancialDataRange(ticker, startDate, endDate);
        
        if (financialData.length > 0) {
          const historical = financialData.filter(q => new Date(q.endDate) <= new Date());
          const forecasted = financialData.filter(q => new Date(q.endDate) > new Date());
          
          return NextResponse.json({
            ticker: ticker.toUpperCase(),
            quarterlyEarnings: {
              historical: historical.map(q => ({
                quarterKey: `${q.fiscalYear}Q${q.fiscalQuarter}`,
                date: q.endDate,
                quarter: `Q${q.fiscalQuarter}/${String(q.fiscalYear).slice(-2)}`,
                eps: q.financials?.epsDiluted || 0,
                revenue: q.financials?.revenue,
                estimated: false
              })),
              forecasted: forecasted.map(q => ({
                quarterKey: `${q.fiscalYear}Q${q.fiscalQuarter}`,
                date: q.endDate,
                quarter: `Q${q.fiscalQuarter}/${String(q.fiscalYear).slice(-2)}`,
                eps: q.financials?.epsDiluted || 0,
                revenue: q.financials?.revenue,
                estimated: true
              }))
            }
          });
        } else {
          return NextResponse.json(
            { error: `No financial data found for ${ticker} in Firebase cache. Fetch the data first.` },
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
      { error: 'Invalid action. Use "clear-cache", "cache-status", or "earnings-summary"' },
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