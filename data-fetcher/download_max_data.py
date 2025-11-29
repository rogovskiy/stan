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
from unified_data_service import UnifiedDataService
from extract_sec_financials import SECFinancialsService


def validate_firebase_config(verbose: bool = True):
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
    
    if verbose:
        print('✅ Firebase configuration loaded successfully')
        print(f'📍 Project ID: {os.getenv("FIREBASE_PROJECT_ID")}')


class MaxDataDownloader:
    """Downloads maximum available data and caches it"""
    
    def __init__(self):
        self.cache = FirebaseCache()
        self.unified_service = UnifiedDataService()
        self.yfinance_service = YFinanceService()
        self.sec_service = SECFinancialsService()
    
    def download_max_data(self, ticker: str, clear_existing: bool = False, 
                         verbose: bool = False, skip_price: bool = False) -> None:
        """Download and cache maximum available data for a ticker
        
        Args:
            ticker: Stock ticker symbol
            clear_existing: Clear existing cache before downloading
            verbose: Show detailed progress
            skip_price: Skip downloading historical price data
        """
        
        if verbose:
            print(f'\n🚀 Starting maximum data download for {ticker.upper()}')
            print(f'Options: clearExisting={clear_existing}, skipPrice={skip_price}')
        else:
            print(f'\n🚀 Downloading data for {ticker.upper()}...')
        
        try:
            # Clear existing cache if requested
            if clear_existing:
                if verbose:
                    print(f'\n🗑️  Clearing existing cache for {ticker}...')
                self.cache.clear_cache(ticker)
                if verbose:
                    print(f'✅ Cache cleared for {ticker}')
            
            # Download historical price data (optional)
            if not skip_price:
                if not verbose:
                    print(f'📈 Downloading historical price data...', end='', flush=True)
                price_results = self._fetch_price_data(ticker, verbose)
                
                if price_results['success']:
                    if verbose:
                        print(f'\n✅ Cached {price_results["years_cached"]} years of price data')
                        print(f'   Date range: {price_results["date_range"]}')
                        print(f'   Data points: {price_results["total_points"]}')
                    else:
                        print(f' {price_results["years_cached"]} years cached')
                else:
                    print(f' ⚠️  Error: {price_results.get("error", "Unknown error")}')
            
            # Download comprehensive financial statements
            if not verbose:
                print(f'📊 Downloading quarterly data...', end='', flush=True)
            sec_results = self._fetch_financial_statements(ticker, verbose)
            
            if sec_results['success']:
                if verbose:
                    print(f'\n✅ Cached {sec_results["quarterly_periods"]} quarterly periods')
                    print(f'   Fiscal years: {sec_results["fiscal_years"]}')
                    print(f'   Data sources: SEC EDGAR + Yahoo Finance (unified)')
                else:
                    print(f' {sec_results["quarterly_periods"]} periods cached')
            else:
                print(f' ⚠️  Error: {sec_results.get("error", "Unknown error")}')
            
            # Download stock split history
            if not verbose:
                print(f'📉 Downloading split history...', end='', flush=True)
            split_results = self._fetch_split_history(ticker, verbose)
            
            if split_results['success']:
                if verbose:
                    print(f'\n✅ Cached {split_results["total_splits"]} stock splits')
                    if split_results['total_splits'] > 0:
                        print(f'   Latest split: {split_results["latest_split"]}')
                else:
                    print(f' {split_results["total_splits"]} splits cached')
            else:
                if not verbose:
                    print(f' ⚠️  Error: {split_results.get("error", "Unknown error")}')
                else:
                    print(f'\n⚠️  Error fetching splits: {split_results.get("error", "Unknown error")}')
            
            print(f'\n✅ Completed for {ticker.upper()}!')
            
        except Exception as error:
            print(f'\n❌ Error downloading data for {ticker}: {error}')
            if 'firebase' in str(error).lower():
                print('\n💡 This might be a Firebase configuration issue.')
                print('   Please check your .env.local file and Firebase project settings.')
            raise error
    
    def _fetch_price_data(self, ticker: str, verbose: bool) -> Dict[str, Any]:
        """Fetch and cache historical price data"""
        try:
            import yfinance as yf
            import pandas as pd
            
            # Download maximum historical data (up to 50 years)
            end_date = datetime.now()
            start_date = end_date - timedelta(days=50 * 365)
            
            if verbose:
                print(f"   Fetching data from {start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}")
            
            stock = yf.Ticker(ticker)
            hist = stock.history(start=start_date, end=end_date, interval='1d')
            
            if hist.empty:
                return {
                    'success': False,
                    'error': 'No price data available',
                    'years_cached': 0
                }
            
            if verbose:
                print(f"   Retrieved {len(hist)} daily price points")
            
            # Group by year and cache
            annual_data = {}
            
            for date_index, row in hist.iterrows():
                year = date_index.year
                year_str = str(year)
                date_str = date_index.strftime('%Y-%m-%d')
                
                if year_str not in annual_data:
                    annual_data[year_str] = {
                        'ticker': ticker.upper(),
                        'year': year,
                        'currency': 'USD',
                        'timezone': 'America/New_York',
                        'data': {},
                        'metadata': {
                            'total_days': 0,
                            'generated_at': datetime.now().isoformat(),
                            'source': 'yfinance_python'
                        }
                    }
                
                annual_data[year_str]['data'][date_str] = {
                    'o': round(float(row.get('Open', row.get('Close', 0))), 2),
                    'h': round(float(row.get('High', row.get('Close', 0))), 2),
                    'l': round(float(row.get('Low', row.get('Close', 0))), 2),
                    'c': round(float(row.get('Close', 0)), 2),
                    'v': int(row.get('Volume', 0))
                }
            
            # Update total_days metadata and cache each year
            years_cached = 0
            min_year = min(int(y) for y in annual_data.keys())
            max_year = max(int(y) for y in annual_data.keys())
            
            for year_str, price_data in annual_data.items():
                price_data['metadata']['total_days'] = len(price_data['data'])
                year = int(year_str)
                
                try:
                    self.cache.cache_annual_price_data(ticker, year, price_data, verbose=verbose)
                    years_cached += 1
                    if not verbose and years_cached % 5 == 0:
                        print(f'.', end='', flush=True)
                except Exception as error:
                    if verbose:
                        print(f"   ❌ Failed to cache year {year}: {error}")
            
            if verbose:
                print(f"   Organized data into {len(annual_data)} years")
            
            date_range = f"{start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')}"
            
            return {
                'success': True,
                'years_cached': years_cached,
                'date_range': date_range,
                'total_points': len(hist)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'years_cached': 0
            }
    
    def _fetch_financial_statements(self, ticker: str, verbose: bool) -> Dict[str, Any]:
        """Fetch and cache comprehensive financial statements using unified service"""
        try:
            # Get all available periods from SEC (suppress verbose output)
            periods = self.sec_service.get_all_available_periods(ticker, verbose=False)
            
            if not periods:
                return {
                    'success': False,
                    'error': 'Failed to load SEC data',
                    'quarterly_periods': 0
                }
            
            if verbose:
                print(f"   Found {periods['total_quarters']} quarters available in SEC data")
            
            # Cache all quarterly data using unified service (auto-selects best source)
            quarterly_count = 0
            fiscal_years = set()
            
            for fiscal_year, fiscal_quarter in periods['quarterly_periods']:
                fiscal_years.add(fiscal_year)
                
                # Fetch using unified service (auto-selects SEC or Yahoo Finance)
                quarter_data = self.unified_service.fetch_financial_data(
                    ticker=ticker,
                    year=fiscal_year,
                    quarter=fiscal_quarter,
                    verbose=False  # Suppress per-quarter verbose output
                )
                
                if not verbose and quarterly_count > 0 and quarterly_count % 10 == 0:
                    print(f'.', end='', flush=True)
                
                if quarter_data:
                    # Prepare for cache
                    cache_data = {
                        'ticker': ticker.upper(),
                        'fiscal_year': fiscal_year,
                        'fiscal_quarter': fiscal_quarter,
                        'period_end_date': quarter_data.get('period_end_date'),
                        'data_source': quarter_data.get('data_source'),
                        'accession_number': quarter_data.get('accession_number'),
                        'is_annual': False,
                        'income_statement': quarter_data.get('income_statement', {}),
                        'balance_sheet': quarter_data.get('balance_sheet', {}),
                        'cash_flow_statement': quarter_data.get('cash_flow_statement', {}),
                        'updated_at': datetime.now().isoformat(),
                        'statement_type': 'quarterly',
                        'derived_from': quarter_data.get('derived_from')
                    }
                    
                    quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
                    self.cache.set_sec_financial_data(ticker, quarter_key, cache_data)
                    quarterly_count += 1
            
            # Calculate fiscal year range
            if fiscal_years:
                years_sorted = sorted(fiscal_years)
                fiscal_years_str = f"{years_sorted[0]}-{years_sorted[-1]}"
            else:
                fiscal_years_str = "None"
            
            return {
                'success': True,
                'quarterly_periods': quarterly_count,
                'fiscal_years': fiscal_years_str
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'quarterly_periods': 0
            }
    
    def _fetch_split_history(self, ticker: str, verbose: bool) -> Dict[str, Any]:
        """Fetch and cache stock split history"""
        try:
            if verbose:
                print(f"\n   Fetching split history for {ticker}...")
            
            # Fetch split history using yfinance service
            splits = self.yfinance_service.fetch_split_history(ticker)
            
            if not splits:
                return {
                    'success': True,
                    'total_splits': 0,
                    'latest_split': None
                }
            
            # Cache splits to Firebase
            self.cache.cache_split_history(ticker, splits, verbose=verbose)
            
            # Get latest split for reporting
            latest_split = splits[0]['description'] if splits else None
            
            return {
                'success': True,
                'total_splits': len(splits),
                'latest_split': latest_split
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'total_splits': 0
            }
    
