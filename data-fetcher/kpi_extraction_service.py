#!/usr/bin/env python3
"""
KPI Extraction Service

Reusable service that combines extraction and unification of KPIs for a single quarter.
"""

from typing import Dict, List, Optional, Any
from extract_kpis3 import process_single_quarter
from unify_kpis import unify_kpis


def extract_and_unify_kpis(
    ticker: str,
    quarter_key: str,
    verbose: bool = False,
    document_type: Optional[str] = None,
    skip_unification: bool = False,
    no_store: bool = False
) -> Dict[str, Any]:
    """
    Extract raw KPIs and unify them in one step.
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter in format YYYYQN (e.g., "2024Q1")
        verbose: Enable verbose output
        document_type: Filter documents by type (optional)
        skip_unification: Skip unification step (extraction only)
        no_store: Don't store results to Firebase
    
    Returns:
        Dictionary with 'extraction' and 'unification' results:
        {
            'extraction': {
                'success': bool,
                'kpis': List[Dict] or None
            },
            'unification': {
                'matched': int,
                'created_definitions': int,
                'unmatched': int,
                'total_unified': int
            } or None or {'skipped': True}
        }
    """
    result = {
        'extraction': {'success': False, 'kpis': None},
        'unification': None
    }
    
    # Step 1: Extract raw KPIs
    if verbose:
        print(f'\n{"="*80}')
        print(f'Extracting KPIs for {ticker.upper()} {quarter_key}')
        print(f'{"="*80}')
    
    raw_kpis = process_single_quarter(
        ticker,
        quarter_key,
        verbose,
        document_type,
        no_store
    )
    
    if not raw_kpis:
        if verbose:
            print(f'⚠️  Extraction failed for {ticker} {quarter_key}')
        return result
    
    result['extraction'] = {
        'success': True,
        'kpis': raw_kpis
    }
    
    # Step 2: Unify KPIs (if not skipped and extraction succeeded)
    if skip_unification:
        if verbose:
            print(f'\n⏭️  Skipping unification (--skip-unification flag)')
        result['unification'] = {'skipped': True}
        return result
    
    if no_store:
        # If no_store is True, we still extracted but didn't store.
        # Unification requires stored raw KPIs, so skip it.
        if verbose:
            print(f'\n⏭️  Skipping unification (--no-store flag prevents unification)')
        result['unification'] = {'skipped': True, 'reason': 'no_store flag prevents unification'}
        return result
    
    if verbose:
        print(f'\n{"="*80}')
        print(f'Unifying KPIs for {ticker.upper()} {quarter_key}')
        print(f'{"="*80}')
    
    try:
        unification_result = unify_kpis(
            ticker,
            quarter_key,
            verbose
        )
        
        if 'error' in unification_result:
            if verbose:
                print(f'⚠️  Unification failed: {unification_result["error"]}')
            result['unification'] = {
                'success': False,
                'error': unification_result['error']
            }
        else:
            result['unification'] = unification_result
            
    except Exception as e:
        if verbose:
            print(f'⚠️  Error during unification: {e}')
            import traceback
            traceback.print_exc()
        result['unification'] = {
            'success': False,
            'error': str(e)
        }
    
    return result




