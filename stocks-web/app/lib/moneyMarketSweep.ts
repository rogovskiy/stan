/** Broker cash sweep / money market symbols — not equity positions. */
export const MONEY_MARKET_SWEEP_TICKERS = new Set([
  'SPAXX', // Fidelity Government Money Market
  'FDRXX', // Fidelity Government Cash Reserves
  'SPRXX', // Fidelity Government Money Market (premium)
  'FCASH', // Fidelity Cash
]);

export function isMoneyMarketSweepTicker(ticker: string | null | undefined): boolean {
  if (ticker == null || typeof ticker !== 'string') return false;
  return MONEY_MARKET_SWEEP_TICKERS.has(ticker.trim().toUpperCase());
}
