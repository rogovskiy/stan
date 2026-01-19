import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Get latest analyst data for a ticker (consolidated document)
 */
export async function getAnalystData(ticker: string): Promise<any | null> {
  try {
    const analystRef = doc(db, 'tickers', ticker.toUpperCase(), 'analyst', 'latest');
    const analystSnap = await getDoc(analystRef);
    
    if (analystSnap.exists()) {
      const data = analystSnap.data();
      
      // Remove metadata fields
      const { latest_timestamp, ...analystData } = data;
      
      return analystData;
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting analyst data for ${ticker}:`, error);
    return null;
  }
}



