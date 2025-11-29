#!/usr/bin/env python3
"""
Analyst Data Fetcher - Python Version

Standalone script to fetch and cache analyst predictions/forecasts from Yahoo Finance.
Can be run periodically (via cron) to accumulate historical analyst data over time.

Usage:
    python fetch_analyst_data.py AAPL
    python fetch_analyst_data.py AAPL MSFT GOOGL  # Multiple tickers
    python fetch_analyst_data.py --all-tickers    # Fetch for all tickers in Firebase
"""

import os
import sys
import argparse
from datetime import datetime
from typing import List
from dotenv import load_dotenv

# Load environment variables first
load_dotenv('.env.local')

from yfinance_service import YFinanceService
from firebase_cache import FirebaseCache


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
        sys.exit(1)
    
    if verbose:
        print('✅ Firebase configuration loaded successfully')
        print(f'📍 Project ID: {os.getenv("FIREBASE_PROJECT_ID")}')


class AnalystDataFetcher:
    """Fetches and caches analyst predictions/forecasts"""
    
    def __init__(self):
        self.cache = FirebaseCache()
        self.yfinance_service = YFinanceService()
    
    def fetch_for_ticker(self, ticker: str, verbose: bool = False) -> dict:
        """Fetch all analyst data for a single ticker
        
        Args:
            ticker: Stock ticker symbol
            verbose: Show detailed progress
            
        Returns:
            Dictionary with results for each data type
        """
        results = {
            'ticker': ticker.upper(),
            'fetched_at': datetime.now().isoformat(),
            'data_types': {},
            'success': True
        }
        
        fetched_at = datetime.now()
        all_analyst_data = {}
        
        if verbose:
            print(f'\n📊 Fetching analyst data for {ticker.upper()}...')
        
        # Fetch price targets
        try:
            if verbose:
                print(f'   - Price targets...', end='', flush=True)
            price_targets = self.yfinance_service.fetch_analyst_price_targets(ticker)
            if price_targets:
                all_analyst_data['price_targets'] = price_targets
                results['data_types']['price_targets'] = {
                    'cached': True,
                    'message': f"Target mean: ${price_targets.get('target_mean', 'N/A')}"
                }
                if verbose:
                    print(f' ✓')
            else:
                results['data_types']['price_targets'] = {
                    'cached': False,
                    'message': 'No data available'
                }
                if verbose:
                    print(f' ✗ (no data)')
        except Exception as e:
            results['data_types']['price_targets'] = {
                'cached': False,
                'message': f'Error: {str(e)}'
            }
            if verbose:
                print(f' ✗ (error: {e})')
        
        # Fetch recommendations
        try:
            if verbose:
                print(f'   - Recommendations...', end='', flush=True)
            recommendations = self.yfinance_service.fetch_analyst_recommendations(ticker)
            if recommendations:
                all_analyst_data['recommendations'] = recommendations
                latest = recommendations.get('latest_summary', {})
                total = (latest.get('strongBuy', 0) + latest.get('buy', 0) + 
                        latest.get('hold', 0) + latest.get('sell', 0) + 
                        latest.get('strongSell', 0))
                results['data_types']['recommendations'] = {
                    'cached': True,
                    'message': f"{total} total recommendations"
                }
                if verbose:
                    print(f' ✓')
            else:
                results['data_types']['recommendations'] = {
                    'cached': False,
                    'message': 'No data available'
                }
                if verbose:
                    print(f' ✗ (no data)')
        except Exception as e:
            results['data_types']['recommendations'] = {
                'cached': False,
                'message': f'Error: {str(e)}'
            }
            if verbose:
                print(f' ✗ (error: {e})')
        
        # Fetch growth estimates
        try:
            if verbose:
                print(f'   - Growth estimates...', end='', flush=True)
            growth_estimates = self.yfinance_service.fetch_growth_estimates(ticker)
            if growth_estimates:
                all_analyst_data['growth_estimates'] = growth_estimates
                stock_trend = growth_estimates.get('stock_trend', {})
                year_growth = stock_trend.get('0y')
                if year_growth is not None:
                    results['data_types']['growth_estimates'] = {
                        'cached': True,
                        'message': f"Current year growth: {year_growth*100:.1f}%"
                    }
                else:
                    results['data_types']['growth_estimates'] = {
                        'cached': True,
                        'message': 'Data cached'
                    }
                if verbose:
                    print(f' ✓')
            else:
                results['data_types']['growth_estimates'] = {
                    'cached': False,
                    'message': 'No data available'
                }
                if verbose:
                    print(f' ✗ (no data)')
        except Exception as e:
            results['data_types']['growth_estimates'] = {
                'cached': False,
                'message': f'Error: {str(e)}'
            }
            if verbose:
                print(f' ✗ (error: {e})')
        
        # Fetch earnings trend
        try:
            if verbose:
                print(f'   - Earnings trend...', end='', flush=True)
            earnings_trend = self.yfinance_service.fetch_earnings_trend(ticker)
            if earnings_trend:
                all_analyst_data['earnings_trend'] = earnings_trend
                history_count = len(earnings_trend.get('earnings_history', []))
                estimate_count = len(earnings_trend.get('earnings_estimate', {}).get('avg', {})) if earnings_trend.get('earnings_estimate') else 0
                results['data_types']['earnings_trend'] = {
                    'cached': True,
                    'message': f"{history_count} historical, {estimate_count} estimates"
                }
                if verbose:
                    print(f' ✓')
            else:
                results['data_types']['earnings_trend'] = {
                    'cached': False,
                    'message': 'No data available'
                }
                if verbose:
                    print(f' ✗ (no data)')
        except Exception as e:
            results['data_types']['earnings_trend'] = {
                'cached': False,
                'message': f'Error: {str(e)}'
            }
            if verbose:
                print(f' ✗ (error: {e})')
        
        # Cache all analyst data together in one consolidated document
        if all_analyst_data:
            try:
                self.cache.cache_analyst_data(ticker, all_analyst_data, fetched_at)
                if verbose:
                    print(f'   ✓ Cached consolidated analyst data snapshot')
            except Exception as e:
                if verbose:
                    print(f'   ✗ Error caching consolidated data: {e}')
                results['success'] = False
        
        # Calculate success rate
        cached_count = sum(1 for d in results['data_types'].values() if d.get('cached'))
        results['cached_count'] = cached_count
        results['total_count'] = len(results['data_types'])
        
        return results
    
    def fetch_for_tickers(self, tickers: List[str], verbose: bool = False) -> List[dict]:
        """Fetch analyst data for multiple tickers
        
        Args:
            tickers: List of stock ticker symbols
            verbose: Show detailed progress
            
        Returns:
            List of result dictionaries, one per ticker
        """
        results = []
        
        if verbose:
            print(f'\n🚀 Fetching analyst data for {len(tickers)} ticker(s)...')
        
        for i, ticker in enumerate(tickers, 1):
            if verbose:
                print(f'\n[{i}/{len(tickers)}] Processing {ticker.upper()}...')
            else:
                print(f'Processing {ticker.upper()}...', end='', flush=True)
            
            try:
                result = self.fetch_for_ticker(ticker, verbose=verbose)
                results.append(result)
                
                if not verbose:
                    cached = result['cached_count']
                    total = result['total_count']
                    print(f' {cached}/{total} types cached')
                    
            except Exception as e:
                print(f'\n❌ Error processing {ticker}: {e}')
                results.append({
                    'ticker': ticker.upper(),
                    'success': False,
                    'error': str(e)
                })
        
        return results
    
    def get_all_tickers_from_firebase(self) -> List[str]:
        """Get all tickers that exist in Firebase
        
        Returns:
            List of ticker symbols
        """
        try:
            # Get all ticker documents
            tickers_ref = self.cache.db.collection('tickers')
            docs = tickers_ref.stream()
            
            tickers = [doc.id for doc in docs]
            return sorted(tickers)
            
        except Exception as e:
            print(f'Error getting tickers from Firebase: {e}')
            return []


