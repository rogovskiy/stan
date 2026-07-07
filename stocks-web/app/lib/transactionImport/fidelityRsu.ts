/** Transaction shape needed for RSU vest FMV resolution. */
export type RsuResolvableTx = {
  type: string;
  ticker: string | null;
  date: string;
  quantity: number;
  price: number | null;
  amount: number;
  notes?: string;
};

const RSU_GRANT_NOTE = 'RSU grant';
const MAX_DAYS_AFTER_VEST = 5;

function isRsuGrantBuy(tx: RsuResolvableTx): boolean {
  if (tx.type !== 'buy' || !tx.ticker || tx.quantity <= 0) return false;
  if (tx.notes === RSU_GRANT_NOTE || tx.notes?.startsWith(RSU_GRANT_NOTE) === true) return true;
  // Legacy imports stored RSU vests without notes and with blank price / $0 amount.
  return (tx.price == null || tx.price === 0) && tx.amount === 0;
}

/** True for RSU vest share deposits (used for cost-basis resolution and TWR cash flows). */
export function isRsuLikeGrantBuy(tx: RsuResolvableTx): boolean {
  return isRsuGrantBuy(tx);
}

function daysAfter(vestDate: string, laterDate: string): number {
  return Math.round((Date.parse(laterDate) - Date.parse(vestDate)) / 86_400_000);
}

function sellUnitPrice(sell: RsuResolvableTx): number | null {
  if (sell.price != null && sell.price > 0) return sell.price;
  const qty = Math.abs(sell.quantity);
  if (qty > 0 && sell.amount > 0) return sell.amount / qty;
  return null;
}

/**
 * Fidelity RSU vest rows omit price/amount on the share deposit. FMV at vest matches the
 * sell-to-cover trade within a few days (shares sold for tax withholding).
 */
export function resolveRsuGrantPrices(transactions: RsuResolvableTx[]): void {
  const rsuBuys = transactions.filter(isRsuGrantBuy);
  const sells = transactions.filter((t) => t.type === 'sell');
  const usedSellIdx = new Set<number>();

  for (const buy of rsuBuys) {
    if (buy.price != null && buy.price > 0) continue;
    if (!buy.ticker || buy.quantity <= 0) continue;

    for (let i = 0; i < sells.length; i++) {
      if (usedSellIdx.has(i)) continue;
      const sell = sells[i];
      if (sell.ticker !== buy.ticker) continue;

      const days = daysAfter(buy.date, sell.date);
      if (days < 0 || days > MAX_DAYS_AFTER_VEST) continue;

      const sellQty = Math.abs(sell.quantity);
      if (sellQty <= 0 || sellQty >= buy.quantity) continue;

      const vestFmv = sellUnitPrice(sell);
      if (vestFmv == null || vestFmv <= 0) continue;

      buy.price = vestFmv;
      buy.notes = `RSU grant @ $${vestFmv.toFixed(2)} vest FMV`;
      usedSellIdx.add(i);
      break;
    }
  }
}
