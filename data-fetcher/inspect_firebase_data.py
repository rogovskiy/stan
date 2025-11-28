#!/usr/bin/env python3
"""
Inspect and compare financial data from different sources stored in Firebase.

This script helps debug the data pipeline by showing:
1. What SEC data was extracted and cached
2. What Yahoo Finance data was cached
3. How the data is merged/combined
4. What the final unified format looks like
"""

import argparse
import json
import os
import sys
from firebase_cache import FirebaseCache
from typing import Dict, List, Optional

# Load environment variables from .env.local in current directory
from dotenv import load_dotenv
load_dotenv('.env.local')

def format_currency(value):
    """Format large numbers as currency"""
    if value is None:
        return "N/A"
    if abs(value) >= 1e9:
        return f"${value/1e9:.2f}B"
    elif abs(value) >= 1e6:
        return f"${value/1e6:.2f}M"
    else:
        return f"${value:,.2f}"

def inspect_quarter_data(ticker: str, quarter_key: str, verbose: bool = False):
    """Inspect a single quarter's data from Firebase"""
    cache = FirebaseCache()
    
    print(f"\n{'='*80}")
    print(f"QUARTER: {quarter_key} ({ticker})")
    print(f"{'='*80}\n")
    
    # Get financial data from the main collection
    financial_data = cache.get_quarterly_financial_data(ticker, quarter_key)
    
    # Get SEC financial statements
    sec_data = cache.get_sec_financial_data(ticker, quarter_key)
    
    # Display Yahoo Finance data
    if financial_data:
        print("📊 YAHOO FINANCE DATA:")
        print("-" * 80)
        print(f"Data Source: {financial_data.get('data_source', 'N/A')}")
        print(f"Period End: {financial_data.get('period_end_date', 'N/A')}")
        print(f"Estimated: {financial_data.get('estimated', False)}")
        
        # Key metrics from Yahoo
        print("\nKey Metrics:")
        if 'revenue' in financial_data:
            print(f"  Revenue: {format_currency(financial_data['revenue'])}")
        if 'eps' in financial_data:
            print(f"  EPS: ${financial_data['eps']:.2f}")
        if 'net_income' in financial_data:
            print(f"  Net Income: {format_currency(financial_data['net_income'])}")
        
        if verbose:
            print("\nAll Yahoo Fields:")
            for key, value in sorted(financial_data.items()):
                if key not in ['fiscal_year', 'fiscal_quarter', 'quarter_key', 'period_end_date', 'data_source', 'estimated', 'updated_at']:
                    if isinstance(value, (int, float)):
                        print(f"  {key}: {format_currency(value) if abs(value) > 1000 else value}")
                    else:
                        print(f"  {key}: {value}")
    else:
        print("📊 YAHOO FINANCE DATA: None")
    
    # Display SEC data
    print("\n")
    if sec_data:
        print("📑 SEC FINANCIAL STATEMENTS:")
        print("-" * 80)
        print(f"Data Source: {sec_data.get('data_source', 'N/A')}")
        print(f"Period End: {sec_data.get('period_end_date', 'N/A')}")
        print(f"Accession Number: {sec_data.get('accession_number', 'N/A')}")
        
        # Income Statement
        income_stmt = sec_data.get('income_statement', {})
        if income_stmt:
            print(f"\n  Income Statement ({len(income_stmt)} fields):")
            if 'revenues' in income_stmt:
                print(f"    Revenues: {format_currency(income_stmt['revenues'])}")
            if 'net_income' in income_stmt:
                print(f"    Net Income: {format_currency(income_stmt['net_income'])}")
            if 'earnings_per_share' in income_stmt:
                print(f"    EPS: ${income_stmt['earnings_per_share']:.2f}")
            if 'earnings_per_share_annual' in income_stmt:
                print(f"    EPS (Annual): ${income_stmt['earnings_per_share_annual']:.2f}")
            
            if verbose:
                print("    All Income Statement Fields:")
                for key, value in sorted(income_stmt.items()):
                    if key not in ['revenues', 'net_income', 'earnings_per_share', 'earnings_per_share_annual']:
                        if isinstance(value, (int, float)):
                            print(f"      {key}: {format_currency(value) if abs(value) > 1000 else value}")
        
        # Balance Sheet
        balance_sheet = sec_data.get('balance_sheet', {})
        if balance_sheet:
            print(f"\n  Balance Sheet ({len(balance_sheet)} fields):")
            if 'total_assets' in balance_sheet:
                print(f"    Total Assets: {format_currency(balance_sheet['total_assets'])}")
            if 'total_liabilities' in balance_sheet:
                print(f"    Total Liabilities: {format_currency(balance_sheet['total_liabilities'])}")
            if 'total_equity' in balance_sheet:
                print(f"    Total Equity: {format_currency(balance_sheet['total_equity'])}")
            
            if verbose:
                print("    All Balance Sheet Fields:")
                for key, value in sorted(balance_sheet.items()):
                    if key not in ['total_assets', 'total_liabilities', 'total_equity']:
                        if isinstance(value, (int, float)):
                            print(f"      {key}: {format_currency(value) if abs(value) > 1000 else value}")
        
        # Cash Flow Statement
        cash_flow = sec_data.get('cash_flow_statement', {})
        if cash_flow:
            print(f"\n  Cash Flow Statement ({len(cash_flow)} fields):")
            if 'operating_cash_flow' in cash_flow:
                print(f"    Operating CF: {format_currency(cash_flow['operating_cash_flow'])}")
            if 'capex' in cash_flow:
                print(f"    CapEx: {format_currency(cash_flow['capex'])}")
            if 'financing_cash_flow' in cash_flow:
                print(f"    Financing CF: {format_currency(cash_flow['financing_cash_flow'])}")
            
            if verbose:
                print("    All Cash Flow Fields:")
                for key, value in sorted(cash_flow.items()):
                    if key not in ['operating_cash_flow', 'capex', 'financing_cash_flow']:
                        if isinstance(value, (int, float)):
                            print(f"      {key}: {format_currency(value) if abs(value) > 1000 else value}")
    else:
        print("📑 SEC FINANCIAL STATEMENTS: None")
    
    # Data comparison
    print("\n")
    print("🔍 DATA COMPARISON:")
    print("-" * 80)
    
    if financial_data and sec_data:
        income_stmt = sec_data.get('income_statement', {})
        
        # Compare revenue
        yahoo_revenue = financial_data.get('revenue')
        sec_revenue = income_stmt.get('revenues')
        if yahoo_revenue and sec_revenue:
            diff_pct = abs(yahoo_revenue - sec_revenue) / sec_revenue * 100
            match = "✅" if diff_pct < 1 else "⚠️"
            print(f"{match} Revenue: Yahoo={format_currency(yahoo_revenue)}, SEC={format_currency(sec_revenue)} (diff: {diff_pct:.2f}%)")
        
        # Compare EPS
        yahoo_eps = financial_data.get('eps')
        sec_eps = income_stmt.get('earnings_per_share')
        if yahoo_eps and sec_eps:
            diff_pct = abs(yahoo_eps - sec_eps) / sec_eps * 100 if sec_eps != 0 else 0
            match = "✅" if diff_pct < 1 else "⚠️"
            print(f"{match} EPS: Yahoo=${yahoo_eps:.2f}, SEC=${sec_eps:.2f} (diff: {diff_pct:.2f}%)")
        
        # Compare net income
        yahoo_net = financial_data.get('net_income')
        sec_net = income_stmt.get('net_income')
        if yahoo_net and sec_net:
            diff_pct = abs(yahoo_net - sec_net) / sec_net * 100
            match = "✅" if diff_pct < 1 else "⚠️"
            print(f"{match} Net Income: Yahoo={format_currency(yahoo_net)}, SEC={format_currency(sec_net)} (diff: {diff_pct:.2f}%)")
    elif financial_data and not sec_data:
        print("⚠️  Only Yahoo Finance data available")
    elif sec_data and not financial_data:
        print("⚠️  Only SEC data available")
    else:
        print("❌ No data found for this quarter")

