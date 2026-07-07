import type { Transaction } from './services/portfolioService';
import { isRsuLikeGrantBuy, resolveRsuGrantPrices } from './transactionImport/fidelityRsu';

type TwrCashFlowTx = Pick<Transaction, 'type' | 'date' | 'ticker' | 'quantity' | 'price' | 'amount' | 'notes'>;

/**
 * External cash flows for time-weighted return (TWR).
 * Cash deposits/withdrawals plus RSU vest FMV (shares appear with $0 amount — not market return).
 */
export function buildTwrCashFlowByDate(transactions: TwrCashFlowTx[]): Record<string, number> {
  const txs = transactions.map((tx) => ({ ...tx }));
  resolveRsuGrantPrices(txs);

  const cashFlowByDate: Record<string, number> = {};

  for (const tx of txs) {
    if (tx.type === 'cash') {
      cashFlowByDate[tx.date] = (cashFlowByDate[tx.date] ?? 0) + tx.amount;
    }
  }

  for (const tx of txs) {
    if (!isRsuLikeGrantBuy(tx) || tx.price == null || tx.price <= 0) continue;
    const contribution = tx.quantity * tx.price;
    cashFlowByDate[tx.date] = (cashFlowByDate[tx.date] ?? 0) + contribution;
  }

  return cashFlowByDate;
}
