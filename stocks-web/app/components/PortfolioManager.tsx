'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Position,
  Portfolio,
  type Band,
  type PortfolioAccountType,
  type Transaction,
} from '../lib/services/portfolioService';
import { useAuth } from '../lib/authContext';
import type { PositionThesisPayload } from '../lib/types/positionThesis';
import { getPositionThesisByDocId } from '../lib/services/positionThesisService';
import type { WatchlistItem, WatchlistStatus } from '../lib/services/watchlistShared';
import { TAX_RATES, computeTaxImpactFromLots, type Lot } from '../lib/taxEstimator';
import PortfolioBenchmarkChart from './PortfolioBenchmarkChart';
import PortfolioConcerns from './PortfolioConcerns';
import AddTransactionModal from './portfolio/AddTransactionModal';
import CashDrawer from './portfolio/CashDrawer';
import CreatePortfolioModal from './portfolio/CreatePortfolioModal';
import EditPositionMetadataModal from './portfolio/EditPositionMetadataModal';
import PortfolioDetailHeader from './portfolio/PortfolioDetailHeader';
import PortfolioManagerSidebar from './portfolio/PortfolioManagerSidebar';
import PortfolioSettingsPanel from './portfolio/PortfolioSettingsPanel';
import PositionsTable, { PositionsEmptyState } from './portfolio/PositionsTable';
import TaxDrawer from './portfolio/TaxDrawer';
import TransactionHistoryDrawer from './portfolio/TransactionHistoryDrawer';
import type { TaxImpactResult, TaxSummary, ViewMode } from './portfolio/types';
import WatchlistItemModal from './portfolio/WatchlistItemModal';
import WatchlistMainPanel from './portfolio/WatchlistMainPanel';

interface PortfolioManagerProps {
  /** Set when the route is `/portfolios/[portfolioId]`; omitted on `/portfolios`. */
  portfolioIdFromRoute?: string;
}

