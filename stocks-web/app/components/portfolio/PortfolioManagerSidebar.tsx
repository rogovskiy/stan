import type { Portfolio } from '../../lib/services/portfolioService';
import type { WatchlistItem } from '../../lib/services/watchlistService';
import type { ViewMode } from './types';

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

export default function PortfolioManagerSidebar({
  viewMode,
  onViewModeChange,
  portfolios,
  watchlistItems,
  selectedPortfolio,
  loadPortfolio,
  onOpenCreatePortfolio,
  onOpenAddWatchlist,
}: {
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  portfolios: Portfolio[];
  watchlistItems: WatchlistItem[];
  selectedPortfolio: Portfolio | null;
  loadPortfolio: (id: string) => void;
  onOpenCreatePortfolio: () => void;
  onOpenAddWatchlist: () => void;
}) {
  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-3 bg-gray-100 rounded-lg p-1">
          <button
            onClick={() => {
              onViewModeChange('portfolios');
            }}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'portfolios'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Portfolios
          </button>
          <button
            onClick={() => {
              onViewModeChange('watchlist');
            }}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
              viewMode === 'watchlist'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Watchlist
          </button>
        </div>

        {viewMode === 'portfolios' ? (
          <button
            onClick={onOpenCreatePortfolio}
            className="w-full px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            + New Portfolio
          </button>
        ) : (
          <button
            onClick={onOpenAddWatchlist}
            className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            + Add to Watchlist
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {viewMode === 'portfolios' ? (
          portfolios.length === 0 ? (
            <div className="p-4 text-sm text-gray-500 text-center">
              No portfolios yet. Create one to get started.
            </div>
          ) : (
            <div className="p-2">
              {portfolios.map((portfolio) => (
                <div
                  key={portfolio.id}
                  onClick={() => loadPortfolio(portfolio.id!)}
                  className={`p-3 mb-2 rounded-lg cursor-pointer transition-colors ${
                    selectedPortfolio?.id === portfolio.id
                      ? 'bg-blue-50 border-2 border-blue-500'
                      : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                  }`}
                >
                  <div className="font-medium text-gray-900">{portfolio.name}</div>
                  {portfolio.description && (
                    <div className="text-xs text-gray-500 mt-1 line-clamp-2">{portfolio.description}</div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {portfolio.positions?.length || 0} positions
                  </div>
                </div>
              ))}
            </div>
          )
        ) : watchlistItems.length === 0 ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            No items in watchlist yet. Add one to get started.
          </div>
        ) : (
          <div className="p-2">
            {watchlistItems.map((item) => (
              <div
                key={item.id}
                className="p-3 mb-2 rounded-lg bg-gray-50 border-2 border-transparent hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-gray-900">{item.ticker}</div>
                  {item.priority && (
                    <span
                      className={`px-2 py-0.5 text-xs font-semibold rounded border ${getPriorityColor(item.priority)}`}
                    >
                      {item.priority}
                    </span>
                  )}
                </div>
                {item.targetPrice && (
                  <div className="text-xs text-gray-500 mt-1">Target: ${item.targetPrice.toFixed(2)}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
