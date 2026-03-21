import type { Transaction } from '../../lib/services/portfolioService';
import type { TransactionFormType } from './types';
import TransactionFormFields from './TransactionFormFields';

export default function TransactionHistoryDrawer({
  ticker,
  transactions,
  editingTransaction,
  transactionType,
  setTransactionType,
  transactionTicker,
  setTransactionTicker,
  transactionDate,
  setTransactionDate,
  transactionQuantity,
  setTransactionQuantity,
  transactionPrice,
  setTransactionPrice,
  transactionAmount,
  setTransactionAmount,
  transactionNotes,
  setTransactionNotes,
  onClose,
  onStartEdit,
  onDeleteTransaction,
  onSaveEdit,
  onCancelEdit,
}: {
  ticker: string;
  transactions: Transaction[];
  editingTransaction: Transaction | null;
  transactionType: TransactionFormType;
  setTransactionType: (t: TransactionFormType) => void;
  transactionTicker: string;
  setTransactionTicker: (v: string) => void;
  transactionDate: string;
  setTransactionDate: (v: string) => void;
  transactionQuantity: string;
  setTransactionQuantity: (v: string) => void;
  transactionPrice: string;
  setTransactionPrice: (v: string) => void;
  transactionAmount: string;
  setTransactionAmount: (v: string) => void;
  transactionNotes: string;
  setTransactionNotes: (v: string) => void;
  onClose: () => void;
  onStartEdit: (tx: Transaction) => void;
  onDeleteTransaction: (id: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}) {
  return (
    <div className="fixed inset-0 flex justify-end z-50 pointer-events-none">
      <div
        className="pointer-events-auto bg-white w-full max-w-lg shadow-2xl border-l border-gray-200 overflow-y-auto h-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xl font-bold text-gray-900">Transactions – {ticker}</h3>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-900 p-1">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {!editingTransaction ? (
            <ul className="space-y-0">
              {transactions.length === 0 && (
                <p className="text-sm text-gray-700 py-4">No transactions yet.</p>
              )}
              {transactions.map((tx) => (
                <li
                  key={tx.id}
                  className="flex items-center justify-between py-3 px-2 border-b border-gray-200 hover:bg-gray-50 rounded"
                >
                  <span className="text-sm font-medium text-gray-900">
                    {tx.date} {tx.type} {tx.quantity !== 0 ? tx.quantity : ''}{' '}
                    {tx.amount !== 0 ? `$${tx.amount.toFixed(2)}` : ''}
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => onStartEdit(tx)}
                      className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                      aria-label="Edit transaction"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => tx.id && onDeleteTransaction(tx.id)}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                      aria-label="Delete transaction"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-800">Edit transaction</h4>
              <TransactionFormFields
                variant="edit"
                transactionType={transactionType}
                setTransactionType={setTransactionType}
                transactionTicker={transactionTicker}
                setTransactionTicker={setTransactionTicker}
                transactionDate={transactionDate}
                setTransactionDate={setTransactionDate}
                transactionQuantity={transactionQuantity}
                setTransactionQuantity={setTransactionQuantity}
                transactionPrice={transactionPrice}
                setTransactionPrice={setTransactionPrice}
                transactionAmount={transactionAmount}
                setTransactionAmount={setTransactionAmount}
                transactionNotes={transactionNotes}
                setTransactionNotes={setTransactionNotes}
              />
              <div className="flex gap-2">
                <button
                  onClick={onSaveEdit}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                >
                  Save
                </button>
                <button
                  onClick={onCancelEdit}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
