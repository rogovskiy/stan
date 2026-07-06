import { getAdminFirestore } from '@/app/lib/firebase-admin';
import { downloadAnnualPriceJson } from '@/app/lib/server/downloadAnnualPriceData';
import { getStartDateFromPeriod, type DailyPricePoint } from '@/app/lib/dailyPrices';

type YearPriceReference = {
  storageRef?: string;
  storage_ref?: string;
};

/**
 * Fetch daily price data for a ticker via Admin Firestore + Admin Storage.
 * Server-only — never uses public Storage URLs.
 */
export async function getDailyPricesForTicker(
  ticker: string,
  period: string = '5y'
): Promise<DailyPricePoint[]> {
  const startDate = getStartDateFromPeriod(period);
  const startYear = startDate.getFullYear();

  const priceDataSnap = await getAdminFirestore()
    .collection('tickers')
    .doc(ticker.toUpperCase())
    .collection('price')
    .doc('consolidated')
    .get();

  if (!priceDataSnap.exists) {
    return [];
  }

  const consolidatedData = priceDataSnap.data() as Record<string, unknown>;
  const years = (consolidatedData.years || {}) as Record<string, YearPriceReference>;

  const yearsToFetch: number[] = [];
  for (const yearStr of Object.keys(years)) {
    const year = parseInt(yearStr, 10);
    if (year >= startYear) yearsToFetch.push(year);
  }
  yearsToFetch.sort((a, b) => a - b);

  const allPriceData: Record<string, { c: number }> = {};
  const normalizedStartDate = new Date(startDate);
  normalizedStartDate.setHours(0, 0, 0, 0);

  for (const year of yearsToFetch) {
    const yearData = years[year.toString()];
    if (!yearData) continue;

    const storageRef = yearData.storageRef || yearData.storage_ref;
    if (!storageRef) continue;

    try {
      const annual = await downloadAnnualPriceJson(storageRef);
      const data = annual.data || {};

      for (const [dateStr, dayData] of Object.entries(data) as [string, { c: number }][]) {
        const date = new Date(dateStr);
        date.setHours(0, 0, 0, 0);
        if (date >= normalizedStartDate) {
          allPriceData[dateStr] = dayData;
        }
      }
    } catch (error) {
      console.error(`Failed to load annual price data for ${ticker} ${year}:`, error);
    }
  }

  return Object.entries(allPriceData)
    .map(([date, data]) => ({ date, price: data.c }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
