/**
 * Watchlist types and constants safe for Client Components (no firebase-admin).
 * Server CRUD lives in watchlistService.ts.
 */

export const WATCHLIST_STATUSES = [
  'thesis_needed',
  'watching',
  'awaiting_confirmation',
  'ready_to_buy',
] as const;

export type WatchlistStatus = (typeof WATCHLIST_STATUSES)[number];

export function isWatchlistStatus(s: string): s is WatchlistStatus {
  return (WATCHLIST_STATUSES as readonly string[]).includes(s);
}

export interface WatchlistItem {
  id?: string;
  ticker: string;
  notes?: string;
  thesisId?: string;
  targetPrice?: number;
  status: WatchlistStatus;
  createdAt?: string;
  updatedAt?: string;
  userId?: string;
}
