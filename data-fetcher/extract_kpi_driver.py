#!/usr/bin/env python3
"""
KPI Extraction and Unification Driver

Comprehensive CLI tool for extracting and unifying KPIs from quarterly documents.
Supports single quarter, multiple quarters, ranges, entire population processing,
and reset functionality.
"""

import argparse
import sys
import re
from typing import List, Optional, Dict, Any
from dotenv import load_dotenv

from kpi_extraction_service import extract_and_unify_kpis
from extract_kpis3 import get_all_quarters_with_documents
from reset_kpi_data import reset_kpi_data

# Load environment variables
load_dotenv('.env.local')


def parse_quarters(quarter_str: str) -> List[str]:
    """Parse comma-separated quarters and validate format"""
    quarters = [q.strip() for q in quarter_str.split(',')]
    
    # Validate each quarter format
    quarter_pattern = re.compile(r'^\d{4}Q[1-4]$')
    for quarter in quarters:
        if not quarter_pattern.match(quarter):
            raise ValueError(f'Invalid quarter format: {quarter}. Use YYYYQN (e.g., 2025Q1)')
    
    return quarters


def parse_quarter_range(start: str, end: str) -> List[str]:
    """Parse quarter range into list of quarters
    
    Args:
        start: Start quarter in format YYYYQN (e.g., "2022Q1")
        end: End quarter in format YYYYQN (e.g., "2024Q4")
        
    Returns:
        List of quarter keys from start to end (inclusive)
    """
    # Validate format
    quarter_pattern = re.compile(r'^\d{4}Q[1-4]$')
    if not quarter_pattern.match(start):
        raise ValueError(f'Invalid start quarter format: {start}. Use YYYYQN (e.g., 2022Q1)')
    if not quarter_pattern.match(end):
        raise ValueError(f'Invalid end quarter format: {end}. Use YYYYQN (e.g., 2024Q4)')
    
    # Parse start and end
    start_year = int(start[:4])
    start_quarter = int(start[5])
    end_year = int(end[:4])
    end_quarter = int(end[5])
    
    # Validate range
    if start_year > end_year or (start_year == end_year and start_quarter > end_quarter):
        raise ValueError(f'Start quarter {start} must be before or equal to end quarter {end}')
    
    # Generate quarters
    quarters = []
    current_year = start_year
    current_quarter = start_quarter
    
    while True:
        quarter_key = f"{current_year}Q{current_quarter}"
        quarters.append(quarter_key)
        
        # Check if we've reached the end
        if current_year == end_year and current_quarter == end_quarter:
            break
        
        # Move to next quarter
        current_quarter += 1
        if current_quarter > 4:
            current_quarter = 1
            current_year += 1
    
    return quarters


