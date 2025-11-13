import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from './firebase';

export interface Ticker {
  symbol: string;
  name: string;
  sector?: string;
  market?: string;
  active?: boolean;
  lastUpdated?: Date;
}

/**
 * Fetch individual ticker details from Firebase
 */
export async function getTickers(symbols: string[]): Promise<Ticker[]> {
  if (symbols.length === 0) return [];
  
  try {
    const tickersRef = collection(db, 'tickers');
    const q = query(
      tickersRef, 
      where('symbol', 'in', symbols.slice(0, 10)), // Firestore 'in' limit is 10
      orderBy('symbol')
    );
    
    const querySnapshot = await getDocs(q);
    const tickers: Ticker[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      tickers.push({
        symbol: data.symbol,
        name: data.name,
        sector: data.sector,
        market: data.market,
        active: data.active,
        lastUpdated: data.lastUpdated?.toDate(),
      });
    });
    
    return tickers;
  } catch (error) {
    console.error('Error fetching tickers:', error);
    throw new Error('Failed to fetch ticker details from Firebase');
  }
}

/**
 * Fetch all available tickers with optional filtering
 */
export async function getAllTickers(activeOnly: boolean = true): Promise<Ticker[]> {
  try {
    const tickersRef = collection(db, 'tickers');
    let q = query(tickersRef, orderBy('symbol'));
    
    if (activeOnly) {
      q = query(tickersRef, where('active', '==', true), orderBy('symbol'));
    }
    
    const querySnapshot = await getDocs(q);
    const tickers: Ticker[] = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      tickers.push({
        symbol: data.symbol,
        name: data.name,
        sector: data.sector,
        market: data.market,
        active: data.active,
        lastUpdated: data.lastUpdated?.toDate(),
      });
    });
    
    return tickers;
  } catch (error) {
    console.error('Error fetching all tickers:', error);
    throw new Error('Failed to fetch tickers from Firebase');
  }
}