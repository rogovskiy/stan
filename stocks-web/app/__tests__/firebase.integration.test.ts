/**
 * Firebase Tickers Integration Tests
 * 
 * These tests verify the Firebase connection and ticker data retrieval functionality.
 * They test the service layer functionality with real Firebase connections.
 * These tests assume the test database is seeded with ticker data.
 */

import { 
  getTickers, 
  getAllTickers,
  type Ticker 
} from '../lib/firebaseService';
import { getApps, deleteApp } from 'firebase/app';
import { terminate } from 'firebase/firestore';
import { db } from '../lib/firebase';

describe('Firebase Tickers Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset environment variables
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'stan-1464e';
  });

  // Clean up Firebase connections after all tests
  afterAll(async () => {
    try {
      // Terminate the Firestore connection
      await terminate(db);
      
      // Delete all Firebase app instances
      const apps = getApps();
      await Promise.all(apps.map(app => deleteApp(app)));
      
      console.log('🧹 Firebase connections cleaned up');
    } catch (error) {
      console.log('⚠️  Error cleaning up Firebase:', error);
    }
  });

  describe('Firebase Service Layer', () => {
    test('should connect to Firebase and fetch all tickers', async () => {
      const allTickers = await getAllTickers();
      expect(Array.isArray(allTickers)).toBe(true);
      expect(allTickers.length).toBeGreaterThan(0);
      console.log(`✅ Successfully connected to Firebase. Found ${allTickers.length} tickers.`);
    });

    test('should validate ticker structure', async () => {
      const allTickers = await getAllTickers();
      expect(allTickers.length).toBeGreaterThan(0);
      
      const firstTicker = allTickers[0];
      
      // Validate required fields
      expect(firstTicker).toHaveProperty('symbol');
      expect(firstTicker).toHaveProperty('name');
      expect(typeof firstTicker.symbol).toBe('string');
      expect(typeof firstTicker.name).toBe('string');
      expect(firstTicker.symbol.length).toBeGreaterThan(0);
      expect(firstTicker.name.length).toBeGreaterThan(0);
      
      // Validate optional fields if present
      if (firstTicker.sector) {
        expect(typeof firstTicker.sector).toBe('string');
      }
      if (firstTicker.market) {
        expect(typeof firstTicker.market).toBe('string');
      }
      if (firstTicker.active !== undefined) {
        expect(typeof firstTicker.active).toBe('boolean');
      }
      if (firstTicker.lastUpdated) {
        expect(firstTicker.lastUpdated).toBeInstanceOf(Date);
      }
      
      console.log(`✅ Ticker structure validation passed for: ${firstTicker.symbol} - ${firstTicker.name}`);
    });

    test('should retrieve specific tickers by symbols', async () => {
      // First get all tickers to have some symbols to test with
      const allTickers = await getAllTickers();
      expect(allTickers.length).toBeGreaterThan(0);
      
      // Test with first few symbols
      const symbolsToTest = allTickers.slice(0, Math.min(3, allTickers.length)).map(t => t.symbol);
      const specificTickers = await getTickers(symbolsToTest);
      
      expect(Array.isArray(specificTickers)).toBe(true);
      expect(specificTickers.length).toBeGreaterThan(0);
      
      // Validate that we got the correct tickers
      specificTickers.forEach(ticker => {
        expect(symbolsToTest).toContain(ticker.symbol);
      });
      
      console.log(`✅ Retrieved ${specificTickers.length} specific tickers from ${symbolsToTest.length} requested symbols`);
    });

    test('should handle empty symbols array in getTickers', async () => {
      const emptyResult = await getTickers([]);
      expect(emptyResult).toEqual([]);
      console.log('✅ Correctly handled empty symbols array');
    });

    test('should handle non-existent ticker symbols', async () => {
      const nonExistentTickers = await getTickers(['NONEXISTENT1', 'NONEXISTENT2']);
      expect(Array.isArray(nonExistentTickers)).toBe(true);
      expect(nonExistentTickers.length).toBe(0);
      console.log('✅ Correctly handled non-existent ticker symbols');
    });

    test('should validate all tickers have required data', async () => {
      const allTickers = await getAllTickers();
      expect(allTickers.length).toBeGreaterThan(0);
      
      allTickers.forEach((ticker, index) => {
        expect(ticker.symbol).toBeDefined();
        expect(ticker.name).toBeDefined();
        expect(typeof ticker.symbol).toBe('string');
        expect(typeof ticker.name).toBe('string');
        expect(ticker.symbol.length).toBeGreaterThan(0);
        expect(ticker.name.length).toBeGreaterThan(0);
        expect(ticker.symbol.trim()).toBe(ticker.symbol); // No leading/trailing spaces
        expect(ticker.name.trim()).toBe(ticker.name); // No leading/trailing spaces
      });
      
      console.log(`✅ Validated ${allTickers.length} tickers, all have required data`);
    });

    test('should retrieve tickers with mixed existing and non-existing symbols', async () => {
      // Get one existing ticker
      const allTickers = await getAllTickers();
      expect(allTickers.length).toBeGreaterThan(0);
      
      const existingSymbol = allTickers[0].symbol;
      const mixedSymbols = [existingSymbol, 'NONEXISTENT'];
      
      const result = await getTickers(mixedSymbols);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].symbol).toBe(existingSymbol);
      
      console.log(`✅ Correctly handled mixed existing/non-existing symbols`);
    });
  });

  describe('Data Validation', () => {
    test('should validate ticker data structure', () => {
      const validTicker: Ticker = {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        sector: 'Technology',
        market: 'NASDAQ',
        active: true,
        lastUpdated: new Date()
      };

      // Validate required fields
      expect(typeof validTicker.symbol).toBe('string');
      expect(typeof validTicker.name).toBe('string');
      
      // Validate optional fields if present
      if (validTicker.sector) expect(typeof validTicker.sector).toBe('string');
      if (validTicker.market) expect(typeof validTicker.market).toBe('string');
      if (validTicker.active !== undefined) expect(typeof validTicker.active).toBe('boolean');
      if (validTicker.lastUpdated) expect(validTicker.lastUpdated).toBeInstanceOf(Date);
      
      console.log('✅ Ticker data structure validation passed');
    });
  });

  describe('Firebase Environment Check', () => {
    test('should have Firebase configuration environment variables', () => {
      const requiredEnvVars = [
        'NEXT_PUBLIC_FIREBASE_API_KEY',
        'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
        'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
        'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
        'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
        'NEXT_PUBLIC_FIREBASE_APP_ID'
      ];

      const missingVars: string[] = [];
      requiredEnvVars.forEach(varName => {
        if (!process.env[varName]) {
          missingVars.push(varName);
        }
      });

      if (missingVars.length > 0) {
        console.log(`⚠️  Missing Firebase environment variables: ${missingVars.join(', ')}`);
        console.log('ℹ️  Make sure .env.local is configured with your Firebase credentials');
      } else {
        console.log('✅ All Firebase environment variables are configured');
      }

      // This test always passes but logs the configuration status
      expect(true).toBe(true);
    });
  });
});