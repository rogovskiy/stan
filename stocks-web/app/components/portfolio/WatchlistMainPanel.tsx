import type { WatchlistItem, WatchlistStatus } from '../../lib/services/watchlistShared';
import { WATCHLIST_STATUSES } from '../../lib/services/watchlistShared';

const STATUS_LABELS: Record<WatchlistStatus, string> = {
  thesis_needed: 'Exploring',
  watching: 'Watching',
  awaiting_confirmation: 'Awaiting confirmation',
  ready_to_buy: 'Ready to buy',
};

export default function WatchlistMainPanel({
  router,
  watchlistItems,
  onOpenAddWatchlist,
  onStartEditWatchlistItem,
  onDeleteWatchlistItem,
  onStatusChange,
  signedIn,
  onSignIn,
}: {
  router: { push: (href: string) => void };
  watchlistItems: WatchlistItem[];
  onOpenAddWatchlist: () => void;
  onStartEditWatchlistItem: (item: WatchlistItem) => void;
  onDeleteWatchlistItem: (id: string) => void;
  onStatusChange: (itemId: string, status: WatchlistStatus) => void;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  if (!signedIn) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-200 bg-white">
          <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
          <p className="text-sm text-gray-600 mt-1">Sign in to track names you&apos;re considering</p>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <p className="text-gray-600 mb-4">Watchlist is available after you sign in with Google.</p>
            <button
              type="button"
              onClick={onSignIn}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
            <p className="text-sm text-gray-600 mt-1">Add a ticker and a note; add a thesis when you&apos;re ready</p>
          </div>
          <button
            type="button"
            onClick={onOpenAddWatchlist}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            + Add ticker
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
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-900">{item.ticker}</h3>
                      <select
                        value={item.status}
                        onChange={(e) =>
                          onStatusChange(item.id!, e.target.value as WatchlistStatus)
                        }
                        className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white text-gray-900 min-w-[12rem]"
                        aria-label="Status"
                      >
                        {WATCHLIST_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {item.notes ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.notes}</p>
                    ) : (
                      <p className="text-sm text-gray-400 italic">No note</p>
                    )}

                    {item.targetPrice != null && (
                      <p className="text-sm text-gray-600">
                        <span className="text-gray-500">Target:</span> ${item.targetPrice.toFixed(2)}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Thesis
                      </span>
                      {item.thesisId ? (
                        <button
                          type="button"
                          onClick={() => {
                            const q = new URLSearchParams();
                            q.set('thesisDocId', item.thesisId!);
                            router.push(`/${item.ticker}/thesis-builder?${q.toString()}`);
                          }}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          View Thesis
                        </button>
                      ) : item.id ? (
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/new-thesis?ticker=${encodeURIComponent(item.ticker)}&watchlistItemId=${encodeURIComponent(item.id)}`
                            )
                          }
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Add thesis
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStartEditWatchlistItem(item)}
                      className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                      aria-label="Edit note"
                      title="Edit note"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
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
                      onClick={() => onDeleteWatchlistItem(item.id!)}
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      aria-label="Remove from watchlist"
                      title="Remove"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No tickers yet.</p>
            <button
              type="button"
              onClick={onOpenAddWatchlist}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
            >
              Add your first ticker
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
