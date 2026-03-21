import type { WatchlistItem } from '../../lib/services/watchlistService';

export default function WatchlistItemModal({
  open,
  editingItem,
  watchlistTicker,
  setWatchlistTicker,
  watchlistPriority,
  setWatchlistPriority,
  watchlistTargetPrice,
  setWatchlistTargetPrice,
  watchlistThesisId,
  setWatchlistThesisId,
  watchlistNotes,
  setWatchlistNotes,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editingItem: WatchlistItem | null;
  watchlistTicker: string;
  setWatchlistTicker: (v: string) => void;
  watchlistPriority: 'low' | 'medium' | 'high';
  setWatchlistPriority: (v: 'low' | 'medium' | 'high') => void;
  watchlistTargetPrice: string;
  setWatchlistTargetPrice: (v: string) => void;
  watchlistThesisId: string;
  setWatchlistThesisId: (v: string) => void;
  watchlistNotes: string;
  setWatchlistNotes: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-gray-900">
              {editingItem ? 'Edit Watchlist Item' : 'Add to Watchlist'}
            </h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Ticker *</label>
              <input
                type="text"
                value={watchlistTicker}
                onChange={(e) => setWatchlistTicker(e.target.value.toUpperCase())}
                className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., AAPL"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Priority</label>
              <select
                value={watchlistPriority}
                onChange={(e) => setWatchlistPriority(e.target.value as 'low' | 'medium' | 'high')}
                className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Target Price</label>
              <input
                type="number"
                value={watchlistTargetPrice}
                onChange={(e) => setWatchlistTargetPrice(e.target.value)}
                min="0"
                step="0.01"
                className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g., 150.00"
              />
              <p className="text-xs text-gray-500 mt-1">Optional: Price at which you&apos;d consider buying</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Thesis ID (optional)</label>
              <input
                type="text"
                value={watchlistThesisId}
                onChange={(e) => setWatchlistThesisId(e.target.value)}
                className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Link to investment thesis"
              />
              <p className="text-xs text-gray-500 mt-1">You can link this item to an investment thesis</p>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
              <textarea
                value={watchlistNotes}
                onChange={(e) => setWatchlistNotes(e.target.value)}
                rows={3}
                className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="Optional notes about this stock..."
              />
            </div>
          </div>

          <div className="flex gap-3 mt-6">
            <button
              onClick={onSubmit}
              disabled={!watchlistTicker.trim()}
              className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              {editingItem ? 'Update' : 'Add'} Item
            </button>
            <button
              onClick={onClose}
              className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
