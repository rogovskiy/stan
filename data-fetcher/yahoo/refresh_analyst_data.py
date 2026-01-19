#!/usr/bin/env python3
"""
Analyst Data Refresh

Fetches and caches latest analyst data (price targets, recommendations, growth estimates, earnings trend).
"""

from typing import Dict, Any
from datetime import datetime
import logging
import os
import sys

# Add parent directory to path so we can import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from yfinance_service import YFinanceService
from services.analyst_data_service import AnalystDataService

logger = logging.getLogger(__name__)


def refresh_analyst_data(ticker: str, verbose: bool = False) -> Dict[str, Any]:
    """Refresh analyst data by fetching all analyst data types and caching consolidated snapshot
    
    Args:
        ticker: Stock ticker symbol
        verbose: Show detailed progress
        
    Returns:
        Dictionary with refresh status and details for each data type
    """
    try:
        yfinance_service = YFinanceService()
        analyst_service = AnalystDataService()
        
        if verbose:
            logger.info(f'Refreshing analyst data for {ticker}')
        
        # Get existing latest analyst data for comparison
        # Get the full latest document to include fetched_at timestamp
        existing_data = None
        existing_fetched_at = None
        try:
            latest_ref = (analyst_service.db.collection('tickers')
                         .document(ticker.upper())
                         .collection('analyst')
                         .document('latest'))
            latest_doc = latest_ref.get()
            if latest_doc.exists:
                existing_data = latest_doc.to_dict()
                existing_fetched_at = existing_data.get('fetched_at')
                if verbose:
                    logger.info(f'  Found existing analyst data from: {existing_fetched_at}')
        except Exception as e:
            if verbose:
                logger.debug(f'  Could not get existing analyst data: {e}')
        
        fetched_at = datetime.now()
        all_analyst_data = {}
        data_types_status = {
            'price_targets': {'cached': False, 'message': 'Not fetched', 'updated': False},
            'recommendations': {'cached': False, 'message': 'Not fetched', 'updated': False},
            'growth_estimates': {'cached': False, 'message': 'Not fetched', 'updated': False},
            'earnings_trend': {'cached': False, 'message': 'Not fetched', 'updated': False}
        }
        
        # Fetch price targets
        try:
            if verbose:
                logger.info('  - Fetching price targets...')
            price_targets = yfinance_service.fetch_analyst_price_targets(ticker)
            if price_targets:
                all_analyst_data['price_targets'] = price_targets
                
                # Compare with existing data
                updated = True
                change_msg = ""
                if existing_data and existing_data.get('price_targets'):
                    old_targets = existing_data['price_targets']
                    old_mean = old_targets.get('target_mean') if isinstance(old_targets, dict) else None
                    new_mean = price_targets.get('target_mean')
                    if old_mean is not None and new_mean is not None:
                        if abs(old_mean - new_mean) < 0.01:  # Essentially unchanged
                            updated = False
                            change_msg = f" (unchanged: ${new_mean:.2f})"
                        else:
                            change_msg = f" (changed: ${old_mean:.2f} → ${new_mean:.2f})"
                    else:
                        change_msg = f" (new: ${new_mean:.2f})" if new_mean else ""
                else:
                    change_msg = f" (new: ${price_targets.get('target_mean', 0):.2f})"
                
                data_types_status['price_targets'] = {
                    'cached': True,
                    'updated': updated,
                    'message': f"Target mean: ${price_targets.get('target_mean', 'N/A')}{change_msg}"
                }
                if verbose:
                    status_icon = '✓' if updated else '→'
                    logger.info(f'    {status_icon} Price targets: mean=${price_targets.get("target_mean"):.2f}{change_msg}')
            else:
                data_types_status['price_targets'] = {
                    'cached': False,
                    'updated': False,
                    'message': 'No data available'
                }
                if verbose:
                    logger.info('    ✗ No price targets data')
        except Exception as e:
            data_types_status['price_targets'] = {
                'cached': False,
                'updated': False,
                'message': f'Error: {str(e)}'
            }
            if verbose:
                logger.warning(f'    ✗ Error fetching price targets: {e}')
        
        # Fetch recommendations
        try:
            if verbose:
                logger.info('  - Fetching recommendations...')
            recommendations = yfinance_service.fetch_analyst_recommendations(ticker)
            if recommendations:
                all_analyst_data['recommendations'] = recommendations
                latest = recommendations.get('latest_summary', {})
                total = (latest.get('strongBuy', 0) + latest.get('buy', 0) + 
                        latest.get('hold', 0) + latest.get('sell', 0) + 
                        latest.get('strongSell', 0))
                
                # Compare with existing data
                updated = True
                change_msg = ""
                if existing_data and existing_data.get('recommendations'):
                    existing_latest = existing_data['recommendations'].get('latest_summary', {})
                    existing_total = (existing_latest.get('strongBuy', 0) + existing_latest.get('buy', 0) + 
                                    existing_latest.get('hold', 0) + existing_latest.get('sell', 0) + 
                                    existing_latest.get('strongSell', 0))
                    if existing_total == total:
                        updated = False
                        change_msg = " (unchanged)"
                    else:
                        change_msg = f" (changed: {existing_total} → {total})"
                else:
                    change_msg = f" (new: {total} total)"
                
                data_types_status['recommendations'] = {
                    'cached': True,
                    'updated': updated,
                    'message': f"{total} total recommendations{change_msg}"
                }
                if verbose:
                    status_icon = '✓' if updated else '→'
                    logger.info(f'    {status_icon} Recommendations: {total} total{change_msg}')
            else:
                data_types_status['recommendations'] = {
                    'cached': False,
                    'updated': False,
                    'message': 'No data available'
                }
                if verbose:
                    logger.info('    ✗ No recommendations data')
        except Exception as e:
            data_types_status['recommendations'] = {
                'cached': False,
                'updated': False,
                'message': f'Error: {str(e)}'
            }
            if verbose:
                logger.warning(f'    ✗ Error fetching recommendations: {e}')
        
        # Fetch growth estimates
        try:
            if verbose:
                logger.info('  - Fetching growth estimates...')
            growth_estimates = yfinance_service.fetch_growth_estimates(ticker)
            if growth_estimates:
                all_analyst_data['growth_estimates'] = growth_estimates
                stock_trend = growth_estimates.get('stock_trend', {})
                year_growth = stock_trend.get('0y')
                
                # Compare with existing data
                updated = True
                change_msg = ""
                if existing_data and existing_data.get('growth_estimates'):
                    existing_trend = existing_data['growth_estimates'].get('stock_trend', {}) if isinstance(existing_data['growth_estimates'], dict) else {}
                    existing_year_growth = existing_trend.get('0y')
                    if existing_year_growth is not None and year_growth is not None:
                        if abs(existing_year_growth - year_growth) < 0.001:  # Essentially unchanged
                            updated = False
                            change_msg = f" (unchanged: {year_growth*100:.1f}%)"
                        else:
                            change_msg = f" (changed: {existing_year_growth*100:.1f}% → {year_growth*100:.1f}%)"
                    else:
                        change_msg = f" (new: {year_growth*100:.1f}%)" if year_growth else ""
                else:
                    change_msg = f" (new: {year_growth*100:.1f}%)" if year_growth else ""
                
                if year_growth is not None:
                    data_types_status['growth_estimates'] = {
                        'cached': True,
                        'updated': updated,
                        'message': f"Current year growth: {year_growth*100:.1f}%{change_msg}"
                    }
                else:
                    data_types_status['growth_estimates'] = {
                        'cached': True,
                        'updated': updated,
                        'message': f'Data cached{change_msg}'
                    }
                if verbose:
                    status_icon = '✓' if updated else '→'
                    logger.info(f'    {status_icon} Growth estimates: {year_growth*100:.1f}%{change_msg}' if year_growth else f'    {status_icon} Growth estimates{change_msg}')
            else:
                data_types_status['growth_estimates'] = {
                    'cached': False,
                    'updated': False,
                    'message': 'No data available'
                }
                if verbose:
                    logger.info('    ✗ No growth estimates data')
        except Exception as e:
            data_types_status['growth_estimates'] = {
                'cached': False,
                'updated': False,
                'message': f'Error: {str(e)}'
            }
            if verbose:
                logger.warning(f'    ✗ Error fetching growth estimates: {e}')
        
        # Fetch earnings trend
        try:
            if verbose:
                logger.info('  - Fetching earnings trend...')
            earnings_trend = yfinance_service.fetch_earnings_trend(ticker)
            if earnings_trend:
                all_analyst_data['earnings_trend'] = earnings_trend
                history_count = len(earnings_trend.get('earnings_history', []))
                estimate_count = len(earnings_trend.get('earnings_estimate', {}).get('avg', {})) if earnings_trend.get('earnings_estimate') else 0
                
                # Compare with existing data
                updated = True
                change_msg = ""
                if existing_data and existing_data.get('earnings_trend'):
                    existing_trend = existing_data['earnings_trend'] if isinstance(existing_data['earnings_trend'], dict) else {}
                    existing_history_count = len(existing_trend.get('earnings_history', []))
                    existing_estimate_count = len(existing_trend.get('earnings_estimate', {}).get('avg', {})) if existing_trend.get('earnings_estimate') else 0
                    
                    if existing_history_count == history_count and existing_estimate_count == estimate_count:
                        updated = False
                        change_msg = " (unchanged)"
                    else:
                        change_msg = f" (changed: {existing_history_count}h/{existing_estimate_count}e → {history_count}h/{estimate_count}e)"
                else:
                    change_msg = f" (new: {history_count}h/{estimate_count}e)"
                
                data_types_status['earnings_trend'] = {
                    'cached': True,
                    'updated': updated,
                    'message': f"{history_count} historical, {estimate_count} estimates{change_msg}"
                }
                if verbose:
                    status_icon = '✓' if updated else '→'
                    logger.info(f'    {status_icon} Earnings trend: {history_count} historical, {estimate_count} estimates{change_msg}')
            else:
                data_types_status['earnings_trend'] = {
                    'cached': False,
                    'updated': False,
                    'message': 'No data available'
                }
                if verbose:
                    logger.info('    ✗ No earnings trend data')
        except Exception as e:
            data_types_status['earnings_trend'] = {
                'cached': False,
                'updated': False,
                'message': f'Error: {str(e)}'
            }
            if verbose:
                logger.warning(f'    ✗ Error fetching earnings trend: {e}')
        
        # Cache all analyst data together if we have any
        if all_analyst_data:
            try:
                # Count what was actually updated before caching
                updated_count = sum(1 for status in data_types_status.values() if status.get('updated'))
                cached_count = sum(1 for status in data_types_status.values() if status.get('cached'))
                
                # Log summary of changes before caching
                if existing_fetched_at:
                    if updated_count > 0:
                        updated_types = [name for name, status in data_types_status.items() if status.get('updated')]
                        logger.info(f'  📊 Changes since last report ({existing_fetched_at}): {updated_count} data type(s) updated - {", ".join(updated_types)}')
                        
                        # Cache new snapshot with changes
                        analyst_service.cache_analyst_data(ticker, all_analyst_data, fetched_at)
                        if verbose:
                            logger.info(f'  ✓ Cached consolidated analyst data snapshot ({updated_count}/{cached_count} data types updated)')
                    else:
                        logger.info(f'  📊 No changes since last report ({existing_fetched_at}), updating fetched_at timestamp')
                        
                        # No changes detected - just update fetched_at timestamp on existing latest document
                        analyst_service.update_analyst_data_timestamp(ticker, fetched_at)
                        if verbose:
                            logger.info(f'  → Updated fetched_at timestamp (no changes, {cached_count} types re-fetched)')
                else:
                    logger.info(f'  📊 First analyst data snapshot for {ticker}')
                    
                    # Cache first snapshot
                    analyst_service.cache_analyst_data(ticker, all_analyst_data, fetched_at)
                    if verbose:
                        logger.info(f'  ✓ Cached consolidated analyst data snapshot ({cached_count} data types)')
                
                return {
                    'success': True,
                    'updated': updated_count > 0,
                    'data_types': data_types_status,
                    'cached_count': cached_count,
                    'updated_count': updated_count,
                    'total_count': len(data_types_status),
                    'fetched_at': fetched_at.isoformat(),
                    'previous_fetched_at': existing_fetched_at
                }
            except Exception as e:
                logger.error(f'Error caching consolidated analyst data: {e}', exc_info=True)
                return {
                    'success': False,
                    'updated': False,
                    'error': f'Failed to cache: {str(e)}',
                    'data_types': data_types_status
                }
        else:
            if verbose:
                logger.warning('No analyst data fetched, nothing to cache')
            return {
                'success': True,
                'updated': False,
                'reason': 'no_data_available',
                'data_types': data_types_status
            }
        
    except Exception as e:
        logger.error(f'Error refreshing analyst data for {ticker}: {e}', exc_info=True)
        return {
            'success': False,
            'updated': False,
            'error': str(e)
        }

