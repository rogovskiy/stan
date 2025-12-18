import { collection, getDocs, query, where, orderBy, doc, getDoc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
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

/**
 * Get KPI timeseries data from ticker-specific collection
 */
export async function getKPITimeseries(ticker: string): Promise<any | null> {
  try {
    const kpiRef = doc(db, 'tickers', ticker.toUpperCase(), 'timeseries', 'kpi');
    const kpiSnap = await getDoc(kpiRef);
    
    if (kpiSnap.exists()) {
      const data = kpiSnap.data();
      
      // Return the data if it exists (no expiration logic)
      if (data) {
        // Remove last_updated from returned data
        const { last_updated, ...kpiData } = data;
        return kpiData;
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting KPI timeseries for ${ticker}:`, error);
    return null;
  }
}

/**
 * Get all KPI definitions for a ticker
 */
export async function getKPIDefinitions(ticker: string): Promise<any[]> {
  try {
    const kpiDefinitionsRef = collection(db, 'tickers', ticker.toUpperCase(), 'kpi_definitions');
    const snapshot = await getDocs(kpiDefinitionsRef);
    
    const definitions: any[] = [];
    snapshot.forEach((doc) => {
      definitions.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    return definitions;
  } catch (error) {
    console.error(`Error getting KPI definitions for ${ticker}:`, error);
    return [];
  }
}

/**
 * Get raw KPIs for a specific quarter
 */
export async function getRawKPIs(ticker: string, quarterKey: string): Promise<any | null> {
  try {
    const rawKpiRef = doc(db, 'tickers', ticker.toUpperCase(), 'raw_kpis', quarterKey);
    const rawKpiSnap = await getDoc(rawKpiRef);
    
    if (rawKpiSnap.exists()) {
      return rawKpiSnap.data();
    }
    
    return null;
  } catch (error) {
    console.error(`Error getting raw KPIs for ${ticker} ${quarterKey}:`, error);
    return null;
  }
}

/**
 * Get all raw KPIs for a ticker (all quarters)
 */
export async function getAllRawKPIs(ticker: string): Promise<any[]> {
  try {
    const rawKpisRef = collection(db, 'tickers', ticker.toUpperCase(), 'raw_kpis');
    const snapshot = await getDocs(rawKpisRef);
    
    const rawKpis: any[] = [];
    snapshot.forEach((doc) => {
      rawKpis.push({
        quarterKey: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by quarter key (YYYYQN format)
    rawKpis.sort((a, b) => {
      const aKey = a.quarterKey || '';
      const bKey = b.quarterKey || '';
      return aKey.localeCompare(bKey);
    });
    
    return rawKpis;
  } catch (error) {
    console.error(`Error getting all raw KPIs for ${ticker}:`, error);
    return [];
  }
}

/**
 * Create a KPI definition from a raw KPI
 */
export async function createKPIDefinition(ticker: string, rawKpi: any, quarterKey: string): Promise<{ kpi_id: string; definition: any }> {
  const { doc, setDoc, getDoc } = await import('firebase/firestore');
  const { createHash } = await import('crypto');
  const { db } = await import('./firebase');
  
  if (!db) {
    throw new Error('Firebase not initialized');
  }
  
  const upperTicker = ticker.toUpperCase();
  const semantic = rawKpi.semantic_interpretation;
  
  if (!semantic) {
    throw new Error('Raw KPI must have semantic_interpretation');
  }
  
  // Generate ID from semantic interpretation (same logic as Python service)
  const invariantString = `${semantic.measure_kind || ''}|${semantic.subject || ''}|${semantic.subject_axis || ''}|${semantic.unit_family || ''}`;
  const kpiId = createHash('md5').update(invariantString).digest('hex').substring(0, 12);
  
  // Create KPI definition from raw KPI
  const definitionData = {
    id: kpiId,
    name: rawKpi.name,
    unit: rawKpi.value?.unit || '',
    multiplier: rawKpi.value?.multiplier || null,
    value_type: rawKpi.value_type || '',
    summary: rawKpi.summary || '',
    source: rawKpi.source || '',
    semantic_interpretation: semantic,
    other_names: rawKpi.other_names || [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  
  // Store definition
  const definitionRef = doc(db, 'tickers', upperTicker, 'kpi_definitions', kpiId);
  await setDoc(definitionRef, definitionData, { merge: true });
  
  // Link raw KPI to definition by updating the raw KPI document
  const rawKpiRef = doc(db, 'tickers', upperTicker, 'raw_kpis', quarterKey);
  const rawKpiDoc = await getDoc(rawKpiRef);
  
  if (rawKpiDoc.exists()) {
    const rawKpiData = rawKpiDoc.data();
    const rawKpis = rawKpiData.raw_kpis || [];
    
    // Find and update the specific raw KPI
    const updatedRawKpis = rawKpis.map((kpi: any) => {
      const kpiSemantic = kpi.semantic_interpretation;
      if (kpiSemantic &&
          kpiSemantic.measure_kind === semantic.measure_kind &&
          kpiSemantic.subject === semantic.subject &&
          kpiSemantic.subject_axis === semantic.subject_axis &&
          kpiSemantic.unit_family === semantic.unit_family) {
        return {
          ...kpi,
          definition_id: kpiId,
          linked_at: new Date().toISOString()
        };
      }
      return kpi;
    });
    
    await setDoc(rawKpiRef, { raw_kpis: updatedRawKpis }, { merge: true });
  }
  
  return { kpi_id: kpiId, definition: definitionData };
}

/**
 * Link a raw KPI to an existing definition
 */
export async function linkRawKPIToDefinition(ticker: string, rawKpi: any, definitionId: string, quarterKey: string): Promise<void> {
  const { doc, getDoc, setDoc } = await import('firebase/firestore');
  const { db } = await import('./firebase');
  
  if (!db) {
    throw new Error('Firebase not initialized');
  }
  
  const upperTicker = ticker.toUpperCase();
  
  // Verify definition exists
  const definitionRef = doc(db, 'tickers', upperTicker, 'kpi_definitions', definitionId);
  const definitionDoc = await getDoc(definitionRef);
  
  if (!definitionDoc.exists()) {
    throw new Error('KPI definition not found');
  }
  
  // Link raw KPI to definition
  const rawKpiRef = doc(db, 'tickers', upperTicker, 'raw_kpis', quarterKey);
  const rawKpiDoc = await getDoc(rawKpiRef);
  
  if (!rawKpiDoc.exists()) {
    throw new Error('Raw KPI document not found');
  }
  
  const rawKpiData = rawKpiDoc.data();
  const rawKpis = rawKpiData.raw_kpis || [];
  const semantic = rawKpi.semantic_interpretation;
  
  // Find and update the specific raw KPI
  const updatedRawKpis = rawKpis.map((kpi: any) => {
    const kpiSemantic = kpi.semantic_interpretation;
    if (kpiSemantic &&
        kpiSemantic.measure_kind === semantic?.measure_kind &&
        kpiSemantic.subject === semantic?.subject &&
        kpiSemantic.subject_axis === semantic?.subject_axis &&
        kpiSemantic.unit_family === semantic?.unit_family) {
      return {
        ...kpi,
        definition_id: definitionId,
        linked_at: new Date().toISOString()
      };
    }
    return kpi;
  });
  
  await setDoc(rawKpiRef, { raw_kpis: updatedRawKpis }, { merge: true });
}

/**
 * Get all prompt fragments for a ticker
 */
export async function getPromptFragments(ticker: string): Promise<any[]> {
  try {
    const fragmentsRef = collection(db, 'tickers', ticker.toUpperCase(), 'prompt_fragments');
    const snapshot = await getDocs(fragmentsRef);
    
    const fragments: any[] = [];
    snapshot.forEach((doc) => {
      fragments.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by order if available, then by created_at
    fragments.sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      if (a.created_at && b.created_at) {
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      }
      return 0;
    });
    
    return fragments;
  } catch (error) {
    console.error(`Error getting prompt fragments for ${ticker}:`, error);
    return [];
  }
}

/**
 * Create or update a prompt fragment
 */
export async function savePromptFragment(
  ticker: string,
  fragment: { id?: string; title: string; content: string }
): Promise<{ id: string; fragment: any }> {
  if (!db) {
    throw new Error('Firebase not initialized');
  }
  
  const upperTicker = ticker.toUpperCase();
  const now = new Date().toISOString();
  
  if (fragment.id) {
    // Update existing fragment
    const fragmentRef = doc(db, 'tickers', upperTicker, 'prompt_fragments', fragment.id);
    await updateDoc(fragmentRef, {
      title: fragment.title.trim(),
      content: fragment.content.trim(),
      updated_at: now
    });
    
    const updatedDoc = await getDoc(fragmentRef);
    return {
      id: fragment.id,
      fragment: updatedDoc.exists() ? { id: fragment.id, ...updatedDoc.data() } : null
    };
  } else {
    // Create new fragment
    const fragmentsRef = collection(db, 'tickers', upperTicker, 'prompt_fragments');
    const newFragment = {
      title: fragment.title.trim(),
      content: fragment.content.trim(),
      created_at: now,
      updated_at: now
    };
    
    const docRef = await addDoc(fragmentsRef, newFragment);
    
    return {
      id: docRef.id,
      fragment: { id: docRef.id, ...newFragment }
    };
  }
}

/**
 * Delete a prompt fragment
 */
export async function deletePromptFragment(ticker: string, fragmentId: string): Promise<void> {
  if (!db) {
    throw new Error('Firebase not initialized');
  }
  
  const upperTicker = ticker.toUpperCase();
  const fragmentRef = doc(db, 'tickers', upperTicker, 'prompt_fragments', fragmentId);
  await deleteDoc(fragmentRef);
}

// Create a service object for easier imports
export const firebaseService = {
  getTickers,
  getAllTickers,
  getTickerMetadata,
  hasTickerData,
  getQuarterlyTimeseries,
  getAnalystData,
  getCompanySummary,
  getKPITimeseries,
  getKPIDefinitions,
  getRawKPIs,
  getAllRawKPIs,
  createKPIDefinition,
  linkRawKPIToDefinition,
  getPromptFragments,
  savePromptFragment,
  deletePromptFragment
};