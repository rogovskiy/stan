import { doc, getDoc, setDoc, collection, query, where, getDocs, deleteDoc, updateDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';

// Lazy import of Firebase services to allow dotenv to load first
let db: any = null;
let storage: any = null;

function getFirebaseServices() {
  if (!db || !storage) {
    const firebase = require('./firebase');
    db = firebase.db;
    storage = firebase.storage;
  }
  return { db, storage };
}

export interface AnnualPriceData {
  ticker: string;
  year: number;
  currency: string;
  timezone: string;
  data: Record<string, {
    o: number; // open
    h: number; // high
    l: number; // low
    c: number; // close
    v: number; // volume
  }>;
  metadata: {
    totalDays: number;
    generatedAt: string;
    source: string;
  };
}

export interface AnnualPriceReference {
  year: number;
  startDate: string;
  endDate: string;
  dataSource: string;
  storageRef: string;
  downloadUrl: string;
  metadata: {
    totalDays: number;
    firstClose: number;
    lastClose: number;
    avgVolume: number;
    fileSize: number;
    compressed: boolean;
  };
  lastUpdated: string;
}

export interface ConsolidatedPriceData {
  lastUpdated: string;
  dataSource: string;
  years: Record<string, {
    year: number;
    startDate: string;
    endDate: string;
    storageRef: string;
    downloadUrl: string;
    metadata: {
      totalDays: number;
      firstClose: number;
      lastClose: number;
      avgVolume: number;
      fileSize: number;
      compressed: boolean;
    };
    lastUpdated: string;
  }>;
}

export interface QuarterlyFinancialData {
  fiscalYear: number;
  fiscalQuarter: number;
  startDate: string;
  endDate: string;
  reportDate?: string;
  
  // Earnings data from earningsHistory
  earnings?: {
    epsActual?: number;
    epsEstimate?: number;
    epsDifference?: number;
    surprisePercent?: number;
    currency?: string;
    period?: string;
    maxAge?: number;
  };
  
  // Forecast data from earningsChart  
  forecast?: {
    actual?: number;
    estimate?: number;
    fiscalQuarter?: string;
    calendarQuarter?: string;
    difference?: string;
    surprisePct?: string;
  };
  
  // Comprehensive financial metrics
  financials?: {
    // Core earnings metrics
    revenue?: number;
    epsDiluted?: number;
    epsBasic?: number;
    grossMarginPct?: number;
    operatingMarginPct?: number;
    netMarginPct?: number;
    
    // Income statement items
    grossProfit?: number;
    operatingIncome?: number;
    netIncome?: number;
    ebit?: number;
    ebitda?: number;
    
    // Per share metrics
    bookValuePerShare?: number;
    dividendPerShare?: number;
    freeCashFlowPerShare?: number;
    
    // Growth metrics
    revenueGrowth?: number;
    earningsGrowth?: number;
    
    // Profitability ratios
    returnOnEquity?: number;
    returnOnAssets?: number;
    returnOnCapital?: number;
    
    // Efficiency metrics
    assetTurnover?: number;
    inventoryTurnover?: number;
    
    // Cash flow metrics
    operatingCashFlow?: number;
    freeCashFlow?: number;
    capitalExpenditure?: number;
    
    // Balance sheet items
    totalAssets?: number;
    totalDebt?: number;
    totalEquity?: number;
    workingCapital?: number;
    
    // Market metrics (when available from Yahoo)
    peRatio?: number;
    pbRatio?: number;
    pegRatio?: number;
    priceToSales?: number;
    enterpriseValue?: number;
    
    // Other metrics
    sharesOutstanding?: number;
    marketCap?: number;
    
    // Data source indicators
    estimated?: boolean;
    dataSource?: string;
  };
}

export interface TickerMetadata {
  name: string;
  exchange: string;
  sector: string;
  lastUpdated: string;
}

export class FirebaseCache {
  
  constructor() {}

  // Utility function to get years in range
  private getYearsInRange(startDate: Date, endDate: Date): number[] {
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    const years: number[] = [];
    
    for (let year = startYear; year <= endYear; year++) {
      years.push(year);
    }
    
    return years;
  }

  // Cache ticker metadata
  async cacheTickerMetadata(ticker: string, metadata: TickerMetadata): Promise<void> {
    try {
      const { db } = getFirebaseServices();
      const docRef = doc(db, 'tickers', ticker.toUpperCase());
      await setDoc(docRef, {
        ...metadata,
        lastUpdated: new Date().toISOString()
      });
      console.log(`Cached metadata for ${ticker}`);
    } catch (error) {
      console.error(`Error caching metadata for ${ticker}:`, error);
      throw error;
    }
  }

  // Get ticker metadata
  async getTickerMetadata(ticker: string): Promise<TickerMetadata | null> {
    try {
      const { db } = getFirebaseServices();
      const docRef = doc(db, 'tickers', ticker.toUpperCase());
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data() as TickerMetadata;
        
        // Check if metadata is stale (older than 7 days)
        const cacheAge = Date.now() - new Date(data.lastUpdated).getTime();
        const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days
        
        if (cacheAge < maxAge) {
          console.log(`Metadata cache hit for ${ticker}`);
          return data;
        }
        
        console.log(`Metadata cache expired for ${ticker}`);
        return null;
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting metadata for ${ticker}:`, error);
      return null;
    }
  }

  // Cache annual price data to Firebase Storage and update consolidated reference
  async cacheAnnualPriceData(ticker: string, year: number, priceData: AnnualPriceData): Promise<void> {
    try {
      const { db, storage } = getFirebaseServices();
      const upperTicker = ticker.toUpperCase();
      
      // 1. Upload price data to Firebase Storage
      const storageRef = ref(storage, `price_data/${upperTicker}/${year}.json`);
      const jsonData = JSON.stringify(priceData, null, 2);
      const blob = new Blob([jsonData], { type: 'application/json' });
      
      console.log(`Uploading price data for ${ticker} ${year} to Storage...`);
      const uploadResult = await uploadBytes(storageRef, blob);
      const downloadUrl = await getDownloadURL(uploadResult.ref);
      
      // 2. Calculate metadata
      const dataEntries = Object.entries(priceData.data);
      const prices = dataEntries.map(([_, data]) => data.c);
      const volumes = dataEntries.map(([_, data]) => data.v);
      
      const yearReference = {
        year,
        startDate: `${year}-01-01`,
        endDate: `${year}-12-31`,
        storageRef: `price_data/${upperTicker}/${year}.json`,
        downloadUrl,
        metadata: {
          totalDays: dataEntries.length,
          firstClose: prices[0] || 0,
          lastClose: prices[prices.length - 1] || 0,
          avgVolume: Math.round(volumes.reduce((a, b) => a + b, 0) / volumes.length) || 0,
          fileSize: blob.size,
          compressed: false
        },
        lastUpdated: new Date().toISOString()
      };
      
      // 3. Update consolidated priceData document (fixed path with even segments)
      const priceDataRef = doc(db, 'tickers', upperTicker, 'price', 'consolidated');
      const priceDataSnap = await getDoc(priceDataRef);
      
      let consolidatedData: ConsolidatedPriceData;
      if (priceDataSnap.exists()) {
        consolidatedData = priceDataSnap.data() as ConsolidatedPriceData;
      } else {
        consolidatedData = {
          lastUpdated: new Date().toISOString(),
          dataSource: 'yahoo_finance',
          years: {}
        };
      }
      
      // Update the specific year and overall timestamp
      consolidatedData.years[year.toString()] = yearReference;
      consolidatedData.lastUpdated = new Date().toISOString();
      
      await setDoc(priceDataRef, consolidatedData);
      
      console.log(`Cached annual price data for ${ticker} ${year} (${blob.size} bytes)`);
    } catch (error) {
      console.error(`Error caching annual price data for ${ticker} ${year}:`, error);
      throw error;
    }
  }

  // Get annual price reference from consolidated document
  async getAnnualPriceReference(ticker: string, year: number): Promise<AnnualPriceReference | null> {
    try {
      const { db } = getFirebaseServices();
      const priceDataRef = doc(db, 'tickers', ticker.toUpperCase(), 'price', 'consolidated');
      const priceDataSnap = await getDoc(priceDataRef);
      
      if (priceDataSnap.exists()) {
        const consolidatedData = priceDataSnap.data() as ConsolidatedPriceData;
        const yearData = consolidatedData.years[year.toString()];
        
        if (yearData) {
          // Handle different data formats (historical vs new)
          const lastUpdated = yearData.lastUpdated || yearData.last_updated;
          const storageRef = yearData.storageRef || yearData.storage_ref;
          const downloadUrl = yearData.downloadUrl || yearData.download_url;
          
          // Ensure the reference has the required fields
          if (!storageRef) {
            console.log(`Annual price reference for ${ticker} ${year} missing storage reference`);
            return null;
          }
          
          if (!downloadUrl) {
            console.log(`Annual price reference for ${ticker} ${year} missing download URL`);
            return null;
          }
          
          // Create normalized reference object
          const normalizedReference: AnnualPriceReference = {
            ...yearData,
            storageRef: storageRef,
            downloadUrl: downloadUrl,
            lastUpdated: lastUpdated
          } as AnnualPriceReference;
          
          // Check cache age - annual price data expires after 24 hours for current year, much longer for past years
          const currentYear = new Date().getFullYear();
          const maxAge = year === currentYear ? 
            24 * 60 * 60 * 1000 : // 24 hours for current year
            365 * 24 * 60 * 60 * 1000; // 1 year for past years (historical data doesn't change)
          
          // Handle missing or invalid lastUpdated timestamp
          if (!lastUpdated) {
            console.log(`Annual price reference found for ${ticker} ${year} but missing lastUpdated - treating as valid for historical year`);
            // For historical years without timestamp, treat as valid if it's not the current year
            if (year < currentYear) {
              return normalizedReference;
            }
            return null;
          }
          
          const cacheAge = Date.now() - new Date(lastUpdated).getTime();
          
          if (cacheAge < maxAge) {
            console.log(`Annual price reference cache hit for ${ticker} ${year}`);
            return normalizedReference;
          }
          
          console.log(`Annual price reference cache expired for ${ticker} ${year} (age: ${Math.round(cacheAge / (24 * 60 * 60 * 1000))} days)`);
        }
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting annual price reference for ${ticker} ${year}:`, error);
      return null;
    }
  }

  // Download annual price data from Firebase Storage
  async downloadAnnualPriceData(reference: AnnualPriceReference): Promise<AnnualPriceData> {
    try {
      console.log(`Downloading price data from Storage: ${reference.storageRef}`);
      const response = await fetch(reference.downloadUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to download price data: ${response.statusText}`);
      }
      
      const priceData = await response.json() as AnnualPriceData;
      return priceData;
    } catch (error) {
      console.error(`Error downloading annual price data:`, error);
      throw error;
    }
  }

  // Get price data for a date range (across multiple years)
  async getPriceDataRange(ticker: string, startDate: Date, endDate: Date): Promise<Record<string, any>> {
    console.log(`Cache: getPriceDataRange called for ${ticker} from ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
    const years = this.getYearsInRange(startDate, endDate);
    console.log(`Cache: Years to fetch: ${years.join(', ')}`);
    const priceData: Record<string, any> = {};
    
    for (const year of years) {
      console.log(`Cache: Fetching data for year ${year}`);
      const reference = await this.getAnnualPriceReference(ticker, year);
      if (reference) {
        console.log(`Cache: Found reference for ${year}, downloading data`);
        const annualData = await this.downloadAnnualPriceData(reference);
        
        // Filter dates within the requested range
        Object.entries(annualData.data).forEach(([dateStr, dayData]) => {
          const date = new Date(dateStr);
          if (date >= startDate && date <= endDate) {
            priceData[dateStr] = dayData;
          }
        });
        console.log(`Cache: Added ${Object.keys(annualData.data).length} data points for ${year}`);
      } else {
        console.log(`Cache: No reference found for ${ticker} year ${year}`);
      }
    }
    
    console.log(`Cache: Total data points retrieved: ${Object.keys(priceData).length}`);
    return priceData;
  }

  // Cache quarterly financial data (unchanged from before)
  async cacheQuarterlyFinancialData(ticker: string, quarterKey: string, financialData: QuarterlyFinancialData): Promise<void> {
    try {
      const { db } = getFirebaseServices();
      const docRef = doc(db, 'tickers', ticker.toUpperCase(), 'quarters', quarterKey);
      await setDoc(docRef, {
        ...financialData,
        lastUpdated: new Date().toISOString()
      });
      console.log(`Cached financial data for ${ticker} ${quarterKey}`);
    } catch (error) {
      console.error(`Error caching financial data for ${ticker} ${quarterKey}:`, error);
      throw error;
    }
  }

  // Get quarterly financial data (unchanged from before)
  async getQuarterlyFinancialData(ticker: string, quarterKey: string): Promise<QuarterlyFinancialData | null> {
    try {
      const { db } = getFirebaseServices();
      const docRef = doc(db, 'tickers', ticker.toUpperCase(), 'quarters', quarterKey);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const data = docSnap.data();
        
        // Financial data expires after 12 hours
        const cacheAge = Date.now() - new Date(data.lastUpdated).getTime();
        const maxAge = 12 * 60 * 60 * 1000; // 12 hours
        
        if (cacheAge < maxAge) {
          console.log(`Financial cache hit for ${ticker} ${quarterKey}`);
          const { lastUpdated, ...financialData } = data;
          return financialData as QuarterlyFinancialData;
        }
        
        console.log(`Financial cache expired for ${ticker} ${quarterKey}`);
        return null;
      }
      
      return null;
    } catch (error) {
      console.error(`Error getting financial data for ${ticker} ${quarterKey}:`, error);
      return null;
    }
  }

  // Get financial data for multiple quarters
  async getFinancialDataRange(ticker: string, startDate: Date, endDate: Date): Promise<QuarterlyFinancialData[]> {
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    const financialData: QuarterlyFinancialData[] = [];
    
    // Generate quarter keys for the range
    for (let year = startYear; year <= endYear; year++) {
      for (let quarter = 1; quarter <= 4; quarter++) {
        const quarterKey = `${year}Q${quarter}`;
        const quarterData = await this.getQuarterlyFinancialData(ticker, quarterKey);
        
        if (quarterData) {
          // Check if quarter falls within date range
          const quarterEndDate = new Date(quarterData.endDate);
          if (quarterEndDate >= startDate && quarterEndDate <= endDate) {
            financialData.push(quarterData);
          }
        }
      }
    }
    
    return financialData.sort((a, b) => {
      if (a.fiscalYear !== b.fiscalYear) return a.fiscalYear - b.fiscalYear;
      return a.fiscalQuarter - b.fiscalQuarter;
    });
  }

  // Clear cache for a specific ticker
  async clearCache(ticker?: string): Promise<void> {
    if (!ticker) {
      console.warn('Clearing all cache not implemented - please specify a ticker');
      return;
    }

    try {
      const { db, storage } = getFirebaseServices();
      const upperTicker = ticker.toUpperCase();
      
      // Delete metadata
      const metaRef = doc(db, 'tickers', upperTicker);
      await deleteDoc(metaRef);
      
      // Get consolidated price data and delete storage files (fixed path)
      const priceDataRef = doc(db, 'tickers', upperTicker, 'price', 'consolidated');
      const priceDataSnap = await getDoc(priceDataRef);
      
      if (priceDataSnap.exists()) {
        const consolidatedData = priceDataSnap.data() as ConsolidatedPriceData;
        
        // Delete all storage files
        const deleteStorageTasks = Object.values(consolidatedData.years).map(async (yearData) => {
          try {
            const storageRef = ref(storage, yearData.storageRef);
            await deleteObject(storageRef);
            console.log(`Deleted storage file: ${yearData.storageRef}`);
          } catch (error) {
            console.warn(`Could not delete storage file ${yearData.storageRef}:`, error);
          }
        });
        
        await Promise.all(deleteStorageTasks);
        
        // Delete consolidated price data document
        await deleteDoc(priceDataRef);
      }
      
      // Delete all financial data
      const quarterQuery = query(collection(db, 'tickers', upperTicker, 'quarters'));
      const quarterSnapshot = await getDocs(quarterQuery);
      const quarterDeletes = quarterSnapshot.docs.map(doc => deleteDoc(doc.ref));
      
      await Promise.all(quarterDeletes);
      console.log(`Cleared all cache for ${ticker}`);
      
    } catch (error) {
      console.error(`Error clearing cache for ${ticker}:`, error);
      throw error;
    }
  }

  // Utility method to check if we have cached data for a date range
  async hasCachedDataForRange(ticker: string, startDate: Date, endDate: Date): Promise<{
    hasAllPriceData: boolean;
    hasAllFinancialData: boolean;
    missingYears: number[];
    missingQuarters: string[];
  }> {
    const years = this.getYearsInRange(startDate, endDate);
    const missingYears: number[] = [];
    const missingQuarters: string[] = [];
    let hasPriceData = true;
    let hasFinancialData = true;
    
    // Check price data (from consolidated document with fixed path)
    try {
      const { db } = getFirebaseServices();
      const priceDataRef = doc(db, 'tickers', ticker.toUpperCase(), 'price', 'consolidated');
      const priceDataSnap = await getDoc(priceDataRef);
      
      if (priceDataSnap.exists()) {
        const consolidatedData = priceDataSnap.data() as ConsolidatedPriceData;
        
        for (const year of years) {
          const yearData = consolidatedData.years[year.toString()];
          if (!yearData) {
            hasPriceData = false;
            missingYears.push(year);
          } else {
            // Check if cached data is still valid
            const currentYear = new Date().getFullYear();
            const maxAge = year === currentYear ? 
              24 * 60 * 60 * 1000 : // 24 hours for current year
              30 * 24 * 60 * 60 * 1000; // 30 days for past years
            
            const cacheAge = Date.now() - new Date(yearData.lastUpdated).getTime();
            if (cacheAge >= maxAge) {
              hasPriceData = false;
              missingYears.push(year);
            }
          }
        }
      } else {
        hasPriceData = false;
        missingYears.push(...years);
      }
    } catch (error) {
      console.error('Error checking price data cache:', error);
      hasPriceData = false;
      missingYears.push(...years);
    }
    
    // Check financial data (quarterly) - unchanged
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    
    for (let year = startYear; year <= endYear; year++) {
      for (let quarter = 1; quarter <= 4; quarter++) {
        const quarterKey = `${year}Q${quarter}`;
        const quarterData = await this.getQuarterlyFinancialData(ticker, quarterKey);
        
        if (!quarterData) {
          hasFinancialData = false;
          missingQuarters.push(quarterKey);
        }
      }
    }
    
    return {
      hasAllPriceData: hasPriceData,
      hasAllFinancialData: hasFinancialData,
      missingYears,
      missingQuarters
    };
  }
}