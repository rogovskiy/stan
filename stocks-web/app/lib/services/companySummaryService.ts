import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Get company information for a ticker from main ticker document
 */
export async function getCompanySummary(ticker: string): Promise<any | null> {
  try {
    // Read from main ticker document instead of subcollection
    const tickerRef = doc(db, 'tickers', ticker.toUpperCase());
    const tickerSnap = await getDoc(tickerRef);
    
    if (tickerSnap.exists()) {
      return tickerSnap.data();
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting company information for ${ticker}:`, error);
    return null;
  }
}



