#!/usr/bin/env python3
"""
Refresh Company Summaries for All Tickers

Generates or updates company summaries (business model, competitive moat)
for all tickers in Firebase. Typically run weekly.
"""

import os
import sys
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from dotenv import load_dotenv
from services.ticker_metadata_service import TickerMetadataService
from generate_company_summary import generate_company_summary
from services.company_summary_service import CompanySummaryService

# Load environment variables
env_path = Path(__file__).parent.parent / '.env.local'
load_dotenv(env_path)


def get_all_tickers():
    """Get all tickers from Firebase"""
    service = TickerMetadataService()
    tickers_ref = service.db.collection('tickers')
    docs = tickers_ref.stream()
    return sorted([doc.id for doc in docs])


def refresh_summaries(verbose=False):
    """Refresh company summaries for all tickers"""
    print('='*80)
    print('REFRESHING COMPANY SUMMARIES')
    print('='*80)
    
    tickers = get_all_tickers()
    
    if not tickers:
        print('No tickers found in Firebase')
        return
    
    print(f'Found {len(tickers)} tickers to process\n')
    
    company_summary_service = CompanySummaryService()
    
    results = {
        'success': [],
        'failed': [],
        'skipped': []
    }
    
    for i, ticker in enumerate(tickers, 1):
        print(f'[{i}/{len(tickers)}] Processing {ticker}...', end='', flush=True)
        
        try:
            # Generate summary
            summary_data = generate_company_summary(ticker, verbose=verbose)
            
            if summary_data:
                # Store to Firebase
                company_summary_service.store_company_summary(ticker, summary_data)
                results['success'].append(ticker)
                print(' ✓')
                
                if verbose:
                    print(f'  Summary: {summary_data.get("summary", "N/A")[:80]}...')
            else:
                results['failed'].append(ticker)
                print(' ✗ (generation failed)')
                
        except KeyboardInterrupt:
            print('\n\n⚠️  Interrupted by user')
            break
        except Exception as e:
            results['failed'].append(ticker)
            print(f' ✗ ({str(e)[:50]})')
            if verbose:
                import traceback
                traceback.print_exc()
    
    # Print summary
    print('\n' + '='*80)
    print('SUMMARY')
    print('='*80)
    print(f'Successfully processed: {len(results["success"])} tickers')
    if results['failed']:
        print(f'Failed: {len(results["failed"])} tickers')
        print(f'  {", ".join(results["failed"])}')
    
    print(f'\n✅ Company summary refresh complete')
    
    return results


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Refresh company summaries for all tickers',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--verbose', action='store_true', 
                       help='Show detailed progress')
    
    args = parser.parse_args()
    
    try:
        results = refresh_summaries(verbose=args.verbose)
        
        # Exit with error if any failed
        if results['failed']:
            sys.exit(1)
        
    except KeyboardInterrupt:
        print('\n\nInterrupted by user')
        sys.exit(1)
    except Exception as e:
        print(f'\n❌ Error: {e}')
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

