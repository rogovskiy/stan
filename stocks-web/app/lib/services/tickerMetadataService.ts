import { doc, getDoc, getDocs, collection, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { TickerMetadata } from '../cache';
import YahooFinance from 'yahoo-finance2';

export interface Ticker {
  symbol: string;
  name: string;
  sector?: string;
  exchange?: string;
  active?: boolean;
  lastUpdated?: Date;
}

export type { TickerMetadata };

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
 * Check if price timestamp is outdated (older than 10 minutes)
 */
function isPriceOutdated(timestamp: string | undefined): boolean {
  if (!timestamp) return true;
  
  const priceAge = Date.now() - new Date(timestamp).getTime();
  const tenMinutes = 10 * 60 * 1000; // 10 minutes in milliseconds
  
  return priceAge >= tenMinutes;
}

/**
 * Check if error is a rate limit (429) error
 */
function isRateLimitError(error: any): boolean {
  if (!error) return false;
  
  const errorMessage = error.message || error.toString() || '';
  const errorStatus = error.status || error.statusCode || '';
  
  return errorMessage.includes('429') || 
         errorMessage.includes('Too Many Requests') || 
         errorMessage.includes('rate limit') ||
         errorStatus === 429 ||
         errorMessage.includes('Failed to get crumb');
}

/**
 * Fetch current price from yfinance
 * Returns null on failure, but will throw if it's a rate limit error (to be handled by caller)
 */
async function fetchPriceFromYFinance(ticker: string): Promise<number | null> {
  try {
    const yf = new YahooFinance({ 
      suppressNotices: ['ripHistorical', 'yahooSurvey'] 
    });
    
    // Try quoteSummary first
    try {
      const quoteSummary = await yf.quoteSummary(ticker, { 
        modules: ['price'] 
      });
      
      if (quoteSummary?.price?.regularMarketPrice !== undefined) {
        const price = quoteSummary.price.regularMarketPrice;
        console.log(`Successfully fetched price for ${ticker} via quoteSummary: $${price}`);
        return price;
      }
      
      // Try alternative price paths in quoteSummary
      const regularMarketPrice = quoteSummary?.price?.regularMarketPrice;
      if (regularMarketPrice !== undefined && typeof regularMarketPrice === 'object' && regularMarketPrice !== null && 'raw' in regularMarketPrice) {
        const price = (regularMarketPrice as any).raw;
        if (typeof price === 'number') {
          console.log(`Successfully fetched price for ${ticker} via quoteSummary.raw: $${price}`);
          return price;
        }
      }
      
      // Try currentPrice as fallback
      const currentPrice = quoteSummary?.price?.currentPrice;
      if (currentPrice !== undefined && currentPrice !== null) {
        const price = typeof currentPrice === 'object' && 'raw' in currentPrice
          ? (currentPrice as any).raw 
          : typeof currentPrice === 'number' ? currentPrice : null;
        if (price !== null && typeof price === 'number') {
          console.log(`Successfully fetched price for ${ticker} via currentPrice: $${price}`);
          return price;
        }
      }
      
      console.warn(`quoteSummary for ${ticker} did not contain expected price fields:`, JSON.stringify(quoteSummary?.price, null, 2));
    } catch (quoteSummaryError) {
      // Check if it's a rate limit error
      if (isRateLimitError(quoteSummaryError)) {
        console.warn(`Rate limit (429) error for ${ticker} when using quoteSummary, will use cached price`);
        throw quoteSummaryError; // Re-throw to be handled by caller
      }
      console.warn(`quoteSummary failed for ${ticker}, trying quote() method:`, quoteSummaryError);
    }
    
    // Fallback: try quote() method
    try {
      const quote = await yf.quote(ticker);
      
      if (quote?.regularMarketPrice !== undefined) {
        const price = typeof quote.regularMarketPrice === 'object'
          ? quote.regularMarketPrice.raw
          : quote.regularMarketPrice;
        console.log(`Successfully fetched price for ${ticker} via quote: $${price}`);
        return price;
      }
      
      // Try alternative fields in quote
      if (quote?.regularMarketPrice?.raw !== undefined) {
        console.log(`Successfully fetched price for ${ticker} via quote.raw: $${quote.regularMarketPrice.raw}`);
        return quote.regularMarketPrice.raw;
      }
      
      if (quote?.currentPrice !== undefined) {
        const price = typeof quote.currentPrice === 'object'
          ? quote.currentPrice.raw
          : quote.currentPrice;
        console.log(`Successfully fetched price for ${ticker} via quote.currentPrice: $${price}`);
        return price;
      }
      
      console.warn(`quote() for ${ticker} did not contain expected price fields:`, JSON.stringify(quote, null, 2));
    } catch (quoteError) {
      // Check if it's a rate limit error
      if (isRateLimitError(quoteError)) {
        console.warn(`Rate limit (429) error for ${ticker} when using quote(), will use cached price`);
        throw quoteError; // Re-throw to be handled by caller
      }
      console.error(`quote() also failed for ${ticker}:`, quoteError);
    }
    
    console.error(`All price fetching methods failed for ${ticker}`);
    return null;
  } catch (error) {
    // If it's a rate limit error, re-throw it so caller can handle it
    if (isRateLimitError(error)) {
      throw error;
    }
    console.error(`Error fetching price from yfinance for ${ticker}:`, error);
    return null;
  }
}

/**
 * Update ticker document with new price and timestamp
 */
async function updateTickerPrice(ticker: string, price: number): Promise<void> {
  try {
    const tickerRef = doc(db, 'tickers', ticker.toUpperCase());
    await updateDoc(tickerRef, {
      lastPrice: price,
      lastPriceTimestamp: new Date().toISOString()
    });
    console.log(`Updated price for ${ticker}: $${price.toFixed(2)}`);
  } catch (error) {
    console.error(`Error updating price for ${ticker}:`, error);
    throw error;
  }
}

/**
 * Get ticker metadata directly from Firebase cache
 * @param symbol - Ticker symbol (e.g., 'AAPL')
 * @param refreshPrice - If true, check and refresh price if outdated (default: false)
 */
export async function getTickerMetadata(
  symbol: string, 
  refreshPrice: boolean = false
): Promise<TickerMetadata | null> {
  try {
    const tickerRef = doc(db, 'tickers', symbol.toUpperCase());
    const tickerSnap = await getDoc(tickerRef);
    
    if (!tickerSnap.exists()) {
      return null;
    }
    
    const metadata = tickerSnap.data() as TickerMetadata;
    
    // If refreshPrice is requested, check if price needs refreshing
    if (refreshPrice && isPriceOutdated(metadata.lastPriceTimestamp)) {
      const symbolUpper = symbol.toUpperCase();
      console.log(`Price for ${symbolUpper} is outdated (lastPriceTimestamp: ${metadata.lastPriceTimestamp}), fetching fresh price...`);
      
      try {
        const freshPrice = await fetchPriceFromYFinance(symbolUpper);
        
        if (freshPrice !== null && !isNaN(freshPrice) && freshPrice > 0) {
          await updateTickerPrice(symbolUpper, freshPrice);
          // Return updated metadata with fresh price
          return {
            ...metadata,
            lastPrice: freshPrice,
            lastPriceTimestamp: new Date().toISOString()
          };
        } else {
          console.warn(`Failed to fetch valid fresh price for ${symbolUpper} (got: ${freshPrice}), returning cached metadata`);
        }
      } catch (error) {
        // If it's a rate limit error, return cached price instead of failing
        if (isRateLimitError(error)) {
          console.warn(`Rate limit (429) encountered for ${symbolUpper}, returning cached price (lastPrice: ${metadata.lastPrice}, lastPriceTimestamp: ${metadata.lastPriceTimestamp})`);
          // Return metadata with existing (outdated) price
          return metadata;
        }
        console.error(`Error during price refresh for ${symbolUpper}:`, error);
        // Continue to return cached metadata even if refresh failed
      }
    }
    
    return metadata;
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

