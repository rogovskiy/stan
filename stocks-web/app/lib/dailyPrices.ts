import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';

/**
 * Calculate start date from period string (e.g. "1y", "3y", "5y")
 * Uses Oct 1 of N years ago for consistency with daily-prices API
 */
export function getStartDateFromPeriod(period: string): Date {
  const today = new Date();
  const startDate = new Date();
  const normalizedPeriod = period.toLowerCase();

  const yearsMatch = normalizedPeriod.match(/^(\d+)(y|yr|year|years)?$/);
  if (yearsMatch) {
    const years = parseInt(yearsMatch[1]);
    startDate.setFullYear(today.getFullYear() - years);
    startDate.setMonth(9, 1); // October 1st
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }

  if (normalizedPeriod === 'max') {
    startDate.setFullYear(today.getFullYear() - 50);
    startDate.setMonth(9, 1);
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }

  startDate.setFullYear(today.getFullYear() - 5);
  startDate.setMonth(9, 1);
  startDate.setHours(0, 0, 0, 0);
  return startDate;
}

export interface DailyPricePoint {
  date: string;
  price: number;
}

/**
 * Fetch daily price data for a ticker from Firebase.
 * Returns sorted array of { date, price } for the given period.
 */
export async function getDailyPricesForTicker(
  ticker: string,
  period: string = '5y'
): Promise<DailyPricePoint[]> {
  const startDate = getStartDateFromPeriod(period);
  const startYear = startDate.getFullYear();

  const priceDataRef = doc(db, 'tickers', ticker.toUpperCase(), 'price', 'consolidated');
  const priceDataSnap = await getDoc(priceDataRef);

  if (!priceDataSnap.exists()) {
    return [];
  }

  const consolidatedData = priceDataSnap.data() as Record<string, unknown>;
  const years = (consolidatedData.years || {}) as Record<string, { downloadUrl?: string; download_url?: string }>;

  const yearsToFetch: number[] = [];
  for (const yearStr of Object.keys(years)) {
    const year = parseInt(yearStr);
    if (year >= startYear) yearsToFetch.push(year);
  }
  yearsToFetch.sort((a, b) => a - b);

  const allPriceData: Record<string, { c: number }> = {};
  const normalizedStartDate = new Date(startDate);
  normalizedStartDate.setHours(0, 0, 0, 0);

  for (const year of yearsToFetch) {
    const yearData = years[year.toString()];
    if (!yearData) continue;

    const downloadUrl = yearData.downloadUrl || yearData.download_url;
    if (!downloadUrl) continue;

    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) continue;

      const annualData = await response.json();
      const data = annualData.data || {};

      for (const [dateStr, dayData] of Object.entries(data) as [string, { c: number }][]) {
        const date = new Date(dateStr);
        date.setHours(0, 0, 0, 0);
        if (date >= normalizedStartDate) {
          allPriceData[dateStr] = dayData;
        }
      }
    } catch {
      // Skip year on error
    }
  }

  return Object.entries(allPriceData)
    .map(([date, data]) => ({ date, price: data.c }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}
