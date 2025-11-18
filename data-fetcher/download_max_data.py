#!/usr/bin/env python3
"""
Maximum Data Download Utility - Python Version

This script downloads and caches maximum available data from Yahoo Finance for a given ticker.
Run with: python download_max_data.py <TICKER>
"""

import os
import sys
import json
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dotenv import load_dotenv

# Load environment variables first
load_dotenv('.env.local')

from yfinance_service import YFinanceService
from firebase_cache import FirebaseCache


def validate_firebase_config():
    """Validate required Firebase environment variables"""
    required_vars = [
        'FIREBASE_PROJECT_ID',
        'FIREBASE_PRIVATE_KEY_ID', 
        'FIREBASE_PRIVATE_KEY',
        'FIREBASE_CLIENT_EMAIL',
        'FIREBASE_CLIENT_ID',
        'FIREBASE_AUTH_URI',
        'FIREBASE_TOKEN_URI'
    ]
    
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        print('❌ Missing required Firebase environment variables:')
        for var in missing_vars:
            print(f'   - {var}')
        print('\n💡 Please check your .env.local file in the project root.')
        print('   Make sure all Firebase configuration variables are set.')
        sys.exit(1)
    
    print('✅ Firebase configuration loaded successfully')
    print(f'📍 Project ID: {os.getenv("FIREBASE_PROJECT_ID")}')


class MaxDataDownloader:
    """Downloads maximum available data from Yahoo Finance and caches it"""
    
    def __init__(self):
        self.yfinance_service = YFinanceService()
        self.cache = FirebaseCache()
    
    def download_max_data(self, ticker: str, clear_existing: bool = False, 
                         verbose: bool = False, max_years_back: int = 50) -> None:
        """Download and cache maximum available data for a ticker"""
        
        print(f'\n🚀 Starting maximum data download for {ticker.upper()}')
        print(f'Options: clearExisting={clear_existing}, maxYearsBack={max_years_back}')
        
        try:
            # Clear existing cache if requested
            if clear_existing:
                print(f'\n🗑️  Clearing existing cache for {ticker}...')
                self.cache.clear_cache(ticker)
                print(f'✅ Cache cleared for {ticker}')
            
            # 1. Download and cache metadata
            print(f'\n📋 Fetching company metadata...')
            metadata = self.yfinance_service.fetch_and_cache_ticker_metadata(ticker)
            
            if verbose:
                print(f'   Company: {metadata["name"]}')
                print(f'   Exchange: {metadata["exchange"]}') 
                print(f'   Sector: {metadata["sector"]}')
            print(f'✅ Metadata cached for {ticker}')
            
            # 2. Download maximum historical price data
            print(f'\n📈 Fetching maximum historical price data...')
            price_results = self.yfinance_service.fetch_max_historical_data(ticker, max_years_back)
            
            if verbose:
                print(f'   Date range: {price_results["years_range"]}')
                print(f'   Data points: {price_results["data_points_retrieved"]}')
                print(f'   Years processed: {price_results["years_processed"]}')
            print(f'✅ Cached {price_results["years_processed"]} years of price data for {ticker}')
            
            # 3. Download financial data (earnings, forecasts)
            print(f'\n💰 Fetching financial and earnings data...')
            financial_results = self.yfinance_service.fetch_max_financial_data(ticker)
            
            if verbose:
                print(f'   Historical earnings: {financial_results["historical_earnings"]}')
                print(f'   Forecast quarters: {financial_results["forecast_quarters"]}')
                print(f'   Total quarters cached: {financial_results["quarters_processed"]}')
            print(f'✅ Cached {financial_results["quarters_processed"]} quarters of financial data for {ticker}')
            
            # 4. Verify cached data
            print(f'\n🔍 Verifying cached data...')
            self._verify_cached_data(ticker, verbose)
            
            print(f'\n🎉 Maximum data download completed successfully for {ticker.upper()}!')
            
        except Exception as error:
            print(f'\n❌ Error downloading data for {ticker}: {error}')
            if 'firebase' in str(error).lower():
                print('\n💡 This might be a Firebase configuration issue.')
                print('   Please check your .env.local file and Firebase project settings.')
            raise error
    
    def _verify_cached_data(self, ticker: str, verbose: bool) -> None:
        """Verify cached data completeness"""
        try:
            # Check what we have cached
            end_date = datetime.now()
            start_date = end_date - timedelta(days=20*365)  # Check last 20 years
            
            cache_status = self.cache.has_cached_data_for_range(ticker, start_date, end_date)
            
            print(f'   Cache verification for {ticker}:')
            print(f'   ✓ Price data complete: {"Yes" if cache_status["has_all_price_data"] else "No"}')
            print(f'   ✓ Financial data complete: {"Yes" if cache_status["has_all_financial_data"] else "No"}')
            
            if cache_status['missing_years']:
                print(f'   ⚠️  Missing price data years: {", ".join(map(str, cache_status["missing_years"]))}')
            
            if cache_status['missing_quarters']:
                print(f'   ⚠️  Missing financial quarters: {len(cache_status["missing_quarters"])}')
                if verbose and len(cache_status['missing_quarters']) < 20:
                    print(f'   Missing quarters: {", ".join(cache_status["missing_quarters"])}')
            
            # Get metadata
            metadata = self.cache.get_ticker_metadata(ticker)
            if metadata:
                print(f'   ✓ Metadata: {metadata["name"]} ({metadata["exchange"]})')
            else:
                print(f'   ⚠️  No metadata cached')
                
        except Exception as error:
            print(f'❌ Error verifying cached data for {ticker}: {error}')


def main():
    """Main CLI interface"""
    validate_firebase_config()
    
    parser = argparse.ArgumentParser(
        description='Download maximum available stock data from Yahoo Finance',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python download_max_data.py AAPL
  python download_max_data.py MSFT --clear --verbose
  python download_max_data.py GOOGL --max-years 20
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT, GOOGL)')
    parser.add_argument('--clear', action='store_true', 
                       help='Clear existing cache before downloading')
    parser.add_argument('--verbose', action='store_true',
                       help='Show detailed progress information')
    parser.add_argument('--max-years', type=int, default=50,
                       help='Maximum years to go back (default: 50)')
    
    args = parser.parse_args()
    
    ticker = args.ticker.upper()
    downloader = MaxDataDownloader()
    
    try:
        downloader.download_max_data(
            ticker=ticker,
            clear_existing=args.clear,
            verbose=args.verbose,
            max_years_back=args.max_years
        )
        
        print(f'\n🎉 Successfully downloaded and cached maximum data for {ticker}!')
        sys.exit(0)
        
    except Exception as error:
        print(f'\n💥 Failed to download data for {ticker}: {error}')
        sys.exit(1)


if __name__ == '__main__':
    main()