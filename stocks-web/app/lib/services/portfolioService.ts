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
  thesisId?: string; // Reference to investment thesis document
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type PortfolioAccountType = 'taxable' | 'ira';

export interface Portfolio {
  id?: string;
  name: string;
  description?: string;
  accountType?: PortfolioAccountType;
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
    
    return {
      id: portfolioSnap.id,
      name: portfolioData.name,
      description: portfolioData.description,
      accountType: portfolioData.accountType === 'ira' ? 'ira' : 'taxable',
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
 * Delete a portfolio and all its positions
 */
export async function deletePortfolio(portfolioId: string): Promise<void> {
  try {
    // Delete all positions first
    const positionsRef = collection(db, 'portfolios', portfolioId, 'positions');
    const positionsSnapshot = await getDocs(positionsRef);
    
    const deletePromises = positionsSnapshot.docs.map(posDoc => 
      deleteDoc(doc(db, 'portfolios', portfolioId, 'positions', posDoc.id))
    );
    await Promise.all(deletePromises);
    
    // Delete the portfolio
    const portfolioRef = doc(db, 'portfolios', portfolioId);
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
    
    // Update portfolio's updatedAt timestamp
    await updatePortfolio(portfolioId, {});
  } catch (error) {
    console.error(`Error deleting position ${positionId} from portfolio ${portfolioId}:`, error);
    throw new Error('Failed to delete position from portfolio');
  }
}


