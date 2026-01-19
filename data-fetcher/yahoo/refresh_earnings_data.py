#!/usr/bin/env python3
"""
Earnings Data Refresh

Fetches latest 4 quarters from Yahoo Finance and caches only missing quarters.
"""

from typing import Dict, Any, List
import logging
import os
import sys
from datetime import datetime

# Add parent directory to path so we can import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from yfinance_service import YFinanceService
from services.financial_data_service import FinancialDataService

logger = logging.getLogger(__name__)


def refresh_earnings_data(ticker: str, verbose: bool = False) -> Dict[str, Any]:
    """Refresh earnings data by fetching latest 4 quarters and caching missing ones
    
    Args:
        ticker: Stock ticker symbol
        verbose: Show detailed progress
        
    Returns:
        Dictionary with refresh status and details
    """
    try:
        yfinance_service = YFinanceService()
        financial_service = FinancialDataService()
        
        if verbose:
            logger.info(f'Refreshing earnings data for {ticker}')
        
        # Fetch latest 4 quarters from Yahoo Finance
        quarterly_data = yfinance_service.fetch_quarterly_earnings(ticker)
        
        if not quarterly_data:
            if verbose:
                logger.warning(f'No quarterly earnings data found for {ticker}')
            return {
                'success': True,
                'updated': False,
                'reason': 'no_data_available',
                'quarters_cached': 0
            }
        
        # Limit to latest 4 quarters
        latest_quarters = quarterly_data[:4]
        
        if verbose:
            logger.info(f'Found {len(latest_quarters)} quarters from Yahoo Finance (using latest {len(latest_quarters)})')
        
        quarters_cached = 0
        cached_quarter_keys = []
        
        # Check each quarter and cache if missing
        for quarter_data in latest_quarters:
            fiscal_year = quarter_data.get('fiscal_year')
            fiscal_quarter = quarter_data.get('fiscal_quarter')
            
            if not fiscal_year or not fiscal_quarter:
                continue
            
            quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
            
            # Check if quarter already exists in Firebase
            existing = financial_service.get_sec_financial_data(ticker, quarter_key)
            
            if existing:
                if verbose:
                    logger.debug(f'Quarter {quarter_key} already exists, skipping')
                continue
            
            # Prepare cache data
            cache_data = {
                'ticker': ticker.upper(),
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'quarter_key': quarter_key,
                'period_end_date': quarter_data.get('period_end_date'),
                'data_source': quarter_data.get('data_source', 'yfinance'),
                'is_annual': False,
                'income_statement': quarter_data.get('income_statement', {}),
                'balance_sheet': quarter_data.get('balance_sheet', {}),
                'cash_flow_statement': quarter_data.get('cash_flow_statement', {}),
                'updated_at': datetime.now().isoformat(),
                'statement_type': 'quarterly'
            }
            
            # Cache the quarter
            financial_service.set_sec_financial_data(ticker, quarter_key, cache_data)
            quarters_cached += 1
            cached_quarter_keys.append(quarter_key)
            
            if verbose:
                logger.info(f'  ✓ Cached {quarter_key}')
        
        if verbose:
            if quarters_cached > 0:
                logger.info(f'✅ Cached {quarters_cached} new quarter(s): {", ".join(cached_quarter_keys)}')
            else:
                logger.info(f'✅ All {len(latest_quarters)} quarters already cached')
        
        return {
            'success': True,
            'updated': quarters_cached > 0,
            'quarters_cached': quarters_cached,
            'total_quarters_checked': len(latest_quarters),
            'cached_quarter_keys': cached_quarter_keys
        }
        
    except Exception as e:
        logger.error(f'Error refreshing earnings data for {ticker}: {e}', exc_info=True)
        return {
            'success': False,
            'updated': False,
            'error': str(e),
            'quarters_cached': 0
        }

