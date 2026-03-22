/**
 * Server-only watchlist persistence (Firebase Admin). Do not import from Client Components;
 * use watchlistShared.ts for types and constants.
 */

import { FieldValue, Timestamp, type DocumentData } from 'firebase-admin/firestore';
import { getAdminFirestore } from '../firebase-admin';
import {
  isWatchlistStatus,
  type WatchlistItem,
  type WatchlistStatus,
} from './watchlistShared';

export type { WatchlistItem, WatchlistStatus } from './watchlistShared';
export { WATCHLIST_STATUSES, isWatchlistStatus } from './watchlistShared';

const STATUS_ORDER: Record<WatchlistStatus, number> = {
  ready_to_buy: 0,
  awaiting_confirmation: 1,
  watching: 2,
  thesis_needed: 3,
};

function toIso(value: unknown): string | undefined {
  if (!value) return undefined;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (typeof (value as Timestamp).toDate === 'function') {
    return (value as Timestamp).toDate().toISOString();
  }
  return undefined;
}

function normalizeStatus(data: { status?: unknown; thesisId?: unknown }): WatchlistStatus {
  const s = data.status;
  if (typeof s === 'string' && isWatchlistStatus(s)) return s;
  return data.thesisId ? 'watching' : 'thesis_needed';
}

function docToItem(id: string, data: DocumentData): WatchlistItem {
  return {
    id,
    ticker: typeof data.ticker === 'string' ? data.ticker : '',
    notes: typeof data.notes === 'string' && data.notes ? data.notes : undefined,
    thesisId: typeof data.thesisId === 'string' && data.thesisId ? data.thesisId : undefined,
    targetPrice: typeof data.targetPrice === 'number' ? data.targetPrice : undefined,
    status: normalizeStatus(data),
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    userId: typeof data.userId === 'string' && data.userId ? data.userId : undefined,
  };
}

/**
 * All watchlist items for a user (Firestore `userId` must match).
 */
export async function getAllWatchlistItems(userId: string): Promise<WatchlistItem[]> {
  try {
    const db = getAdminFirestore();
    const snap = await db.collection('watchlist').where('userId', '==', userId).get();
    const items: WatchlistItem[] = [];
    snap.forEach((d) => {
      items.push(docToItem(d.id, d.data()));
    });
    return items.sort((a, b) => {
      const sd = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (sd !== 0) return sd;
      const ca = a.createdAt || '';
      const cb = b.createdAt || '';
      if (ca !== cb) return cb.localeCompare(ca);
      return a.ticker.localeCompare(b.ticker);
    });
  } catch (error) {
    console.error('Error fetching watchlist items:', error);
    throw new Error('Failed to fetch watchlist items from Firebase');
  }
}

/**
 * Single item if it exists and belongs to userId.
 */
export async function getWatchlistItem(itemId: string, userId: string): Promise<WatchlistItem | null> {
  try {
    const db = getAdminFirestore();
    const docRef = await db.collection('watchlist').doc(itemId).get();
    if (!docRef.exists) return null;
    const data = docRef.data()!;
    if (data.userId !== userId) return null;
    return docToItem(docRef.id, data);
  } catch (error) {
    console.error(`Error fetching watchlist item ${itemId}:`, error);
    throw new Error('Failed to fetch watchlist item from Firebase');
  }
}

export type NewWatchlistItemInput = {
  ticker: string;
  notes?: string;
  thesisId?: string;
  targetPrice?: number;
  status?: WatchlistStatus;
  userId: string;
};

export async function addWatchlistItem(item: NewWatchlistItemInput): Promise<string> {
  try {
    const db = getAdminFirestore();
    const status: WatchlistStatus =
      item.status && isWatchlistStatus(item.status) ? item.status : 'thesis_needed';
    const ref = await db.collection('watchlist').add({
      ticker: item.ticker.toUpperCase(),
      notes: item.notes || '',
      thesisId: item.thesisId || null,
      targetPrice: item.targetPrice ?? null,
      status,
      userId: item.userId,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    console.error('Error adding watchlist item:', error);
    throw new Error('Failed to add watchlist item to Firebase');
  }
}

export type WatchlistItemUpdates = {
  ticker?: string;
  notes?: string;
  thesisId?: string | null;
  targetPrice?: number | null;
  status?: WatchlistStatus;
};

export async function updateWatchlistItem(
  itemId: string,
  userId: string,
  updates: WatchlistItemUpdates
): Promise<void> {
  try {
    const db = getAdminFirestore();
    const ref = db.collection('watchlist').doc(itemId);
    const existing = await ref.get();
    if (!existing.exists || existing.data()?.userId !== userId) {
      throw new Error('Watchlist item not found');
    }
    const payload: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
    if (updates.ticker !== undefined) payload.ticker = updates.ticker.trim().toUpperCase();
    if (updates.notes !== undefined) payload.notes = updates.notes;
    if (updates.thesisId !== undefined) {
      payload.thesisId = updates.thesisId === null || updates.thesisId === '' ? null : updates.thesisId;
    }
    if (updates.targetPrice !== undefined) {
      payload.targetPrice = updates.targetPrice === null || updates.targetPrice === undefined ? null : updates.targetPrice;
    }
    if (updates.status !== undefined) {
      if (!isWatchlistStatus(updates.status)) {
        throw new Error('Invalid status');
      }
      payload.status = updates.status;
    }
    await ref.update(payload);
  } catch (error) {
    console.error(`Error updating watchlist item ${itemId}:`, error);
    if (
      error instanceof Error &&
      (error.message === 'Watchlist item not found' || error.message === 'Invalid status')
    ) {
      throw error;
    }
    throw new Error('Failed to update watchlist item in Firebase');
  }
}

export async function deleteWatchlistItem(itemId: string, userId: string): Promise<void> {
  try {
    const db = getAdminFirestore();
    const ref = db.collection('watchlist').doc(itemId);
    const existing = await ref.get();
    if (!existing.exists || existing.data()?.userId !== userId) {
      throw new Error('Watchlist item not found');
    }
    await ref.delete();
  } catch (error) {
    console.error(`Error deleting watchlist item ${itemId}:`, error);
    if (error instanceof Error && error.message === 'Watchlist item not found') {
      throw error;
    }
    throw new Error('Failed to delete watchlist item from Firebase');
  }
}
