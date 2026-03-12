#!/usr/bin/env python3
"""
Yahoo Finance Refresh Driver

Orchestrates refresh of all Yahoo Finance data types:
- Daily price data (incremental)
- Earnings data (latest quarters)
- Analyst data (all types)
- Split history (periodic check)
- Options data (snapshot to option_data/<ticker>/<as_of>.csv.gz)
"""

import argparse
import sys
import os
import logging
from typing import Dict, Any

from yahoo.refresh_daily_price import refresh_daily_price
from yahoo.refresh_earnings_data import refresh_earnings_data
from yahoo.refresh_analyst_data import refresh_analyst_data
from yahoo.refresh_split_history import refresh_split_history
from yahoo.refresh_options_data import refresh_options_data
from yfinance_service import YFinanceService

# Repo root (parent of functions_yahoo) for option_data output when local; /tmp when deployed (writable)
_DRIVER_DIR = os.path.dirname(os.path.abspath(__file__))
_OPTIONS_OUTPUT_DIR = (
    os.environ.get("TMPDIR", "/tmp")
    if os.environ.get("K_SERVICE")
    else os.path.dirname(os.path.dirname(_DRIVER_DIR))
)

logger = logging.getLogger(__name__)

# Quote types for which we skip earnings and analyst refresh (no fundamentals from Yahoo)
_SKIP_FUNDAMENTALS_QUOTE_TYPES = frozenset({'ETF', 'MUTUALFUND'})

def refresh_yahoo_data(ticker: str, verbose: bool = False) -> Dict[str, Any]:
    """Refresh all Yahoo Finance data for a ticker

    Args:
        ticker: Stock ticker symbol
        verbose: Show detailed progress

    Returns:
        Dictionary with results from all refresh operations
    """
    ticker = ticker.upper()

    results = {
        'ticker': ticker,
        'success': True,
        'results': {}
    }

    logger.info(f'Starting Yahoo Finance refresh for {ticker}')

    # Detect ETF / no-fundamentals so we skip earnings and analyst (Yahoo returns 404 for those)
    skip_earnings_analyst = False
    try:
        quote_type = YFinanceService().get_quote_type(ticker)
        if quote_type and quote_type.upper() in _SKIP_FUNDAMENTALS_QUOTE_TYPES:
            skip_earnings_analyst = True
            if verbose:
                logger.info('\n📌 %s is %s; skipping earnings and analyst refresh', ticker, quote_type)
    except Exception as e:
        logger.debug('Could not get quote type for %s: %s', ticker, e)

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

    if skip_earnings_analyst:
        results['results']['earnings'] = {
            'success': True,
            'updated': False,
            'reason': 'etf_or_no_fundamentals',
            'quarters_cached': 0
        }
        results['results']['analyst'] = {
            'success': True,
            'updated': False,
            'reason': 'etf_or_no_fundamentals',
        }
    else:
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

    # Refresh options data (snapshot to option_data/<ticker>/<as_of>.csv.gz)
    try:
        if verbose:
            logger.info('\n📊 Refreshing options data...')
        options_result = refresh_options_data(
            ticker=ticker,
            as_of=None,
            output_dir=_OPTIONS_OUTPUT_DIR,
            verbose=verbose,
        )
        results['results']['options'] = options_result
        if not options_result.get('success'):
            results['success'] = False
    except Exception as e:
        logger.error(f'Error in options refresh: {e}', exc_info=True)
        results['results']['options'] = {
            'success': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
        results['success'] = False

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

        options = results['results'].get('options', {})
        if options.get('success'):
            msg = f"Options: ✓ Saved ({options.get('expiries_count', 0)} expiries)"
            if options.get('uploaded_to_storage'):
                msg += " + Storage"
            logger.info(msg)
        else:
            logger.info(f"Options: ✗ Error: {options.get('error', 'Unknown')}")

        logger.info('='*60)

    logger.info(f'Yahoo Finance refresh completed for {ticker}')

    return results


def main():
    """Main CLI interface (used when run via run_local.py with ticker in argv)."""
    parser = argparse.ArgumentParser(
        description='Refresh Yahoo Finance data for a ticker',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python -m yahoo.refresh_driver AAPL --verbose
  python -m yahoo.refresh_driver MSFT
        '''
    )

    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('--verbose', action='store_true',
                        help='Show detailed progress information')

    args = parser.parse_args()

    ticker = args.ticker.upper()

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
