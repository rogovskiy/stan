import type { TransactionFormType } from './types';

type Props = {
  variant: 'add' | 'edit';
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
};

const labelAdd = 'block text-sm font-semibold text-gray-700 mb-2';
const labelEdit = 'block text-sm text-gray-700 mb-1';
const inputAdd =
  'w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500';
const inputEdit =
  'w-full px-3 py-2 text-black border border-gray-300 rounded-lg text-sm bg-white';

export default function TransactionFormFields({
  variant,
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
}: Props) {
  const lbl = variant === 'add' ? labelAdd : labelEdit;
  const inp = variant === 'add' ? inputAdd : inputEdit;

  if (variant === 'edit') {
    return (
      <>
        <div>
          <label className={lbl}>Type</label>
          <select
            value={transactionType}
            onChange={(e) => setTransactionType(e.target.value as TransactionFormType)}
            className={inp}
          >
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="dividend">Dividend</option>
            <option value="dividend_reinvest">Dividend reinvest</option>
            <option value="cash">Cash</option>
          </select>
        </div>
        {transactionType !== 'cash' && (
          <div>
            <label className={lbl}>Ticker</label>
            <input
              type="text"
              value={transactionTicker}
              onChange={(e) => setTransactionTicker(e.target.value.toUpperCase())}
              className={inp}
            />
          </div>
        )}
        <div>
          <label className={lbl}>Date</label>
          <input
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            className={inp}
          />
        </div>
        <div>
          <label className={lbl}>Quantity</label>
          <input
            type="number"
            value={transactionQuantity}
            onChange={(e) => setTransactionQuantity(e.target.value)}
            step="0.0001"
            className={inp}
          />
        </div>
        <div>
          <label className={lbl}>Price</label>
          <input
            type="number"
            value={transactionPrice}
            onChange={(e) => setTransactionPrice(e.target.value)}
            step="0.01"
            className={inp}
          />
        </div>
        <div>
          <label className={lbl}>Amount</label>
          <input
            type="number"
            value={transactionAmount}
            onChange={(e) => setTransactionAmount(e.target.value)}
            step="0.01"
            className={inp}
          />
        </div>
        <div>
          <label className={lbl}>Notes</label>
          <input
            type="text"
            value={transactionNotes}
            onChange={(e) => setTransactionNotes(e.target.value)}
            className={inp}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <div>
        <label className={lbl}>Type</label>
        <select
          value={transactionType}
          onChange={(e) => setTransactionType(e.target.value as TransactionFormType)}
          className={inp}
        >
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
          <option value="dividend">Dividend</option>
          <option value="dividend_reinvest">Dividend reinvest</option>
          <option value="cash">Cash</option>
        </select>
      </div>
      {transactionType !== 'cash' && (
        <div>
          <label className={lbl}>Ticker *</label>
          <input
            type="text"
            value={transactionTicker}
            onChange={(e) => setTransactionTicker(e.target.value.toUpperCase())}
            className={inp}
            placeholder="e.g., AAPL"
          />
        </div>
      )}
      <div>
        <label className={lbl}>Date *</label>
        <input
          type="date"
          value={transactionDate}
          onChange={(e) => setTransactionDate(e.target.value)}
          className={inp}
        />
      </div>
      {(transactionType === 'buy' ||
        transactionType === 'sell' ||
        transactionType === 'dividend_reinvest') && (
        <>
          <div>
            <label className={lbl}>
              Quantity * ({transactionType === 'sell' ? 'negative' : 'positive'})
            </label>
            <input
              type="number"
              value={transactionQuantity}
              onChange={(e) => setTransactionQuantity(e.target.value)}
              step="0.0001"
              className={inp}
              placeholder={transactionType === 'sell' ? 'e.g., -10' : 'e.g., 100'}
            />
          </div>
          <div>
            <label className={lbl}>Price per share</label>
            <input
              type="number"
              value={transactionPrice}
              onChange={(e) => setTransactionPrice(e.target.value)}
              min="0"
              step="0.01"
              className={inp}
              placeholder="e.g., 150.00"
            />
          </div>
        </>
      )}
      {(transactionType === 'dividend' || transactionType === 'cash') && (
        <div>
          <label className={lbl}>Amount (cash impact) *</label>
          <input
            type="number"
            value={transactionAmount}
            onChange={(e) => setTransactionAmount(e.target.value)}
            step="0.01"
            className={inp}
            placeholder={transactionType === 'dividend' ? 'e.g., 25.00' : 'e.g., 1000 or -500'}
          />
        </div>
      )}
      {(transactionType === 'buy' ||
        transactionType === 'sell' ||
        transactionType === 'dividend_reinvest') && (
        <div>
          <label className={lbl}>Amount (optional; auto from qty × price)</label>
          <input
            type="number"
            value={transactionAmount}
            onChange={(e) => setTransactionAmount(e.target.value)}
            step="0.01"
            className={inp}
            placeholder="Leave blank to use quantity × price"
          />
        </div>
      )}
      <div>
        <label className={lbl}>Notes (optional)</label>
        <input
          type="text"
          value={transactionNotes}
          onChange={(e) => setTransactionNotes(e.target.value)}
          className={inp}
          placeholder="Per-transaction memo"
        />
      </div>
    </>
  );
}
