#!/usr/bin/env python3
"""
Split History Refresh

Fetches and caches stock split history with frequency check.
Only refreshes if last_updated is older than 7 days (splits are rare).
"""

from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
import logging

from yfinance_service import YFinanceService
from services.price_data_service import PriceDataService

logger = logging.getLogger(__name__)


def refresh_split_history(ticker: str, verbose: bool = False, force_refresh: bool = False) -> Dict[str, Any]:
    """Refresh split history with frequency check

    Args:
        ticker: Stock ticker symbol
        verbose: Show detailed progress
        force_refresh: Force refresh even if cache is fresh

    Returns:
        Dictionary with refresh status and details
    """
    try:
        price_service = PriceDataService()
        yfinance_service = YFinanceService()

        if verbose:
            logger.info(f'Checking split history for {ticker}')

        existing_doc = price_service.get_split_history_with_metadata(ticker)
        existing_splits = existing_doc.get('splits', []) if existing_doc else None

        if existing_doc and not force_refresh:
            last_updated_str = existing_doc.get('last_updated')
            if last_updated_str:
                try:
                    last_updated = datetime.fromisoformat(last_updated_str.replace('Z', '+00:00'))
                    if last_updated.tzinfo:
                        last_updated = last_updated.replace(tzinfo=None)

                    days_since_update = (datetime.now() - last_updated).days

                    if days_since_update < 7:
                        if verbose:
                            logger.info(f'Split history cache is fresh ({days_since_update} days old), skipping refresh')
                        return {
                            'success': True,
                            'updated': False,
                            'reason': 'cache_fresh',
                            'last_updated': last_updated_str,
                            'days_since_update': days_since_update,
                            'total_splits': existing_doc.get('total_splits', len(existing_splits) if existing_splits else 0)
                        }
                except (ValueError, AttributeError) as e:
                    if verbose:
                        logger.warning(f'Could not parse last_updated timestamp, proceeding with refresh: {e}')

        if verbose:
            logger.info('Fetching split history from Yahoo Finance...')

        new_splits = yfinance_service.fetch_split_history(ticker)

        if not new_splits:
            if verbose:
                logger.info('No split history found')
            return {
                'success': True,
                'updated': False,
                'reason': 'no_splits_available',
                'total_splits': 0
            }

        new_splits_count = 0
        if existing_splits:
            existing_dates = {split['date'] for split in existing_splits}
            new_splits_dates = {split['date'] for split in new_splits}
            new_splits_count = len(new_splits_dates - existing_dates)

            if new_splits_count == 0:
                if verbose:
                    logger.info(f'No new splits found ({len(existing_splits)} existing splits)')
                price_service.cache_split_history(ticker, new_splits, verbose=verbose)
                return {
                    'success': True,
                    'updated': False,
                    'reason': 'no_new_splits',
                    'total_splits': len(new_splits),
                    'new_splits': 0
                }
            else:
                if verbose:
                    logger.info(f'Found {new_splits_count} new split(s)')
        else:
            new_splits_count = len(new_splits)
            if verbose:
                logger.info(f'No existing splits found, caching {new_splits_count} split(s)')

        price_service.cache_split_history(ticker, new_splits, verbose=verbose)

        if verbose:
            logger.info(f'✅ Cached split history: {len(new_splits)} total split(s)')

        return {
            'success': True,
            'updated': True,
            'total_splits': len(new_splits),
            'new_splits': new_splits_count,
            'latest_split': new_splits[0]['description'] if new_splits else None
        }

    except Exception as e:
        logger.error(f'Error refreshing split history for {ticker}: {e}', exc_info=True)
        return {
            'success': False,
            'updated': False,
            'error': str(e),
            'error_type': type(e).__name__
        }
