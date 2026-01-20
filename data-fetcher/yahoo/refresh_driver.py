#!/usr/bin/env python3
"""
Yahoo Finance Refresh Driver

Orchestrates refresh of all Yahoo Finance data types:
- Daily price data (incremental)
- Earnings data (latest quarters)
- Analyst data (all types)
- Split history (periodic check)
"""

import argparse
import sys
import os
import logging
from typing import Dict, Any
from dotenv import load_dotenv

# Add parent directory to path so we can import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from cloud_logging_setup import setup_cloud_logging, mdc_ticker, mdc_execution_id, emit_metric

# Import refresh modules
from yahoo.refresh_daily_price import refresh_daily_price
from yahoo.refresh_earnings_data import refresh_earnings_data
from yahoo.refresh_analyst_data import refresh_analyst_data
from yahoo.refresh_split_history import refresh_split_history

# Load environment variables
load_dotenv('.env.local')

# Initialize logging
setup_cloud_logging()
logger = logging.getLogger(__name__)


def refresh_yahoo_data(ticker: str, verbose: bool = False) -> Dict[str, Any]:
    """Refresh all Yahoo Finance data for a ticker
    
    Args:
        ticker: Stock ticker symbol
        verbose: Show detailed progress
        
    Returns:
        Dictionary with results from all refresh operations
    """
    ticker = ticker.upper()
    mdc_ticker.set(ticker)
    
    results = {
        'ticker': ticker,
        'success': True,
        'results': {}
    }
    
    logger.info(f'Starting Yahoo Finance refresh for {ticker}')
    emit_metric('yahoo_refresh_start', ticker=ticker)
    
    # Refresh daily price data
    try:
        if verbose:
            logger.info('\n📈 Refreshing daily price data...')
        price_result = refresh_daily_price(ticker, verbose=verbose)
        results['results']['price'] = price_result
        if not price_result.get('success'):
            results['success'] = False
    except Exception as e:
        logger.error(f'Error in price refresh: {e}', exc_info=True)
        results['results']['price'] = {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
        results['success'] = False
    
    # Refresh earnings data
    try:
        if verbose:
            logger.info('\n📊 Refreshing earnings data...')
        earnings_result = refresh_earnings_data(ticker, verbose=verbose)
        results['results']['earnings'] = earnings_result
        if not earnings_result.get('success'):
            results['success'] = False
    except Exception as e:
        logger.error(f'Error in earnings refresh: {e}', exc_info=True)
        results['results']['earnings'] = {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
        results['success'] = False
    
    # Refresh analyst data
    try:
        if verbose:
            logger.info('\n👥 Refreshing analyst data...')
        analyst_result = refresh_analyst_data(ticker, verbose=verbose)
        results['results']['analyst'] = analyst_result
        if not analyst_result.get('success'):
            results['success'] = False
    except Exception as e:
        logger.error(f'Error in analyst refresh: {e}', exc_info=True)
        results['results']['analyst'] = {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
        results['success'] = False
    
    # Refresh split history (may skip if cache is fresh)
    try:
        if verbose:
            logger.info('\n📉 Checking split history...')
        splits_result = refresh_split_history(ticker, verbose=verbose)
        results['results']['splits'] = splits_result
        if not splits_result.get('success'):
            results['success'] = False
    except Exception as e:
        logger.error(f'Error in split history refresh: {e}', exc_info=True)
        results['results']['splits'] = {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
        results['success'] = False
    
    # Emit completion metric
    emit_metric('yahoo_refresh_complete', 
                ticker=ticker,
                success=results['success'],
                price_updated=results['results'].get('price', {}).get('updated', False),
                earnings_updated=results['results'].get('earnings', {}).get('updated', False),
                analyst_updated=results['results'].get('analyst', {}).get('updated', False),
                splits_updated=results['results'].get('splits', {}).get('updated', False))
    
    if verbose:
        logger.info('\n' + '='*60)
        logger.info('REFRESH SUMMARY')
        logger.info('='*60)
        
        price = results['results'].get('price', {})
        if price.get('updated'):
            logger.info(f"Price: ✓ Updated ({price.get('days_added', 0)} days added)")
        elif price.get('success'):
            logger.info(f"Price: - {price.get('reason', 'No update needed')}")
        else:
            logger.info(f"Price: ✗ Error: {price.get('error', 'Unknown')}")
        
        earnings = results['results'].get('earnings', {})
        if earnings.get('updated'):
            logger.info(f"Earnings: ✓ Updated ({earnings.get('quarters_cached', 0)} quarters cached)")
        elif earnings.get('success'):
            logger.info(f"Earnings: - {earnings.get('reason', 'No update needed')}")
        else:
            logger.info(f"Earnings: ✗ Error: {earnings.get('error', 'Unknown')}")
        
        analyst = results['results'].get('analyst', {})
        if analyst.get('updated'):
            cached = analyst.get('cached_count', 0)
            total = analyst.get('total_count', 0)
            logger.info(f"Analyst: ✓ Updated ({cached}/{total} types cached)")
        elif analyst.get('success'):
            logger.info(f"Analyst: - {analyst.get('reason', 'No update needed')}")
        else:
            logger.info(f"Analyst: ✗ Error: {analyst.get('error', 'Unknown')}")
        
        splits = results['results'].get('splits', {})
        if splits.get('updated'):
            logger.info(f"Splits: ✓ Updated ({splits.get('total_splits', 0)} total splits)")
        elif splits.get('success'):
            logger.info(f"Splits: - {splits.get('reason', 'No update needed')}")
        else:
            logger.info(f"Splits: ✗ Error: {splits.get('error', 'Unknown')}")
        
        logger.info('='*60)
    
    logger.info(f'Yahoo Finance refresh completed for {ticker}')
    
    return results


def main():
    """Main CLI interface"""
    parser = argparse.ArgumentParser(
        description='Refresh Yahoo Finance data for a ticker',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Refresh all data for AAPL
  python yahoo/refresh_driver.py AAPL --verbose
  
  # Refresh without verbose output
  python yahoo/refresh_driver.py MSFT
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('--verbose', action='store_true',
                       help='Show detailed progress information')
    
    args = parser.parse_args()
    
    ticker = args.ticker.upper()
    mdc_execution_id.set('local')
    
    try:
        results = refresh_yahoo_data(ticker, verbose=args.verbose)
        
        if results['success']:
            sys.exit(0)
        else:
            logger.error('Refresh completed with errors')
            sys.exit(1)
            
    except KeyboardInterrupt:
        logger.info('\n\nInterrupted by user')
        sys.exit(1)
    except Exception as e:
        logger.error(f'Error: {e}', exc_info=args.verbose)
        sys.exit(1)


if __name__ == '__main__':
    main()