def main():
    parser = argparse.ArgumentParser(
        description='Extract and unify KPIs from quarterly investor relations documents',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Single quarter with unification
  python extract_kpi_driver.py AAPL 2024Q1
  
  # Single quarter, extraction only
  python extract_kpi_driver.py AAPL 2024Q1 --skip-unification
  
  # Multiple quarters (comma-separated)
  python extract_kpi_driver.py AAPL 2024Q1,2024Q2,2024Q3
  
  # Quarter range
  python extract_kpi_driver.py AAPL --start-quarter 2022Q1 --end-quarter 2024Q4
  
  # All quarters from a start point
  python extract_kpi_driver.py AAPL --all-quarters --start-quarter 2022Q1
  
  # All quarters (entire population)
  python extract_kpi_driver.py AAPL --all-quarters
  
  # With document filtering
  python extract_kpi_driver.py AAPL --all-quarters --document-type earnings_release
  
  # Reset all KPI data (standalone)
  python extract_kpi_driver.py AAPL --reset
  
  # Reset then process all quarters
  python extract_kpi_driver.py AAPL --reset --all-quarters
  
  # Verbose output
  python extract_kpi_driver.py AAPL --all-quarters --verbose
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('quarter', nargs='?', help='Quarter(s) in format YYYYQN (e.g., 2024Q1) or comma-separated (e.g., 2024Q1,2024Q2,2024Q3). Can be omitted if using --start-quarter, --end-quarter, or --all-quarters.')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-store', action='store_true', help='Extract KPIs without storing to Firebase (prevents unification)')
    parser.add_argument('--skip-unification', action='store_true', help='Skip unification step (extraction only)')
    parser.add_argument('--all-quarters', action='store_true', help='Process all quarters iteratively (earliest to latest)')
    parser.add_argument('--start-quarter', help='Start processing from this quarter. Can be used with --all-quarters or with --end-quarter for range.')
    parser.add_argument('--end-quarter', help='End quarter for range processing. Must be used with --start-quarter.')
    parser.add_argument('--document-type', help='Filter documents by type (e.g., earnings_release, presentation, sec_filing_10k, sec_filing_10q, sec_filing_8k, annual_report, proxy_statement, other)')
    parser.add_argument('--reset', action='store_true', help='Reset all KPI data for the ticker before processing (clears raw_kpis, quarterly_analysis, kpi_definitions). Can be used standalone.')
    
    args = parser.parse_args()
    
    ticker = args.ticker.upper()
    
    try:
        # Handle reset first (if specified)
        if args.reset:
            if args.verbose:
                print(f'\n{"="*80}')
                print(f'Resetting KPI data for {ticker}')
                print(f'{"="*80}')
            
            try:
                reset_results = reset_kpi_data(ticker, verbose=args.verbose)
                
                # Check for errors
                if any(count == -1 for count in reset_results.values()):
                    print('\n⚠️  Some reset operations failed. Check errors above.')
                    sys.exit(1)
                
                print(f'\n✅ Successfully reset all KPI data for {ticker}')
                
            except Exception as e:
                print(f'\n❌ Error during reset: {e}')
                if args.verbose:
                    import traceback
                    traceback.print_exc()
                sys.exit(1)
        
        # If only reset was specified (no quarters), exit here
        if not args.quarter and not args.start_quarter and not args.end_quarter and not args.all_quarters:
            if args.reset:
                print('\n✅ Reset complete. No quarters specified for processing.')
                sys.exit(0)
            else:
                parser.error('Quarter is required. Provide as positional argument, use --start-quarter with --end-quarter, or use --all-quarters')
        
        # Determine which quarters to process
        quarters_to_process: List[str] = []
        
        if args.all_quarters:
            # Get all quarters with documents
            all_quarters = get_all_quarters_with_documents(ticker)
            
            if not all_quarters:
                print(f'No quarters with documents found for {ticker}')
                sys.exit(1)
            
            # Filter to start from specified quarter if provided
            if args.start_quarter:
                if not re.match(r'^\d{4}Q[1-4]$', args.start_quarter):
                    print(f'Error: Invalid start-quarter format. Use YYYYQN (e.g., 2022Q1)')
                    sys.exit(1)
                try:
                    start_idx = all_quarters.index(args.start_quarter)
                    all_quarters = all_quarters[start_idx:]
                except ValueError:
                    print(f'Warning: Start quarter {args.start_quarter} not found, starting from earliest')
            
            quarters_to_process = all_quarters
            
        elif args.start_quarter and args.end_quarter:
            # Quarter range
            try:
                quarters_to_process = parse_quarter_range(args.start_quarter, args.end_quarter)
            except ValueError as e:
                print(f'Error: {e}')
                sys.exit(1)
                
        elif args.start_quarter:
            # Single quarter via --start-quarter
            if not re.match(r'^\d{4}Q[1-4]$', args.start_quarter):
                print(f'Error: Invalid start-quarter format. Use YYYYQN (e.g., 2022Q1)')
                sys.exit(1)
            quarters_to_process = [args.start_quarter]
            
        elif args.quarter:
            # Parse quarters (handle comma-separated)
            try:
                quarters_to_process = parse_quarters(args.quarter)
            except ValueError as e:
                print(f'Error: {e}')
                sys.exit(1)
        else:
            parser.error('Quarter is required. Provide as positional argument, use --start-quarter with --end-quarter, or use --all-quarters')
        
        if not quarters_to_process:
            print('No quarters to process')
            sys.exit(1)
        
        # Validate end-quarter is not used without start-quarter
        if args.end_quarter and not args.start_quarter:
            parser.error('--end-quarter must be used with --start-quarter')
        
        # Display processing plan
        if args.verbose:
            print(f'\n📊 Processing {len(quarters_to_process)} quarter(s) for {ticker}')
            print(f'   Quarters: {", ".join(quarters_to_process)}')
            if args.skip_unification:
                print(f'   ⏭️  Unification will be skipped')
            if args.no_store:
                print(f'   ⏭️  Results will not be stored to Firebase')
            if args.document_type:
                print(f'   📄 Filtering to document type: {args.document_type}')
        
        # Process each quarter
        results: Dict[str, Dict[str, Any]] = {}
        failed_quarters: List[str] = []
        
        for i, quarter_key in enumerate(quarters_to_process, 1):
            print(f'\n{"="*80}')
            print(f'Processing Quarter {i}/{len(quarters_to_process)}: {quarter_key}')
            print(f'{"="*80}')
            
            try:
                result = extract_and_unify_kpis(
                    ticker,
                    quarter_key,
                    verbose=args.verbose,
                    document_type=args.document_type,
                    skip_unification=args.skip_unification,
                    no_store=args.no_store
                )
                
                if result['extraction']['success']:
                    results[quarter_key] = result
                    
                    # Display summary for this quarter
                    extraction_success = result['extraction']['success']
                    kpis_count = len(result['extraction']['kpis']) if result['extraction']['kpis'] else 0
                    
                    if args.skip_unification or (result.get('unification') and result['unification'].get('skipped')):
                        print(f'\n✅ Quarter {quarter_key}: Extracted {kpis_count} KPIs (unification skipped)')
                    elif result.get('unification') and 'error' not in result['unification']:
                        unif = result['unification']
                        print(f'\n✅ Quarter {quarter_key}: Extracted {kpis_count} KPIs, Unified {unif.get("total_unified", 0)} KPIs')
                        print(f'   Matched: {unif.get("matched", 0)}, Created definitions: {unif.get("created_definitions", 0)}')
                    else:
                        print(f'\n⚠️  Quarter {quarter_key}: Extracted {kpis_count} KPIs, but unification failed')
                else:
                    failed_quarters.append(quarter_key)
                    print(f'\n❌ Quarter {quarter_key}: Extraction failed')
                    
            except KeyboardInterrupt:
                print('\n\n⚠️  Interrupted by user')
                sys.exit(1)
            except Exception as e:
                failed_quarters.append(quarter_key)
                print(f'\n❌ Quarter {quarter_key}: Error - {e}')
                if args.verbose:
                    import traceback
                    traceback.print_exc()
        
        # Final summary
        print(f'\n{"="*80}')
        print(f'✅ Processing Complete')
        print(f'{"="*80}')
        print(f'   Successful: {len(results)} quarter(s)')
        if failed_quarters:
            print(f'   Failed: {len(failed_quarters)} quarter(s)')
            print(f'   Failed quarters: {", ".join(failed_quarters)}')
        
        # Detailed summary
        if results and args.verbose:
            print(f'\n📊 Detailed Results:')
            for quarter_key, result in results.items():
                kpis_count = len(result['extraction']['kpis']) if result['extraction']['kpis'] else 0
                if result.get('unification') and 'error' not in result['unification'] and not result['unification'].get('skipped'):
                    unif = result['unification']
                    print(f'   {quarter_key}: {kpis_count} KPIs extracted, {unif.get("total_unified", 0)} unified')
                else:
                    print(f'   {quarter_key}: {kpis_count} KPIs extracted (unification skipped or failed)')
        
        # Exit with error if any quarters failed
        if failed_quarters:
            sys.exit(1)
        
    except KeyboardInterrupt:
        print('\n\n⚠️  Interrupted by user')
        sys.exit(1)
    except Exception as e:
        print(f'\n❌ Fatal error: {e}')
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

