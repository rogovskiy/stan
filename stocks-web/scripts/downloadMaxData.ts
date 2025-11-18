#!/usr/bin/env tsx

/**
 * Maximum Data Download Utility
 * 
 * This script downloads and caches maximum available data from Yahoo Finance for a given ticker.
 * Run with: npx tsx scripts/downloadMaxData.ts <TICKER>
 */

// Load environment variables first, before any other imports
import { config } from 'dotenv';
config({ path: '.env.local' });

// Now import Firebase after environment variables are loaded
import { YFinanceService } from '../app/lib/yfinance';
import { FirebaseCache } from '../app/lib/cache';

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

interface DownloadOptions {
  ticker: string;
  clearExisting?: boolean;
  verbose?: boolean;
  maxYearsBack?: number;
}

class MaxDataDownloader {
  private yfinanceService: YFinanceService;
  private cache: FirebaseCache;

  constructor() {
    this.yfinanceService = new YFinanceService();
    this.cache = new FirebaseCache();
  }

  async downloadMaxData(options: DownloadOptions): Promise<void> {
    const { ticker, clearExisting = false, verbose = false, maxYearsBack = 50 } = options;
    
    console.log(`\n🚀 Starting maximum data download for ${ticker.toUpperCase()}`);
    console.log(`Options: clearExisting=${clearExisting}, maxYearsBack=${maxYearsBack}`);

    try {
      // Clear existing cache if requested
      if (clearExisting) {
        console.log(`\n🗑️  Clearing existing cache for ${ticker}...`);
        await this.cache.clearCache(ticker);
        console.log(`✅ Cache cleared for ${ticker}`);
      }

      // 1. Download and cache metadata
      console.log(`\n📋 Fetching company metadata...`);
      const metadata = await this.yfinanceService.fetchAndCacheTickerMetadata(ticker);
      
      if (verbose) {
        console.log(`   Company: ${metadata.name}`);
        console.log(`   Exchange: ${metadata.exchange}`);
        console.log(`   Sector: ${metadata.sector}`);
      }
      console.log(`✅ Metadata cached for ${ticker}`);

      // 2. Download maximum historical price data
      console.log(`\n📈 Fetching maximum historical price data...`);
      const priceResults = await this.yfinanceService.fetchMaxHistoricalData(ticker, maxYearsBack);
      
      if (verbose) {
        console.log(`   Date range: ${priceResults.yearsRange}`);
        console.log(`   Data points: ${priceResults.dataPointsRetrieved}`);
        console.log(`   Years processed: ${priceResults.yearsProcessed}`);
      }
      console.log(`✅ Cached ${priceResults.yearsProcessed} years of price data for ${ticker}`);

      // 3. Download financial data (earnings, forecasts)
      console.log(`\n💰 Fetching financial and earnings data...`);
      const financialResults = await this.yfinanceService.fetchMaxFinancialData(ticker);
      
      if (verbose) {
        console.log(`   Historical earnings: ${financialResults.historicalEarnings}`);
        console.log(`   Forecast quarters: ${financialResults.forecastQuarters}`);
        console.log(`   Total quarters cached: ${financialResults.quartersProcessed}`);
      }
      console.log(`✅ Cached ${financialResults.quartersProcessed} quarters of financial data for ${ticker}`);

      // 4. Verify cached data
      console.log(`\n🔍 Verifying cached data...`);
      await this.verifyCachedData(ticker, verbose);

      console.log(`\n🎉 Maximum data download completed successfully for ${ticker.toUpperCase()}!`);

    } catch (error) {
      console.error(`\n❌ Error downloading data for ${ticker}:`, error);
      if (error instanceof Error && error.message.includes('Firebase')) {
        console.error('\n💡 This might be a Firebase configuration issue.');
        console.error('   Please check your .env.local file and Firebase project settings.');
      }
      throw error;
    }
  }

  private async verifyCachedData(ticker: string, verbose: boolean): Promise<void> {
    try {
      // Check what we have cached
      const endDate = new Date();
      const startDate = new Date();
      startDate.setFullYear(endDate.getFullYear() - 20); // Check last 20 years

      const cacheStatus = await this.cache.hasCachedDataForRange(ticker, startDate, endDate);
      
      console.log(`   Cache verification for ${ticker}:`);
      console.log(`   ✓ Price data complete: ${cacheStatus.hasAllPriceData ? 'Yes' : 'No'}`);
      console.log(`   ✓ Financial data complete: ${cacheStatus.hasAllFinancialData ? 'Yes' : 'No'}`);
      
      if (cacheStatus.missingYears.length > 0) {
        console.log(`   ⚠️  Missing price data years: ${cacheStatus.missingYears.join(', ')}`);
      }
      
      if (cacheStatus.missingQuarters.length > 0) {
        console.log(`   ⚠️  Missing financial quarters: ${cacheStatus.missingQuarters.length}`);
        if (verbose && cacheStatus.missingQuarters.length < 20) {
          console.log(`   Missing quarters: ${cacheStatus.missingQuarters.join(', ')}`);
        }
      }

      // Get metadata
      const metadata = await this.cache.getTickerMetadata(ticker);
      if (metadata) {
        console.log(`   ✓ Metadata: ${metadata.name} (${metadata.exchange})`);
      } else {
        console.log(`   ⚠️  No metadata cached`);
      }

    } catch (error) {
      console.error(`❌ Error verifying cached data for ${ticker}:`, error);
    }
  }
}

// CLI interface
async function main() {
  validateFirebaseConfig();

  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: npx tsx scripts/downloadMaxData.ts <TICKER> [options]

Arguments:
  TICKER              Stock ticker symbol (e.g., AAPL, MSFT, GOOGL)

Options:
  --clear             Clear existing cache before downloading
  --verbose           Show detailed progress information
  --max-years=<N>     Maximum years to go back (default: 50)

Examples:
  npx tsx scripts/downloadMaxData.ts AAPL
  npx tsx scripts/downloadMaxData.ts MSFT --clear --verbose
  npx tsx scripts/downloadMaxData.ts GOOGL --max-years=20
    `);
    process.exit(1);
  }

  const ticker = args[0].toUpperCase();
  const clearExisting = args.includes('--clear');
  const verbose = args.includes('--verbose');
  
  let maxYearsBack = 50;
  const maxYearsArg = args.find(arg => arg.startsWith('--max-years='));
  if (maxYearsArg) {
    maxYearsBack = parseInt(maxYearsArg.split('=')[1]) || 50;
  }

  const downloader = new MaxDataDownloader();
  
  try {
    await downloader.downloadMaxData({
      ticker,
      clearExisting,
      verbose,
      maxYearsBack
    });
    
    console.log(`\n🎉 Successfully downloaded and cached maximum data for ${ticker}!`);
    process.exit(0);
    
  } catch (error) {
    console.error(`\n💥 Failed to download data for ${ticker}:`, error);
    process.exit(1);
  }
}

// Run the script if called directly
if (require.main === module) {
  main().catch(console.error);
}

export { MaxDataDownloader };