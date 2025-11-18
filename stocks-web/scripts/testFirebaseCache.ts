#!/usr/bin/env tsx

/**
 * Firebase Cache Management Utility
 * 
 * This script helps test and manage the new Firebase-based cache system.
 * Run with: npx tsx scripts/testFirebaseCache.ts
 */

// Load environment variables first, before any other imports
import { config } from 'dotenv';
config({ path: '.env.local' });

// Now import Firebase after environment variables are loaded
import { FirebaseCache } from '../app/lib/cache';
import { YFinanceService } from '../app/lib/yfinance';
import { doc, getDoc } from 'firebase/firestore';

// Validate required Firebase environment variables
function validateFirebaseConfig() {
  const requiredVars = [
    'NEXT_PUBLIC_FIREBASE_API_KEY',
    'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
    'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
    'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
    'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
    'NEXT_PUBLIC_FIREBASE_APP_ID'
  ];

  const missingVars = requiredVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required Firebase environment variables:');
    missingVars.forEach(varName => console.error(`   - ${varName}`));
    console.error('\n💡 Please check your .env.local file in the project root.');
    console.error('   Make sure all Firebase configuration variables are set.');
    process.exit(1);
  }
  
  console.log('✅ Firebase configuration loaded successfully');
  console.log(`📍 Project ID: ${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`);
}

async function testFirebaseCache() {
  console.log('🔥 Firebase Cache System Test (Hybrid Storage Model)\n');
  
  // Validate Firebase config first
  validateFirebaseConfig();
  
  const cache = new FirebaseCache();
  const yfinance = new YFinanceService();
  
  const testTicker = 'AAPL';
  const testPeriod = '2y';
  
  try {
    // Test 1: Check current cache status
    console.log('\n📊 Step 1: Checking cache status (Annual Storage Model)...');
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 2);
    
    const cacheStatus = await cache.hasCachedDataForRange(testTicker, startDate, endDate);
    console.log(`Cache status for ${testTicker}:`, cacheStatus);
    
    // Test 2: Check metadata
    console.log('\n📋 Step 2: Checking metadata...');
    const metadata = await cache.getTickerMetadata(testTicker);
    if (metadata) {
      console.log(`Metadata found:`, metadata);
    } else {
      console.log(`No metadata found for ${testTicker}`);
    }
    
    // Test 3: Fetch and cache data (now uses Firebase Storage for price data)
    console.log('\n📈 Step 3: Fetching stock data with Firebase Storage backend...');
    const startTime = Date.now();
    const stockData = await yfinance.fetchStockData(testTicker, testPeriod);
    const fetchTime = Date.now() - startTime;
    
    console.log(`✅ Data fetched in ${fetchTime}ms`);
    console.log(`Symbol: ${stockData.symbol}`);
    console.log(`Company: ${stockData.companyName}`);
    console.log(`Total data points: ${stockData.data.length}`);
    
    const dailyPoints = stockData.data.filter(d => d.frequency === 'daily');
    const quarterlyPoints = stockData.data.filter(d => d.frequency === 'quarterly');
    
    console.log(`- Daily price points: ${dailyPoints.length}`);
    console.log(`- Quarterly points: ${quarterlyPoints.length}`);
    
    // Test 4: Check cache status after fetch (should show annual files in Storage)
    console.log('\n🔍 Step 4: Checking cache status after fetch...');
    const newCacheStatus = await cache.hasCachedDataForRange(testTicker, startDate, endDate);
    console.log(`New cache status:`, newCacheStatus);
    
    // Test 5: Test cache hit performance (should download from Storage)
    console.log('\n⚡ Step 5: Testing cache hit (downloads from Firebase Storage)...');
    const cacheStartTime = Date.now();
    const cachedStockData = await yfinance.fetchStockData(testTicker, testPeriod);
    const cacheTime = Date.now() - cacheStartTime;
    
    console.log(`✅ Cached data fetched in ${cacheTime}ms (${Math.round(((fetchTime - cacheTime) / fetchTime) * 100)}% faster)`);
    
    // Test 6: Test quarterly financial data access
    console.log('\n📅 Step 6: Testing quarterly data access...');
    const quarterlyFinancials = await cache.getFinancialDataRange(testTicker, startDate, endDate);
    console.log(`Found ${quarterlyFinancials.length} quarters of financial data`);
    
    if (quarterlyFinancials.length > 0) {
      const latest = quarterlyFinancials[quarterlyFinancials.length - 1];
      console.log(`Latest quarter: ${latest.fiscalYear}Q${latest.fiscalQuarter}`);
      console.log(`EPS: ${latest.financials?.epsDiluted || 'N/A'}`);
    }
    
    // Test 7: Test annual price data access (Firebase Storage)
    console.log('\n💰 Step 7: Testing annual price data access from Storage...');
    const priceData = await cache.getPriceDataRange(testTicker, startDate, endDate);
    const priceDates = Object.keys(priceData).sort();
    console.log(`Found price data for ${priceDates.length} days`);
    
    if (priceDates.length > 0) {
      const firstDate = priceDates[0];
      const lastDate = priceDates[priceDates.length - 1];
      console.log(`Date range: ${firstDate} to ${lastDate}`);
      console.log(`Latest close: $${priceData[lastDate]?.c || 'N/A'}`);
    }
    
    // Test 8: Show Firebase Storage references from consolidated document
    console.log('\n☁️ Step 8: Testing consolidated price data structure...');
    const { db } = require('../app/lib/firebase');
    const priceDataRef = doc(db, 'tickers', testTicker.toUpperCase(), 'price', 'consolidated');
    const priceDataSnap = await getDoc(priceDataRef);
    
    if (priceDataSnap.exists()) {
      const consolidatedData = priceDataSnap.data();
      console.log(`Found consolidated price data with ${Object.keys(consolidatedData.years).length} years`);
      
      Object.entries(consolidatedData.years).forEach(([year, yearData]: [string, any]) => {
        console.log(`${year}: ${yearData.metadata.totalDays} days, ${Math.round(yearData.metadata.fileSize / 1024)} KB in Storage`);
        console.log(`   Storage path: ${yearData.storageRef}`);
        console.log(`   Price range: $${yearData.metadata.firstClose} - $${yearData.metadata.lastClose}`);
      });
    } else {
      console.log('No consolidated price data found');
    }
    
    console.log('\n✅ All hybrid storage tests completed successfully!');
    console.log('\n💡 Benefits realized:');
    console.log('   - Large price datasets stored efficiently in Firebase Storage');
    console.log('   - Metadata and financial data remain fast in Firestore');
    console.log('   - Annual chunks reduce file count and improve performance');
    console.log('   - Storage costs significantly lower than Firestore for large datasets');
    console.log('   - Consolidated price references in single document for better performance');
    
    // Exit cleanly
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error && error.message.includes('Firebase')) {
      console.error('\n💡 This might be a Firebase configuration issue.');
      console.error('   Please check your .env.local file and Firebase project settings.');
    }
    process.exit(1);
  }
}

