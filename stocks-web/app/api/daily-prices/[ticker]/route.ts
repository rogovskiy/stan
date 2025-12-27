import { NextRequest, NextResponse } from 'next/server';
import { FirebaseCache } from '../../../lib/cache';
import { DailyPriceResponse } from '../../../types/api';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../lib/firebase';

const cache = new FirebaseCache();

// Helper function to calculate start date based on period
// Period like "8y" means beginning of fiscal year 8 years ago
// Apple's fiscal year starts on October 1st
function getStartDateFromPeriod(period: string): Date {
  const today = new Date();
  const startDate = new Date();
  
  const normalizedPeriod = period.toLowerCase();
  
  // Extract number of years
  const yearsMatch = normalizedPeriod.match(/^(\d+)(y|yr|year|years)?$/);
  if (yearsMatch) {
    const years = parseInt(yearsMatch[1]);
    startDate.setFullYear(today.getFullYear() - years);
    startDate.setMonth(9, 1); // October 1st (month 9, day 1) - beginning of fiscal year
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }
  
  // Handle "max" - go back 50 years
  if (normalizedPeriod === 'max') {
    startDate.setFullYear(today.getFullYear() - 50);
    startDate.setMonth(9, 1); // October 1st
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }
  
  // Default to 5 years
  startDate.setFullYear(today.getFullYear() - 5);
  startDate.setMonth(9, 1); // October 1st
  startDate.setHours(0, 0, 0, 0);
  return startDate;
}

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

    console.log(`Daily Prices API Request: ${ticker}, period: ${period}`);

    try {
      // Calculate start date based on period
      const startDate = getStartDateFromPeriod(period);
      const startYear = startDate.getFullYear();
      
      console.log(`Start date: ${startDate.toISOString().split('T')[0]} (year: ${startYear})`);

      // Get consolidated price data document from Firebase
      const priceDataRef = doc(db, 'tickers', ticker.toUpperCase(), 'price', 'consolidated');
      const priceDataSnap = await getDoc(priceDataRef);

      if (!priceDataSnap.exists()) {
        return NextResponse.json(
          { error: `No price data found for ${ticker}` },
          { status: 404 }
        );
      }

      const consolidatedData = priceDataSnap.data() as any;
      const years = consolidatedData.years || {};

      // Get all years >= startYear from the document
      const yearsToFetch: number[] = [];
      Object.keys(years).forEach(yearStr => {
        const year = parseInt(yearStr);
        if (year >= startYear) {
          yearsToFetch.push(year);
        }
      });
      yearsToFetch.sort((a, b) => a - b);

      console.log(`Found ${yearsToFetch.length} years to fetch: ${yearsToFetch.join(', ')}`);

      // Fetch price data from storage for each year
      const allPriceData: Record<string, any> = {};
      const normalizedStartDate = new Date(startDate);
      normalizedStartDate.setHours(0, 0, 0, 0);

      for (const year of yearsToFetch) {
        const yearData = years[year.toString()];
        if (!yearData) continue;

        // Handle both camelCase and snake_case field names
        const downloadUrl = yearData.downloadUrl || yearData.download_url;
        if (!downloadUrl) {
          console.log(`No download URL for year ${year}, skipping`);
          continue;
        }

        try {
          console.log(`Fetching data for year ${year} from ${downloadUrl}`);
          const response = await fetch(downloadUrl);
          if (!response.ok) {
            console.error(`Failed to fetch data for year ${year}: ${response.statusText}`);
            continue;
          }

          const annualData = await response.json();
          
          // Filter by start date and add to allPriceData
          Object.entries(annualData.data || {}).forEach(([dateStr, dayData]: [string, any]) => {
            const date = new Date(dateStr);
            date.setHours(0, 0, 0, 0);
            if (date >= normalizedStartDate) {
              allPriceData[dateStr] = dayData;
            }
          });
        } catch (error) {
          console.error(`Error fetching data for year ${year}:`, error);
        }
      }

      // Get ticker metadata
      const metadata = await cache.getTickerMetadata(ticker);
      const companyName = metadata?.name || ticker.toUpperCase();

      // Transform to API format
      const dailyPriceData = Object.entries(allPriceData)
        .map(([date, data]: [string, any]) => ({
          date: date,
          fyDate: date,
          year: new Date(date).getFullYear(),
          price: data.c, // Close price
          estimated: false
        }))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      console.log(`Retrieved ${dailyPriceData.length} data points from ${dailyPriceData[0]?.date || 'N/A'} to ${dailyPriceData[dailyPriceData.length - 1]?.date || 'N/A'}`);

      const response: DailyPriceResponse = {
        symbol: ticker.toUpperCase(),
        companyName: companyName,
        currency: 'USD',
        data: dailyPriceData,
        metadata: {
          lastUpdated: new Date().toISOString(),
          dataRange: {
            start: dailyPriceData[0]?.date || '',
            end: dailyPriceData[dailyPriceData.length - 1]?.date || ''
          }
        }
      };

      return NextResponse.json(response);

    } catch (error) {
      console.error(`Failed to fetch daily price data for ${ticker}:`, error);
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






