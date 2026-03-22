/**
 * Services Index
 * 
 * Central export point for all domain-specific services.
 * This allows importing multiple services from a single location.
 */

// Ticker metadata service
export type { Ticker } from './tickerMetadataService';
export * from './tickerMetadataService';

// Timeseries service
export * from './timeseriesService';

// Quarterly text analysis service
export * from './quarterlyTextAnalysisService';

// Analyst data service
export * from './analystDataService';

// KPI definition service
export * from './kpiDefinitionService';

// Raw KPI service
export * from './rawKpiService';

// Prompt fragment service
export * from './promptFragmentService';

// Portfolio service
export * from './portfolioService';

// Watchlist: types/constants are client-safe; CRUD is server-only (firebase-admin).
export * from './watchlistShared';
export {
  addWatchlistItem,
  deleteWatchlistItem,
  getAllWatchlistItems,
  getWatchlistItem,
  updateWatchlistItem,
} from './watchlistService';
export type { NewWatchlistItemInput, WatchlistItemUpdates } from './watchlistService';

// YouTube subscriptions and videos
export * from './youtubeSubscriptionService';