export default function PortfolioManager({ portfolioIdFromRoute }: PortfolioManagerProps) {
  const router = useRouter();
  const { user, signInWithGoogle } = useAuth();
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

  const [portfolioName, setPortfolioName] = useState('');
  const [portfolioDescription, setPortfolioDescription] = useState('');
  const [positionTicker, setPositionTicker] = useState('');
  const [positionQuantity, setPositionQuantity] = useState('');
  const [positionPurchaseDate, setPositionPurchaseDate] = useState('');
  const [positionPurchasePrice, setPositionPurchasePrice] = useState('');
  const [positionThesisId, setPositionThesisId] = useState('');
  const [positionNotes, setPositionNotes] = useState('');
  const [transactionType, setTransactionType] = useState<
    'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash'
  >('buy');
  const [transactionTicker, setTransactionTicker] = useState('');
  const [transactionDate, setTransactionDate] = useState('');
  const [transactionQuantity, setTransactionQuantity] = useState('');
  const [transactionPrice, setTransactionPrice] = useState('');
  const [transactionAmount, setTransactionAmount] = useState('');
  const [transactionNotes, setTransactionNotes] = useState('');

  const [watchlistTicker, setWatchlistTicker] = useState('');
  const [watchlistNotes, setWatchlistNotes] = useState('');
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

  const [thesisPayloadByThesisId, setThesisPayloadByThesisId] = useState<
    Record<string, PositionThesisPayload>
  >({});
  const [thesisPayloadsLoading, setThesisPayloadsLoading] = useState(false);

  const [taxSummary, setTaxSummary] = useState<TaxSummary | null>(null);
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

  useEffect(() => {
    if (viewMode === 'portfolios') {
      fetchPortfolios();
    } else if (!user) {
      setWatchlistItems([]);
      setLoading(false);
    } else {
      fetchWatchlistItems();
    }
  }, [viewMode, user]);

  useEffect(() => {
    if (selectedPortfolio?.id) {
      loadCashTransactions(selectedPortfolio.id);
    } else {
      setCashTransactions([]);
    }
  }, [selectedPortfolio?.id]);

  useEffect(() => {
    const uid = user?.uid;
    const plist = selectedPortfolio?.positions;
    if (!uid || !plist?.length) {
      setThesisPayloadByThesisId({});
      setThesisPayloadsLoading(false);
      return;
    }
    const ids = [
      ...new Set(
        plist.map((p) => p.thesisId?.trim()).filter((id): id is string => Boolean(id))
      ),
    ];
    if (ids.length === 0) {
      setThesisPayloadByThesisId({});
      setThesisPayloadsLoading(false);
      return;
    }
    let cancelled = false;
    setThesisPayloadsLoading(true);
    void (async () => {
      const entries = await Promise.all(
        ids.map(async (docId) => {
          try {
            const loaded = await getPositionThesisByDocId(uid, docId);
            return [docId, loaded?.payload ?? null] as const;
          } catch {
            return [docId, null] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, PositionThesisPayload> = {};
      for (const [docId, payload] of entries) {
        if (payload) next[docId] = payload;
      }
      setThesisPayloadByThesisId(next);
      setThesisPayloadsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, selectedPortfolio?.positions, selectedPortfolio?.id]);

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
    fetch(`/api/portfolios/${selectedPortfolio.id}/tax`)
      .then((res) => res.json())
      .then((json) => {
        if (cancelled) return;
        if (json.success && json.data) setTaxSummary(json.data as TaxSummary);
        else setTaxSummary(null);
      })
      .catch(() => {
        if (!cancelled) setTaxSummary(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedPortfolio?.id]);

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

  const taxImpactResult = useMemo((): TaxImpactResult | null => {
    const positions = selectedPortfolio?.positions ?? [];
    if (!taxImpactTicker.trim() || positions.length === 0) return null;
    const position = positions.find((p) => p.ticker.toUpperCase() === taxImpactTicker.toUpperCase());
    if (!position) return null;
    const shares = parseFloat(taxImpactShares);
    if (!Number.isFinite(shares) || shares <= 0 || shares > position.quantity) return null;
    const priceRaw = taxImpactPrice.trim()
      ? parseFloat(taxImpactPrice)
      : positionPrices[position.ticker.toUpperCase()];
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
          breakdown: result.breakdown.map((c) => ({
            quantity: c.quantity,
            purchaseDate: c.purchaseDate,
            gain: c.gain,
            longTerm: c.longTerm,
          })),
          useLots: true,
        };
      }
    }

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
      } else {
        setError(result.error || 'Failed to fetch portfolios');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch portfolios');
    } finally {
      setLoading(false);
    }
  };

  const loadPortfolio = useCallback(async (portfolioId: string) => {
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
  }, []);

  useEffect(() => {
    if (viewMode !== 'portfolios') return;

    // While the portfolio list is still loading, `portfolios` is [] — do not treat that as
    // "user has zero portfolios" or we strip `/portfolios/[id]` from the URL prematurely.
    if (portfolios.length === 0) {
      if (portfolioIdFromRoute && !loading) {
        router.replace('/portfolios', { scroll: false });
      }
      return;
    }

    const firstId = portfolios[0].id!;
    if (!portfolioIdFromRoute) {
      router.replace(`/portfolios/${encodeURIComponent(firstId)}`, { scroll: false });
      return;
    }

    const valid = portfolios.some((p) => p.id === portfolioIdFromRoute);
    if (!valid) {
      router.replace(`/portfolios/${encodeURIComponent(firstId)}`, { scroll: false });
      return;
    }

    if (selectedPortfolio?.id !== portfolioIdFromRoute) {
      void loadPortfolio(portfolioIdFromRoute);
    }
  }, [
    viewMode,
    portfolios,
    portfolioIdFromRoute,
    selectedPortfolio?.id,
    loadPortfolio,
    router,
    loading,
  ]);

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
          router.replace(`/portfolios/${encodeURIComponent(result.data.id)}`, { scroll: false });
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
    setSettingsBands((prev) => prev.map((b) => (b.id === id ? { ...b, ...updates } : b)));
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
      const res = await fetch(
        `/api/portfolios/${selectedPortfolio.id}/transactions?ticker=${encodeURIComponent(ticker)}`
      );
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
    const type = (editingTransaction.type || transactionType) as
      | 'buy'
      | 'sell'
      | 'dividend'
      | 'dividend_reinvest'
      | 'cash';
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
          body: JSON.stringify({
            type,
            ticker,
            date,
            quantity,
            price,
            amount,
            notes: transactionNotes || '',
          }),
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
      const res = await fetch(`/api/portfolios/${selectedPortfolio.id}/transactions/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text }),
      });
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

  const fetchWatchlistItems = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const token = await user.getIdToken();
      const response = await fetch('/api/watchlist', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json();

      if (response.status === 401) {
        setError(result.error || 'Sign in to use your watchlist');
        setWatchlistItems([]);
        return;
      }

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
    if (!user) {
      setError('Sign in to add watchlist items');
      return;
    }
    if (!watchlistTicker.trim()) {
      setError('Ticker is required');
      return;
    }

    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ticker: watchlistTicker.trim(),
          notes: watchlistNotes.trim(),
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
    if (!user) {
      setError('Sign in to update watchlist items');
      return;
    }
    if (!editingWatchlistItem?.id) return;
    if (!watchlistTicker.trim()) {
      setError('Ticker is required');
      return;
    }

    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/watchlist/${editingWatchlistItem.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          ticker: watchlistTicker.trim(),
          notes: watchlistNotes.trim(),
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
    if (!user) {
      setError('Sign in to manage your watchlist');
      return;
    }
    if (!confirm('Are you sure you want to remove this item from the watchlist?')) {
      return;
    }

    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/watchlist/${itemId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
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
  };

  const startEditWatchlistItem = (item: WatchlistItem) => {
    setEditingWatchlistItem(item);
    setWatchlistTicker(item.ticker);
    setWatchlistNotes(item.notes || '');
    setShowAddWatchlistItem(true);
  };

  const handleWatchlistStatusChange = async (itemId: string, status: WatchlistStatus) => {
    if (!user) return;
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/watchlist/${itemId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      const result = await response.json();
      if (result.success) await fetchWatchlistItems();
      else setError(result.error || 'Failed to update status');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status');
    }
  };

  const openAddTransaction = () => {
    setTransactionType('buy');
    setTransactionTicker('');
    setTransactionDate(new Date().toISOString().slice(0, 10));
    setTransactionQuantity('');
    setTransactionPrice('');
    setTransactionAmount('');
    setTransactionNotes('');
    setShowAddTransaction(true);
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
      <PortfolioManagerSidebar
        viewMode={viewMode}
        onViewModeChange={(m) => {
          setViewMode(m);
          setSelectedPortfolio(null);
        }}
        portfolios={portfolios}
        watchlistItems={watchlistItems}
        selectedPortfolio={selectedPortfolio}
        onSelectPortfolioId={(id) => {
          router.replace(`/portfolios/${encodeURIComponent(id)}`, { scroll: false });
        }}
        onOpenCreatePortfolio={() => {
          setShowCreatePortfolio(true);
          setPortfolioName('');
          setPortfolioDescription('');
        }}
        watchlistSignedIn={Boolean(user)}
        onWatchlistSignIn={() => {
          signInWithGoogle().catch((e) => setError(e instanceof Error ? e.message : 'Sign-in failed'));
        }}
      />

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
              <div className="relative z-10 p-6 border-b border-gray-200 bg-white">
                <PortfolioDetailHeader
                  selectedPortfolio={selectedPortfolio}
                  totalPortfolioValue={totalPortfolioValue}
                  taxSummary={taxSummary}
                  onOpenCashDrawer={() => setCashDrawerOpen(true)}
                  onOpenTaxDrawer={() => {
                    setTaxDrawerYear(new Date().getFullYear());
                    setTaxDrawerSummary(taxSummary);
                    setTaxDrawerOpen(true);
                  }}
                  onOpenSettings={openSettings}
                />
                {settingsOpen && (
                  <PortfolioSettingsPanel
                    settingsName={settingsName}
                    setSettingsName={setSettingsName}
                    settingsDescription={settingsDescription}
                    setSettingsDescription={setSettingsDescription}
                    settingsAccountType={settingsAccountType}
                    setSettingsAccountType={setSettingsAccountType}
                    settingsBands={settingsBands}
                    addBand={addBand}
                    updateBand={updateBand}
                    removeBand={removeBand}
                    onSave={handleSaveSettings}
                    onCancel={() => setSettingsOpen(false)}
                    onDeletePortfolio={handleDeletePortfolio}
                    savingSettings={savingSettings}
                    portfolioId={selectedPortfolio.id}
                  />
                )}
              </div>

              <div className="relative z-0 flex-1 overflow-y-auto p-6">
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
                {(selectedPortfolio.positions ?? []).filter((p) => (Number(p.quantity) || 0) > 0.0001)
                  .length > 0 ? (
                  <PositionsTable
                    router={router}
                    selectedPortfolio={selectedPortfolio}
                    positionPrices={positionPrices}
                    totalPortfolioValue={totalPortfolioValue}
                    csvFileInputRef={csvFileInputRef}
                    importInProgress={importInProgress}
                    importMessage={importMessage}
                    handleImportCsv={handleImportCsv}
                    onOpenAddTransaction={openAddTransaction}
                    startEditPositionMetadata={startEditPositionMetadata}
                    openTransactionHistory={openTransactionHistory}
                    handleDeletePosition={handleDeletePosition}
                    thesisPayloadByThesisId={thesisPayloadByThesisId}
                    thesisPayloadsLoading={thesisPayloadsLoading}
                  />
                ) : (
                  <PositionsEmptyState
                    csvFileInputRef={csvFileInputRef}
                    importInProgress={importInProgress}
                    importMessage={importMessage}
                    handleImportCsv={handleImportCsv}
                    onOpenAddTransaction={openAddTransaction}
                  />
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
          <WatchlistMainPanel
            router={router}
            watchlistItems={watchlistItems}
            onOpenAddWatchlist={() => {
              if (!user) return;
              setEditingWatchlistItem(null);
              resetWatchlistForm();
              setShowAddWatchlistItem(true);
            }}
            onStartEditWatchlistItem={startEditWatchlistItem}
            onDeleteWatchlistItem={handleDeleteWatchlistItem}
            onStatusChange={handleWatchlistStatusChange}
            signedIn={Boolean(user)}
            onSignIn={() => {
              signInWithGoogle().catch((e) => setError(e instanceof Error ? e.message : 'Sign-in failed'));
            }}
          />
        )}
      </div>

      <CreatePortfolioModal
        open={showCreatePortfolio}
        portfolioName={portfolioName}
        setPortfolioName={setPortfolioName}
        portfolioDescription={portfolioDescription}
        setPortfolioDescription={setPortfolioDescription}
        onClose={() => {
          setShowCreatePortfolio(false);
          setPortfolioName('');
          setPortfolioDescription('');
        }}
        onCreate={handleCreatePortfolio}
      />

      {editingPositionMetadata && selectedPortfolio?.id && (
        <EditPositionMetadataModal
          portfolioId={selectedPortfolio.id}
          position={editingPositionMetadata}
          bands={selectedPortfolio?.bands ?? []}
          positionBandId={positionBandId}
          setPositionBandId={setPositionBandId}
          positionThesisId={positionThesisId}
          setPositionThesisId={setPositionThesisId}
          positionNotes={positionNotes}
          setPositionNotes={setPositionNotes}
          onClose={() => setEditingPositionMetadata(null)}
          onSave={handleSavePositionMetadata}
        />
      )}

      <AddTransactionModal
        open={showAddTransaction && !editingTransaction}
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
        onClose={() => {
          setShowAddTransaction(false);
          cancelEdit();
        }}
        onSubmit={handleAddTransaction}
      />

      {transactionHistoryTicker && (
        <TransactionHistoryDrawer
          ticker={transactionHistoryTicker}
          transactions={transactionsForTicker}
          editingTransaction={editingTransaction}
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
          onClose={() => setTransactionHistoryTicker(null)}
          onStartEdit={startEditTransaction}
          onDeleteTransaction={handleDeleteTransaction}
          onSaveEdit={handleUpdateTransaction}
          onCancelEdit={() => setEditingTransaction(null)}
        />
      )}

      <TaxDrawer
        open={taxDrawerOpen}
        onClose={() => setTaxDrawerOpen(false)}
        taxDrawerYear={taxDrawerYear}
        setTaxDrawerYear={setTaxDrawerYear}
        onYearChange={fetchTaxForYear}
        taxDrawerLoading={taxDrawerLoading}
        taxDrawerSummary={taxDrawerSummary}
        taxSummary={taxSummary}
        selectedPortfolio={selectedPortfolio}
        taxImpactTicker={taxImpactTicker}
        setTaxImpactTicker={setTaxImpactTicker}
        taxImpactShares={taxImpactShares}
        setTaxImpactShares={setTaxImpactShares}
        taxImpactPrice={taxImpactPrice}
        setTaxImpactPrice={setTaxImpactPrice}
        taxImpactLotsLoading={taxImpactLotsLoading}
        taxImpactResult={taxImpactResult}
      />

      <CashDrawer
        open={cashDrawerOpen}
        onClose={() => setCashDrawerOpen(false)}
        cashBalance={selectedPortfolio?.cashBalance ?? 0}
        cashTransactions={cashTransactions}
      />

      <WatchlistItemModal
        open={showAddWatchlistItem && Boolean(user)}
        editingItem={editingWatchlistItem}
        watchlistTicker={watchlistTicker}
        setWatchlistTicker={setWatchlistTicker}
        watchlistNotes={watchlistNotes}
        setWatchlistNotes={setWatchlistNotes}
        onClose={cancelEdit}
        onSubmit={editingWatchlistItem ? handleUpdateWatchlistItem : handleAddWatchlistItem}
      />
    </div>
  );
}
