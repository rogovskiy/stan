#!/usr/bin/env python3
"""
Unified Data Service

Combines SEC and Yahoo Finance data sources, automatically selecting the appropriate
source based on data availability. Uses Yahoo Finance for recent quarters (last 4-5)
and SEC filings for historical data.
"""

import json
import argparse
import sys
from datetime import datetime
from typing import Dict, List, Optional, Any
from extract_sec_financials import extract_sec_financials
from yfinance_service import YFinanceService
from financial_data_validator import validate_financial_data_format


class UnifiedDataService:
    """Service that combines SEC and Yahoo Finance data sources"""
    
    def __init__(self, cache_dir: str = './sec_data_cache'):
        self.cache_dir = cache_dir
        self.yfinance_service = YFinanceService(cache_dir=cache_dir)
        print("✅ Unified data service initialized")
    
    def _is_recent_quarter(self, year: int, quarter: int) -> bool:
        """
        Determine if a quarter is recent enough to be available in Yahoo Finance.
        Yahoo Finance typically has the last 4-5 quarters available.
        """
        current_date = datetime.now()
        current_year = current_date.year
        current_quarter = (current_date.month - 1) // 3 + 1
        
        # Calculate quarters back from current
        quarters_back = (current_year - year) * 4 + (current_quarter - quarter)
        
        # Yahoo Finance typically has last 5 quarters reliably
        return quarters_back <= 5
    
    def fetch_financial_data(
        self,
        ticker: str,
        year: int,
        quarter: int,
        verbose: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Fetch financial data for a specific quarter using the most appropriate source.
        
        Args:
            ticker: Stock ticker symbol
            year: Fiscal year
            quarter: Fiscal quarter 1-4
            verbose: Enable verbose output
            
        Returns:
            Financial data dictionary for the quarter, or None if not found
        """
        result = None
        
        if self._is_recent_quarter(year, quarter):
            if verbose:
                print(f"📊 Fetching {ticker} {year}Q{quarter} from Yahoo Finance (recent quarter)")
            
            yf_data = self.yfinance_service.fetch_quarterly_earnings(ticker)
            
            # Filter for requested quarter
            for item in yf_data:
                if item['fiscal_year'] == year and item['fiscal_quarter'] == quarter:
                    result = item
                    break
            
            if not result:
                if verbose:
                    print(f"⚠️  Yahoo Finance doesn't have {year}Q{quarter}, trying SEC...")
                
                try:
                    sec_response = extract_sec_financials(ticker, year, quarter, verbose, self.cache_dir)
                    if sec_response and 'data' in sec_response:
                        result = sec_response['data']
                except Exception as e:
                    if verbose:
                        print(f"❌ SEC extraction failed: {e}")
        else:
            if verbose:
                print(f"📊 Fetching {ticker} {year}Q{quarter} from SEC (historical quarter)")
            
            try:
                sec_response = extract_sec_financials(ticker, year, quarter, verbose, self.cache_dir)
                if sec_response and 'data' in sec_response:
                    result = sec_response['data']
            except Exception as e:
                if verbose:
                    print(f"❌ SEC extraction failed: {e}")
                    print(f"⚠️  Trying Yahoo Finance as fallback...")
                
                yf_data = self.yfinance_service.fetch_quarterly_earnings(ticker)
                for item in yf_data:
                    if item['fiscal_year'] == year and item['fiscal_quarter'] == quarter:
                        result = item
                        break
        
        # Validate result
        if result:
            validation = validate_financial_data_format(result)
            if not validation['valid']:
                print(f"⚠️  Validation warning for {result.get('quarter_key', 'unknown')}:")
                for error in validation['errors']:
                    print(f"    ERROR: {error}")
        
        return result


def main():
    parser = argparse.ArgumentParser(
        description='Extract financial data for a specific quarter using unified SEC/Yahoo Finance service',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Extract specific quarter (auto-selects best source)
  python unified_data_service.py AAPL 2025Q3 --pretty
  
  # Verbose output with source selection details
  python unified_data_service.py AAPL 2024Q2 --verbose --pretty
        '''
    )
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT, GOOGL)')
    parser.add_argument('quarter_key', help='Quarter in format YYYYQN (e.g., 2024Q1, 2025Q3)')
    parser.add_argument('--pretty', action='store_true', help='Pretty print JSON output')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    
    args = parser.parse_args()
    
    ticker = args.ticker.upper()
    
    # Parse quarter_key (e.g., "2024Q1" -> year=2024, quarter=1)
    try:
        if 'Q' not in args.quarter_key:
            raise ValueError("Quarter must be in format YYYYQN (e.g., 2024Q1)")
        year_str, quarter_str = args.quarter_key.split('Q')
        year = int(year_str)
        quarter = int(quarter_str)
        if quarter not in [1, 2, 3, 4]:
            raise ValueError("Quarter must be 1-4")
    except (ValueError, IndexError) as e:
        print(f"❌ Invalid quarter format: {args.quarter_key}", file=sys.stderr)
        print(f"   Expected format: YYYYQN (e.g., 2024Q1, 2025Q3)", file=sys.stderr)
        sys.exit(1)
    
    try:
        service = UnifiedDataService()
        data = service.fetch_financial_data(
            ticker=ticker,
            year=year,
            quarter=quarter,
            verbose=args.verbose
        )
        
        if not data:
            print(f"❌ No data found for {ticker} {year}Q{quarter}", file=sys.stderr)
            sys.exit(1)
        
        # Format output
        output = {
            'ticker': ticker,
            'data': data
        }
        
        # Print JSON
        if args.pretty:
            print(json.dumps(output, indent=2))
        else:
            print(json.dumps(output))
        
    except Exception as e:
        print(f"❌ Error: {e}", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