def main():
    """Main CLI interface"""
    
    parser = argparse.ArgumentParser(
        description='Fetch and cache analyst predictions/forecasts from Yahoo Finance',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Fetch for a single ticker
  python fetch_analyst_data.py AAPL
  
  # Fetch for multiple tickers
  python fetch_analyst_data.py AAPL MSFT GOOGL
  
  # Fetch for all tickers in Firebase
  python fetch_analyst_data.py --all-tickers
  
  # Verbose output
  python fetch_analyst_data.py AAPL --verbose
  
  # Set up cron job to run daily at 9 AM:
  # 0 9 * * * cd /path/to/data-fetcher && /path/to/venv/bin/python fetch_analyst_data.py --all-tickers
        '''
    )
    
    parser.add_argument('tickers', nargs='*', help='Stock ticker symbol(s) (e.g., AAPL, MSFT, GOOGL)')
    parser.add_argument('--all-tickers', action='store_true',
                       help='Fetch analyst data for all tickers in Firebase')
    parser.add_argument('--verbose', action='store_true',
                       help='Show detailed progress information')
    
    args = parser.parse_args()
    
    # Validate Firebase config
    validate_firebase_config(verbose=args.verbose)
    
    # Determine which tickers to process
    if args.all_tickers:
        fetcher = AnalystDataFetcher()
        tickers = fetcher.get_all_tickers_from_firebase()
        if not tickers:
            print('❌ No tickers found in Firebase')
            sys.exit(1)
        if args.verbose:
            print(f'Found {len(tickers)} ticker(s) in Firebase')
    elif args.tickers:
        tickers = [t.upper() for t in args.tickers]
    else:
        parser.print_help()
        sys.exit(1)
    
    # Fetch analyst data
    fetcher = AnalystDataFetcher()
    
    try:
        results = fetcher.fetch_for_tickers(tickers, verbose=args.verbose)
        
        # Print summary
        print(f'\n' + '='*60)
        print('SUMMARY')
        print('='*60)
        
        successful = [r for r in results if r.get('success', True)]
        failed = [r for r in results if not r.get('success', True)]
        
        for result in successful:
            ticker = result['ticker']
            cached = result.get('cached_count', 0)
            total = result.get('total_count', 0)
            print(f'{ticker}: {cached}/{total} types cached ✓')
            
            if args.verbose:
                for data_type, info in result.get('data_types', {}).items():
                    status = '✓' if info.get('cached') else '✗'
                    print(f'  {status} {data_type}: {info.get("message")}')
        
        if failed:
            print(f'\nFailed ({len(failed)}):')
            for result in failed:
                print(f'  {result["ticker"]}: {result.get("error", "Unknown error")}')
        
        print(f'\n✅ Completed processing {len(successful)}/{len(results)} ticker(s)!')
        sys.exit(0)
        
    except Exception as error:
        print(f'\n💥 Failed to fetch analyst data: {error}')
        sys.exit(1)


if __name__ == '__main__':
    main()

