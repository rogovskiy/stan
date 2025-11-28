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
from extract_sec_financials import SECFinancialsService


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
        self.sec_service = SECFinancialsService()
    
    def download_max_data(self, ticker: str, clear_existing: bool = False, 
                         verbose: bool = False, max_years_back: int = 50,
                         skip_price_data: bool = False, skip_financial_data: bool = False) -> None:
        """Download and cache maximum available data for a ticker
        
        Args:
            ticker: Stock ticker symbol
            clear_existing: Clear existing cache before downloading
            verbose: Show detailed progress
            max_years_back: Maximum years of historical data to fetch
            skip_price_data: Skip downloading historical price data
            skip_financial_data: Skip downloading financial/earnings data
        """
        
        print(f'\n🚀 Starting maximum data download for {ticker.upper()}')
        print(f'Options: clearExisting={clear_existing}, maxYearsBack={max_years_back}')
        if skip_price_data:
            print(f'⏭️  Skipping price data download')
        if skip_financial_data:
            print(f'⏭️  Skipping financial data download')
        
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
            
            # 2. Download maximum historical price data (optional)
            if not skip_price_data:
                print(f'\n📈 Fetching maximum historical price data...')
                price_results = self.yfinance_service.fetch_max_historical_data(ticker, max_years_back)
                
                if verbose:
                    print(f'   Date range: {price_results["years_range"]}')
                    print(f'   Data points: {price_results["data_points_retrieved"]}')
                    print(f'   Years processed: {price_results["years_processed"]}')
                print(f'✅ Cached {price_results["years_processed"]} years of price data for {ticker}')
            else:
                print(f'\n⏭️  Skipped price data download')
            
            # 3. Download financial/earnings data (optional)
            if not skip_financial_data:
                # 3a. Download SEC financial statements (income, balance sheet, cash flow)
                print(f'\n📊 Fetching SEC comprehensive financial statements...')
                sec_results = self._fetch_sec_financial_statements(ticker, verbose)
                
                if sec_results['success']:
                    print(f'✅ Cached {sec_results["quarterly_periods"]} quarterly periods and {sec_results["annual_periods"]} annual periods')
                    if verbose:
                        print(f'   Fiscal years: {sec_results["fiscal_years"]}')
                        print(f'   Data sources: SEC EDGAR filings')
                else:
                    print(f'⚠️  No SEC data available for {ticker}: {sec_results.get("error", "Unknown error")}')
                
                # 3b. Download Yahoo Finance financial data (earnings, forecasts)
                print(f'\n💰 Fetching Yahoo Finance earnings data...')
                financial_results = self.yfinance_service.fetch_max_financial_data(ticker)
                
                if verbose:
                    print(f'   Historical earnings: {financial_results["historical_earnings"]}')
                    print(f'   Forecast quarters: {financial_results["forecast_quarters"]}')
                    print(f'   Total quarters cached: {financial_results["quarters_processed"]}')
                print(f'✅ Cached {financial_results["quarters_processed"]} quarters of financial data for {ticker}')
            else:
                print(f'\n⏭️  Skipped financial data download')
            
            # 4. Verify cached data
            print(f'\n🔍 Verifying cached data...')
            self._verify_cached_data(ticker, verbose, skip_price=skip_price_data, skip_financial=skip_financial_data)
            
            print(f'\n🎉 Maximum data download completed successfully for {ticker.upper()}!')
            
        except Exception as error:
            print(f'\n❌ Error downloading data for {ticker}: {error}')
            if 'firebase' in str(error).lower():
                print('\n💡 This might be a Firebase configuration issue.')
                print('   Please check your .env.local file and Firebase project settings.')
            raise error
    
    def _fetch_sec_financial_statements(self, ticker: str, verbose: bool) -> Dict[str, Any]:
        """Fetch and cache comprehensive SEC financial statements"""
        try:
            # Get all available periods for the ticker
            periods = self.sec_service.get_all_available_periods(ticker, verbose=verbose)
            
            if not periods:
                return {
                    'success': False,
                    'error': 'Failed to load SEC data',
                    'quarterly_periods': 0,
                    'annual_periods': 0
                }
            
            if verbose:
                print(f"   Found {periods['total_quarters']} quarters and {periods['total_years']} years")
            
            # Cache all quarterly data
            quarterly_count = 0
            for fiscal_year, fiscal_quarter in periods['quarterly_periods']:
                quarter_data = self.sec_service.get_quarterly_data(
                    ticker=ticker,
                    fiscal_year=fiscal_year,
                    fiscal_quarter=fiscal_quarter,
                    verbose=verbose
                )
                
                if quarter_data:
                    cache_data = self.sec_service.prepare_for_cache(
                        ticker=ticker,
                        data=quarter_data,
                        is_annual=False
                    )
                    quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
                    self.cache.set_sec_financial_data(ticker, quarter_key, cache_data)
                    quarterly_count += 1
            
            # Cache all annual data
            annual_count = 0
            for fiscal_year in periods['annual_periods']:
                annual_data = self.sec_service.get_annual_data(
                    ticker=ticker,
                    fiscal_year=fiscal_year,
                    verbose=verbose
                )
                
                if annual_data:
                    cache_data = self.sec_service.prepare_for_cache(
                        ticker=ticker,
                        data=annual_data,
                        is_annual=True
                    )
                    annual_key = f"{fiscal_year}_ANNUAL"
                    self.cache.set_sec_financial_data(ticker, annual_key, cache_data)
                    annual_count += 1
            
            # Calculate fiscal year range
            if periods['quarterly_periods']:
                years = sorted(set([y for y, q in periods['quarterly_periods']]))
                fiscal_years_str = f"{years[0]}-{years[-1]}" if years else "None"
            else:
                fiscal_years_str = "None"
            
            return {
                'success': True,
                'quarterly_periods': quarterly_count,
                'annual_periods': annual_count,
                'fiscal_years': fiscal_years_str
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'quarterly_periods': 0,
                'annual_periods': 0
            }
    
    def _verify_cached_data(self, ticker: str, verbose: bool, skip_price: bool = False, skip_financial: bool = False) -> None:
        """Verify cached data completeness
        
        Args:
            ticker: Stock ticker symbol
            verbose: Show detailed output
            skip_price: Skip price data verification
            skip_financial: Skip financial data verification
        """
        try:
            # Check what we have cached
            end_date = datetime.now()
            start_date = end_date - timedelta(days=20*365)  # Check last 20 years
            
            cache_status = self.cache.has_cached_data_for_range(ticker, start_date, end_date)
            
            print(f'   Cache verification for {ticker}:')
            
            if not skip_price:
                print(f'   ✓ Price data complete: {"Yes" if cache_status["has_all_price_data"] else "No"}')
                if cache_status['missing_years']:
                    print(f'   ⚠️  Missing price data years: {", ".join(map(str, cache_status["missing_years"]))}')
            
            if not skip_financial:
                print(f'   ✓ Financial data complete: {"Yes" if cache_status["has_all_financial_data"] else "No"}')
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
        description='Download maximum available stock data from Yahoo Finance and SEC',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Download everything (price + financial data)
  python download_max_data.py AAPL
  
  # Download only financial data (skip price data)
  python download_max_data.py AAPL --skip-price
  
  # Download only price data (skip financial data)
  python download_max_data.py AAPL --skip-financial
  
  # Download with options
  python download_max_data.py MSFT --clear --verbose --max-years 20
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT, GOOGL)')
    parser.add_argument('--clear', action='store_true', 
                       help='Clear existing cache before downloading')
    parser.add_argument('--verbose', action='store_true',
                       help='Show detailed progress information')
    parser.add_argument('--max-years', type=int, default=50,
                       help='Maximum years to go back for price data (default: 50)')
    parser.add_argument('--skip-price', action='store_true',
                       help='Skip downloading historical price data')
    parser.add_argument('--skip-financial', action='store_true',
                       help='Skip downloading financial/earnings data')
    
    args = parser.parse_args()
    
    ticker = args.ticker.upper()
    downloader = MaxDataDownloader()
    
    try:
        downloader.download_max_data(
            ticker=ticker,
            clear_existing=args.clear,
            verbose=args.verbose,
            max_years_back=args.max_years,
            skip_price_data=args.skip_price,
            skip_financial_data=args.skip_financial
        )
        
        print(f'\n🎉 Successfully downloaded and cached maximum data for {ticker}!')
        sys.exit(0)
        
    except Exception as error:
        print(f'\n💥 Failed to download data for {ticker}: {error}')
        sys.exit(1)


if __name__ == '__main__':
    main()