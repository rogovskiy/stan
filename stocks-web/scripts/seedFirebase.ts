/**
 * Firebase Test Data Seeder
 * 
 * Run this script to populate your Firebase database with test ticker lists and individual tickers.
 * Usage: node --loader ts-node/esm scripts/seedFirebase.ts
 */

// Load environment variables first, before any other imports
import { config } from 'dotenv';
config({ path: '.env.local' });

// Now import Firebase after environment variables are loaded
import { collection, addDoc, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../app/lib/firebase';

interface TestTickerList {
  name: string;
  description: string;
  tickers: string[];
}

interface TestTicker {
  symbol: string;
  name: string;
  sector: string;
  market: string;
  active: boolean;
}


// Sample individual tickers with detailed info
const testTickers: TestTicker[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', sector: 'Technology', market: 'NASDAQ', active: true },
  { symbol: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology', market: 'NASDAQ', active: true },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', sector: 'Technology', market: 'NASDAQ', active: true },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Discretionary', market: 'NASDAQ', active: true },
  { symbol: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Discretionary', market: 'NASDAQ', active: true },
  { symbol: 'META', name: 'Meta Platforms Inc.', sector: 'Technology', market: 'NASDAQ', active: true },
  { symbol: 'NFLX', name: 'Netflix Inc.', sector: 'Communication Services', market: 'NASDAQ', active: true },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology', market: 'NASDAQ', active: true },
  { symbol: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare', market: 'NYSE', active: true },
  { symbol: 'PG', name: 'Procter & Gamble Co.', sector: 'Consumer Staples', market: 'NYSE', active: true },
  { symbol: 'KO', name: 'The Coca-Cola Company', sector: 'Consumer Staples', market: 'NYSE', active: true },
  { symbol: 'PEP', name: 'PepsiCo Inc.', sector: 'Consumer Staples', market: 'NASDAQ', active: true },
  { symbol: 'WMT', name: 'Walmart Inc.', sector: 'Consumer Staples', market: 'NYSE', active: true },
  { symbol: 'VZ', name: 'Verizon Communications Inc.', sector: 'Communication Services', market: 'NYSE', active: true },
  { symbol: 'JPM', name: 'JPMorgan Chase & Co.', sector: 'Financials', market: 'NYSE', active: true },
  { symbol: 'BAC', name: 'Bank of America Corporation', sector: 'Financials', market: 'NYSE', active: true },
  { symbol: 'WFC', name: 'Wells Fargo & Company', sector: 'Financials', market: 'NYSE', active: true },
  { symbol: 'GS', name: 'The Goldman Sachs Group Inc.', sector: 'Financials', market: 'NYSE', active: true },
  { symbol: 'MS', name: 'Morgan Stanley', sector: 'Financials', market: 'NYSE', active: true },
  { symbol: 'CRM', name: 'Salesforce Inc.', sector: 'Technology', market: 'NYSE', active: true },
  { symbol: 'ADBE', name: 'Adobe Inc.', sector: 'Technology', market: 'NASDAQ', active: true }
];

async function seedTickers() {
  console.log('🌱 Seeding individual tickers...');
  
  try {
    for (const tickerData of testTickers) {
      const tickerRef = doc(db, 'tickers', tickerData.symbol);
      
      await setDoc(tickerRef, {
        ...tickerData,
        lastUpdated: serverTimestamp()
      });
      
      console.log(`✅ Created ticker: ${tickerData.symbol} - ${tickerData.name}`);
    }
    
    console.log(`🎉 Successfully created ${testTickers.length} individual tickers`);
  } catch (error) {
    console.error('❌ Error seeding tickers:', error);
    throw error;
  }
}

async function seedFirebase() {
  console.log('🚀 Starting Firebase seeding process...');
  
  try {
    console.log(`📡 Attempting to connect to Firebase...`);
    
    // Seed individual tickers
    await seedTickers();
    
    console.log('✨ Firebase seeding completed successfully!');
    console.log('📊 You can now run the integration tests to verify the data');
    
  } catch (error) {
    console.error('💥 Firebase seeding failed:', error);
    if (error.message.includes('Missing required Firebase environment variables')) {
      console.error('ℹ️  Please create a .env.local file with your Firebase credentials');
      console.error('ℹ️  Copy .env.example to .env.local and fill in your Firebase project details');
    }
    process.exit(1);
  }
}

// Run the seeder if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  seedFirebase();
}

export { seedFirebase, testTickers };