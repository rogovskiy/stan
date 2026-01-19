import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Get quarterly time series data from ticker-specific collection
 */
export async function getQuarterlyTimeseries(ticker: string): Promise<any | null> {
  try {
    const timeseriesRef = doc(db, 'tickers', ticker.toUpperCase(), 'timeseries', 'quarterly');
    const timeseriesSnap = await getDoc(timeseriesRef);
    
    if (timeseriesSnap.exists()) {
      const data = timeseriesSnap.data();
      
      // Return the data if it exists (no expiration logic)
      if (data) {
        // Remove last_updated from returned data
        const { last_updated, ...timeseriesData } = data;
        return timeseriesData;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting quarterly timeseries for ${ticker}:`, error);
    return null;
  }
}

/**
 * Get KPI timeseries data from ticker-specific collection
 */
export async function getKPITimeseries(ticker: string): Promise<any | null> {
  try {
    const kpiTimeseriesRef = doc(db, 'tickers', ticker.toUpperCase(), 'timeseries', 'kpi');
    const kpiTimeseriesSnap = await getDoc(kpiTimeseriesRef);
    
    if (kpiTimeseriesSnap.exists()) {
      const data = kpiTimeseriesSnap.data();
      
      // Return the data if it exists (no expiration logic)
      if (data) {
        // Remove last_updated from returned data if present
        const { last_updated, ...kpiTimeseriesData } = data;
        return kpiTimeseriesData;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting KPI timeseries for ${ticker}:`, error);
    return null;
  }
}



