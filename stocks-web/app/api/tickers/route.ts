import { NextResponse } from 'next/server';
import { getAllTickers, getTickerMetadata } from '../../lib/services/tickerMetadataService';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');
  const getAllTickersParam = searchParams.get('getAllTickers');
  
  try {
    // If a specific ticker is requested, return just that ticker's metadata
    if (ticker) {
      const metadata = await getTickerMetadata(ticker);
      if (metadata) {
        return NextResponse.json({ 
          success: true, 
          data: {
            symbol: ticker.toUpperCase(),
            name: metadata.name,
            sector: metadata.sector,
            exchange: metadata.exchange,
            // Include all additional company information fields for future display
            industry: metadata.industry,
            longBusinessSummary: metadata.longBusinessSummary,
            fiscalYearEndMonth: metadata.fiscalYearEndMonth,
            fiscalYearEndDate: metadata.fiscalYearEndDate,
            lastFiscalYearEnd: metadata.lastFiscalYearEnd,
            longName: metadata.longName,
            shortName: metadata.shortName,
            country: metadata.country,
            website: metadata.website,
            fullTimeEmployees: metadata.fullTimeEmployees,
            source: metadata.source,
            lastUpdated: metadata.lastUpdated,
            // Include price fields
            lastPrice: metadata.lastPrice,
            lastPriceTimestamp: metadata.lastPriceTimestamp
          }
        });
      } else {
        return NextResponse.json(
          { 
            success: false, 
            error: 'Ticker not found' 
          }, 
          { status: 404 }
        );
      }
    }
    
    // Fetch all tickers (this is the only implemented functionality for now)
    const tickers = await getAllTickers();
    return NextResponse.json({ 
      success: true, 
      data: tickers,
      count: tickers.length 
    });
    
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