async function clearCache(ticker?: string) {
  console.log(`🧹 Clearing cache${ticker ? ` for ${ticker}` : ''}...`);
  
  // Validate Firebase config
  validateFirebaseConfig();
  
  const cache = new FirebaseCache();
  
  try {
    await cache.clearCache(ticker);
    console.log('✅ Cache cleared successfully');
  } catch (error) {
    console.error('❌ Failed to clear cache:', error);
    process.exit(1);
  }
}

async function cacheStatus(ticker: string) {
  console.log(`📊 Cache status for ${ticker}:`);
  
  // Validate Firebase config
  validateFirebaseConfig();
  
  const cache = new FirebaseCache();
  
  try {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(endDate.getFullYear() - 5);
    
    const [metadata, cacheStatus] = await Promise.all([
      cache.getTickerMetadata(ticker),
      cache.hasCachedDataForRange(ticker, startDate, endDate)
    ]);
    
    console.log('\nMetadata:', metadata || 'Not found');
    console.log('\nCache Status:', cacheStatus);
    
    if (cacheStatus.missingQuarters.length > 0) {
      console.log('\nMissing quarters:', cacheStatus.missingQuarters.join(', '));
    }
    
  } catch (error) {
    console.error('❌ Failed to get cache status:', error);
    process.exit(1);
  }
}

// CLI interface
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'test':
    testFirebaseCache();
    break;
    
  case 'clear':
    clearCache(args[1]);
    break;
    
  case 'status':
    if (!args[1]) {
      console.error('❌ Please provide a ticker symbol');
      process.exit(1);
    }
    cacheStatus(args[1]);
    break;
    
  default:
    console.log(`
🔥 Firebase Cache Management Utility

Usage:
  npx tsx scripts/testFirebaseCache.ts test         - Run full test suite
  npx tsx scripts/testFirebaseCache.ts clear [TICKER] - Clear cache (all or specific ticker)
  npx tsx scripts/testFirebaseCache.ts status TICKER  - Check cache status for ticker

Examples:
  npx tsx scripts/testFirebaseCache.ts test
  npx tsx scripts/testFirebaseCache.ts clear AAPL
  npx tsx scripts/testFirebaseCache.ts status MSFT

Environment:
  Requires Firebase configuration in .env.local:
  - NEXT_PUBLIC_FIREBASE_API_KEY
  - NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
  - NEXT_PUBLIC_FIREBASE_PROJECT_ID
  - NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
  - NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
  - NEXT_PUBLIC_FIREBASE_APP_ID
`);
    break;
}