#!/usr/bin/env python3
"""
Yahoo Finance Service - Python Version

Handles data fetching from Yahoo Finance API using yfinance library.
"""

import yfinance as yf
import pandas as pd
from datetime import datetime
from typing import Dict, List, Optional, Any
import json
import argparse
import sys
from financial_data_validator import validate_financial_data_format

class YFinanceService:
    """Service for fetching data from Yahoo Finance"""
    
    def __init__(self, cache_dir: str = './sec_data_cache'):
        self.cache_dir = cache_dir
    
    def _get_fiscal_quarter_from_date(self, date, fiscal_year_end_month: int) -> tuple:
        """Calculate fiscal year and quarter from date based on fiscal year-end month
        
        For a company with fiscal year ending in September:
        - Q1: October, November, December (months 10, 11, 12)
        - Q2: January, February, March (months 1, 2, 3)
        - Q3: April, May, June (months 4, 5, 6)
        - Q4: July, August, September (months 7, 8, 9)
        
        Args:
            date: Date object (period END date)
            fiscal_year_end_month: Month when fiscal year ends (1-12)
            
        Returns:
            Tuple of (fiscal_year, fiscal_quarter)
        """
        try:
            if not hasattr(date, 'year') or not hasattr(date, 'month'):
                return None, None
            
            # Calculate months since the last fiscal year end
            # If current month is after FYE, we're in the next fiscal year
            if date.month > fiscal_year_end_month:
                fiscal_year = date.year + 1
                months_into_fy = date.month - fiscal_year_end_month
            else:
                fiscal_year = date.year
                months_into_fy = 12 - fiscal_year_end_month + date.month
            
            # Determine quarter based on months into fiscal year
            fiscal_quarter = ((months_into_fy - 1) // 3) + 1
            
            # Clamp to 1-4 range
            fiscal_quarter = max(1, min(4, fiscal_quarter))
            
            return fiscal_year, fiscal_quarter
            
        except Exception:
            return None, None
    
    def _get_quarter_key_from_date(self, date, fiscal_year_end_month: int) -> Optional[str]:
        """Generate quarter key from date (e.g., '2024Q1')"""
        fiscal_year, fiscal_quarter = self._get_fiscal_quarter_from_date(date, fiscal_year_end_month)
        if fiscal_year and fiscal_quarter:
            return f"{fiscal_year}Q{fiscal_quarter}"
        return None
    
    def fetch_quarterly_earnings(self, ticker: str) -> List[Dict[str, Any]]:
        """Fetch comprehensive quarterly financial data from Yahoo Finance
        
        Returns:
            List of quarterly financial data dictionaries with income statement,
            balance sheet, and cash flow statement
        """
        try:
            stock = yf.Ticker(ticker)
            
            # Get fiscal year-end month from company info
            info = stock.info
            fiscal_year_end_timestamp = info.get('lastFiscalYearEnd')
            
            # Default to December if not available, but try to infer from data
            fiscal_year_end_month = 12
            if fiscal_year_end_timestamp:
                from datetime import datetime
                fye_date = datetime.fromtimestamp(fiscal_year_end_timestamp)
                fiscal_year_end_month = fye_date.month
            
            # Get all three financial statements
            quarterly_income = stock.quarterly_income_stmt if hasattr(stock, 'quarterly_income_stmt') else None
            quarterly_balance = stock.quarterly_balance_sheet if hasattr(stock, 'quarterly_balance_sheet') else None
            quarterly_cashflow = stock.quarterly_cashflow if hasattr(stock, 'quarterly_cashflow') else None
            
            # Collect all unique dates from all statements
            all_dates = set()
            if quarterly_income is not None and not quarterly_income.empty:
                all_dates.update(quarterly_income.columns)
            if quarterly_balance is not None and not quarterly_balance.empty:
                all_dates.update(quarterly_balance.columns)
            if quarterly_cashflow is not None and not quarterly_cashflow.empty:
                all_dates.update(quarterly_cashflow.columns)
            
            quarterly_data = []
            
            for date_col in sorted(all_dates, reverse=True):
                quarter_key = self._get_quarter_key_from_date(date_col, fiscal_year_end_month)
                if not quarter_key:
                    continue
                
                fiscal_year, fiscal_quarter = self._get_fiscal_quarter_from_date(date_col, fiscal_year_end_month)
                
                quarter_data = {
                    'fiscal_year': fiscal_year,
                    'fiscal_quarter': fiscal_quarter,
                    'quarter_key': quarter_key,
                    'period_end_date': date_col.strftime('%Y-%m-%d') if hasattr(date_col, 'strftime') else str(date_col),
                    'data_source': 'yfinance',
                    'is_annual': False,
                    'income_statement': {},
                    'balance_sheet': {},
                    'cash_flow_statement': {}
                }
                
                # Extract Income Statement data
                if quarterly_income is not None and date_col in quarterly_income.columns:
                    income_stmt = {}
                    
                    # Map YFinance fields to our standardized field names
                    income_field_mapping = {
                        'Total Revenue': 'revenues',
                        'Cost Of Revenue': 'cost_of_revenue',
                        'Gross Profit': 'gross_profit',
                        'Operating Expense': 'operating_expenses',
                        'Operating Income': 'operating_income',
                        'Pretax Income': 'pretax_income',
                        'Tax Provision': 'tax_expense',
                        'Net Income': 'net_income',
                        'Net Income Common Stockholders': 'net_income',
                        'Basic EPS': 'earnings_per_share',
                        'Diluted EPS': 'diluted_eps',
                        'Basic Average Shares': 'outstanding_shares',
                        'Diluted Average Shares': 'diluted_shares',
                        'EBIT': 'ebit',
                        'EBITDA': 'ebitda',
                        'Research And Development': 'research_development_expense',
                        'Selling General And Administration': 'selling_general_admin_expense',
                        'Interest Expense': 'interest_expense',
                        'Interest Income': 'interest_income',
                        'Other Income Expense': 'other_income_expense',
                        'Total Expenses': 'total_expenses',
                        'Total Operating Income As Reported': 'total_operating_income'
                    }
                    
                    for yf_field, std_field in income_field_mapping.items():
                        if yf_field in quarterly_income.index:
                            value = quarterly_income.loc[yf_field, date_col]
                            if pd.notna(value):
                                income_stmt[std_field] = float(value)
                    
                    quarter_data['income_statement'] = income_stmt
                
                # Extract Balance Sheet data
                if quarterly_balance is not None and date_col in quarterly_balance.columns:
                    balance_sheet = {}
                    
                    balance_field_mapping = {
                        'Cash And Cash Equivalents': 'cash',
                        'Cash Cash Equivalents And Short Term Investments': 'cash_and_short_term_investments',
                        'Current Assets': 'current_assets',
                        'Total Assets': 'total_assets',
                        'Total Non Current Assets': 'noncurrent_assets',
                        'Current Liabilities': 'current_liabilities',
                        'Total Liabilities Net Minority Interest': 'total_liabilities',
                        'Total Non Current Liabilities Net Minority Interest': 'noncurrent_liabilities',
                        'Stockholders Equity': 'stockholders_equity',
                        'Total Equity Gross Minority Interest': 'total_equity',
                        'Retained Earnings': 'retained_earnings',
                        'Common Stock': 'common_stock',
                        'Treasury Stock': 'treasury_stock',
                        'Additional Paid In Capital': 'additional_paid_in_capital',
                        'Accounts Receivable': 'accounts_receivable',
                        'Inventory': 'inventory',
                        'Accounts Payable': 'accounts_payable',
                        'Long Term Debt': 'long_term_debt',
                        'Current Debt': 'current_debt',
                        'Total Debt': 'total_debt',
                        'Net Debt': 'net_debt',
                        'Working Capital': 'working_capital',
                        'Invested Capital': 'invested_capital',
                        'Tangible Book Value': 'tangible_book_value',
                        'Ordinary Shares Number': 'shares_outstanding'
                    }
                    
                    for yf_field, std_field in balance_field_mapping.items():
                        if yf_field in quarterly_balance.index:
                            value = quarterly_balance.loc[yf_field, date_col]
                            if pd.notna(value):
                                balance_sheet[std_field] = float(value)
                    
                    quarter_data['balance_sheet'] = balance_sheet
                
                # Extract Cash Flow Statement data
                if quarterly_cashflow is not None and date_col in quarterly_cashflow.columns:
                    cash_flow = {}
                    
                    cashflow_field_mapping = {
                        'Operating Cash Flow': 'operating_cash_flow',
                        'Investing Cash Flow': 'investing_cash_flow',
                        'Financing Cash Flow': 'financing_cash_flow',
                        'End Cash Position': 'cash_ending',
                        'Beginning Cash Position': 'cash_beginning',
                        'Free Cash Flow': 'free_cash_flow',
                        'Capital Expenditure': 'capex',
                        'Depreciation And Amortization': 'depreciation_amortization',
                        'Stock Based Compensation': 'stock_based_compensation',
                        'Change In Working Capital': 'working_capital_change',
                        'Change In Accounts Payable': 'accounts_payable_change',
                        'Change In Accounts Receivable': 'accounts_receivable_change',
                        'Change In Inventory': 'inventory_change',
                        'Issuance Of Debt': 'debt_issuance',
                        'Repayment Of Debt': 'debt_repayment',
                        'Repurchase Of Capital Stock': 'stock_repurchase',
                        'Common Stock Issuance': 'stock_issuance',
                        'Common Stock Dividend Paid': 'dividends_paid',
                        'Net Income From Continuing Operations': 'net_income_continuing_ops',
                        'Deferred Income Tax': 'deferred_income_tax',
                        'Cash Flow From Continuing Operating Activities': 'operating_cash_flow_continuing',
                        'Cash Flow From Continuing Investing Activities': 'investing_cash_flow_continuing',
                        'Cash Flow From Continuing Financing Activities': 'financing_cash_flow_continuing'
                    }
                    
                    for yf_field, std_field in cashflow_field_mapping.items():
                        if yf_field in quarterly_cashflow.index:
                            value = quarterly_cashflow.loc[yf_field, date_col]
                            if pd.notna(value):
                                cash_flow[std_field] = float(value)
                    
                    quarter_data['cash_flow_statement'] = cash_flow
                
                # Only include quarter if it has at least some financial data
                has_data = (
                    len(quarter_data['income_statement']) > 0 or
                    len(quarter_data['balance_sheet']) > 0 or
                    len(quarter_data['cash_flow_statement']) > 0
                )
                
                if has_data:
                    # Validate the data format before adding
                    validation_result = validate_financial_data_format(quarter_data)
                    if not validation_result['valid']:
                        print(f"Warning: Data validation failed for {quarter_key}:")
                        for error in validation_result['errors']:
                            print(f"  ERROR: {error}")
                    if validation_result.get('warnings'):
                        for warning in validation_result['warnings']:
                            print(f"  WARNING: {warning}")
                    
                    quarterly_data.append(quarter_data)
            
            return quarterly_data
            
        except Exception as e:
            print(f"Error fetching quarterly financial data: {e}")
            return []


def main():
    parser = argparse.ArgumentParser(
        description='Extract Yahoo Finance data for specific quarter',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Extract specific quarter
  python yfinance_service.py AAPL 2024Q1 --pretty
  
  # Verbose output with extraction details
  python yfinance_service.py AAPL 2025Q3 --verbose --pretty
        '''
    )
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT, GOOGL)')
    parser.add_argument('quarter_key', help='Quarter in format YYYYQN (e.g., 2024Q1, 2025Q3)')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')
    parser.add_argument('--pretty', action='store_true', help='Pretty print JSON output')
    parser.add_argument('--cache-dir', default='./sec_data_cache', help='Directory containing cached SEC data')
    
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
    
    # Initialize service
    service = YFinanceService(cache_dir=args.cache_dir)
    
    # Fetch data
    try:
        if args.verbose:
            print(f"Fetching data for {ticker} Q{quarter} {year}...")
        
        data = service.fetch_quarterly_earnings(ticker)
        
        if not data:
            result = {
                'error': f"No financial data available for {ticker}",
                'note': 'Yahoo Finance only provides the most recent 4-5 quarters of data'
            }
        else:
            # Find specific quarter
            filtered_data = None
            for item in data:
                if item.get('fiscal_year') == year and item.get('fiscal_quarter') == quarter:
                    filtered_data = {
                        'ticker': ticker,
                        'data': item
                    }
                    break
            
            if not filtered_data:
                available_quarters = [f"{q['fiscal_year']}Q{q['fiscal_quarter']}" for q in data]
                result = {
                    'error': f"Quarter {year}Q{quarter} not found for {ticker}",
                    'note': 'Yahoo Finance only provides the most recent 4-5 quarters of data',
                    'available_quarters': available_quarters
                }
            else:
                result = filtered_data
        
        # Print results
        if args.pretty:
            print(json.dumps(result, indent=2, default=str))
        else:
            print(json.dumps(result, default=str))
            
    except Exception as e:
        error_result = {'error': str(e)}
        if args.pretty:
            print(json.dumps(error_result, indent=2))
        else:
            print(json.dumps(error_result))
        sys.exit(1)


if __name__ == '__main__':
    main()