def main():
    """Main CLI interface"""
    
    parser = argparse.ArgumentParser(
        description='Download maximum available stock data using unified SEC/Yahoo Finance service',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Download all available data (price + financial)
  python download_max_data.py AAPL
  
  # Download only financial data (skip price)
  python download_max_data.py AAPL --skip-price
  
  # Clear cache and re-download with verbose output
  python download_max_data.py AAPL --clear --verbose
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT, GOOGL)')
    parser.add_argument('--clear', action='store_true', 
                       help='Clear existing cache before downloading')
    parser.add_argument('--verbose', action='store_true',
                       help='Show detailed progress information')
    parser.add_argument('--skip-price', action='store_true',
                       help='Skip downloading historical price data')
    
    args = parser.parse_args()
    
    ticker = args.ticker.upper()
    validate_firebase_config(verbose=args.verbose)
    downloader = MaxDataDownloader()
    
    try:
        downloader.download_max_data(
            ticker=ticker,
            clear_existing=args.clear,
            verbose=args.verbose,
            skip_price=args.skip_price
        )
        
        print(f'\n🎉 Successfully downloaded and cached maximum data for {ticker}!')
        sys.exit(0)
        
    except Exception as error:
        print(f'\n💥 Failed to download data for {ticker}: {error}')
        sys.exit(1)


if __name__ == '__main__':
    main()