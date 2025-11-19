import { collection, getDocs, query, where, orderBy, doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { TickerMetadata } from './cache';

export interface Ticker {
  symbol: string;
  name: string;
  sector?: string;
  exchange?: string;
  active?: boolean;
  lastUpdated?: Date;
}

/**
 * Get custom cached data by key with age validation
 */
export async function getCustomData(key: string, maxAgeHours: number = 24): Promise<any | null> {
  try {
    const customDataRef = doc(db, 'custom_data', key);
    const customDataSnap = await getDoc(customDataRef);
    
    if (customDataSnap.exists()) {
      const data = customDataSnap.data();
      
      // Check if data is still fresh
      if (data.last_updated) {
        const lastUpdated = new Date(data.last_updated);
        const now = new Date();
        const ageHours = (now.getTime() - lastUpdated.getTime()) / (1000 * 60 * 60);
        
        if (ageHours < maxAgeHours) {
          // Remove last_updated from returned data
          const { last_updated, ...customData } = data;
          return customData;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting custom data for ${key}:`, error);
    return null;
  }
}

/**
 * Fetch individual ticker details from Firebase using the new cache structure
 */
export async function getTickers(symbols: string[]): Promise<Ticker[]> {
  if (symbols.length === 0) return [];
  
  try {
    const tickers: Ticker[] = [];
    
    // Fetch each ticker individually since they're now stored as documents
    for (const symbol of symbols.slice(0, 10)) { // Limit to 10 for performance
      const tickerRef = doc(db, 'tickers', symbol.toUpperCase());
      const tickerSnap = await getDoc(tickerRef);
      
      if (tickerSnap.exists()) {
        const data = tickerSnap.data() as TickerMetadata;
        tickers.push({
          symbol: symbol.toUpperCase(),
          name: data.name,
          sector: data.sector,
          exchange: data.exchange,
          active: true,
          lastUpdated: new Date(data.lastUpdated),
        });
      }
    }
    
    return tickers.sort((a, b) => a.symbol.localeCompare(b.symbol));
  } catch (error) {
    console.error('Error fetching tickers:', error);
    throw new Error('Failed to fetch ticker details from Firebase');
  }
}

/**
 * Fetch all available tickers with optional filtering
 * Note: This will scan all ticker documents to get the full list
 */
export async function getAllTickers(activeOnly: boolean = true): Promise<Ticker[]> {
  try {
    const tickersRef = collection(db, 'tickers');
    const querySnapshot = await getDocs(tickersRef);
    const tickers: Ticker[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data() as TickerMetadata;
      
      // Filter out subcollections (price, quarters) by checking if data has expected metadata structure
      if (data.name && data.exchange) {
        tickers.push({
          symbol: doc.id,
          name: data.name,
          sector: data.sector,
          exchange: data.exchange,
          active: true, // All cached tickers are considered active
          lastUpdated: new Date(data.lastUpdated),
        });
      }
    });
    
    return tickers.sort((a, b) => a.symbol.localeCompare(b.symbol));
  } catch (error) {
    console.error('Error fetching all tickers:', error);
    throw new Error('Failed to fetch tickers from Firebase');
  }
}

/**
 * Get ticker metadata directly from Firebase cache
 */
export async function getTickerMetadata(symbol: string): Promise<TickerMetadata | null> {
  try {
    const tickerRef = doc(db, 'tickers', symbol.toUpperCase());
    const tickerSnap = await getDoc(tickerRef);
    
    if (tickerSnap.exists()) {
      return tickerSnap.data() as TickerMetadata;
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching metadata for ${symbol}:`, error);
    return null;
  }
}

/**
 * Check if ticker data exists in Firebase cache
 */
export async function hasTickerData(symbol: string): Promise<boolean> {
  try {
    const tickerRef = doc(db, 'tickers', symbol.toUpperCase());
    const tickerSnap = await getDoc(tickerRef);
    return tickerSnap.exists();
  } catch (error) {
    console.error(`Error checking ticker data for ${symbol}:`, error);
    return false;
  }
}

// Create a service object for easier imports
export const firebaseService = {
  getTickers,
  getAllTickers,
  getTickerMetadata,
  hasTickerData,
  getCustomData
};