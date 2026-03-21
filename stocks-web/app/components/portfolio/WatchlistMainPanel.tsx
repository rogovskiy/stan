import type { WatchlistItem } from '../../lib/services/watchlistService';

function getPriorityColor(priority?: string) {
  switch (priority) {
    case 'high':
      return 'bg-red-100 text-red-800 border-red-200';
    case 'medium':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'low':
      return 'bg-green-100 text-green-800 border-green-200';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-200';
  }
}

export default function WatchlistMainPanel({
  router,
  watchlistItems,
  onOpenAddWatchlist,
  onStartEditWatchlistItem,
  onDeleteWatchlistItem,
}: {
  router: { push: (href: string) => void };
  watchlistItems: WatchlistItem[];
  onOpenAddWatchlist: () => void;
  onStartEditWatchlistItem: (item: WatchlistItem) => void;
  onDeleteWatchlistItem: (id: string) => void;
}) {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
            <p className="text-sm text-gray-600 mt-1">Track stocks you&apos;re considering for investment</p>
          </div>
          <button
            onClick={onOpenAddWatchlist}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            + Add to Watchlist
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {watchlistItems.length > 0 ? (
          <div className="space-y-4">
            {watchlistItems.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold text-gray-900">{item.ticker}</h3>
                      {item.priority && (
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded border ${getPriorityColor(item.priority)}`}
                        >
                          {item.priority}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                      {item.targetPrice !== undefined && item.targetPrice !== null && (
                        <div>
                          <span className="text-gray-500">Target Price:</span>
                          <span className="ml-2 text-gray-900">${item.targetPrice.toFixed(2)}</span>
                        </div>
                      )}
                      {item.thesisId && (
                        <div className="col-span-2">
                          <span className="text-gray-500">Thesis:</span>
                          <button
                            onClick={() => router.push(`/${item.ticker}/thesis`)}
                            className="ml-2 text-blue-600 hover:text-blue-700 hover:underline"
                          >
                            View Thesis →
                          </button>
                        </div>
                      )}
                      {item.notes && (
                        <div className="col-span-2">
                          <span className="text-gray-500">Notes:</span>
                          <p className="mt-1 text-gray-700">{item.notes}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => onStartEditWatchlistItem(item)}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => onDeleteWatchlistItem(item.id!)}
                      className="px-3 py-1.5 text-sm text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No items in your watchlist yet.</p>
            <button
              onClick={onOpenAddWatchlist}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
            >
              Add Your First Item
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
