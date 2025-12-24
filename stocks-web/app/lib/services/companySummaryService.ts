import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Get company summary for a ticker
 */
export async function getCompanySummary(ticker: string): Promise<any | null> {
  try {
    const summaryRef = doc(db, 'tickers', ticker.toUpperCase(), 'company_summary', 'summary');
    const summarySnap = await getDoc(summaryRef);
    
    if (summarySnap.exists()) {
      return summarySnap.data();
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting company summary for ${ticker}:`, error);
    return null;
  }
}

