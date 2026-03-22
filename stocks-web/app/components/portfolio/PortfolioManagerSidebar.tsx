import type { Portfolio } from '../../lib/services/portfolioService';
import type { WatchlistItem, WatchlistStatus } from '../../lib/services/watchlistShared';
import type { ViewMode } from './types';

/** Short status chips in the sidebar (not thesis doc links). */
const STATUS_SHORT: Record<WatchlistStatus, string> = {
  thesis_needed: 'Explore',
  watching: 'Watching',
  awaiting_confirmation: 'Wait',
  ready_to_buy: 'Ready',
};

const STATUS_TOOLTIP: Record<WatchlistStatus, string> = {
  thesis_needed: 'Still exploring — add a thesis when you’re ready',
  watching: 'Status: watching',
  awaiting_confirmation: 'Status: awaiting confirmation',
  ready_to_buy: 'Status: ready to buy',
};

function getStatusSidebarColor(status: WatchlistStatus) {
  switch (status) {
    case 'ready_to_buy':
      return 'bg-emerald-100 text-emerald-900 border-emerald-200';
    case 'awaiting_confirmation':
      return 'bg-amber-100 text-amber-900 border-amber-200';
    case 'watching':
      return 'bg-sky-100 text-sky-900 border-sky-200';
    case 'thesis_needed':
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
  watchlistSignedIn,
  onWatchlistSignIn,
}: {
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  portfolios: Portfolio[];
  watchlistItems: WatchlistItem[];
  selectedPortfolio: Portfolio | null;
  loadPortfolio: (id: string) => void;
  onOpenCreatePortfolio: () => void;
  watchlistSignedIn: boolean;
  onWatchlistSignIn: () => void;
}) {
  return (
    <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="p-4 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-3 bg-gray-100 rounded-lg p-1">
          <button
            type="button"
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
            type="button"
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
            type="button"
            onClick={onOpenCreatePortfolio}
            className="w-full px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
          >
            + New Portfolio
          </button>
        ) : !watchlistSignedIn ? (
          <button
            type="button"
            onClick={onWatchlistSignIn}
            className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            Sign in for watchlist
          </button>
        ) : null}
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
                  role="button"
                  tabIndex={0}
                  onClick={() => loadPortfolio(portfolio.id!)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') loadPortfolio(portfolio.id!);
                  }}
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
        ) : !watchlistSignedIn ? (
          <div className="p-4 text-sm text-gray-500 text-center">
            Sign in to view and edit your watchlist.
          </div>
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
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium text-gray-900 truncate">{item.ticker}</div>
                  <span
                    className={`shrink-0 px-2 py-0.5 text-xs font-semibold rounded border ${getStatusSidebarColor(item.status)}`}
                    title={STATUS_TOOLTIP[item.status]}
                  >
                    {STATUS_SHORT[item.status]}
                  </span>
                </div>
                {item.targetPrice != null && (
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
