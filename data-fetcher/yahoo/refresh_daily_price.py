#!/usr/bin/env python3
"""
Daily Price Data Refresh

Incrementally updates daily price data for the current year by:
1. Downloading existing current year file from Storage
2. Finding the last date in the data
3. Fetching only new data from last_date + 1 to now
4. Merging new data and overwriting Storage file
5. Updating consolidated reference with actual end_date
"""

import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import logging
import os
import sys

# Add parent directory to path so we can import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from yfinance_service import YFinanceService
from services.price_data_service import PriceDataService

logger = logging.getLogger(__name__)


def refresh_daily_price(ticker: str, verbose: bool = False) -> Dict[str, Any]:
    """Refresh daily price data for current year with incremental update
    
    Args:
        ticker: Stock ticker symbol
        verbose: Show detailed progress
        
    Returns:
        Dictionary with refresh status and details
    """
    try:
        price_service = PriceDataService()
        current_year = datetime.now().year
        
        if verbose:
            logger.info(f'Refreshing daily price data for {ticker} {current_year}')
        
        # Get consolidated reference for current year
        reference = price_service.get_annual_price_reference(ticker, current_year)
        # Determine start date for fetching
        if reference:
            # Download existing file
            existing_data = price_service.download_annual_price_data(reference)
            
            # Extract last date from data
            if existing_data and 'data' in existing_data and existing_data['data']:
                dates = list(existing_data['data'].keys())
                if dates:
                    last_date_str = max(dates)
                    last_date = datetime.strptime(last_date_str, '%Y-%m-%d')
                    
                    # Check if already up to date
                    # Compare dates only (no time component) to properly check if last_date is today or yesterday
                    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
                    last_date_only = last_date.replace(hour=0, minute=0, second=0, microsecond=0)
                    days_since_last = (today - last_date_only).days
                    
                    if verbose:
                        logger.debug(f'Last date in cache: {last_date_str}, today: {today.strftime("%Y-%m-%d")}, days since last: {days_since_last}')
                    
                    # Skip if last_date is today or yesterday (market might not have new data yet)
                    # Only fetch if last_date is 2+ days ago
                    if days_since_last <= 1:
                        if verbose:
                            logger.info(f'Price data already up to date (last: {last_date_str}, today: {today.strftime("%Y-%m-%d")})')
                        return {
                            'success': True,
                            'updated': False,
                            'reason': 'already_up_to_date',
                            'last_date': last_date_str,
                            'days_added': 0
                        }
                    
                    # Fetch from last_date + 1 day
                    start_date = last_date + timedelta(days=1)
                    if verbose:
                        logger.info(f'Last date in cache: {last_date_str}, fetching from {start_date.strftime("%Y-%m-%d")} to {today.strftime("%Y-%m-%d")}')
                else:
                    # No dates in data, fetch full year
                    start_date = datetime(current_year, 1, 1)
                    existing_data = None
                    if verbose:
                        logger.info('No dates found in existing data, fetching full year')
            else:
                # Empty data, fetch full year
                start_date = datetime(current_year, 1, 1)
                existing_data = None
                if verbose:
                    logger.info('No existing data found, fetching full year')
        else:
            # No reference exists for current year
            # If we're in a new year, re-download full previous year to fix end_date
            previous_year = current_year - 1
            prev_year_reference = price_service.get_annual_price_reference(ticker, previous_year)
            if prev_year_reference:
                # We're in a new year and previous year data exists
                # Re-download full previous year to recalculate correct end_date
                if verbose:
                    logger.info(f'Re-downloading full previous year ({previous_year}) to recalculate correct end_date')
                
                # Fetch full previous year from Yahoo Finance
                prev_year_start = datetime(previous_year, 1, 1)
                prev_year_end = datetime(previous_year, 12, 31)
                stock = yf.Ticker(ticker)
                prev_hist = stock.history(start=prev_year_start, end=prev_year_end, interval='1d')
                
                if not prev_hist.empty:
                    # Build complete previous year data
                    prev_year_data = {
                        'ticker': ticker.upper(),
                        'year': previous_year,
                        'currency': 'USD',
                        'timezone': 'America/New_York',
                        'data': {},
                        'metadata': {
                            'total_days': 0,
                            'generated_at': datetime.now().isoformat(),
                            'source': 'yfinance_python'
                        }
                    }
                    
                    # Convert to data dictionary format
                    for date_index, row in prev_hist.iterrows():
                        date_str = date_index.strftime('%Y-%m-%d')
                        prev_year_data['data'][date_str] = {
                            'o': round(float(row.get('Open', row.get('Close', 0))), 2),
                            'h': round(float(row.get('High', row.get('Close', 0))), 2),
                            'l': round(float(row.get('Low', row.get('Close', 0))), 2),
                            'c': round(float(row.get('Close', 0)), 2),
                            'v': int(row.get('Volume', 0))
                        }
                    
                    # Update metadata
                    prev_year_data['metadata']['total_days'] = len(prev_year_data['data'])
                    
                    # Calculate actual end date from data
                    prev_dates = list(prev_year_data['data'].keys())
                    prev_end_date = max(prev_dates) if prev_dates else f'{previous_year}-12-31'
                    
                    # Cache previous year data with correct end_date
                    price_service.cache_annual_price_data(
                        ticker,
                        previous_year,
                        prev_year_data,
                        actual_end_date=prev_end_date,
                        verbose=verbose
                    )
                    
                    if verbose:
                        logger.info(f'✅ Re-downloaded previous year ({previous_year}) with correct end_date: {prev_end_date}')
            
            # Now fetch full current year
            start_date = datetime(current_year, 1, 1)
            existing_data = None
            if verbose:
                logger.info(f'No reference found for {current_year}, fetching full year')
        
        # Fetch new data from Yahoo Finance
        end_date = datetime.now()
        if verbose:
            logger.info(f'Fetching price data from {start_date.strftime("%Y-%m-%d")} to {end_date.strftime("%Y-%m-%d")}')
        
        stock = yf.Ticker(ticker)
        hist = stock.history(start=start_date, end=end_date, interval='1d')
        
        if hist.empty:
            if verbose:
                logger.warning('No new price data returned from Yahoo Finance')
            return {
                'success': True,
                'updated': False,
                'reason': 'no_new_data',
                'days_added': 0
            }
        
        # Convert to data dictionary format
        # Only include dates that don't already exist in the data
        new_data = {}
        existing_dates = set(existing_data.get('data', {}).keys()) if existing_data else set()
        
        for date_index, row in hist.iterrows():
            date_str = date_index.strftime('%Y-%m-%d')
            # Only add if this date doesn't already exist
            if date_str not in existing_dates:
                new_data[date_str] = {
                    'o': round(float(row.get('Open', row.get('Close', 0))), 2),
                    'h': round(float(row.get('High', row.get('Close', 0))), 2),
                    'l': round(float(row.get('Low', row.get('Close', 0))), 2),
                    'c': round(float(row.get('Close', 0)), 2),
                    'v': int(row.get('Volume', 0))
                }
        
        # Check if we actually have any new data
        if not new_data:
            if verbose:
                logger.info(f'No new price data to add (all fetched dates already exist in cache)')
            return {
                'success': True,
                'updated': False,
                'reason': 'no_new_dates',
                'last_date': max(existing_dates) if existing_dates else None,
                'days_added': 0
            }
        
        if verbose:
            logger.info(f'Fetched {len(new_data)} new daily price points (skipped {len(hist) - len(new_data)} existing dates)')
        
        # Merge with existing data
        if existing_data:
            # Merge new data into existing
            existing_data['data'].update(new_data)
            merged_data = existing_data
        else:
            # Create new data structure
            merged_data = {
                'ticker': ticker.upper(),
                'year': current_year,
                'currency': 'USD',
                'timezone': 'America/New_York',
                'data': new_data,
                'metadata': {
                    'total_days': 0,
                    'generated_at': datetime.now().isoformat(),
                    'source': 'yfinance_python'
                }
            }
        
        # Update metadata
        merged_data['metadata']['total_days'] = len(merged_data['data'])
        merged_data['metadata']['generated_at'] = datetime.now().isoformat()
        
        # Calculate actual end date from merged data
        dates = list(merged_data['data'].keys())
        actual_end_date = max(dates) if dates else f'{current_year}-12-31'
        
        # Cache merged data with actual end date
        price_service.cache_annual_price_data(
            ticker, 
            current_year, 
            merged_data, 
            actual_end_date=actual_end_date,
            verbose=verbose
        )
        
        if verbose:
            logger.info(f'✅ Updated price data for {ticker} {current_year}: added {len(new_data)} days, total {len(merged_data["data"])} days')
        
        return {
            'success': True,
            'updated': True,
            'days_added': len(new_data),
            'total_days': len(merged_data['data']),
            'last_date': actual_end_date
        }
        
    except Exception as e:
        logger.error(f'Error refreshing daily price for {ticker}: {e}', exc_info=True)
        return {
            'success': False,
            'updated': False,
            'error': str(e)
        }

