import { 
  doc, 
  getDoc, 
  getDocs, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  query,
  orderBy,
  Timestamp,
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';

export interface Position {
  id?: string;
  ticker: string;
  quantity: number;
  purchaseDate?: string; // ISO date string
  purchasePrice?: number;
  thesisId?: string; // Reference to investment thesis document (position-level)
  notes?: string; // Position-level notes
  createdAt?: string;
  updatedAt?: string;
}

export type TransactionType = 'buy' | 'sell' | 'dividend' | 'dividend_reinvest' | 'cash';

export interface Transaction {
  id?: string;
  type: TransactionType;
  ticker: string | null; // null for type 'cash' only
  date: string; // ISO date YYYY-MM-DD
  quantity: number; // positive buy/dividend_reinvest, negative sell, 0 for dividend/cash
  price: number | null;
  amount: number; // Cash impact USD: + in, - out
  notes?: string; // Per-transaction memo only
  createdAt?: string;
  updatedAt?: string;
}

export type PortfolioAccountType = 'taxable' | 'ira';

export interface Portfolio {
  id?: string;
  name: string;
  description?: string;
  accountType?: PortfolioAccountType;
  cashBalance?: number; // Stored aggregate; updated by recomputeAndWriteAggregates
  positions?: Position[];
  createdAt?: string;
  updatedAt?: string;
  userId?: string; // For future multi-user support
}

/**
 * Get all portfolios for a user
 */
export async function getAllPortfolios(userId?: string): Promise<Portfolio[]> {
  try {
    const portfoliosRef = collection(db, 'portfolios');
    const q = query(portfoliosRef, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    const portfolios: Portfolio[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      portfolios.push({
        id: doc.id,
        name: data.name,
        description: data.description,
        accountType: data.accountType === 'ira' ? 'ira' : 'taxable',
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
        userId: data.userId,
      });
    });
    
    return portfolios;
  } catch (error) {
    console.error('Error fetching portfolios:', error);
    throw new Error('Failed to fetch portfolios from Firebase');
  }
}

/**
 * Get a single portfolio by ID with its positions
 */
export async function getPortfolio(portfolioId: string): Promise<Portfolio | null> {
  try {
    const portfolioRef = doc(db, 'portfolios', portfolioId);
    const portfolioSnap = await getDoc(portfolioRef);
    
    if (!portfolioSnap.exists()) {
      return null;
    }
    
    const portfolioData = portfolioSnap.data();
    
    // Fetch positions from subcollection
    const positionsRef = collection(db, 'portfolios', portfolioId, 'positions');
    const positionsSnapshot = await getDocs(positionsRef);
    const positions: Position[] = [];
    
    positionsSnapshot.forEach((posDoc) => {
      const posData = posDoc.data();
      positions.push({
        id: posDoc.id,
        ticker: posData.ticker,
        quantity: posData.quantity,
        purchaseDate: posData.purchaseDate,
        purchasePrice: posData.purchasePrice,
        thesisId: posData.thesisId,
        notes: posData.notes,
        createdAt: posData.createdAt?.toDate?.()?.toISOString() || posData.createdAt,
        updatedAt: posData.updatedAt?.toDate?.()?.toISOString() || posData.updatedAt,
      });
    });
    
    const cashBalance = typeof portfolioData.cashBalance === 'number' ? portfolioData.cashBalance : 0;

    return {
      id: portfolioSnap.id,
      name: portfolioData.name,
      description: portfolioData.description,
      accountType: portfolioData.accountType === 'ira' ? 'ira' : 'taxable',
      cashBalance,
      positions: positions.sort((a, b) => a.ticker.localeCompare(b.ticker)),
      createdAt: portfolioData.createdAt?.toDate?.()?.toISOString() || portfolioData.createdAt,
      updatedAt: portfolioData.updatedAt?.toDate?.()?.toISOString() || portfolioData.updatedAt,
      userId: portfolioData.userId,
    };
  } catch (error) {
    console.error(`Error fetching portfolio ${portfolioId}:`, error);
    throw new Error('Failed to fetch portfolio from Firebase');
  }
}

/**
 * Create a new portfolio
 */
export async function createPortfolio(portfolio: Omit<Portfolio, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const portfoliosRef = collection(db, 'portfolios');
    const docRef = await addDoc(portfoliosRef, {
      name: portfolio.name,
      description: portfolio.description || '',
      accountType: portfolio.accountType || 'taxable',
      cashBalance: 0,
      userId: portfolio.userId || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    return docRef.id;
  } catch (error) {
    console.error('Error creating portfolio:', error);
    throw new Error('Failed to create portfolio in Firebase');
  }
}

/**
 * Update a portfolio
 */
export async function updatePortfolio(
  portfolioId: string, 
  updates: Partial<Omit<Portfolio, 'id' | 'createdAt' | 'positions'>>
): Promise<void> {
  try {
    const portfolioRef = doc(db, 'portfolios', portfolioId);
    await updateDoc(portfolioRef, {
      ...updates,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error(`Error updating portfolio ${portfolioId}:`, error);
    throw new Error('Failed to update portfolio in Firebase');
  }
}

/**
 * Delete a portfolio, all its positions, and all its transactions
 */
export async function deletePortfolio(portfolioId: string): Promise<void> {
  try {
    const portfolioRef = doc(db, 'portfolios', portfolioId);

    // Delete all transactions first
    const transactionsRef = collection(db, 'portfolios', portfolioId, 'transactions');
    const transactionsSnapshot = await getDocs(transactionsRef);
    await Promise.all(
      transactionsSnapshot.docs.map((txDoc) =>
        deleteDoc(doc(db, 'portfolios', portfolioId, 'transactions', txDoc.id))
      )
    );

    // Delete all positions
    const positionsRef = collection(db, 'portfolios', portfolioId, 'positions');
    const positionsSnapshot = await getDocs(positionsRef);
    await Promise.all(
      positionsSnapshot.docs.map((posDoc) =>
        deleteDoc(doc(db, 'portfolios', portfolioId, 'positions', posDoc.id))
      )
    );

    await deleteDoc(portfolioRef);
  } catch (error) {
    console.error(`Error deleting portfolio ${portfolioId}:`, error);
    throw new Error('Failed to delete portfolio from Firebase');
  }
}

/**
 * Add a position to a portfolio
 */
export async function addPosition(portfolioId: string, position: Omit<Position, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const positionsRef = collection(db, 'portfolios', portfolioId, 'positions');
    const docRef = await addDoc(positionsRef, {
      ticker: position.ticker.toUpperCase(),
      quantity: position.quantity,
      purchaseDate: position.purchaseDate || null,
      purchasePrice: position.purchasePrice || null,
      thesisId: position.thesisId || null,
      notes: position.notes || '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    // Update portfolio's updatedAt timestamp
    await updatePortfolio(portfolioId, {});
    
    return docRef.id;
  } catch (error) {
    console.error(`Error adding position to portfolio ${portfolioId}:`, error);
    throw new Error('Failed to add position to portfolio');
  }
}

/**
 * Update a position in a portfolio
 */
export async function updatePosition(
  portfolioId: string,
  positionId: string,
  updates: Partial<Omit<Position, 'id' | 'createdAt'>>
): Promise<void> {
  try {
    const positionRef = doc(db, 'portfolios', portfolioId, 'positions', positionId);
    await updateDoc(positionRef, {
      ...updates,
      ticker: updates.ticker ? updates.ticker.toUpperCase() : undefined,
      updatedAt: serverTimestamp(),
    });
    
    // Update portfolio's updatedAt timestamp
    await updatePortfolio(portfolioId, {});
  } catch (error) {
    console.error(`Error updating position ${positionId} in portfolio ${portfolioId}:`, error);
    throw new Error('Failed to update position in portfolio');
  }
}

/**
 * Delete a position from a portfolio
 */
export async function deletePosition(portfolioId: string, positionId: string): Promise<void> {
  try {
    const positionRef = doc(db, 'portfolios', portfolioId, 'positions', positionId);
    await deleteDoc(positionRef);
    await updatePortfolio(portfolioId, {});
  } catch (error) {
    console.error(`Error deleting position ${positionId} from portfolio ${portfolioId}:`, error);
    throw new Error('Failed to delete position from portfolio');
  }
}

// --- Transactions ---

export async function getTransactions(
  portfolioId: string,
  ticker?: string | null
): Promise<Transaction[]> {
  try {
    const transactionsRef = collection(db, 'portfolios', portfolioId, 'transactions');
    const q = query(transactionsRef, orderBy('date', 'desc'));
    const snapshot = await getDocs(q);
    const list: Transaction[] = [];
    snapshot.forEach((txDoc) => {
      const d = txDoc.data();
      const tx: Transaction = {
        id: txDoc.id,
        type: d.type as TransactionType,
        ticker: d.ticker ?? null,
        date: d.date,
        quantity: d.quantity ?? 0,
        price: d.price ?? null,
        amount: d.amount ?? 0,
        notes: d.notes ?? '',
        createdAt: d.createdAt?.toDate?.()?.toISOString() ?? d.createdAt,
        updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? d.updatedAt,
      };
      if (ticker == null || (tx.ticker && tx.ticker.toUpperCase() === ticker.toUpperCase())) {
        list.push(tx);
      }
    });
    return list;
  } catch (error) {
    console.error(`Error fetching transactions for portfolio ${portfolioId}:`, error);
    throw new Error('Failed to fetch transactions');
  }
}

export async function addTransaction(
  portfolioId: string,
  transaction: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>
): Promise<string> {
  try {
    const transactionsRef = collection(db, 'portfolios', portfolioId, 'transactions');
    const docRef = await addDoc(transactionsRef, {
      type: transaction.type,
      ticker: transaction.ticker != null ? transaction.ticker.toUpperCase() : null,
      date: transaction.date,
      quantity: transaction.quantity,
      price: transaction.price ?? null,
      amount: transaction.amount,
      notes: transaction.notes ?? '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await recomputeAndWriteAggregates(portfolioId);
    return docRef.id;
  } catch (error) {
    console.error(`Error adding transaction to portfolio ${portfolioId}:`, error);
    throw new Error('Failed to add transaction');
  }
}

export async function getTransaction(
  portfolioId: string,
  transactionId: string
): Promise<Transaction | null> {
  try {
    const txRef = doc(db, 'portfolios', portfolioId, 'transactions', transactionId);
    const snap = await getDoc(txRef);
    if (!snap.exists()) return null;
    const d = snap.data();
    return {
      id: snap.id,
      type: d.type as TransactionType,
      ticker: d.ticker ?? null,
      date: d.date,
      quantity: d.quantity ?? 0,
      price: d.price ?? null,
      amount: d.amount ?? 0,
      notes: d.notes ?? '',
      createdAt: d.createdAt?.toDate?.()?.toISOString() ?? d.createdAt,
      updatedAt: d.updatedAt?.toDate?.()?.toISOString() ?? d.updatedAt,
    };
  } catch (error) {
    console.error(`Error fetching transaction ${transactionId}:`, error);
    throw new Error('Failed to fetch transaction');
  }
}

export async function updateTransaction(
  portfolioId: string,
  transactionId: string,
  updates: Partial<Omit<Transaction, 'id' | 'createdAt'>>
): Promise<void> {
  try {
    const txRef = doc(db, 'portfolios', portfolioId, 'transactions', transactionId);
    const payload: Record<string, unknown> = { ...updates, updatedAt: serverTimestamp() };
    if (updates.ticker !== undefined) {
      payload.ticker = updates.ticker != null ? updates.ticker.toUpperCase() : null;
    }
    await updateDoc(txRef, payload);
    await recomputeAndWriteAggregates(portfolioId);
  } catch (error) {
    console.error(`Error updating transaction ${transactionId}:`, error);
    throw new Error('Failed to update transaction');
  }
}

export async function deleteTransaction(portfolioId: string, transactionId: string): Promise<void> {
  try {
    const txRef = doc(db, 'portfolios', portfolioId, 'transactions', transactionId);
    await deleteDoc(txRef);
    await recomputeAndWriteAggregates(portfolioId);
  } catch (error) {
    console.error(`Error deleting transaction ${transactionId}:`, error);
    throw new Error('Failed to delete transaction');
  }
}

export async function recomputeAndWriteAggregates(portfolioId: string): Promise<void> {
  const transactions = await getTransactions(portfolioId, null);
  const portfolioRef = doc(db, 'portfolios', portfolioId);
  const byTicker = new Map<
    string,
    { quantity: number; costSum: number; earliestDate: string | null; thesisId?: string; notes?: string }
  >();
  let cashTotal = 0;

  for (const tx of transactions) {
    cashTotal += tx.amount;
    if (tx.ticker) {
      const key = tx.ticker.toUpperCase();
      if (!byTicker.has(key)) byTicker.set(key, { quantity: 0, costSum: 0, earliestDate: null });
      const row = byTicker.get(key)!;
      row.quantity += tx.quantity;
      if ((tx.type === 'buy' || tx.type === 'dividend_reinvest') && tx.quantity > 0 && tx.price != null) {
        row.costSum += tx.quantity * tx.price;
      }
      if (tx.date) {
        if (row.earliestDate == null || tx.date < row.earliestDate) row.earliestDate = tx.date;
      }
    }
  }

  const positionsRef = collection(db, 'portfolios', portfolioId, 'positions');
  const positionsSnap = await getDocs(positionsRef);
  const existingByTicker = new Map<string, { id: string; thesisId?: string; notes?: string }>();
  positionsSnap.forEach((posDoc) => {
    const d = posDoc.data();
    const t = (d.ticker as string)?.toUpperCase();
    if (t) existingByTicker.set(t, { id: posDoc.id, thesisId: d.thesisId, notes: d.notes });
  });

  for (const [ticker, row] of byTicker) {
    const existing = existingByTicker.get(ticker);
    if (existing) {
      row.thesisId = existing.thesisId;
      row.notes = existing.notes;
    }
  }

  for (const [ticker, row] of byTicker) {
    if (row.quantity <= 0) {
      const existing = existingByTicker.get(ticker);
      if (existing) await deleteDoc(doc(db, 'portfolios', portfolioId, 'positions', existing.id));
    }
  }

  for (const [ticker, row] of byTicker) {
    if (row.quantity <= 0) continue;
    const averagePrice = row.quantity > 0 && row.costSum > 0 ? row.costSum / row.quantity : null;
    const existing = existingByTicker.get(ticker);
    if (existing) {
      await updateDoc(doc(db, 'portfolios', portfolioId, 'positions', existing.id), {
        quantity: row.quantity,
        purchasePrice: averagePrice,
        purchaseDate: row.earliestDate ?? null,
        thesisId: row.thesisId ?? null,
        notes: row.notes ?? '',
        updatedAt: serverTimestamp(),
      });
    } else {
      await addDoc(collection(db, 'portfolios', portfolioId, 'positions'), {
        ticker,
        quantity: row.quantity,
        purchasePrice: averagePrice,
        purchaseDate: row.earliestDate ?? null,
        thesisId: row.thesisId ?? null,
        notes: row.notes ?? '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  await updateDoc(portfolioRef, { cashBalance: cashTotal, updatedAt: serverTimestamp() });
}


