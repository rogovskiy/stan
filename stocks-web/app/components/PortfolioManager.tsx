'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Position, Portfolio } from '../lib/services/portfolioService';
import { WatchlistItem } from '../lib/services/watchlistService';
import PortfolioBenchmarkChart from './PortfolioBenchmarkChart';

interface PortfolioManagerProps {
  initialPortfolioId?: string;
}

type ViewMode = 'portfolios' | 'watchlist';

export default function PortfolioManager({ initialPortfolioId }: PortfolioManagerProps) {
  const router = useRouter();
  const [viewMode, setViewMode] = useState<ViewMode>('portfolios');
  const [portfolios, setPortfolios] = useState<Portfolio[]>([]);
  const [watchlistItems, setWatchlistItems] = useState<WatchlistItem[]>([]);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreatePortfolio, setShowCreatePortfolio] = useState(false);
  const [showAddPosition, setShowAddPosition] = useState(false);
  const [showAddWatchlistItem, setShowAddWatchlistItem] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [editingWatchlistItem, setEditingWatchlistItem] = useState<WatchlistItem | null>(null);
  
  // Form states
  const [portfolioName, setPortfolioName] = useState('');
  const [portfolioDescription, setPortfolioDescription] = useState('');
  const [positionTicker, setPositionTicker] = useState('');
  const [positionQuantity, setPositionQuantity] = useState('');
  const [positionPurchaseDate, setPositionPurchaseDate] = useState('');
  const [positionPurchasePrice, setPositionPurchasePrice] = useState('');
  const [positionThesisId, setPositionThesisId] = useState('');
  const [positionNotes, setPositionNotes] = useState('');
  
  // Watchlist form states
  const [watchlistTicker, setWatchlistTicker] = useState('');
  const [watchlistNotes, setWatchlistNotes] = useState('');
  const [watchlistThesisId, setWatchlistThesisId] = useState('');
  const [watchlistTargetPrice, setWatchlistTargetPrice] = useState('');
  const [watchlistPriority, setWatchlistPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [positionPrices, setPositionPrices] = useState<Record<string, number>>({});

  // Fetch data on mount and when view mode changes
  useEffect(() => {
    if (viewMode === 'portfolios') {
      fetchPortfolios();
    } else {
      fetchWatchlistItems();
    }
  }, [viewMode]);

  // Load selected portfolio if initialPortfolioId is provided
  useEffect(() => {
    if (initialPortfolioId && portfolios.length > 0) {
      const portfolio = portfolios.find(p => p.id === initialPortfolioId);
      if (portfolio) {
        loadPortfolio(portfolio.id!);
      }
    }
  }, [initialPortfolioId, portfolios]);

  // Fetch latest price for each position ticker (for total value / total return)
  useEffect(() => {
    const positions = selectedPortfolio?.positions;
    if (!positions?.length) {
      setPositionPrices({});
      return;
    }
    let cancelled = false;
    const tickers = [...new Set(positions.map((p) => p.ticker.toUpperCase()))];
    const prices: Record<string, number> = {};
    Promise.all(
      tickers.map(async (ticker) => {
        try {
          const res = await fetch(`/api/daily-prices/${ticker}?period=1y`);
          if (cancelled) return;
          const json = await res.json();
          const data = json?.data;
          if (Array.isArray(data) && data.length > 0 && data[data.length - 1]?.price != null) {
            prices[ticker] = data[data.length - 1].price;
          }
        } catch {
          // leave price undefined for this ticker
        }
      })
    ).then(() => {
      if (!cancelled) setPositionPrices(prices);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedPortfolio?.positions]);

  const totalPortfolioValue = useMemo(() => {
    const positions = selectedPortfolio?.positions;
    if (!positions?.length) return null;
    let total = 0;
    for (const p of positions) {
      const price = positionPrices[p.ticker.toUpperCase()];
      if (price != null) total += p.quantity * price;
    }
    return total > 0 ? total : null;
  }, [selectedPortfolio?.positions, positionPrices]);

  const fetchPortfolios = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/portfolios');
      const result = await response.json();
      
      if (result.success) {
        setPortfolios(result.data);
        if (result.data.length > 0 && !selectedPortfolio) {
          loadPortfolio(result.data[0].id!);
        }
      } else {
        setError(result.error || 'Failed to fetch portfolios');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch portfolios');
    } finally {
      setLoading(false);
    }
  };

  const loadPortfolio = async (portfolioId: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/portfolios/${portfolioId}`);
      const result = await response.json();
      
      if (result.success) {
        setSelectedPortfolio(result.data);
      } else {
        setError(result.error || 'Failed to load portfolio');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePortfolio = async () => {
    if (!portfolioName.trim()) {
      setError('Portfolio name is required');
      return;
    }

    try {
      const response = await fetch('/api/portfolios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: portfolioName.trim(),
          description: portfolioDescription.trim(),
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        await fetchPortfolios();
        setShowCreatePortfolio(false);
        setPortfolioName('');
        setPortfolioDescription('');
        if (result.data.id) {
          loadPortfolio(result.data.id);
        }
      } else {
        setError(result.error || 'Failed to create portfolio');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create portfolio');
    }
  };

  const handleDeletePortfolio = async (portfolioId: string) => {
    if (!confirm('Are you sure you want to delete this portfolio? This will delete all positions.')) {
      return;
    }

    try {
      const response = await fetch(`/api/portfolios/${portfolioId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      
      if (result.success) {
        await fetchPortfolios();
        setSelectedPortfolio(null);
      } else {
        setError(result.error || 'Failed to delete portfolio');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete portfolio');
    }
  };

  const handleAddPosition = async () => {
    if (!selectedPortfolio?.id) return;
    if (!positionTicker.trim() || !positionQuantity) {
      setError('Ticker and quantity are required');
      return;
    }

    try {
      const response = await fetch(`/api/portfolios/${selectedPortfolio.id}/positions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: positionTicker.trim(),
          quantity: parseFloat(positionQuantity),
          purchaseDate: positionPurchaseDate || undefined,
          purchasePrice: positionPurchasePrice ? parseFloat(positionPurchasePrice) : undefined,
          thesisId: positionThesisId || undefined,
          notes: positionNotes || '',
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        setSelectedPortfolio(result.data.portfolio);
        setShowAddPosition(false);
        resetPositionForm();
      } else {
        setError(result.error || 'Failed to add position');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add position');
    }
  };

  const handleUpdatePosition = async () => {
    if (!selectedPortfolio?.id || !editingPosition?.id) return;

    try {
      const response = await fetch(
        `/api/portfolios/${selectedPortfolio.id}/positions/${editingPosition.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker: positionTicker.trim(),
            quantity: parseFloat(positionQuantity),
            purchaseDate: positionPurchaseDate || null,
            purchasePrice: positionPurchasePrice ? parseFloat(positionPurchasePrice) : null,
            thesisId: positionThesisId || null,
            notes: positionNotes || '',
          }),
        }
      );

      const result = await response.json();
      
      if (result.success) {
        setSelectedPortfolio(result.data);
        setEditingPosition(null);
        setShowAddPosition(false);
        resetPositionForm();
      } else {
        setError(result.error || 'Failed to update position');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update position');
    }
  };

  const handleDeletePosition = async (positionId: string) => {
    if (!selectedPortfolio?.id) return;
    if (!confirm('Are you sure you want to delete this position?')) {
      return;
    }

    try {
      const response = await fetch(
        `/api/portfolios/${selectedPortfolio.id}/positions/${positionId}`,
        {
          method: 'DELETE',
        }
      );

      const result = await response.json();
      
      if (result.success) {
        setSelectedPortfolio(result.data);
      } else {
        setError(result.error || 'Failed to delete position');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete position');
    }
  };

  const resetPositionForm = () => {
    setPositionTicker('');
    setPositionQuantity('');
    setPositionPurchaseDate('');
    setPositionPurchasePrice('');
    setPositionThesisId('');
    setPositionNotes('');
  };

  const startEditPosition = (position: Position) => {
    setEditingPosition(position);
    setPositionTicker(position.ticker);
    setPositionQuantity(position.quantity.toString());
    setPositionPurchaseDate(position.purchaseDate || '');
    setPositionPurchasePrice(position.purchasePrice?.toString() || '');
    setPositionThesisId(position.thesisId || '');
    setPositionNotes(position.notes || '');
    setShowAddPosition(true);
  };

  const cancelEdit = () => {
    setEditingPosition(null);
    setEditingWatchlistItem(null);
    setShowAddPosition(false);
    setShowAddWatchlistItem(false);
    resetPositionForm();
    resetWatchlistForm();
  };

  // Watchlist functions
  const fetchWatchlistItems = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/watchlist');
      const result = await response.json();
      
      if (result.success) {
        setWatchlistItems(result.data);
      } else {
        setError(result.error || 'Failed to fetch watchlist items');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch watchlist items');
    } finally {
      setLoading(false);
    }
  };

  const handleAddWatchlistItem = async () => {
    if (!watchlistTicker.trim()) {
      setError('Ticker is required');
      return;
    }

    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: watchlistTicker.trim(),
          notes: watchlistNotes.trim(),
          thesisId: watchlistThesisId || undefined,
          targetPrice: watchlistTargetPrice ? parseFloat(watchlistTargetPrice) : undefined,
          priority: watchlistPriority,
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        await fetchWatchlistItems();
        setShowAddWatchlistItem(false);
        resetWatchlistForm();
      } else {
        setError(result.error || 'Failed to add watchlist item');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add watchlist item');
    }
  };

  const handleUpdateWatchlistItem = async () => {
    if (!editingWatchlistItem?.id) return;
    if (!watchlistTicker.trim()) {
      setError('Ticker is required');
      return;
    }

    try {
      const response = await fetch(`/api/watchlist/${editingWatchlistItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: watchlistTicker.trim(),
          notes: watchlistNotes.trim(),
          thesisId: watchlistThesisId || null,
          targetPrice: watchlistTargetPrice ? parseFloat(watchlistTargetPrice) : null,
          priority: watchlistPriority,
        }),
      });

      const result = await response.json();
      
      if (result.success) {
        await fetchWatchlistItems();
        setEditingWatchlistItem(null);
        setShowAddWatchlistItem(false);
        resetWatchlistForm();
      } else {
        setError(result.error || 'Failed to update watchlist item');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update watchlist item');
    }
  };

  const handleDeleteWatchlistItem = async (itemId: string) => {
    if (!confirm('Are you sure you want to remove this item from the watchlist?')) {
      return;
    }

    try {
      const response = await fetch(`/api/watchlist/${itemId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      
      if (result.success) {
        await fetchWatchlistItems();
      } else {
        setError(result.error || 'Failed to delete watchlist item');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete watchlist item');
    }
  };

  const resetWatchlistForm = () => {
    setWatchlistTicker('');
    setWatchlistNotes('');
    setWatchlistThesisId('');
    setWatchlistTargetPrice('');
    setWatchlistPriority('medium');
  };

  const startEditWatchlistItem = (item: WatchlistItem) => {
    setEditingWatchlistItem(item);
    setWatchlistTicker(item.ticker);
    setWatchlistNotes(item.notes || '');
    setWatchlistThesisId(item.thesisId || '');
    setWatchlistTargetPrice(item.targetPrice?.toString() || '');
    setWatchlistPriority(item.priority || 'medium');
    setShowAddWatchlistItem(true);
  };

  const getPriorityColor = (priority?: string) => {
    switch (priority) {
      case 'high': return 'bg-red-100 text-red-800 border-red-200';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low': return 'bg-green-100 text-green-800 border-green-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (loading && viewMode === 'portfolios' && portfolios.length === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-gray-500">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-200px)] bg-gray-50 rounded-xl overflow-hidden border border-gray-200 shadow-lg">
      {/* Left Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* View Mode Toggle */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center gap-2 mb-3 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => {
                setViewMode('portfolios');
                setSelectedPortfolio(null);
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
                setViewMode('watchlist');
                setSelectedPortfolio(null);
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
              onClick={() => {
                setShowCreatePortfolio(true);
                setPortfolioName('');
                setPortfolioDescription('');
              }}
              className="w-full px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              + New Portfolio
            </button>
          ) : (
            <button
              onClick={() => {
                setEditingWatchlistItem(null);
                resetWatchlistForm();
                setShowAddWatchlistItem(true);
              }}
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
                      <div className="text-xs text-gray-500 mt-1 line-clamp-2">
                        {portfolio.description}
                      </div>
                    )}
                    <div className="text-xs text-gray-400 mt-1">
                      {portfolio.positions?.length || 0} positions
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            watchlistItems.length === 0 ? (
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
                        <span className={`px-2 py-0.5 text-xs font-semibold rounded border ${getPriorityColor(item.priority)}`}>
                          {item.priority}
                        </span>
                      )}
                    </div>
                    {item.targetPrice && (
                      <div className="text-xs text-gray-500 mt-1">
                        Target: ${item.targetPrice.toFixed(2)}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {error && (
          <div className="p-4 bg-red-50 border-b border-red-200">
            <div className="text-sm text-red-800">{error}</div>
            <button
              onClick={() => setError(null)}
              className="mt-2 text-xs text-red-600 hover:text-red-800"
            >
              Dismiss
            </button>
          </div>
        )}

        {viewMode === 'portfolios' ? (
          selectedPortfolio ? (
            <>
              <div className="p-6 border-b border-gray-200 bg-white">
                <div className="flex items-center justify-between">
                  <div>
                    <h1 className="text-2xl font-bold text-gray-900">{selectedPortfolio.name}</h1>
                    {selectedPortfolio.description && (
                      <p className="text-sm text-gray-600 mt-1">{selectedPortfolio.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-6">
                    {totalPortfolioValue != null && (
                      <p className="text-lg font-semibold text-gray-900">
                        Total value: ${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </p>
                    )}
                    <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setEditingPosition(null);
                        resetPositionForm();
                        setShowAddPosition(true);
                      }}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                    >
                      + Add Position
                    </button>
                    <button
                      onClick={() => handleDeletePortfolio(selectedPortfolio.id!)}
                      className="px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md transition-colors"
                    >
                      Delete Portfolio
                    </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {selectedPortfolio.id && (
                  <div className="mb-6">
                    <PortfolioBenchmarkChart portfolioId={selectedPortfolio.id} />
                  </div>
                )}
                {selectedPortfolio.positions && selectedPortfolio.positions.length > 0 ? (
                  <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Ticker</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Shares</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Avg cost</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Total value</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Total return</th>
                          <th className="w-24 py-3 px-4" />
                        </tr>
                      </thead>
                      <tbody>
                        {selectedPortfolio.positions.map((position) => {
                          const tickerKey = position.ticker.toUpperCase();
                          const currentPrice = positionPrices[tickerKey];
                          const avgCost = position.purchasePrice ?? null;
                          const totalValue = currentPrice != null ? position.quantity * currentPrice : null;
                          const totalReturnPct =
                            avgCost != null && avgCost > 0 && currentPrice != null
                              ? ((currentPrice - avgCost) / avgCost) * 100
                              : null;
                          return (
                            <tr key={position.id} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-3 px-4 font-medium text-gray-900">{position.ticker}</td>
                              <td className="py-3 px-4 text-right text-gray-700">
                                {position.quantity.toLocaleString()}
                              </td>
                              <td className="py-3 px-4 text-right text-gray-700">
                                {avgCost != null ? `$${avgCost.toFixed(2)}` : '—'}
                              </td>
                              <td className="py-3 px-4 text-right text-gray-700">
                                {totalValue != null ? `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'}
                              </td>
                              <td className="py-3 px-4 text-right">
                                {totalReturnPct != null ? (
                                  <span className={totalReturnPct >= 0 ? 'text-green-600' : 'text-red-600'}>
                                    {totalReturnPct >= 0 ? '+' : ''}{totalReturnPct.toFixed(1)}%
                                  </span>
                                ) : (
                                  <span className="text-gray-400">—</span>
                                )}
                              </td>
                              <td className="py-3 px-4">
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => startEditPosition(position)}
                                    className="text-gray-600 hover:text-gray-900 text-xs font-medium"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeletePosition(position.id!)}
                                    className="text-red-600 hover:text-red-700 text-xs font-medium"
                                  >
                                    Delete
                                  </button>
                                  {position.thesisId && (
                                    <button
                                      onClick={() => router.push(`/${position.ticker}/thesis`)}
                                      className="text-blue-600 hover:text-blue-700 text-xs font-medium"
                                    >
                                      Thesis
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-gray-500 mb-4">No positions in this portfolio yet.</p>
                    <button
                      onClick={() => {
                        setEditingPosition(null);
                        resetPositionForm();
                        setShowAddPosition(true);
                      }}
                      className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                    >
                      Add Your First Position
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-gray-500 mb-4">Select a portfolio or create a new one to get started.</p>
                <button
                  onClick={() => {
                    setShowCreatePortfolio(true);
                    setPortfolioName('');
                    setPortfolioDescription('');
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                >
                  Create Portfolio
                </button>
              </div>
            </div>
          )
        ) : (
          /* Watchlist View */
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="p-6 border-b border-gray-200 bg-white">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
                  <p className="text-sm text-gray-600 mt-1">
                    Track stocks you're considering for investment
                  </p>
                </div>
                <button
                  onClick={() => {
                    setEditingWatchlistItem(null);
                    resetWatchlistForm();
                    setShowAddWatchlistItem(true);
                  }}
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
                            <h3 className="text-lg font-semibold text-gray-900">
                              {item.ticker}
                            </h3>
                            {item.priority && (
                              <span className={`px-2 py-1 text-xs font-semibold rounded border ${getPriorityColor(item.priority)}`}>
                                {item.priority}
                              </span>
                            )}
                          </div>
                          
                          <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                            {item.targetPrice !== undefined && item.targetPrice !== null && (
                              <div>
                                <span className="text-gray-500">Target Price:</span>
                                <span className="ml-2 text-gray-900">
                                  ${item.targetPrice.toFixed(2)}
                                </span>
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
                            onClick={() => startEditWatchlistItem(item)}
                            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-md transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteWatchlistItem(item.id!)}
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
                    onClick={() => {
                      setEditingWatchlistItem(null);
                      resetWatchlistForm();
                      setShowAddWatchlistItem(true);
                    }}
                    className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
                  >
                    Add Your First Item
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Create Portfolio Modal */}
      {showCreatePortfolio && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">Create Portfolio</h3>
                <button
                  onClick={() => {
                    setShowCreatePortfolio(false);
                    setPortfolioName('');
                    setPortfolioDescription('');
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Portfolio Name *
                  </label>
                  <input
                    type="text"
                    value={portfolioName}
                    onChange={(e) => setPortfolioName(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., Growth Portfolio"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Description
                  </label>
                  <textarea
                    value={portfolioDescription}
                    onChange={(e) => setPortfolioDescription(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional description..."
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleCreatePortfolio}
                  disabled={!portfolioName.trim()}
                  className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  Create
                </button>
                <button
                  onClick={() => {
                    setShowCreatePortfolio(false);
                    setPortfolioName('');
                    setPortfolioDescription('');
                  }}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Position Modal */}
      {showAddPosition && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">
                  {editingPosition ? 'Edit Position' : 'Add Position'}
                </h3>
                <button
                  onClick={cancelEdit}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Ticker *
                  </label>
                  <input
                    type="text"
                    value={positionTicker}
                    onChange={(e) => setPositionTicker(e.target.value.toUpperCase())}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., AAPL"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    value={positionQuantity}
                    onChange={(e) => setPositionQuantity(e.target.value)}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., 100"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Purchase Date
                  </label>
                  <input
                    type="date"
                    value={positionPurchaseDate}
                    onChange={(e) => setPositionPurchaseDate(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Purchase Price
                  </label>
                  <input
                    type="number"
                    value={positionPurchasePrice}
                    onChange={(e) => setPositionPurchasePrice(e.target.value)}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., 150.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Thesis ID (optional)
                  </label>
                  <input
                    type="text"
                    value={positionThesisId}
                    onChange={(e) => setPositionThesisId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Link to investment thesis"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    You can link this position to an investment thesis
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Notes
                  </label>
                  <textarea
                    value={positionNotes}
                    onChange={(e) => setPositionNotes(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional notes about this position..."
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={editingPosition ? handleUpdatePosition : handleAddPosition}
                  disabled={!positionTicker.trim() || !positionQuantity}
                  className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {editingPosition ? 'Update' : 'Add'} Position
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Watchlist Item Modal */}
      {showAddWatchlistItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">
                  {editingWatchlistItem ? 'Edit Watchlist Item' : 'Add to Watchlist'}
                </h3>
                <button
                  onClick={cancelEdit}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Ticker *
                  </label>
                  <input
                    type="text"
                    value={watchlistTicker}
                    onChange={(e) => setWatchlistTicker(e.target.value.toUpperCase())}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., AAPL"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Priority
                  </label>
                  <select
                    value={watchlistPriority}
                    onChange={(e) => setWatchlistPriority(e.target.value as 'low' | 'medium' | 'high')}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Target Price
                  </label>
                  <input
                    type="number"
                    value={watchlistTargetPrice}
                    onChange={(e) => setWatchlistTargetPrice(e.target.value)}
                    min="0"
                    step="0.01"
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="e.g., 150.00"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Optional: Price at which you'd consider buying
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Thesis ID (optional)
                  </label>
                  <input
                    type="text"
                    value={watchlistThesisId}
                    onChange={(e) => setWatchlistThesisId(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Link to investment thesis"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    You can link this item to an investment thesis
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">
                    Notes
                  </label>
                  <textarea
                    value={watchlistNotes}
                    onChange={(e) => setWatchlistNotes(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Optional notes about this stock..."
                  />
                </div>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  onClick={editingWatchlistItem ? handleUpdateWatchlistItem : handleAddWatchlistItem}
                  disabled={!watchlistTicker.trim()}
                  className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:bg-gray-300 disabled:cursor-not-allowed"
                >
                  {editingWatchlistItem ? 'Update' : 'Add'} Item
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

