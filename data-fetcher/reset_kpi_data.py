#!/usr/bin/env python3
"""
Reset KPI Data Script

Clears all KPI-related data for a ticker:
- raw_kpis collection
- quarterly_analysis collection  
- kpi_definitions collection (including values)

Usage:
    python reset_kpi_data.py <ticker> [--verbose]
"""

import argparse
import sys
from dotenv import load_dotenv
from raw_kpi_service import RawKPIService
from kpi_definitions_service import KPIDefinitionsService
from firebase_cache import FirebaseCache

# Load environment variables from .env.local
load_dotenv('.env.local')


def clear_quarterly_analysis(ticker: str, verbose: bool = False) -> int:
    """Clear all quarterly_analysis documents for a ticker
    
    Args:
        ticker: Stock ticker symbol
        verbose: Enable verbose output
        
    Returns:
        Number of documents deleted
    """
    try:
        firebase = FirebaseCache()
        upper_ticker = ticker.upper()
        
        ticker_ref = firebase.db.collection('tickers').document(upper_ticker)
        quarterly_analysis_ref = ticker_ref.collection('quarterly_analysis')
        
        docs = list(quarterly_analysis_ref.stream())
        deleted_count = 0
        
        if verbose:
            print(f'🗑️  Clearing quarterly_analysis for {upper_ticker}...')
            print(f'   Found {len(docs)} quarterly_analysis document(s)')
        
        # Delete in batches (Firestore batch limit is 500)
        BATCH_SIZE = 500
        for i in range(0, len(docs), BATCH_SIZE):
            batch = firebase.db.batch()
            batch_docs = docs[i:i + BATCH_SIZE]
            
            for doc in batch_docs:
                batch.delete(doc.reference)
            
            batch.commit()
            deleted_count += len(batch_docs)
            
            if verbose:
                print(f'   Deleted batch {i // BATCH_SIZE + 1}: {len(batch_docs)} document(s)')
        
        if verbose:
            print(f'✅ Cleared {deleted_count} quarterly_analysis document(s) for {upper_ticker}')
        
        return deleted_count
        
    except Exception as error:
        print(f'Error clearing quarterly_analysis for {ticker}: {error}')
        raise error


def reset_kpi_data(ticker: str, verbose: bool = False) -> dict:
    """Reset all KPI data for a ticker
    
    Clears:
    - raw_kpis collection
    - quarterly_analysis collection
    - kpi_definitions collection (including values)
    
    Args:
        ticker: Stock ticker symbol
        verbose: Enable verbose output
        
    Returns:
        Dictionary with deletion counts for each collection
    """
    results = {
        'raw_kpis': 0,
        'quarterly_analysis': 0,
        'kpi_definitions': 0
    }
    
    if verbose:
        separator = '=' * 60
        print(f'\n{separator}')
        print(f'🔄 Resetting KPI data for {ticker.upper()}')
        print(f'{separator}\n')
    
    # 1. Clear raw_kpis
    try:
        raw_kpi_service = RawKPIService()
        results['raw_kpis'] = raw_kpi_service.clear_all_raw_kpis(ticker, verbose=verbose)
    except Exception as error:
        print(f'❌ Error clearing raw_kpis: {error}')
        results['raw_kpis'] = -1
    
    # 2. Clear quarterly_analysis
    try:
        results['quarterly_analysis'] = clear_quarterly_analysis(ticker, verbose=verbose)
    except Exception as error:
        print(f'❌ Error clearing quarterly_analysis: {error}')
        results['quarterly_analysis'] = -1
    
    # 3. Clear kpi_definitions (this also clears KPI timeseries)
    try:
        kpi_defs_service = KPIDefinitionsService()
        # Note: clear_all_kpi_data also clears quarterly_analysis, but we already cleared it
        # It also clears kpi timeseries, which is fine
        results['kpi_definitions'] = kpi_defs_service.clear_all_kpi_data(ticker, verbose=verbose)
    except Exception as error:
        print(f'❌ Error clearing kpi_definitions: {error}')
        results['kpi_definitions'] = -1
    
    if verbose:
        separator = '=' * 60
        print(f'\n{separator}')
        print(f'📊 Reset Summary for {ticker.upper()}:')
        print(f'{separator}')
        print(f'   raw_kpis: {results["raw_kpis"]} quarter(s) deleted')
        print(f'   quarterly_analysis: {results["quarterly_analysis"]} document(s) deleted')
        print(f'   kpi_definitions: {results["kpi_definitions"]} item(s) deleted')
        print(f'{separator}\n')
    
    return results


def main():
    parser = argparse.ArgumentParser(
        description='Reset all KPI data for a ticker (raw_kpis, quarterly_analysis, kpi_definitions)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python reset_kpi_data.py AAPL
  python reset_kpi_data.py AAPL --verbose
        """
    )
    
    parser.add_argument(
        'ticker',
        type=str,
        help='Stock ticker symbol (e.g., AAPL)'
    )
    
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Enable verbose output'
    )
    
    args = parser.parse_args()
    
    try:
        results = reset_kpi_data(args.ticker, verbose=args.verbose)
        
        # Check for errors
        if any(count == -1 for count in results.values()):
            print('\n⚠️  Some operations failed. Check errors above.')
            sys.exit(1)
        
        print(f'\n✅ Successfully reset all KPI data for {args.ticker.upper()}')
        sys.exit(0)
        
    except KeyboardInterrupt:
        print('\n\n⚠️  Operation cancelled by user')
        sys.exit(1)
    except Exception as error:
        print(f'\n❌ Fatal error: {error}')
        sys.exit(1)


if __name__ == '__main__':
    main()

