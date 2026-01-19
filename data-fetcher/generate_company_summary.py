#!/usr/bin/env python3
"""
Generate Company Information

Fetches company information from Yahoo Finance using yfinance library.
Stores company info at /tickers/{ticker} in Firestore.
"""

import json
import argparse
import sys
from datetime import datetime
from typing import Dict, Optional, Any
from dotenv import load_dotenv
import yfinance as yf

from services.company_summary_service import CompanySummaryService

# Load environment variables from .env.local
load_dotenv('.env.local')


def fetch_company_info(ticker: str, verbose: bool = False) -> Optional[Dict[str, Any]]:
    """Fetch company information from Yahoo Finance
    
    Args:
        ticker: Stock ticker symbol
        verbose: Enable verbose output
        
    Returns:
        Dictionary with company information including:
        - exchange, industry, sector
        - longBusinessSummary
        - fiscalYearEndMonth, fiscalYearEndDate
        - longName, shortName, name
        - country, website, fullTimeEmployees
    """
    try:
        if verbose:
            print(f'Fetching company information for {ticker} from Yahoo Finance...')
        
        stock = yf.Ticker(ticker)
        info = stock.info
        
        if not info:
            print(f'Error: No info available for ticker {ticker}')
            return None
        
        # Extract relevant fields
        company_info = {
            'ticker': ticker.upper(),
            'lastUpdated': datetime.now().isoformat(),
            'source': 'yahoo_finance'
        }
        
        # Exchange information
        exchange = info.get('exchange') or info.get('exchangeName')
        if exchange:
            company_info['exchange'] = exchange
        
        # Industry and sector
        industry = info.get('industry')
        if industry:
            company_info['industry'] = industry
        
        sector = info.get('sector')
        if sector:
            company_info['sector'] = sector
        
        # Business summary (replaces summary field)
        long_business_summary = info.get('longBusinessSummary')
        if long_business_summary:
            company_info['longBusinessSummary'] = long_business_summary
        
        # Fiscal year end information
        fiscal_year_end_timestamp = info.get('lastFiscalYearEnd')
        if fiscal_year_end_timestamp:
            fye_date = datetime.fromtimestamp(fiscal_year_end_timestamp)
            company_info['fiscalYearEndMonth'] = fye_date.month
            company_info['fiscalYearEndDate'] = fye_date.strftime('%Y-%m-%d')
            company_info['lastFiscalYearEnd'] = fiscal_year_end_timestamp
        
        # Company name (try multiple fields)
        long_name = info.get('longName')
        short_name = info.get('shortName')
        name = info.get('name')
        
        if long_name:
            company_info['longName'] = long_name
        if short_name:
            company_info['shortName'] = short_name
        if name:
            company_info['name'] = name
        
        # Use longName as primary name if available, fallback to shortName or name
        if long_name:
            company_info['name'] = long_name
        elif short_name:
            company_info['name'] = short_name
        elif name:
            company_info['name'] = name
        
        # Country
        country = info.get('country')
        if country:
            company_info['country'] = country
        
        # Website
        website = info.get('website')
        if website:
            company_info['website'] = website
        
        # Employees
        full_time_employees = info.get('fullTimeEmployees')
        if full_time_employees:
            company_info['fullTimeEmployees'] = int(full_time_employees)
        
        if verbose:
            print(f'✅ Fetched company information for {ticker}')
            print(f'   Fields captured: {len(company_info)} fields')
            print(f'   Name: {company_info.get("name", "N/A")}')
            print(f'   Exchange: {company_info.get("exchange", "N/A")}')
            print(f'   Industry: {company_info.get("industry", "N/A")}')
            print(f'   Sector: {company_info.get("sector", "N/A")}')
        
        return company_info
        
    except Exception as e:
        print(f'Error fetching company information for {ticker}: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return None


def main():
    parser = argparse.ArgumentParser(
        description='Fetch company information from Yahoo Finance',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Fetch and store company information
  python generate_company_summary.py AAPL
  
  # Fetch with verbose output
  python generate_company_summary.py AAPL --verbose
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-store', action='store_true', help='Fetch information without storing to Firebase')
    
    args = parser.parse_args()
    
    try:
        # Fetch company information
        company_info = fetch_company_info(args.ticker.upper(), args.verbose)
        
        if not company_info:
            print(f'Failed to fetch company information for {args.ticker}')
            sys.exit(1)
        
        # Store to Firebase unless --no-store is specified
        if not args.no_store:
            company_summary_service = CompanySummaryService()
            company_summary_service.store_company_summary(args.ticker.upper(), company_info)
            print(f'\n✅ Company information stored for {args.ticker}')
        else:
            print('\n✅ Company information fetched (not stored):')
            print(json.dumps(company_info, indent=2))
    
    except KeyboardInterrupt:
        print('\n\nInterrupted by user')
        sys.exit(1)
    except Exception as e:
        print(f'Error: {e}')
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
