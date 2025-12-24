import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Get quarterly text analysis for a ticker
 * If quarterKey is not provided, fetches from "current" document
 */
export async function getQuarterlyTextAnalysis(ticker: string, quarterKey?: string): Promise<any | null> {
  try {
    const quarterDocId = quarterKey || 'current';
    const analysisRef = doc(db, 'tickers', ticker.toUpperCase(), 'quarterly_text_analyses', quarterDocId);
    const analysisSnap = await getDoc(analysisRef);
    
    if (analysisSnap.exists()) {
      const data = analysisSnap.data();
      
      // Return the extracted_data if it exists, otherwise return the full document
      if (data.extracted_data) {
        return {
          ...data.extracted_data,
          quarter_key: data.quarter_key || quarterKey,
          ticker: data.ticker || ticker.toUpperCase(),
          created_at: data.created_at,
          num_documents: data.num_documents
        };
      }
      
      return data;
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting quarterly text analysis for ${ticker}:`, error);
    return null;
  }
}