def list_all_quarters(ticker: str):
    """List all quarters available for a ticker"""
    cache = FirebaseCache()
    
    print(f"\n{'='*80}")
    print(f"ALL QUARTERS FOR {ticker}")
    print(f"{'='*80}\n")
    
    # Get all financial data
    all_financial = cache.get_all_quarterly_financial_data(ticker)
    
    # Get all SEC data
    sec_result = cache.get_all_sec_financial_data(ticker)
    sec_quarterly = sec_result.get('quarterly', []) if sec_result else []
    sec_annual = sec_result.get('annual', []) if sec_result else []
    
    # Build lookup sets
    financial_quarters = {q['quarter_key'] for q in all_financial if 'quarter_key' in q}
    sec_quarters = {q['quarter_key'] for q in sec_quarterly if 'quarter_key' in q}
    sec_annual_keys = {a['quarter_key'] for a in sec_annual if 'quarter_key' in a}
    
    # Get all unique quarters
    all_quarters = sorted(financial_quarters | sec_quarters | sec_annual_keys)
    
    print(f"Total quarters found: {len(all_quarters)}")
    print(f"  - Yahoo Finance: {len(financial_quarters)}")
    print(f"  - SEC Quarterly: {len(sec_quarters)}")
    print(f"  - SEC Annual: {len(sec_annual_keys)}")
    print()
    
    # Group by year
    by_year = {}
    for qkey in all_quarters:
        if '_ANNUAL' in qkey:
            year = qkey.split('_')[0]
        else:
            year = qkey[:4]
        if year not in by_year:
            by_year[year] = []
        by_year[year].append(qkey)
    
    # Display by year
    for year in sorted(by_year.keys()):
        print(f"\nFY{year}:")
        for qkey in sorted(by_year[year]):
            has_yahoo = "Y" if qkey in financial_quarters else " "
            has_sec = "S" if qkey in sec_quarters else " "
            has_annual = "A" if qkey in sec_annual_keys else " "
            print(f"  [{has_yahoo}|{has_sec}|{has_annual}] {qkey}")
    
    print("\nLegend: [Y|S|A] = Yahoo Finance | SEC Quarterly | SEC Annual")

