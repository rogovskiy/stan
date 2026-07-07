import { getDailyPricesForTicker } from './getDailyPrices';
import { isMoneyMarketSweepTicker } from '../moneyMarketSweep';

/** Tickers with no daily price series in Firebase for the given period. */
export async function getMissingPriceTickers(
  tickers: string[],
  period = '5y'
): Promise<string[]> {
  const unique = [
    ...new Set(
      tickers.map((t) => t.toUpperCase()).filter((t) => t && !isMoneyMarketSweepTicker(t))
    ),
  ];
  if (unique.length === 0) return [];

  const results = await Promise.all(unique.map((t) => getDailyPricesForTicker(t, period)));
  return unique.filter((_, i) => !results[i]?.length);
}
