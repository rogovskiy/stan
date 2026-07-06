/**
 * Shared daily price helpers (client-safe).
 * Server routes load price files via Admin Storage — see lib/server/getDailyPrices.ts.
 */

/**
 * Calculate start date from period string (e.g. "1y", "3y", "5y").
 * Always uses calendar-year boundaries: Jan 1 of (currentYear - (N-1)).
 * So 1y = current year (YTD), 3y = last 3 calendar years, 5y = last 5 calendar years.
 * Performance and average annual return are then consistent regardless of chart range.
 */
export function getStartDateFromPeriod(period: string): Date {
  const today = new Date();
  const startDate = new Date();
  const normalizedPeriod = period.toLowerCase();

  const yearsMatch = normalizedPeriod.match(/^(\d+)(y|yr|year|years)?$/);
  if (yearsMatch) {
    const years = parseInt(yearsMatch[1], 10);
    // Jan 1 of (currentYear - (years - 1)) so 1y = this year, 5y = 5 full calendar years
    startDate.setFullYear(today.getFullYear() - (years - 1));
    startDate.setMonth(0, 1); // January 1st
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }

  if (normalizedPeriod === 'max') {
    startDate.setFullYear(today.getFullYear() - 50);
    startDate.setMonth(0, 1);
    startDate.setHours(0, 0, 0, 0);
    return startDate;
  }

  startDate.setFullYear(today.getFullYear() - 4); // 5y default
  startDate.setMonth(0, 1);
  startDate.setHours(0, 0, 0, 0);
  return startDate;
}

export interface DailyPricePoint {
  date: string;
  price: number;
}

/**
 * Find the closing price on `dateStr` or the latest trading day before it.
 * Assumes `prices` is sorted ascending by date.
 */
export function findPriceOnOrBefore(
  prices: DailyPricePoint[],
  dateStr: string
): number | null {
  if (prices.length === 0) return null;
  let lo = 0;
  let hi = prices.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (prices[mid].date <= dateStr) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? prices[best].price : null;
}
