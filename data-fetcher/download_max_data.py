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
from services.price_data_service import PriceDataService
from services.financial_data_service import FinancialDataService
from services.analyst_data_service import AnalystDataService
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
        self.price_service = PriceDataService()
        self.financial_service = FinancialDataService()
        self.analyst_service = AnalystDataService()
        self.unified_service = UnifiedDataService()
        self.yfinance_service = YFinanceService()
        self.sec_service = SECFinancialsService()
    
    def download_max_data(self, ticker: str, clear_existing: bool = False, 
                         verbose: bool = False, skip_price: bool = False,
                         include_analyst: bool = False) -> None:
        """Download and cache maximum available data for a ticker
        
        Args:
            ticker: Stock ticker symbol
            clear_existing: Clear existing cache before downloading
            verbose: Show detailed progress
            skip_price: Skip downloading historical price data
            include_analyst: Include analyst predictions/forecasts data
        """
        
        if verbose:
            print(f'\n🚀 Starting maximum data download for {ticker.upper()}')
            print(f'Options: clearExisting={clear_existing}, skipPrice={skip_price}, includeAnalyst={include_analyst}')
        else:
            print(f'\n🚀 Downloading data for {ticker.upper()}...')
        
        try:
            # Clear existing cache if requested
            if clear_existing:
                if verbose:
                    print(f'\n🗑️  Clearing existing cache for {ticker}...')
                # Note: clear_cache is a cross-domain utility - skipping for now
                # Individual services can be cleared separately if needed
                print(f'⚠️  Clear cache not yet implemented in refactored services')
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
            
            # Download analyst predictions/forecasts if requested
            if include_analyst:
                if not verbose:
                    print(f'📊 Downloading analyst data...', end='', flush=True)
                analyst_results = self._fetch_analyst_data(ticker, verbose)
                
                if analyst_results['success']:
                    if verbose:
                        print(f'\n✅ Cached analyst data:')
                        for data_type, status in analyst_results['data_types'].items():
                            status_icon = '✓' if status['cached'] else '✗'
                            print(f'   {status_icon} {data_type}: {status["message"]}')
                    else:
                        cached_count = sum(1 for s in analyst_results['data_types'].values() if s['cached'])
                        print(f' {cached_count}/4 types cached')
                else:
                    if not verbose:
                        print(f' ⚠️  Error: {analyst_results.get("error", "Unknown error")}')
                    else:
                        print(f'\n⚠️  Error fetching analyst data: {analyst_results.get("error", "Unknown error")}')
            
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
                    self.price_service.cache_annual_price_data(ticker, year, price_data, verbose=verbose)
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
            sec_periods = self.sec_service.get_all_available_periods(ticker, verbose=False)
            
            # Also get all quarters available from Yahoo Finance
            yf_quarters = self.yfinance_service.fetch_quarterly_earnings(ticker)
            yf_periods = set()
            for q in yf_quarters:
                yf_periods.add((q.get('fiscal_year'), q.get('fiscal_quarter')))
            
            # Combine SEC and Yahoo Finance periods
            all_periods = set()
            if sec_periods:
                all_periods.update(sec_periods.get('quarterly_periods', []))
            all_periods.update(yf_periods)
            
            if not all_periods:
                return {
                    'success': False,
                    'error': 'No quarterly periods found from SEC or Yahoo Finance',
                    'quarterly_periods': 0
                }
            
            sec_count = len(sec_periods.get('quarterly_periods', [])) if sec_periods else 0
            yf_count = len(yf_periods)
            
            if verbose:
                if sec_periods:
                    print(f"   Found {sec_count} quarters in SEC data, {yf_count} quarters in Yahoo Finance")
                else:
                    print(f"   SEC data not available, found {yf_count} quarters in Yahoo Finance")
                print(f"   Total unique quarters to fetch: {len(all_periods)}")
            
            # Cache all quarterly data using unified service (auto-selects best source)
            quarterly_count = 0
            fiscal_years = set()
            
            for fiscal_year, fiscal_quarter in sorted(all_periods, reverse=True):
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
                    self.financial_service.set_sec_financial_data(ticker, quarter_key, cache_data)
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
            self.price_service.cache_split_history(ticker, splits, verbose=verbose)
            
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
    
    def _fetch_analyst_data(self, ticker: str, verbose: bool) -> Dict[str, Any]:
        """Fetch and cache analyst predictions/forecasts data (consolidated)"""
        try:
            all_analyst_data = {}
            data_types_status = {
                'price_targets': False,
                'recommendations': False,
                'growth_estimates': False,
                'earnings_trend': False
            }
            
            fetched_at = datetime.now()
            
            if verbose:
                print(f"\n   Fetching analyst data for {ticker}...")
            
            # Fetch price targets
            try:
                if verbose:
                    print(f"   - Fetching price targets...", end='', flush=True)
                price_targets = self.yfinance_service.fetch_analyst_price_targets(ticker)
                if price_targets:
                    all_analyst_data['price_targets'] = price_targets
                    data_types_status['price_targets'] = True
                    if verbose:
                        print(f" ✓ (high: {price_targets.get('target_high')}, mean: {price_targets.get('target_mean')})")
                else:
                    if verbose:
                        print(f" ✗ (no data)")
            except Exception as e:
                if verbose:
                    print(f" ✗ (error: {e})")
                data_types_status['price_targets'] = {'error': str(e)}
            
            # Fetch recommendations
            try:
                if verbose:
                    print(f"   - Fetching recommendations...", end='', flush=True)
                recommendations = self.yfinance_service.fetch_analyst_recommendations(ticker)
                if recommendations:
                    all_analyst_data['recommendations'] = recommendations
                    data_types_status['recommendations'] = True
                    if verbose:
                        latest = recommendations.get('latest_summary', {})
                        print(f" ✓ (Strong Buy: {latest.get('strongBuy', 0)}, Buy: {latest.get('buy', 0)})")
                else:
                    if verbose:
                        print(f" ✗ (no data)")
            except Exception as e:
                if verbose:
                    print(f" ✗ (error: {e})")
                data_types_status['recommendations'] = {'error': str(e)}
            
            # Fetch growth estimates
            try:
                if verbose:
                    print(f"   - Fetching growth estimates...", end='', flush=True)
                growth_estimates = self.yfinance_service.fetch_growth_estimates(ticker)
                if growth_estimates:
                    all_analyst_data['growth_estimates'] = growth_estimates
                    data_types_status['growth_estimates'] = True
                    if verbose:
                        stock_trend = growth_estimates.get('stock_trend', {})
                        print(f" ✓ (0q: {stock_trend.get('0q')}, 0y: {stock_trend.get('0y')})")
                else:
                    if verbose:
                        print(f" ✗ (no data)")
            except Exception as e:
                if verbose:
                    print(f" ✗ (error: {e})")
                data_types_status['growth_estimates'] = {'error': str(e)}
            
            # Fetch earnings trend
            try:
                if verbose:
                    print(f"   - Fetching earnings trend...", end='', flush=True)
                earnings_trend = self.yfinance_service.fetch_earnings_trend(ticker)
                if earnings_trend:
                    all_analyst_data['earnings_trend'] = earnings_trend
                    data_types_status['earnings_trend'] = True
                    if verbose:
                        history_count = len(earnings_trend.get('earnings_history', []))
                        print(f" ✓ ({history_count} historical quarters)")
                else:
                    if verbose:
                        print(f" ✗ (no data)")
            except Exception as e:
                if verbose:
                    print(f" ✗ (error: {e})")
                data_types_status['earnings_trend'] = {'error': str(e)}
            
            # Cache all analyst data together in one consolidated document
            if all_analyst_data:
                try:
                    self.analyst_service.cache_analyst_data(ticker, all_analyst_data, fetched_at)
                    if verbose:
                        print(f"   ✓ Cached consolidated analyst data snapshot")
                except Exception as e:
                    if verbose:
                        print(f"   ✗ Error caching consolidated data: {e}")
            
            # Format results
            formatted_data_types = {}
            for data_type, status in data_types_status.items():
                if isinstance(status, dict) and 'error' in status:
                    formatted_data_types[data_type] = {
                        'cached': False,
                        'message': f"Error: {status['error']}"
                    }
                elif status:
                    formatted_data_types[data_type] = {
                        'cached': True,
                        'message': 'Successfully cached'
                    }
                else:
                    formatted_data_types[data_type] = {
                        'cached': False,
                        'message': 'No data available'
                    }
            
            return {
                'success': True,
                'data_types': formatted_data_types,
                'fetched_at': fetched_at.isoformat()
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'data_types': {}
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
    parser.add_argument('--include-analyst', action='store_true',
                       help='Include analyst predictions/forecasts data')
    
    args = parser.parse_args()
    
    ticker = args.ticker.upper()
    validate_firebase_config(verbose=args.verbose)
    downloader = MaxDataDownloader()
    
    try:
        downloader.download_max_data(
            ticker=ticker,
            clear_existing=args.clear,
            verbose=args.verbose,
            skip_price=args.skip_price,
            include_analyst=args.include_analyst
        )
        
        print(f'\n🎉 Successfully downloaded and cached maximum data for {ticker}!')
        sys.exit(0)
        
    except Exception as error:
        print(f'\n💥 Failed to download data for {ticker}: {error}')
        sys.exit(1)


if __name__ == '__main__':
    main()