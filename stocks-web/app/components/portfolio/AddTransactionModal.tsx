import type { TransactionFormType } from './types';
import TransactionFormFields from './TransactionFormFields';

export default function AddTransactionModal({
  open,
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
  onSubmit,
}: {
  open: boolean;
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
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-gray-900">Add Transaction</h3>
            <button onClick={onClose} className="text-gray-600 hover:text-gray-900">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="space-y-4">
            <TransactionFormFields
              variant="add"
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
          </div>
          <div className="flex gap-3 mt-6">
            <button
              onClick={onSubmit}
              disabled={transactionType !== 'cash' && !transactionTicker.trim()}
              className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Add Transaction
            </button>
            <button onClick={onClose} className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium">
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
