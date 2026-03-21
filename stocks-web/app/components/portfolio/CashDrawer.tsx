import type { Transaction } from '../../lib/services/portfolioService';

export default function CashDrawer({
  open,
  onClose,
  cashBalance,
  cashTransactions,
}: {
  open: boolean;
  onClose: () => void;
  cashBalance: number;
  cashTransactions: Transaction[];
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex justify-end z-50 pointer-events-none">
      <div className="pointer-events-auto bg-white w-full max-w-lg shadow-2xl border-l border-gray-200 overflow-y-auto h-full">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900">Cash</h3>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-900 p-1" aria-label="Close">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-lg font-semibold text-gray-900 mb-4">
            Balance: $
            {cashBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Cash transactions</h4>
          {cashTransactions.length === 0 ? (
            <p className="text-sm text-gray-500">No cash transactions yet.</p>
          ) : (
            <div className="rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="text-left py-2 px-4 font-medium text-gray-700">Date</th>
                    <th className="text-left py-2 px-4 font-medium text-gray-700">Description</th>
                    <th className="text-right py-2 px-4 font-medium text-gray-700">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {cashTransactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-2 px-4 text-gray-700">{tx.date}</td>
                      <td className="py-2 px-4 text-gray-700">{tx.notes || '—'}</td>
                      <td className="py-2 px-4 text-right font-medium">
                        <span className={tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}>
                          {tx.amount >= 0 ? '+' : ''}$
                          {tx.amount.toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
