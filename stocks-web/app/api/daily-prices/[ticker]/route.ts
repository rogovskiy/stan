import { NextRequest, NextResponse } from 'next/server';
import { FirebaseCache } from '../../../lib/cache';
import { DailyPriceResponse } from '../../../types/api';
import { getDailyPricesForTicker } from '../../../lib/server/getDailyPrices';

const cache = new FirebaseCache();

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  try {
    const { ticker } = await params;
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '5y';

    if (!ticker) {
      return NextResponse.json(
        { error: 'Ticker symbol is required' },
        { status: 400 }
      );
    }

    try {
      const dailyPricePoints = await getDailyPricesForTicker(ticker, period);

      if (dailyPricePoints.length === 0) {
        return NextResponse.json(
          { error: `No price data found for ${ticker}` },
          { status: 404 }
        );
      }

      const metadata = await cache.getTickerMetadata(ticker);
      const companyName = metadata?.name || ticker.toUpperCase();

      const dailyPriceData = dailyPricePoints.map((point) => ({
        date: point.date,
        fyDate: point.date,
        year: new Date(`${point.date}T12:00:00`).getFullYear(),
        price: point.price,
        estimated: false,
      }));

      const response: DailyPriceResponse = {
        symbol: ticker.toUpperCase(),
        companyName: companyName,
        currency: 'USD',
        data: dailyPriceData,
        metadata: {
          lastUpdated: new Date().toISOString(),
          dataRange: {
            start: dailyPriceData[0]?.date || '',
            end: dailyPriceData[dailyPriceData.length - 1]?.date || '',
          },
        },
      };

      return NextResponse.json(response);
    } catch (error) {
      return NextResponse.json(
        {
          error: 'Failed to fetch daily price data',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        { status: 500 }
      );
    }
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