def compare_quarters(ticker: str, quarter1: str, quarter2: str):
    """Compare two quarters side by side"""
    cache = FirebaseCache()
    
    print(f"\n{'='*80}")
    print(f"COMPARE: {quarter1} vs {quarter2} ({ticker})")
    print(f"{'='*80}\n")
    
    # Get data for both quarters
    data1_financial = cache.get_quarterly_financial_data(ticker, quarter1)
    data1_sec = cache.get_sec_financial_data(ticker, quarter1)
    
    data2_financial = cache.get_quarterly_financial_data(ticker, quarter2)
    data2_sec = cache.get_sec_financial_data(ticker, quarter2)
    
    # Compare key metrics
    print(f"{'Metric':<30} {quarter1:>15} {quarter2:>15} {'Change':>15}")
    print("-" * 80)
    
    # Revenue
    rev1 = (data1_sec.get('income_statement', {}).get('revenues') if data1_sec 
            else data1_financial.get('revenue') if data1_financial else None)
    rev2 = (data2_sec.get('income_statement', {}).get('revenues') if data2_sec 
            else data2_financial.get('revenue') if data2_financial else None)
    
    if rev1 and rev2:
        change = (rev2 - rev1) / rev1 * 100
        print(f"{'Revenue':<30} {format_currency(rev1):>15} {format_currency(rev2):>15} {f'{change:+.1f}%':>15}")
    
    # EPS
    eps1 = (data1_sec.get('income_statement', {}).get('earnings_per_share') if data1_sec 
            else data1_financial.get('eps') if data1_financial else None)
    eps2 = (data2_sec.get('income_statement', {}).get('earnings_per_share') if data2_sec 
            else data2_financial.get('eps') if data2_financial else None)
    
    if eps1 and eps2:
        change = (eps2 - eps1) / eps1 * 100
        print(f"{'EPS':<30} {f'${eps1:.2f}':>15} {f'${eps2:.2f}':>15} {f'{change:+.1f}%':>15}")
    
    # Net Income
    net1 = (data1_sec.get('income_statement', {}).get('net_income') if data1_sec 
            else data1_financial.get('net_income') if data1_financial else None)
    net2 = (data2_sec.get('income_statement', {}).get('net_income') if data2_sec 
            else data2_financial.get('net_income') if data2_financial else None)
    
    if net1 and net2:
        change = (net2 - net1) / net1 * 100
        print(f"{'Net Income':<30} {format_currency(net1):>15} {format_currency(net2):>15} {f'{change:+.1f}%':>15}")

def main():
    parser = argparse.ArgumentParser(
        description='Inspect financial data stored in Firebase',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # List all quarters for AAPL
  python inspect_firebase_data.py AAPL --list
  
  # Inspect a specific quarter
  python inspect_firebase_data.py AAPL --quarter 2021Q4
  
  # Inspect with full details
  python inspect_firebase_data.py AAPL --quarter 2021Q4 --verbose
  
  # Compare two quarters
  python inspect_firebase_data.py AAPL --compare 2021Q3 2021Q4
  
  # Inspect recent quarters
  python inspect_firebase_data.py AAPL --recent 4
        """
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol')
    parser.add_argument('--list', '-l', action='store_true', help='List all available quarters')
    parser.add_argument('--quarter', '-q', help='Inspect specific quarter (e.g., 2021Q4)')
    parser.add_argument('--compare', '-c', nargs=2, metavar=('Q1', 'Q2'), help='Compare two quarters')
    parser.add_argument('--recent', '-r', type=int, metavar='N', help='Inspect N most recent quarters')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show all fields')
    
    args = parser.parse_args()
    ticker = args.ticker.upper()
    
    if args.list:
        list_all_quarters(ticker)
    elif args.quarter:
        inspect_quarter_data(ticker, args.quarter, args.verbose)
    elif args.compare:
        compare_quarters(ticker, args.compare[0], args.compare[1])
    elif args.recent:
        cache = FirebaseCache()
        all_financial = cache.get_all_quarterly_financial_data(ticker)
        sec_result = cache.get_all_sec_financial_data(ticker)
        sec_quarterly = sec_result.get('quarterly', []) if sec_result else []
        
        # Get all unique quarters
        financial_quarters = {q['quarter_key'] for q in all_financial if 'quarter_key' in q}
        sec_quarters = {q['quarter_key'] for q in sec_quarterly if 'quarter_key' in q}
        all_quarters = sorted(financial_quarters | sec_quarters)
        
        # Get recent quarters
        recent_quarters = all_quarters[-args.recent:] if len(all_quarters) >= args.recent else all_quarters
        
        for qkey in recent_quarters:
            inspect_quarter_data(ticker, qkey, args.verbose)
    else:
        # Default: list all quarters
        list_all_quarters(ticker)

if __name__ == '__main__':
    main()
