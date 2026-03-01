'use client';

import { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import { useRouter } from 'next/navigation';
import { Position, Portfolio, type Band, type PortfolioAccountType, type Transaction } from '../lib/services/portfolioService';
import { WatchlistItem } from '../lib/services/watchlistService';
import { TAX_RATES, computeTaxImpactFromLots, type Lot } from '../lib/taxEstimator';
import PortfolioBenchmarkChart from './PortfolioBenchmarkChart';
import PortfolioConcerns from './PortfolioConcerns';
import TodoPopover from './TodoPopover';

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
  const [showAddTransaction, setShowAddTransaction] = useState(false);
  const [showAddWatchlistItem, setShowAddWatchlistItem] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [editingPositionMetadata, setEditingPositionMetadata] = useState<Position | null>(null);
  const [transactionHistoryTicker, setTransactionHistoryTicker] = useState<string | null>(null);
  const [transactionsForTicker, setTransactionsForTicker] = useState<Transaction[]>([]);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
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
  // Transaction form state (for Add Transaction / Edit Transaction)
  const [transactionType, setTransactionType] = useState<'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash'>('buy');
  const [transactionTicker, setTransactionTicker] = useState('');
  const [transactionDate, setTransactionDate] = useState('');
  const [transactionQuantity, setTransactionQuantity] = useState('');
  const [transactionPrice, setTransactionPrice] = useState('');
  const [transactionAmount, setTransactionAmount] = useState('');
  const [transactionNotes, setTransactionNotes] = useState('');

  // Watchlist form states
  const [watchlistTicker, setWatchlistTicker] = useState('');
  const [watchlistNotes, setWatchlistNotes] = useState('');
  const [watchlistThesisId, setWatchlistThesisId] = useState('');
  const [watchlistTargetPrice, setWatchlistTargetPrice] = useState('');
  const [watchlistPriority, setWatchlistPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [positionPrices, setPositionPrices] = useState<Record<string, number>>({});
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsName, setSettingsName] = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [settingsAccountType, setSettingsAccountType] = useState<PortfolioAccountType>('taxable');
  const [settingsBands, setSettingsBands] = useState<Band[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [positionBandId, setPositionBandId] = useState('');
  const [importInProgress, setImportInProgress] = useState(false);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [cashTransactions, setCashTransactions] = useState<Transaction[]>([]);
  const csvFileInputRef = useRef<HTMLInputElement>(null);

  // Tax summary (taxable portfolios only)
  type TaxSummary = {
    taxable: boolean;
    year?: number;
    firstTransactionYear?: number;
    message?: string;
    realizedGainsYtd?: number;
    dividendIncomeYtd?: number;
    taxOnGains?: number;
    taxOnDividends?: number;
    estimatedTaxDue?: number;
    gainsByTicker?: Record<
      string,
      { realizedGain: number; shortTermGain: number; longTermGain: number; termType: 'short-term' | 'long-term' | 'mixed'; taxOnGains: number }
    >;
    disclaimer?: string;
  };
  const [taxSummary, setTaxSummary] = useState<TaxSummary | null>(null);
  const [taxSummaryLoading, setTaxSummaryLoading] = useState(false);
  const [taxDrawerOpen, setTaxDrawerOpen] = useState(false);
  const [taxDrawerYear, setTaxDrawerYear] = useState(() => new Date().getFullYear());
  const [taxDrawerSummary, setTaxDrawerSummary] = useState<TaxSummary | null>(null);
  const [taxDrawerLoading, setTaxDrawerLoading] = useState(false);
  const [taxImpactTicker, setTaxImpactTicker] = useState('');
  const [taxImpactShares, setTaxImpactShares] = useState('');
  const [taxImpactPrice, setTaxImpactPrice] = useState('');
  const [taxImpactLots, setTaxImpactLots] = useState<Lot[] | null>(null);
  const [taxImpactLotsLoading, setTaxImpactLotsLoading] = useState(false);
  const [cashDrawerOpen, setCashDrawerOpen] = useState(false);

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

  // Load cash transactions when a portfolio is selected
  useEffect(() => {
    if (selectedPortfolio?.id) {
      loadCashTransactions(selectedPortfolio.id);
    } else {
      setCashTransactions([]);
    }
  }, [selectedPortfolio?.id]);

  // Fetch tax summary when a portfolio is selected
  useEffect(() => {
    if (!selectedPortfolio?.id) {
      setTaxSummary(null);
      setTaxDrawerOpen(false);
      setTaxDrawerSummary(null);
      setCashDrawerOpen(false);
      setTaxImpactTicker('');
      setTaxImpactShares('');
      setTaxImpactPrice('');
      setTaxImpactLots(null);
      return;
    }
    let cancelled = false;
    setTaxSummaryLoading(true);
    fetch(`/api/portfolios/${selectedPortfolio.id}/tax`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success && json.data) setTaxSummary(json.data as TaxSummary);
        else setTaxSummary(null);
      })
      .catch(() => {
        if (!cancelled) setTaxSummary(null);
      })
      .finally(() => {
        if (!cancelled) setTaxSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPortfolio?.id]);

  // Fetch open lots for the selected position (for lot-based tax impact)
  useEffect(() => {
    const ticker = taxImpactTicker.trim();
    if (!ticker || !selectedPortfolio?.id) {
      setTaxImpactLots(null);
      return;
    }
    let cancelled = false;
    setTaxImpactLotsLoading(true);
    fetch(`/api/portfolios/${selectedPortfolio.id}/lots?ticker=${encodeURIComponent(ticker)}`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success && Array.isArray(json.data?.lots)) setTaxImpactLots(json.data.lots as Lot[]);
        else setTaxImpactLots(null);
      })
      .catch(() => {
        if (!cancelled) setTaxImpactLots(null);
      })
      .finally(() => {
        if (!cancelled) setTaxImpactLotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPortfolio?.id, taxImpactTicker]);

  const fetchTaxForYear = async (year: number) => {
    if (!selectedPortfolio?.id) return;
    setTaxDrawerLoading(true);
    try {
      const res = await fetch(`/api/portfolios/${selectedPortfolio.id}/tax?year=${year}`);
      const json = await res.json();
      if (json.success && json.data) setTaxDrawerSummary(json.data as TaxSummary);
      else setTaxDrawerSummary(null);
    } catch {
      setTaxDrawerSummary(null);
    } finally {
      setTaxDrawerLoading(false);
    }
  };

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

  // Tax impact of potential sell (lot-based when lots available, else average cost fallback)
  const taxImpactResult = useMemo(() => {
    const positions = selectedPortfolio?.positions ?? [];
    if (!taxImpactTicker.trim() || positions.length === 0) return null;
    const position = positions.find((p) => p.ticker.toUpperCase() === taxImpactTicker.toUpperCase());
    if (!position) return null;
    const shares = parseFloat(taxImpactShares);
    if (!Number.isFinite(shares) || shares <= 0 || shares > position.quantity) return null;
    const priceRaw = taxImpactPrice.trim() ? parseFloat(taxImpactPrice) : positionPrices[position.ticker.toUpperCase()];
    const price = priceRaw != null && Number.isFinite(priceRaw) ? priceRaw : null;
    if (price == null || price <= 0) return null;
    const saleDate = new Date().toISOString().slice(0, 10);

    if (taxImpactLots && taxImpactLots.length > 0) {
      const totalSharesInLots = taxImpactLots.reduce((s, l) => s + l.quantity, 0);
      if (totalSharesInLots >= shares) {
        const result = computeTaxImpactFromLots(taxImpactLots, shares, price, saleDate, TAX_RATES);
        return {
          gain: result.totalGain,
          estimatedTax: result.estimatedTax,
          shortTermGain: result.shortTermGain,
          longTermGain: result.longTermGain,
          breakdown: result.breakdown,
          useLots: true,
        };
      }
    }

    // Fallback: average cost and earliest purchase date
    const costBasis = position.purchasePrice ?? 0;
    const gain = (price - costBasis) * shares;
    const purchaseDate = position.purchaseDate ? new Date(position.purchaseDate) : null;
    const oneYearMs = 365.25 * 24 * 60 * 60 * 1000;
    const isLongTerm = purchaseDate ? Date.now() - purchaseDate.getTime() > oneYearMs : false;
    const rate = isLongTerm ? TAX_RATES.longTermCapitalGains : TAX_RATES.shortTermCapitalGains;
    const estimatedTax = gain > 0 ? gain * rate : 0;
    return {
      gain,
      estimatedTax,
      shortTermGain: isLongTerm ? 0 : gain,
      longTermGain: isLongTerm ? gain : 0,
      breakdown: [],
      useLots: false,
    };
  }, [
    selectedPortfolio?.positions,
    taxImpactTicker,
    taxImpactShares,
    taxImpactPrice,
    positionPrices,
    taxImpactLots,
  ]);

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
        setSettingsOpen(false);
        await fetchPortfolios();
        setSelectedPortfolio(null);
      } else {
        setError(result.error || 'Failed to delete portfolio');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete portfolio');
    }
  };

  const openSettings = () => {
    if (selectedPortfolio) {
      setSettingsName(selectedPortfolio.name);
      setSettingsDescription(selectedPortfolio.description || '');
      setSettingsAccountType(selectedPortfolio.accountType || 'taxable');
      setSettingsBands(selectedPortfolio.bands ?? []);
      setSettingsOpen(true);
    }
  };

  const addBand = () => {
    setSettingsBands((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: '',
        sizeMinPct: 0,
        sizeMaxPct: 10,
        maxPositionSizePct: undefined,
        maxDrawdownPct: undefined,
      },
    ]);
  };

  const updateBand = (id: string, updates: Partial<Band>) => {
    setSettingsBands((prev) =>
      prev.map((b) => (b.id === id ? { ...b, ...updates } : b))
    );
  };

  const removeBand = (id: string) => {
    setSettingsBands((prev) => prev.filter((b) => b.id !== id));
  };

  const handleSaveSettings = async () => {
    if (!selectedPortfolio?.id || !settingsName.trim()) return;
    setSavingSettings(true);
    setError(null);
    try {
      const response = await fetch(`/api/portfolios/${selectedPortfolio.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: settingsName.trim(),
          description: settingsDescription.trim(),
          accountType: settingsAccountType,
          bands: settingsBands.map((b) => ({
            id: b.id,
            name: b.name.trim(),
            sizeMinPct: b.sizeMinPct,
            sizeMaxPct: b.sizeMaxPct,
            maxPositionSizePct: b.maxPositionSizePct,
            maxDrawdownPct: b.maxDrawdownPct,
            expectedReturnMinPct: b.expectedReturnMinPct,
            expectedReturnMaxPct: b.expectedReturnMaxPct,
          })),
        }),
      });
      const result = await response.json();
      if (result.success) {
        setSelectedPortfolio(result.data);
        setSettingsOpen(false);
      } else {
        setError(result.error || 'Failed to update portfolio');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update portfolio');
    } finally {
      setSavingSettings(false);
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
        const updated = result.data?.portfolio;
        if (updated?.id) {
          setSelectedPortfolio(updated);
        } else if (selectedPortfolio?.id) {
          await loadPortfolio(selectedPortfolio.id);
        }
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
        const updated = result.data;
        if (updated?.id) {
          setSelectedPortfolio(updated);
        } else if (selectedPortfolio?.id) {
          await loadPortfolio(selectedPortfolio.id);
        }
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
    setPositionBandId('');
  };

  const startEditPositionMetadata = (position: Position) => {
    setEditingPositionMetadata(position);
    setPositionThesisId(position.thesisId || '');
    setPositionNotes(position.notes || '');
    setPositionBandId(position.bandId ?? '');
  };

  const loadTransactionsForTicker = async (ticker: string) => {
    if (!selectedPortfolio?.id) return;
    try {
      const res = await fetch(`/api/portfolios/${selectedPortfolio.id}/transactions?ticker=${encodeURIComponent(ticker)}`);
      const result = await res.json();
      if (result.success) setTransactionsForTicker(result.data);
      else setTransactionsForTicker([]);
    } catch {
      setTransactionsForTicker([]);
    }
  };

  const openTransactionHistory = (ticker: string) => {
    setTransactionHistoryTicker(ticker);
    setEditingTransaction(null);
    loadTransactionsForTicker(ticker);
  };

  const loadCashTransactions = async (portfolioId: string) => {
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/transactions`);
      const result = await res.json();
      if (result.success && Array.isArray(result.data)) {
        setCashTransactions(result.data.filter((tx: Transaction) => tx.type === 'cash'));
      } else {
        setCashTransactions([]);
      }
    } catch {
      setCashTransactions([]);
    }
  };

  const handleSavePositionMetadata = async () => {
    if (!selectedPortfolio?.id || !editingPositionMetadata?.id) return;
    setError(null);
    try {
      const response = await fetch(
        `/api/portfolios/${selectedPortfolio.id}/positions/${editingPositionMetadata.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            thesisId: positionThesisId || null,
            notes: positionNotes || '',
            bandId: positionBandId || null,
          }),
        }
      );
      const result = await response.json();
      if (result.success) {
        setSelectedPortfolio(result.data);
        setEditingPositionMetadata(null);
      } else {
        setError(result.error || 'Failed to update position');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update position');
    }
  };

  const handleAddTransaction = async () => {
    if (!selectedPortfolio?.id) return;
    const type = transactionType;
    const ticker = transactionTicker.trim().toUpperCase() || null;
    if (type !== 'cash' && !ticker) {
      setError('Ticker is required for non-cash transactions');
      return;
    }
    const date = transactionDate || new Date().toISOString().slice(0, 10);
    const quantity = type === 'cash' || type === 'dividend' ? 0 : parseFloat(transactionQuantity) || 0;
    const price = transactionPrice ? parseFloat(transactionPrice) : null;
    let amount = transactionAmount ? parseFloat(transactionAmount) : 0;
    if (type === 'buy' || type === 'dividend_reinvest') {
      if (quantity > 0 && price != null) amount = -(quantity * price);
    } else if (type === 'sell') {
      if (quantity < 0 && price != null) amount = Math.abs(quantity) * price;
    }
    setError(null);
    try {
      const response = await fetch(`/api/portfolios/${selectedPortfolio.id}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          ticker,
          date,
          quantity,
          price,
          amount,
          notes: transactionNotes || '',
        }),
      });
      const result = await response.json();
      if (result.success) {
        setSelectedPortfolio(result.portfolio);
        setShowAddTransaction(false);
        setTransactionTicker('');
        setTransactionQuantity('');
        setTransactionPrice('');
        setTransactionAmount('');
        setTransactionNotes('');
        if (type === 'cash' && selectedPortfolio.id) {
          loadCashTransactions(selectedPortfolio.id);
        }
      } else {
        setError(result.error || 'Failed to add transaction');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add transaction');
    }
  };

  const handleUpdateTransaction = async () => {
    if (!selectedPortfolio?.id || !editingTransaction?.id) return;
    const type = (editingTransaction.type || transactionType) as 'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash';
    const ticker = transactionTicker.trim().toUpperCase() || null;
    if (type !== 'cash' && !ticker) {
      setError('Ticker is required for non-cash transactions');
      return;
    }
    const date = transactionDate || editingTransaction.date;
    const quantity = type === 'cash' || type === 'dividend' ? 0 : parseFloat(transactionQuantity) || 0;
    const price = transactionPrice ? parseFloat(transactionPrice) : null;
    let amount = transactionAmount ? parseFloat(transactionAmount) : editingTransaction.amount;
    if (type === 'buy' || type === 'dividend_reinvest') {
      if (quantity > 0 && price != null) amount = -(quantity * price);
    } else if (type === 'sell') {
      if (quantity < 0 && price != null) amount = Math.abs(quantity) * price;
    }
    setError(null);
    try {
      const response = await fetch(
        `/api/portfolios/${selectedPortfolio.id}/transactions/${editingTransaction.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type, ticker, date, quantity, price, amount, notes: transactionNotes || '' }),
        }
      );
      const result = await response.json();
      if (result.success) {
        setSelectedPortfolio(result.portfolio);
        setEditingTransaction(null);
        if (transactionHistoryTicker) loadTransactionsForTicker(transactionHistoryTicker);
      } else {
        setError(result.error || 'Failed to update transaction');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update transaction');
    }
  };

  const handleDeleteTransaction = async (transactionId: string) => {
    if (!selectedPortfolio?.id) return;
    if (!confirm('Delete this transaction? Position will be recomputed.')) return;
    try {
      const response = await fetch(
        `/api/portfolios/${selectedPortfolio.id}/transactions/${transactionId}`,
        { method: 'DELETE' }
      );
      const result = await response.json();
      if (result.success) {
        setSelectedPortfolio(result.portfolio);
        if (transactionHistoryTicker) loadTransactionsForTicker(transactionHistoryTicker);
      } else {
        setError(result.error || 'Failed to delete transaction');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete transaction');
    }
  };

  const handleImportCsv = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selectedPortfolio?.id) return;
    setError(null);
    setImportMessage(null);
    setImportInProgress(true);
    try {
      const text = await file.text();
      const res = await fetch(
        `/api/portfolios/${selectedPortfolio.id}/transactions/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ csv: text }),
        }
      );
      const result = await res.json();
      if (!res.ok) {
        setError(result.error ?? 'Import failed');
        setImportMessage(null);
        return;
      }
      if (result.success && result.data) {
        const { equityOk, cashOk, skipped, failed } = result.data;
        const parts = [`Imported ${equityOk} equity, ${cashOk} cash`];
        if (skipped > 0) parts.push(`${skipped} duplicate(s) skipped`);
        if (failed > 0) parts.push(`${failed} failed`);
        setImportMessage(parts.join('. ') + '.');
        if (result.portfolio) setSelectedPortfolio(result.portfolio);
      }
      if (selectedPortfolio?.id) {
        await loadPortfolio(selectedPortfolio.id);
        await loadCashTransactions(selectedPortfolio.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      setImportMessage(null);
    } finally {
      setImportInProgress(false);
    }
  };

  const startEditTransaction = (tx: Transaction) => {
    setEditingTransaction(tx);
    setTransactionType(tx.type as 'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash');
    setTransactionTicker(tx.ticker || '');
    setTransactionDate(tx.date || '');
    setTransactionQuantity(tx.quantity.toString());
    setTransactionPrice(tx.price != null ? String(tx.price) : '');
    setTransactionAmount(String(tx.amount));
    setTransactionNotes(tx.notes || '');
  };

  const cancelEdit = () => {
    setEditingPosition(null);
    setEditingPositionMetadata(null);
    setEditingTransaction(null);
    setEditingWatchlistItem(null);
    setShowAddPosition(false);
    setShowAddTransaction(false);
    setShowAddWatchlistItem(false);
    setTransactionHistoryTicker(null);
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
              className="w-full px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
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
                  <div className="flex items-center gap-6 flex-wrap">
                    {totalPortfolioValue != null && (
                      <div className="flex flex-col">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Total value</span>
                        <span className="text-2xl font-bold text-gray-900 tracking-tight">
                          ${totalPortfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setCashDrawerOpen(true)}
                      className="flex flex-col items-start rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 hover:bg-blue-50 hover:border-blue-200 hover:shadow-sm transition-colors text-left min-w-[7rem] group"
                      title="View cash transactions"
                    >
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1 group-hover:text-blue-600">
                        Cash
                        <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </span>
                      <span className="text-lg font-semibold text-gray-900 group-hover:text-blue-700">
                        ${((selectedPortfolio.cashBalance ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    </button>
                    {taxSummary?.taxable && (
                      <button
                        type="button"
                        onClick={() => {
                          setTaxDrawerYear(new Date().getFullYear());
                          setTaxDrawerSummary(taxSummary);
                          setTaxDrawerOpen(true);
                        }}
                        className="flex flex-col items-start rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 hover:bg-blue-50 hover:border-blue-200 hover:shadow-sm transition-colors text-left min-w-[7rem] group"
                        title="View tax details and pick year"
                      >
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1 group-hover:text-blue-600">
                          Tax (YTD)
                          <svg className="w-3.5 h-3.5 text-gray-400 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </span>
                        <span className="text-lg font-semibold text-gray-900 group-hover:text-blue-700">
                          ${(taxSummary.estimatedTaxDue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </button>
                    )}
                    <TodoPopover />
                    <button
                      type="button"
                      onClick={openSettings}
                      className="p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                      title="Portfolio settings"
                      aria-label="Portfolio settings"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </button>
                  </div>
                </div>
                {(() => {
                  const CHANNEL_LABELS: Record<string, string> = {
                    EQUITIES_US: 'Equity market',
                    CREDIT: 'Credit',
                    VOL: 'Volatility',
                    RATES_SHORT: 'Short rates',
                    RATES_LONG: 'Long rates',
                    USD: 'USD',
                    OIL: 'Oil',
                    GOLD: 'Gold',
                    INFLATION: 'Inflation',
                    GLOBAL_RISK: 'Global risk',
                  };
                  const channels = selectedPortfolio.channelExposures?.channels;
                  const systematicRisks: { label: string; level: 'HIGH' | 'MED' | 'LOW-MED' | 'LOW' }[] = channels
                    ? Object.entries(channels)
                        .map(([ch, exp]) => {
                          const absBeta = Math.abs(exp.beta);
                          const r2 = exp.rSquared ?? 0;
                          const reliableImpact = absBeta * r2;
                          const level: 'HIGH' | 'MED' | 'LOW-MED' | 'LOW' =
                            reliableImpact >= 0.03 ? 'HIGH'
                            : reliableImpact >= 0.005 ? 'MED'
                            : reliableImpact >= 0.001 ? 'LOW-MED'
                            : 'LOW';
                          return {
                            label: CHANNEL_LABELS[ch] ?? ch,
                            reliableImpact,
                            level,
                          };
                        })
                        .sort((a, b) => b.reliableImpact - a.reliableImpact)
                        .slice(0, 5)
                        .map(({ label, level }) => ({ label, level }))
                    : [];
                  const levelBars: Record<string, number> = { HIGH: 3, MED: 2, 'LOW-MED': 2, LOW: 1 };
                  const levelColors: Record<string, string> = {
                    HIGH: '#dc2626',
                    MED: '#d97706',
                    'LOW-MED': '#ca8a04',
                    LOW: '#16a34a',
                  };
                  const RiskBars = ({ level }: { level: keyof typeof levelBars }) => {
                    const n = levelBars[level];
                    const color = levelColors[level];
                    const halfSecond = level === 'LOW-MED';
                    return (
                      <span className="inline-flex items-end gap-0.5" title={level} aria-label={level}>
                        {[1, 2, 3].map((i) => {
                          const filled = i < n;
                          const half = i === n && halfSecond;
                          const show = filled || half;
                          return (
                            <span
                              key={i}
                              className="w-1 rounded-sm"
                              style={{
                                height: 10,
                                backgroundColor: show ? color : '#e5e7eb',
                                opacity: half ? 0.5 : 1,
                              }}
                            />
                          );
                        })}
                      </span>
                    );
                  };
                  return (
                    <div className="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                      <span className="font-medium text-gray-400">Systematic risks:</span>
                      {systematicRisks.length > 0 ? (
                        systematicRisks.map(({ label, level }) => (
                          <span key={label} className="inline-flex items-center gap-1.5">
                            {label} <RiskBars level={level} />
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-400">Run portfolio channel exposure to see systematic risks</span>
                      )}
                    </div>
                  );
                })()}
                {settingsOpen && (
                  <div className="mt-4 pt-4 border-t border-gray-200 max-h-[min(60vh,500px)] overflow-y-auto">
                    <h3 className="text-sm font-semibold text-gray-800 mb-3">Portfolio settings</h3>
                    <div className="grid gap-3 max-w-xl">
                      <label className="block">
                        <span className="text-sm text-gray-600">Name</span>
                        <input
                          type="text"
                          value={settingsName}
                          onChange={(e) => setSettingsName(e.target.value)}
                          className="mt-1 block w-full px-3 py-2 text-black border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </label>
                      <label className="block">
                        <span className="text-sm text-gray-600">Description</span>
                        <textarea
                          value={settingsDescription}
                          onChange={(e) => setSettingsDescription(e.target.value)}
                          rows={2}
                          className="mt-1 block w-full px-3 py-2 text-black border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                      </label>
                      <div>
                        <span className="text-sm text-gray-600 block mb-1">Account type</span>
                        <div className="flex gap-4">
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="accountType"
                              checked={settingsAccountType === 'taxable'}
                              onChange={() => setSettingsAccountType('taxable')}
                              className="text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm">Taxable</span>
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="radio"
                              name="accountType"
                              checked={settingsAccountType === 'ira'}
                              onChange={() => setSettingsAccountType('ira')}
                              className="text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-sm">IRA</span>
                          </label>
                        </div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-gray-600">Risk bands</span>
                          <button
                            type="button"
                            onClick={addBand}
                            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                          >
                            + Add band
                          </button>
                        </div>
                        <p className="text-xs text-gray-500 mb-2">
                          Bands define portfolio size ranges (e.g. 10–20%) and optional limits (max position size, max drawdown). Assign bands to positions in the position edit dialog.
                        </p>
                        {settingsBands.length === 0 ? (
                          <p className="text-sm text-gray-400 italic">No bands defined.</p>
                        ) : (
                          <ul className="space-y-3">
                            {settingsBands.map((band) => (
                              <li
                                key={band.id}
                                className="border border-gray-200 rounded-lg p-3 bg-gray-50/50 space-y-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <input
                                    type="text"
                                    value={band.name}
                                    onChange={(e) => updateBand(band.id, { name: e.target.value })}
                                    placeholder="Band name"
                                    className="flex-1 min-w-0 px-2 py-1.5 text-sm text-black border border-gray-300 rounded focus:ring-2 focus:ring-blue-500"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeBand(band.id)}
                                    className="p-1.5 text-gray-400 hover:text-red-600 rounded"
                                    title="Remove band"
                                    aria-label="Remove band"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </div>
                                <div className="grid grid-cols-2 gap-2 text-sm">
                                  <label className="flex flex-col gap-0.5">
                                    <span className="text-gray-500">Size range %</span>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={0.5}
                                        value={band.sizeMinPct}
                                        onChange={(e) => updateBand(band.id, { sizeMinPct: parseFloat(e.target.value) || 0 })}
                                        className="w-16 px-2 py-1 text-black border border-gray-300 rounded"
                                      />
                                      <span className="text-gray-400">–</span>
                                      <input
                                        type="number"
                                        min={0}
                                        max={100}
                                        step={0.5}
                                        value={band.sizeMaxPct}
                                        onChange={(e) => updateBand(band.id, { sizeMaxPct: parseFloat(e.target.value) || 0 })}
                                        className="w-16 px-2 py-1 text-black border border-gray-300 rounded"
                                      />
                                    </div>
                                  </label>
                                  <label className="flex flex-col gap-0.5">
                                    <span className="text-gray-500">Max position %</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={0.5}
                                      placeholder="—"
                                      value={band.maxPositionSizePct ?? ''}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        updateBand(band.id, { maxPositionSizePct: v === '' ? undefined : parseFloat(v) || 0 });
                                      }}
                                      className="w-full px-2 py-1 text-black border border-gray-300 rounded"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-0.5 col-span-2">
                                    <span className="text-gray-500">Max drawdown %</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={100}
                                      step={0.5}
                                      placeholder="—"
                                      value={band.maxDrawdownPct ?? ''}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        updateBand(band.id, { maxDrawdownPct: v === '' ? undefined : parseFloat(v) || 0 });
                                      }}
                                      className="w-full max-w-[8rem] px-2 py-1 text-black border border-gray-300 rounded"
                                    />
                                  </label>
                                  <label className="flex flex-col gap-0.5 col-span-2">
                                    <span className="text-gray-500">Expected return range % (annual)</span>
                                    <div className="flex items-center gap-1">
                                      <input
                                        type="number"
                                        min={-100}
                                        max={200}
                                        step={0.5}
                                        placeholder="Min"
                                        value={band.expectedReturnMinPct ?? ''}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          updateBand(band.id, { expectedReturnMinPct: v === '' ? undefined : parseFloat(v) || 0 });
                                        }}
                                        className="w-16 px-2 py-1 text-black border border-gray-300 rounded"
                                      />
                                      <span className="text-gray-400">–</span>
                                      <input
                                        type="number"
                                        min={-100}
                                        max={200}
                                        step={0.5}
                                        placeholder="Max"
                                        value={band.expectedReturnMaxPct ?? ''}
                                        onChange={(e) => {
                                          const v = e.target.value;
                                          updateBand(band.id, { expectedReturnMaxPct: v === '' ? undefined : parseFloat(v) || 0 });
                                        }}
                                        className="w-16 px-2 py-1 text-black border border-gray-300 rounded"
                                      />
                                    </div>
                                  </label>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <div className="flex items-center gap-3 pt-2">
                        <button
                          type="button"
                          onClick={handleSaveSettings}
                          disabled={savingSettings || !settingsName.trim()}
                          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-md"
                        >
                          {savingSettings ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSettingsOpen(false)}
                          className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => selectedPortfolio?.id && handleDeletePortfolio(selectedPortfolio.id)}
                          className="ml-auto px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 rounded-md"
                        >
                          Delete portfolio
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                {selectedPortfolio.id && (
                  <>
                    <div className="mb-6">
                      <PortfolioConcerns
                        portfolioId={selectedPortfolio.id}
                        onTickerClick={(ticker) => router.push(`/${ticker}/value`)}
                      />
                    </div>
                    <div className="mb-6">
                      <PortfolioBenchmarkChart portfolioId={selectedPortfolio.id} />
                    </div>
                  </>
                )}
                {(selectedPortfolio.positions ?? []).filter((p) => (Number(p.quantity) || 0) > 0.0001).length > 0 ? (
                  <div>
                    <div className="flex justify-end items-center gap-2 mb-3 flex-wrap">
                      <input
                        ref={csvFileInputRef}
                        type="file"
                        accept=".csv"
                        className="hidden"
                        onChange={handleImportCsv}
                      />
                      <button
                        type="button"
                        onClick={() => csvFileInputRef.current?.click()}
                        disabled={importInProgress}
                        className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors border border-gray-200 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {importInProgress ? 'Importing…' : 'Import transactions'}
                      </button>
                      <button
                        onClick={() => {
                          setTransactionType('buy');
                          setTransactionTicker('');
                          setTransactionDate(new Date().toISOString().slice(0, 10));
                          setTransactionQuantity('');
                          setTransactionPrice('');
                          setTransactionAmount('');
                          setTransactionNotes('');
                          setShowAddTransaction(true);
                        }}
                        className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors border border-gray-200 hover:border-gray-300"
                      >
                        + Add Transaction
                      </button>
                    </div>
                    {importMessage && (
                      <p className="text-sm text-gray-600 mb-2">{importMessage}</p>
                    )}
                    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Ticker</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Shares</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Weight %</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Return (since buy)</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Drawdown Impact %</th>
                          <th className="text-left py-3 px-4 font-medium text-gray-700">Thesis Status</th>
                          <th className="text-right py-3 px-4 font-medium text-gray-700">Total value</th>
                          <th className="w-28 py-3 px-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const bands = selectedPortfolio.bands ?? [];
                          const positions = (selectedPortfolio.positions ?? []).filter((p) => (Number(p.quantity) || 0) > 0.0001);
                          type Section = { bandId: string | null; bandLabel: string; band: Band | null; positions: Position[] };
                          const sections: Section[] = [];
                          for (const band of bands) {
                            const bandPositions = positions.filter((p) => p.bandId === band.id);
                            if (bandPositions.length > 0) {
                              sections.push({
                                bandId: band.id,
                                bandLabel: band.name || `${band.sizeMinPct}–${band.sizeMaxPct}%`,
                                band,
                                positions: bandPositions,
                              });
                            }
                          }
                          const unassigned = positions.filter((p) => !p.bandId);
                          if (unassigned.length > 0) {
                            sections.push({ bandId: null, bandLabel: 'No band', band: null, positions: unassigned });
                          }
                          if (sections.length === 0 && positions.length > 0) {
                            sections.push({ bandId: null, bandLabel: 'No band', band: null, positions });
                          }
                          return sections.map((section) => {
                            const bandTotalValue = totalPortfolioValue != null && totalPortfolioValue > 0
                              ? section.positions.reduce((sum, p) => {
                                  const price = positionPrices[p.ticker.toUpperCase()];
                                  return sum + (price != null ? p.quantity * price : 0);
                                }, 0)
                              : null;
                            const actualPct = bandTotalValue != null && totalPortfolioValue != null && totalPortfolioValue > 0
                              ? (bandTotalValue / totalPortfolioValue) * 100
                              : null;
                            const targetRange = section.band
                              ? `${section.band.sizeMinPct}–${section.band.sizeMaxPct}%`
                              : null;
                            const isViolation = section.band != null && actualPct != null &&
                              (actualPct < section.band.sizeMinPct || actualPct > section.band.sizeMaxPct);
                            return (
                            <Fragment key={section.bandId ?? 'none'}>
                              <tr className={`border-b border-gray-200 ${isViolation ? 'bg-red-50 border-l-4 border-l-red-500' : 'bg-gray-100'}`}>
                                <td colSpan={8} className="py-2 px-4 font-semibold text-gray-800">
                                  {section.bandLabel}
                                  {isViolation && (
                                    <span className="ml-2 text-red-700 font-medium text-xs uppercase tracking-wide">Violation</span>
                                  )}
                                  {actualPct != null && (
                                    <span className={`font-normal ml-2 ${isViolation ? 'text-red-800' : 'text-gray-600'}`}>
                                      — {actualPct.toFixed(1)}% of portfolio
                                      {targetRange != null && (
                                        <span> (target {targetRange})</span>
                                      )}
                                    </span>
                                  )}
                                </td>
                              </tr>
                              {section.positions.map((position) => {
                                const tickerKey = position.ticker.toUpperCase();
                                const currentPrice = positionPrices[tickerKey];
                                const avgCost = position.purchasePrice ?? null;
                                const totalValue = currentPrice != null ? position.quantity * currentPrice : null;
                                const returnSinceBuy =
                                  avgCost != null && avgCost > 0 && currentPrice != null
                                    ? ((currentPrice - avgCost) / avgCost) * 100
                                    : null;
                                const weightPct =
                                  totalPortfolioValue != null && totalPortfolioValue > 0 && totalValue != null
                                    ? (totalValue / totalPortfolioValue) * 100
                                    : null;
                                const maxPositionPct = section.band?.maxPositionSizePct;
                                const isOversized = maxPositionPct != null && weightPct != null && weightPct > maxPositionPct;
                                return (
                                  <tr
                                    key={position.id}
                                    className={`border-b border-gray-100 hover:bg-gray-50 ${isOversized ? 'bg-amber-50' : ''}`}
                                  >
                                    <td className="py-3 px-4 font-medium text-gray-900">
                                      {position.ticker}
                                      {isOversized && (
                                        <span className="ml-2 text-amber-700 font-normal text-xs" title={`Position is ${weightPct?.toFixed(1)}% of portfolio; max for this band is ${maxPositionPct}%`}>
                                          Oversized
                                        </span>
                                      )}
                                    </td>
                                    <td className="py-3 px-4 text-right text-gray-700">
                                      {position.quantity.toLocaleString()}
                                    </td>
                                    <td className="py-3 px-4 text-right text-gray-700">
                                      {weightPct != null ? `${weightPct.toFixed(1)}%` : ''}
                                    </td>
                                    <td className="py-3 px-4 text-right">
                                      {returnSinceBuy != null ? (
                                        <span className={returnSinceBuy >= 0 ? 'text-green-600' : 'text-red-600'}>
                                          {returnSinceBuy >= 0 ? '+' : ''}{returnSinceBuy.toFixed(1)}%
                                        </span>
                                      ) : (
                                        ''
                                      )}
                                    </td>
                                    <td className="py-3 px-4 text-right text-gray-700" />
                                    <td className="py-3 px-4 text-gray-700">
                                      {position.thesisId ? 'Linked' : ''}
                                    </td>
                                    <td className="py-3 px-4 text-right text-gray-700">
                                      {totalValue != null ? `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}
                                    </td>
                                    <td className="py-3 px-4">
                                      <div className="flex items-center gap-1">
                                        <button
                                          type="button"
                                          onClick={() => startEditPositionMetadata(position)}
                                          title="Edit thesis and notes"
                                          aria-label="Edit position metadata"
                                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                                        >
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => openTransactionHistory(position.ticker)}
                                          title="Transaction history"
                                          aria-label="Transaction history"
                                          className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                        >
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                          </svg>
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => handleDeletePosition(position.id!)}
                                          title="Delete position"
                                          aria-label="Delete position"
                                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                        >
                                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                          </svg>
                                        </button>
                                        {position.thesisId && (
                                          <button
                                            type="button"
                                            onClick={() => router.push(`/${position.ticker}/thesis`)}
                                            title="View thesis"
                                            aria-label="View thesis"
                                            className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"
                                          >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                            </svg>
                                          </button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </Fragment>
                            );
                          });
                        })()}
                      </tbody>
                    </table>
                  </div>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <p className="text-gray-500 mb-4">No positions in this portfolio yet. Add a transaction or import from CSV.</p>
                    <input
                      ref={csvFileInputRef}
                      type="file"
                      accept=".csv"
                      className="hidden"
                      onChange={handleImportCsv}
                    />
                    <div className="flex justify-center gap-2 flex-wrap">
                      <button
                        type="button"
                        onClick={() => csvFileInputRef.current?.click()}
                        disabled={importInProgress}
                        className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors border border-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {importInProgress ? 'Importing…' : 'Import transactions'}
                      </button>
                      <button
                        onClick={() => {
                          setTransactionType('buy');
                          setTransactionTicker('');
                          setTransactionDate(new Date().toISOString().slice(0, 10));
                          setTransactionQuantity('');
                          setTransactionPrice('');
                          setTransactionAmount('');
                          setTransactionNotes('');
                          setShowAddTransaction(true);
                        }}
                        className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors border border-gray-200"
                      >
                        Add Your First Transaction
                      </button>
                    </div>
                    {importMessage && (
                      <p className="text-sm text-gray-600 mt-2">{importMessage}</p>
                    )}
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
                  className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors border border-gray-200"
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
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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

      {/* Edit position metadata (thesisId, notes only) */}
      {editingPositionMetadata && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">Edit position – {editingPositionMetadata.ticker}</h3>
                <button onClick={() => setEditingPositionMetadata(null)} className="text-gray-600 hover:text-gray-900">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Band (optional)</label>
                  <select
                    value={positionBandId}
                    onChange={(e) => setPositionBandId(e.target.value)}
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">None</option>
                    {(selectedPortfolio?.bands ?? []).map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name || `Band ${b.sizeMinPct}–${b.sizeMaxPct}%`}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Thesis ID (optional)</label>
                  <input
                    type="text"
                    value={positionThesisId}
                    onChange={(e) => setPositionThesisId(e.target.value)}
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Link to investment thesis"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Notes</label>
                  <textarea
                    value={positionNotes}
                    onChange={(e) => setPositionNotes(e.target.value)}
                    rows={3}
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Position notes..."
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleSavePositionMetadata}
                  className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
                >
                  Save
                </button>
                <button onClick={() => setEditingPositionMetadata(null)} className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Transaction Modal */}
      {showAddTransaction && !editingTransaction && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-xl font-bold text-gray-900">Add Transaction</h3>
                <button onClick={() => { setShowAddTransaction(false); cancelEdit(); }} className="text-gray-600 hover:text-gray-900">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Type</label>
                  <select
                    value={transactionType}
                    onChange={(e) => setTransactionType(e.target.value as 'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash')}
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Ticker *</label>
                    <input
                      type="text"
                      value={transactionTicker}
                      onChange={(e) => setTransactionTicker(e.target.value.toUpperCase())}
                      className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="e.g., AAPL"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Date *</label>
                  <input
                    type="date"
                    value={transactionDate}
                    onChange={(e) => setTransactionDate(e.target.value)}
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {(transactionType === 'buy' || transactionType === 'sell' || transactionType === 'dividend_reinvest') && (
                  <>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">
                        Quantity * ({transactionType === 'sell' ? 'negative' : 'positive'})
                      </label>
                      <input
                        type="number"
                        value={transactionQuantity}
                        onChange={(e) => setTransactionQuantity(e.target.value)}
                        step="0.0001"
                        className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder={transactionType === 'sell' ? 'e.g., -10' : 'e.g., 100'}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-2">Price per share</label>
                      <input
                        type="number"
                        value={transactionPrice}
                        onChange={(e) => setTransactionPrice(e.target.value)}
                        min="0"
                        step="0.01"
                        className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        placeholder="e.g., 150.00"
                      />
                    </div>
                  </>
                )}
                {(transactionType === 'dividend' || transactionType === 'cash') && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Amount (cash impact) *</label>
                    <input
                      type="number"
                      value={transactionAmount}
                      onChange={(e) => setTransactionAmount(e.target.value)}
                      step="0.01"
                      className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder={transactionType === 'dividend' ? 'e.g., 25.00' : 'e.g., 1000 or -500'}
                    />
                  </div>
                )}
                {(transactionType === 'buy' || transactionType === 'sell' || transactionType === 'dividend_reinvest') && (
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-2">Amount (optional; auto from qty × price)</label>
                    <input
                      type="number"
                      value={transactionAmount}
                      onChange={(e) => setTransactionAmount(e.target.value)}
                      step="0.01"
                      className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                      placeholder="Leave blank to use quantity × price"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Notes (optional)</label>
                  <input
                    type="text"
                    value={transactionNotes}
                    onChange={(e) => setTransactionNotes(e.target.value)}
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Per-transaction memo"
                  />
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  onClick={handleAddTransaction}
                  disabled={transactionType !== 'cash' && !transactionTicker.trim()}
                  className="flex-1 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Add Transaction
                </button>
                <button onClick={() => { setShowAddTransaction(false); cancelEdit(); }} className="px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 font-medium">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transaction history drawer */}
      {transactionHistoryTicker && (
        <div className="fixed inset-0 flex justify-end z-50 pointer-events-none">
          <div className="pointer-events-auto bg-white w-full max-w-lg shadow-2xl border-l border-gray-200 overflow-y-auto h-full" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">Transactions – {transactionHistoryTicker}</h3>
                <button onClick={() => setTransactionHistoryTicker(null)} className="text-gray-600 hover:text-gray-900 p-1">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {!editingTransaction ? (
                <ul className="space-y-0">
                  {transactionsForTicker.length === 0 && <p className="text-sm text-gray-700 py-4">No transactions yet.</p>}
                  {transactionsForTicker.map((tx) => (
                    <li key={tx.id} className="flex items-center justify-between py-3 px-2 border-b border-gray-200 hover:bg-gray-50 rounded">
                      <span className="text-sm font-medium text-gray-900">
                        {tx.date} {tx.type} {tx.quantity !== 0 ? tx.quantity : ''} {tx.amount !== 0 ? `$${tx.amount.toFixed(2)}` : ''}
                      </span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          onClick={() => startEditTransaction(tx)}
                          className="p-1.5 text-gray-500 hover:bg-gray-100 rounded"
                          aria-label="Edit transaction"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          onClick={() => tx.id && handleDeleteTransaction(tx.id)}
                          className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded"
                          aria-label="Delete transaction"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="space-y-4">
                  <h4 className="font-semibold text-gray-800">Edit transaction</h4>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Type</label>
                    <select
                      value={transactionType}
                      onChange={(e) => setTransactionType(e.target.value as 'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash')}
                      className="w-full px-3 py-2 text-black border border-gray-300 rounded-lg text-sm bg-white"
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
                      <label className="block text-sm text-gray-700 mb-1">Ticker</label>
                      <input
                        type="text"
                        value={transactionTicker}
                        onChange={(e) => setTransactionTicker(e.target.value.toUpperCase())}
                        className="w-full px-3 py-2 text-black border border-gray-300 rounded-lg text-sm bg-white"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Date</label>
                    <input
                      type="date"
                      value={transactionDate}
                      onChange={(e) => setTransactionDate(e.target.value)}
                      className="w-full px-3 py-2 text-black border border-gray-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Quantity</label>
                    <input
                      type="number"
                      value={transactionQuantity}
                      onChange={(e) => setTransactionQuantity(e.target.value)}
                      step="0.0001"
                      className="w-full px-3 py-2 text-black border border-gray-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Price</label>
                    <input
                      type="number"
                      value={transactionPrice}
                      onChange={(e) => setTransactionPrice(e.target.value)}
                      step="0.01"
                      className="w-full px-3 py-2 text-black border border-gray-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Amount</label>
                    <input
                      type="number"
                      value={transactionAmount}
                      onChange={(e) => setTransactionAmount(e.target.value)}
                      step="0.01"
                      className="w-full px-3 py-2 text-black border border-gray-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-gray-700 mb-1">Notes</label>
                    <input
                      type="text"
                      value={transactionNotes}
                      onChange={(e) => setTransactionNotes(e.target.value)}
                      className="w-full px-3 py-2 text-black border border-gray-300 rounded-lg text-sm bg-white"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleUpdateTransaction}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingTransaction(null)}
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
      )}

      {/* Tax details drawer – same pattern as transaction history drawer (no backdrop, close via X) */}
      {taxDrawerOpen && (
        <div className="fixed inset-0 flex justify-end z-50 pointer-events-none">
          <div className="pointer-events-auto bg-white w-full max-w-lg shadow-2xl border-l border-gray-200 overflow-y-auto h-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">Tax</h3>
                <button onClick={() => setTaxDrawerOpen(false)} className="text-gray-600 hover:text-gray-900 p-1" aria-label="Close">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                <select
                  value={taxDrawerYear}
                  onChange={(e) => {
                    const y = parseInt(e.target.value, 10);
                    setTaxDrawerYear(y);
                    fetchTaxForYear(y);
                  }}
                  className="w-full max-w-[8rem] text-sm border border-gray-300 rounded px-3 py-2 text-gray-900 bg-white"
                >
                  {(() => {
                    const currentYear = new Date().getFullYear();
                    const firstYear = taxDrawerSummary?.firstTransactionYear ?? taxSummary?.firstTransactionYear ?? currentYear - 30;
                    const minYear = Math.max(2000, firstYear);
                    const years: number[] = [];
                    for (let y = currentYear; y >= minYear; y--) years.push(y);
                    return years.map((y) => (
                      <option key={y} value={y}>{y}</option>
                    ));
                  })()}
                </select>
              </div>
              {taxDrawerLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : taxDrawerSummary && !taxDrawerSummary.taxable ? (
                <p className="text-sm text-gray-600">{taxDrawerSummary.message ?? 'No taxable events'}</p>
              ) : taxDrawerSummary?.taxable ? (
                <div className="space-y-4">
                  <p className="text-sm font-medium text-gray-900">
                    Estimated taxes due ({taxDrawerSummary.year ?? taxDrawerYear}): ${(taxDrawerSummary.estimatedTaxDue ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <dl className="text-sm text-gray-600 space-y-1">
                    <div className="flex justify-between gap-4">
                      <dt>Realized gains YTD</dt>
                      <dd>${(taxDrawerSummary.realizedGainsYtd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>Dividend income YTD</dt>
                      <dd>${(taxDrawerSummary.dividendIncomeYtd ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                    </div>
                    <div className="flex justify-between gap-4">
                      <dt>Tax on gains</dt>
                      <dd>${(taxDrawerSummary.taxOnGains ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                    </div>
                    {taxDrawerSummary.gainsByTicker && Object.keys(taxDrawerSummary.gainsByTicker).length > 0 && (
                      <div className="pl-2 border-l-2 border-gray-200 mt-2 space-y-1.5">
                        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">By ticker</span>
                        {Object.entries(taxDrawerSummary.gainsByTicker)
                          .sort(([, a], [, b]) => (b.taxOnGains ?? 0) - (a.taxOnGains ?? 0))
                          .map(([ticker, { realizedGain, shortTermGain, longTermGain, termType, taxOnGains }]) => (
                            <div key={ticker} className="flex justify-between gap-4 text-xs">
                              <dt className="font-medium text-gray-700">
                                {ticker}
                                <span className="ml-1.5 text-gray-500 font-normal normal-case">({termType?.replace(/-/g, ' ') ?? '—'})</span>
                              </dt>
                              <dd className="text-right">
                                <span className="text-gray-600">${(realizedGain ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} gain</span>
                                <span className="mx-1.5 text-gray-400">→</span>
                                <span className="font-medium">${(taxOnGains ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} tax</span>
                              </dd>
                            </div>
                          ))}
                      </div>
                    )}
                    <div className="flex justify-between gap-4">
                      <dt>Tax on dividends</dt>
                      <dd>${(taxDrawerSummary.taxOnDividends ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
                    </div>
                  </dl>
                  {taxDrawerSummary.disclaimer && (
                    <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">{taxDrawerSummary.disclaimer}</p>
                  )}
                  <div className="pt-4 border-t border-gray-200">
                    <h4 className="text-sm font-medium text-gray-800 mb-2">Tax impact of potential actions</h4>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Position</span>
                        <select
                          value={taxImpactTicker}
                          onChange={(e) => {
                            setTaxImpactTicker(e.target.value);
                            const pos = selectedPortfolio?.positions?.find((p) => p.ticker.toUpperCase() === e.target.value.toUpperCase());
                            if (pos) setTaxImpactShares(String(pos.quantity));
                          }}
                          className="text-sm border border-gray-300 rounded px-2 py-1.5 text-gray-900 min-w-[6rem]"
                        >
                          <option value="">Select…</option>
                          {(selectedPortfolio?.positions ?? []).filter((p) => (Number(p.quantity) || 0) > 0.0001).map((p) => (
                            <option key={p.ticker} value={p.ticker}>{p.ticker}</option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Shares</span>
                        <input
                          type="number"
                          min={1}
                          max={selectedPortfolio?.positions?.find((p) => p.ticker.toUpperCase() === taxImpactTicker.toUpperCase())?.quantity ?? 0}
                          value={taxImpactShares}
                          onChange={(e) => setTaxImpactShares(e.target.value)}
                          className="w-24 text-sm border border-gray-300 rounded px-2 py-1.5 text-gray-900"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-gray-500">Price (optional)</span>
                        <input
                          type="number"
                          step={0.01}
                          min={0}
                          placeholder="Current"
                          value={taxImpactPrice}
                          onChange={(e) => setTaxImpactPrice(e.target.value)}
                          className="w-24 text-sm border border-gray-300 rounded px-2 py-1.5 text-gray-900"
                        />
                      </label>
                    </div>
                    {taxImpactLotsLoading && taxImpactTicker && (
                      <p className="mt-2 text-xs text-gray-500">Loading lots…</p>
                    )}
                    {taxImpactResult && !taxImpactLotsLoading && (
                      <div className="mt-3 text-sm text-gray-700 space-y-1">
                        <p className="font-medium">Estimated gain: ${taxImpactResult.gain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        {taxImpactResult.useLots && (taxImpactResult.shortTermGain !== 0 || taxImpactResult.longTermGain !== 0) ? (
                          <>
                            {taxImpactResult.shortTermGain !== 0 && (
                              <p className="text-gray-600">Short-term gain: ${taxImpactResult.shortTermGain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            )}
                            {taxImpactResult.longTermGain !== 0 && (
                              <p className="text-gray-600">Long-term gain: ${taxImpactResult.longTermGain.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                            )}
                            {taxImpactResult.breakdown && taxImpactResult.breakdown.length > 1 && (
                              <details className="mt-1">
                                <summary className="text-xs text-gray-500 cursor-pointer">By lot (FIFO)</summary>
                                <ul className="mt-1 text-xs text-gray-600 list-disc list-inside space-y-0.5">
                                  {taxImpactResult.breakdown.map((chunk, i) => (
                                    <li key={i}>
                                      {chunk.quantity} sh @ {chunk.purchaseDate} → ${chunk.gain.toFixed(2)} {chunk.longTerm ? 'LT' : 'ST'}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                          </>
                        ) : null}
                        <p className="font-medium">Estimated tax: ${taxImpactResult.estimatedTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                        {!taxImpactResult.useLots && (
                          <p className="text-xs text-gray-500">Using average cost. Add buy/sell history for lot-level (FIFO) accuracy.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Cash drawer – same pattern as tax drawer */}
      {cashDrawerOpen && (
        <div className="fixed inset-0 flex justify-end z-50 pointer-events-none">
          <div className="pointer-events-auto bg-white w-full max-w-lg shadow-2xl border-l border-gray-200 overflow-y-auto h-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-900">Cash</h3>
                <button onClick={() => setCashDrawerOpen(false)} className="text-gray-600 hover:text-gray-900 p-1" aria-label="Close">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p className="text-lg font-semibold text-gray-900 mb-4">
                Balance: ${((selectedPortfolio?.cashBalance ?? 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                              {tx.amount >= 0 ? '+' : ''}${tx.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    className="w-full px-4 py-2 text-black border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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

