import { collection, getDocs, query, where, orderBy, doc, getDoc, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from './firebase';
import { TickerMetadata } from './cache';
import crypto from 'crypto';

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

/**
 * Get all KPI definitions for a ticker
 */
export async function getKPIDefinitions(ticker: string): Promise<any[]> {
  try {
    const kpiDefinitionsRef = collection(db, 'tickers', ticker.toUpperCase(), 'kpi_definitions');
    const querySnapshot = await getDocs(kpiDefinitionsRef);
    
    const definitions: any[] = [];
    querySnapshot.forEach((doc) => {
      definitions.push(doc.data());
    });
    
    // Sort by name
    definitions.sort((a, b) => {
      const nameA = a.name || '';
      const nameB = b.name || '';
      return nameA.localeCompare(nameB);
    });
    
    return definitions;
  } catch (error) {
    console.error(`Error getting KPI definitions for ${ticker}:`, error);
    return [];
  }
}

/**
 * Generate an immutable KPI ID from semantic_interpretation
 * This matches the Python implementation - generates a 12-character MD5 hash
 */
function generateKpiId(semanticInterpretation: any): string {
  if (!semanticInterpretation) {
    throw new Error('semantic_interpretation is required to generate KPI ID');
  }

  const measureKind = semanticInterpretation.measure_kind || '';
  const subject = semanticInterpretation.subject || '';
  const subjectAxis = semanticInterpretation.subject_axis || '';
  const unitFamily = semanticInterpretation.unit_family || '';

  // Normalize qualifiers
  const qualifiers = semanticInterpretation.qualifiers;
  let qualifiersDict: Record<string, string> = {};

  if (qualifiers) {
    if (Array.isArray(qualifiers)) {
      qualifiers.forEach((q: any) => {
        if (q && typeof q === 'object' && q.key && q.value) {
          qualifiersDict[q.key] = q.value;
        }
      });
    } else if (typeof qualifiers === 'object') {
      qualifiersDict = { ...qualifiers };
    }
  }

  // Sort qualifiers by key for deterministic hashing
  const sortedQualifiers = Object.entries(qualifiersDict).sort(([a], [b]) => a.localeCompare(b));
  const qualifiersStr = JSON.stringify(sortedQualifiers);

  // Create deterministic string from invariants
  const invariantString = `${measureKind}|${subject}|${subjectAxis}|${unitFamily}|${qualifiersStr}`;

  // Generate MD5 hash and take first 12 characters
  const hash = crypto.createHash('md5').update(invariantString).digest('hex');
  return hash.substring(0, 12);
}

/**
 * Create a KPI definition from a raw KPI
 */
export async function createKPIDefinition(
  ticker: string, 
  rawKpi: any, 
  quarterKey: string
): Promise<any> {
  try {
    const upperTicker = ticker.toUpperCase();
    const semanticInterpretation = rawKpi.semantic_interpretation;

    if (!semanticInterpretation) {
      throw new Error('Raw KPI must have semantic_interpretation to create a definition');
    }

    // Generate immutable ID from semantic_interpretation
    const kpiId = generateKpiId(semanticInterpretation);

    // Check if definition already exists
    const definitionRef = doc(db, 'tickers', upperTicker, 'kpi_definitions', kpiId);
    const existingSnap = await getDoc(definitionRef);
    const existingData = existingSnap.exists() ? existingSnap.data() : null;

    const now = new Date().toISOString();

    // Prepare definition data
    const definitionData: any = {
      id: kpiId,
      name: rawKpi.name || '',
      value: {
        unit: rawKpi.value?.unit || '',
        multiplier: rawKpi.value?.multiplier || null
      },
      value_type: rawKpi.value_type || '',
      summary: rawKpi.summary || '',
      source: rawKpi.source || '',
      semantic_interpretation: semanticInterpretation,
      updated_at: now
    };

    // If new document, set created_at; otherwise preserve existing
    if (!existingSnap.exists()) {
      definitionData.created_at = now;
    } else if (existingData?.created_at) {
      definitionData.created_at = existingData.created_at;
    }

    // Store the definition
    await setDoc(definitionRef, definitionData);

    return definitionData;
  } catch (error) {
    console.error(`Error creating KPI definition for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Link a raw KPI to a definition by updating the raw_kpis document
 */
export async function linkRawKPIToDefinition(
  ticker: string,
  rawKpi: any,
  definitionId: string,
  quarterKey: string
): Promise<void> {
  try {
    const rawKpisRef = doc(db, 'tickers', ticker.toUpperCase(), 'raw_kpis', quarterKey);
    const rawKpisSnap = await getDoc(rawKpisRef);
    
    if (!rawKpisSnap.exists()) {
      throw new Error(`Raw KPIs document not found for ${ticker} ${quarterKey}`);
    }
    
    const data = rawKpisSnap.data();
    const rawKpis = data.raw_kpis || [];
    
    // Find and update the matching KPI
    const kpiName = rawKpi.name;
    const updatedKpis = rawKpis.map((kpi: any) => {
      if (kpi.name === kpiName) {
        return {
          ...kpi,
          definition_id: definitionId,
          linked_at: new Date().toISOString()
        };
      }
      return kpi;
    });
    
    await updateDoc(rawKpisRef, {
      raw_kpis: updatedKpis
    });
  } catch (error) {
    console.error(`Error linking raw KPI to definition for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Get all prompt fragments for a ticker
 */
export async function getPromptFragments(ticker: string): Promise<any[]> {
  try {
    const fragmentsRef = collection(db, 'tickers', ticker.toUpperCase(), 'prompt_fragments');
    const querySnapshot = await getDocs(fragmentsRef);
    
    const fragments: any[] = [];
    querySnapshot.forEach((doc) => {
      fragments.push({
        id: doc.id,
        ...doc.data()
      });
    });
    
    // Sort by order if available, then by created_at
    fragments.sort((a, b) => {
      const orderA = a.order !== undefined ? a.order : Infinity;
      const orderB = b.order !== undefined ? b.order : Infinity;
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      const createdA = a.created_at || '';
      const createdB = b.created_at || '';
      return createdA.localeCompare(createdB);
    });
    
    return fragments;
  } catch (error) {
    console.error(`Error getting prompt fragments for ${ticker}:`, error);
    return [];
  }
}

/**
 * Save a prompt fragment (create or update)
 */
export async function savePromptFragment(
  ticker: string,
  fragment: { id?: string; title: string; content: string }
): Promise<any> {
  try {
    const upperTicker = ticker.toUpperCase();
    const now = new Date().toISOString();
    
    const fragmentData: any = {
      title: fragment.title,
      content: fragment.content,
      updated_at: now
    };
    
    if (fragment.id) {
      // Update existing fragment
      const fragmentRef = doc(db, 'tickers', upperTicker, 'prompt_fragments', fragment.id);
      const fragmentSnap = await getDoc(fragmentRef);
      
      if (fragmentSnap.exists()) {
        const existingData = fragmentSnap.data();
        // Preserve created_at if it exists
        if (existingData?.created_at) {
          fragmentData.created_at = existingData.created_at;
        }
        await updateDoc(fragmentRef, fragmentData);
        return {
          id: fragment.id,
          ...fragmentData
        };
      } else {
        throw new Error(`Prompt fragment with ID ${fragment.id} not found`);
      }
    } else {
      // Create new fragment - generate an ID
      const fragmentsRef = collection(db, 'tickers', upperTicker, 'prompt_fragments');
      const newFragmentRef = doc(fragmentsRef);
      
      fragmentData.created_at = now;
      
      await setDoc(newFragmentRef, fragmentData);
      
      return {
        id: newFragmentRef.id,
        ...fragmentData
      };
    }
  } catch (error) {
    console.error(`Error saving prompt fragment for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Delete a prompt fragment by ID
 */
export async function deletePromptFragment(ticker: string, id: string): Promise<void> {
  try {
    const fragmentRef = doc(db, 'tickers', ticker.toUpperCase(), 'prompt_fragments', id);
    const fragmentSnap = await getDoc(fragmentRef);
    
    if (!fragmentSnap.exists()) {
      throw new Error(`Prompt fragment with ID ${id} not found`);
    }
    
    await deleteDoc(fragmentRef);
  } catch (error) {
    console.error(`Error deleting prompt fragment ${id} for ${ticker}:`, error);
    throw error;
  }
}

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

// Create a service object for easier imports
export const firebaseService = {
  getTickers,
  getAllTickers,
  getTickerMetadata,
  hasTickerData,
  getQuarterlyTimeseries,
  getKPITimeseries,
  getKPIDefinitions,
  createKPIDefinition,
  linkRawKPIToDefinition,
  getRawKPIs,
  getAllRawKPIs,
  getPromptFragments,
  savePromptFragment,
  deletePromptFragment,
  getAnalystData,
  getCompanySummary,
  getQuarterlyTextAnalysis
};