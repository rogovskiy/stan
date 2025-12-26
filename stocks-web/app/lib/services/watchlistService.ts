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
  serverTimestamp
} from 'firebase/firestore';
import { db } from '../firebase';

export interface WatchlistItem {
  id?: string;
  ticker: string;
  notes?: string;
  thesisId?: string; // Reference to investment thesis document
  targetPrice?: number; // Target price to buy at
  priority?: 'low' | 'medium' | 'high'; // Priority level
  createdAt?: string;
  updatedAt?: string;
  userId?: string; // For future multi-user support
}

/**
 * Get all watchlist items for a user
 */
export async function getAllWatchlistItems(userId?: string): Promise<WatchlistItem[]> {
  try {
    const watchlistRef = collection(db, 'watchlist');
    const q = query(watchlistRef, orderBy('createdAt', 'desc'));
    const querySnapshot = await getDocs(q);
    
    const items: WatchlistItem[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      items.push({
        id: doc.id,
        ticker: data.ticker,
        notes: data.notes,
        thesisId: data.thesisId,
        targetPrice: data.targetPrice,
        priority: data.priority || 'medium',
        createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
        userId: data.userId,
      });
    });
    
    return items.sort((a, b) => {
      // Sort by priority first (high > medium > low), then by ticker
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const priorityDiff = (priorityOrder[b.priority || 'medium'] || 2) - (priorityOrder[a.priority || 'medium'] || 2);
      if (priorityDiff !== 0) return priorityDiff;
      return a.ticker.localeCompare(b.ticker);
    });
  } catch (error) {
    console.error('Error fetching watchlist items:', error);
    throw new Error('Failed to fetch watchlist items from Firebase');
  }
}

/**
 * Get a single watchlist item by ID
 */
export async function getWatchlistItem(itemId: string): Promise<WatchlistItem | null> {
  try {
    const itemRef = doc(db, 'watchlist', itemId);
    const itemSnap = await getDoc(itemRef);
    
    if (!itemSnap.exists()) {
      return null;
    }
    
    const data = itemSnap.data();
    return {
      id: itemSnap.id,
      ticker: data.ticker,
      notes: data.notes,
      thesisId: data.thesisId,
      targetPrice: data.targetPrice,
      priority: data.priority || 'medium',
      createdAt: data.createdAt?.toDate?.()?.toISOString() || data.createdAt,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || data.updatedAt,
      userId: data.userId,
    };
  } catch (error) {
    console.error(`Error fetching watchlist item ${itemId}:`, error);
    throw new Error('Failed to fetch watchlist item from Firebase');
  }
}

/**
 * Add a new watchlist item
 */
export async function addWatchlistItem(item: Omit<WatchlistItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  try {
    const watchlistRef = collection(db, 'watchlist');
    const docRef = await addDoc(watchlistRef, {
      ticker: item.ticker.toUpperCase(),
      notes: item.notes || '',
      thesisId: item.thesisId || null,
      targetPrice: item.targetPrice || null,
      priority: item.priority || 'medium',
      userId: item.userId || null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    
    return docRef.id;
  } catch (error) {
    console.error('Error adding watchlist item:', error);
    throw new Error('Failed to add watchlist item to Firebase');
  }
}

/**
 * Update a watchlist item
 */
export async function updateWatchlistItem(
  itemId: string, 
  updates: Partial<Omit<WatchlistItem, 'id' | 'createdAt' | 'userId'>>
): Promise<void> {
  try {
    const itemRef = doc(db, 'watchlist', itemId);
    await updateDoc(itemRef, {
      ...updates,
      ticker: updates.ticker ? updates.ticker.toUpperCase() : undefined,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error(`Error updating watchlist item ${itemId}:`, error);
    throw new Error('Failed to update watchlist item in Firebase');
  }
}

/**
 * Delete a watchlist item
 */
export async function deleteWatchlistItem(itemId: string): Promise<void> {
  try {
    const itemRef = doc(db, 'watchlist', itemId);
    await deleteDoc(itemRef);
  } catch (error) {
    console.error(`Error deleting watchlist item ${itemId}:`, error);
    throw new Error('Failed to delete watchlist item from Firebase');
  }
}


