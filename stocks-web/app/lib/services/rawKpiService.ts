import { doc, getDoc, getDocs, collection } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Get raw KPIs for a specific quarter
 */
export async function getRawKPIs(ticker: string, quarterKey: string): Promise<any | null> {
  try {
    const rawKpisRef = doc(db, 'tickers', ticker.toUpperCase(), 'raw_kpis', quarterKey);
    const rawKpisSnap = await getDoc(rawKpisRef);
    
    if (rawKpisSnap.exists()) {
      const data = rawKpisSnap.data();
      // Map quarter_key to quarterKey for frontend compatibility
      const quarterKeyValue = data.quarter_key || quarterKey;
      return {
        ...data,
        quarterKey: quarterKeyValue, // Frontend expects camelCase (override if exists)
        quarter_key: quarterKeyValue // Keep snake_case for backwards compatibility
      };
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting raw KPIs for ${ticker} ${quarterKey}:`, error);
    return null;
  }
}

/**
 * Get all raw KPIs for a ticker across all quarters
 */
export async function getAllRawKPIs(ticker: string): Promise<any[]> {
  try {
    const rawKpisRef = collection(db, 'tickers', ticker.toUpperCase(), 'raw_kpis');
    const querySnapshot = await getDocs(rawKpisRef);
    
    const rawKpisList: any[] = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      // Map quarter_key to quarterKey for frontend compatibility
      // Use doc.id as fallback if quarter_key is not in the document
      const quarterKeyValue = data.quarter_key || doc.id;
      rawKpisList.push({
        ...data,
        quarterKey: quarterKeyValue, // Frontend expects camelCase (override if exists)
        quarter_key: quarterKeyValue // Keep snake_case for backwards compatibility
      });
    });
    
    // Sort by quarterKey chronologically
    rawKpisList.sort((a, b) => {
      const qa = a.quarterKey || a.quarter_key || '0000Q0';
      const qb = b.quarterKey || b.quarter_key || '0000Q0';
      const yearA = parseInt(qa.substring(0, 4), 10);
      const yearB = parseInt(qb.substring(0, 4), 10);
      if (yearA !== yearB) {
        return yearA - yearB;
      }
      const quarterA = parseInt(qa.substring(5), 10);
      const quarterB = parseInt(qb.substring(5), 10);
      return quarterA - quarterB;
    });
    
    return rawKpisList;
  } catch (error) {
    console.error(`Error getting all raw KPIs for ${ticker}:`, error);
    return [];
  }
}

