#!/usr/bin/env python3
"""
SEC Financial Data Extractor - Extract comprehensive financial statements from SEC filings

Extracts quarterly and annual financial data including:
- Income Statement
- Balance Sheet  
- Cash Flow Statement

Supports fiscal quarter alignment and automatic Q4 derivation.

Also provides SECFinancialsService class for programmatic access with caching support.
"""

from secfsdstools.f_standardize.is_standardize import IncomeStatementStandardizer
from secfsdstools.f_standardize.bs_standardize import BalanceSheetStandardizer
from secfsdstools.f_standardize.cf_standardize import CashFlowStandardizer
from cik_lookup_service import CIKLookupService
from load_cached_sec_data import load_cached_data, filter_by_ticker
import pandas as pd
import json
import argparse
import sys
import logging
from typing import Dict, List, Optional, Any
from datetime import datetime

# Suppress verbose logging from secfsdstools standardizers
logging.getLogger('secfsdstools').setLevel(logging.WARNING)

# Create a module-level singleton for CIK lookups to avoid reloading
_cik_service = None

def _get_cik_service():
    """Get or create the singleton CIK lookup service"""
    global _cik_service
    if _cik_service is None:
        _cik_service = CIKLookupService()
    return _cik_service

# Module-level cache for filtered ticker data
_ticker_data_cache = {}
_sec_data_cache = None

def detect_fiscal_year_end(standardized_df):
    """Detect fiscal year-end month from annual reports (qtrs=4)
    
    Returns:
        Tuple of (month, day) representing fiscal year-end, or None if cannot detect
    """
    try:
        # Get annual reports (qtrs=4)
        annual_df = standardized_df[standardized_df['qtrs'] == 4]
        
        if len(annual_df) == 0:
            return None
        
        # Get the first annual report date
        first_annual = annual_df.iloc[0]
        ddate = int(first_annual['ddate'])
        
        # Extract month and day
        date_str = str(ddate)
        month = int(date_str[4:6])
        day = int(date_str[6:8])
        
        return (month, day)
    except:
        return None

def parse_date_with_fiscal_year_end(date_value, fiscal_year_end_month, fiscal_year_end_day=None):
    """Parse date and determine fiscal year/quarter based on company's fiscal year-end
    
    Args:
        date_value: Date in YYYYMMDD format (numpy.int64 or int)
        fiscal_year_end_month: Month when fiscal year ends (1-12)
        fiscal_year_end_day: Day when fiscal year ends (optional, defaults to last day of month)
    
    Returns:
        Dict with fiscal_year, fiscal_quarter, period_end_date
    """
    try:
        if pd.isna(date_value):
            return None
        
        # Handle numpy.int64 format
        if hasattr(date_value, 'item'):
            date_int = int(date_value.item())
        else:
            date_int = int(date_value)
        
        date_str = str(date_int)
        if len(date_str) == 8:  # YYYYMMDD
            year, month, day = int(date_str[:4]), int(date_str[4:6]), int(date_str[6:8])
            date_obj = pd.Timestamp(year=year, month=month, day=day)
            
            # Calculate fiscal quarter based on fiscal year-end month
            # Fiscal year starts the month after the fiscal year-end
            fiscal_year_start_month = (fiscal_year_end_month % 12) + 1
            
            # Determine which fiscal quarter this month falls into
            # Q1 starts right after fiscal year end
            if fiscal_year_start_month <= 3:
                q1_months = list(range(fiscal_year_start_month, fiscal_year_start_month + 3))
                q2_months = list(range(fiscal_year_start_month + 3, fiscal_year_start_month + 6))
                q3_months = list(range(fiscal_year_start_month + 6, fiscal_year_start_month + 9))
                q4_months = list(range(fiscal_year_start_month + 9, fiscal_year_start_month + 12))
            else:
                # Fiscal year spans calendar years
                q1_start = fiscal_year_start_month
                q1_months = [(q1_start + i - 1) % 12 + 1 for i in range(3)]
                q2_months = [(q1_start + i + 2) % 12 + 1 for i in range(3)]
                q3_months = [(q1_start + i + 5) % 12 + 1 for i in range(3)]
                q4_months = [(q1_start + i + 8) % 12 + 1 for i in range(3)]
            
            # Determine fiscal quarter
            if month in q1_months:
                fiscal_quarter = 1
            elif month in q2_months:
                fiscal_quarter = 2
            elif month in q3_months:
                fiscal_quarter = 3
            else:  # q4_months
                fiscal_quarter = 4
            
            # Determine fiscal year
            # If current month is after fiscal year-end month, we're in next fiscal year
            # If current month is before or equal to fiscal year-end month, we're in current fiscal year
            if month > fiscal_year_end_month:
                fiscal_year = year + 1
            elif month < fiscal_year_end_month:
                fiscal_year = year
            else:  # month == fiscal_year_end_month
                # Same month as fiscal year-end, fiscal year is current year
                fiscal_year = year
            
            return {
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'period_end_date': date_obj.strftime('%Y-%m-%d')
            }
        return None
    except:
        return None

def _extract_income_statement_fields(period, is_annual=False):
    """Extract income statement fields from a standardized period record"""
    income_statement_fields = {
        'revenues': 'Revenues',
        'cost_of_revenue': 'CostOfRevenue',
        'gross_profit': 'GrossProfit',
        'operating_expenses': 'OperatingExpenses',
        'operating_income': 'OperatingIncomeLoss',
        'pretax_income': 'IncomeLossFromContinuingOperationsBeforeIncomeTaxExpenseBenefit',
        'tax_expense': 'AllIncomeTaxExpenseBenefit',
        'continuing_operations_income': 'IncomeLossFromContinuingOperations',
        'discontinued_operations_income': 'IncomeLossFromDiscontinuedOperationsNetOfTax',
        'profit_loss': 'ProfitLoss',
        'noncontrolling_interest': 'NetIncomeLossAttributableToNoncontrollingInterest',
        'net_income': 'NetIncomeLoss',
        'outstanding_shares': 'OutstandingShares',
        'earnings_per_share': 'EarningsPerShare'
    }
    
    result = {}
    for field_name, column_name in income_statement_fields.items():
        if column_name in period and pd.notna(period[column_name]):
            value = period[column_name]
            if pd.notna(value) and value != 0:
                if field_name == 'earnings_per_share' and is_annual:
                    result[f'{field_name}_annual'] = float(value)
                else:
                    result[field_name] = float(value)
    
    return result

def _extract_balance_sheet_fields(period):
    """Extract balance sheet fields from a standardized period record"""
    balance_sheet_fields = {
        'cash': 'Cash',
        'current_assets': 'AssetsCurrent',
        'noncurrent_assets': 'AssetsNoncurrent',
        'total_assets': 'Assets',
        'current_liabilities': 'LiabilitiesCurrent',
        'noncurrent_liabilities': 'LiabilitiesNoncurrent',
        'total_liabilities': 'Liabilities',
        'retained_earnings': 'RetainedEarnings',
        'additional_paid_in_capital': 'AdditionalPaidInCapital',
        'treasury_stock': 'TreasuryStockValue',
        'stockholders_equity': 'HolderEquity',
        'redeemable_equity': 'RedeemableEquity',
        'temporary_equity': 'TemporaryEquity',
        'total_equity': 'Equity',
        'total_liabilities_and_equity': 'LiabilitiesAndEquity'
    }
    
    result = {}
    for field_name, column_name in balance_sheet_fields.items():
        if column_name in period and pd.notna(period[column_name]):
            value = period[column_name]
            if pd.notna(value) and value != 0:
                result[field_name] = float(value)
    
    return result

def _extract_cash_flow_fields(period):
    """Extract cash flow statement fields from a standardized period record"""
    cash_flow_fields = {
        'depreciation_amortization': 'DepreciationDepletionAndAmortization',
        'stock_based_compensation': 'ShareBasedCompensation',
        'deferred_income_tax': 'DeferredIncomeTaxExpenseBenefit',
        'accounts_payable_change': 'IncreaseDecreaseInAccountsPayable',
        'operating_cash_flow': 'NetCashProvidedByUsedInOperatingActivities',
        'operating_cash_flow_continuing': 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
        'operating_cash_flow_discontinued': 'CashProvidedByUsedInOperatingActivitiesDiscontinuedOperations',
        'capex': 'PaymentsToAcquirePropertyPlantAndEquipment',
        'acquisitions': 'PaymentsToAcquireBusinessesNetOfCashAcquired',
        'intangible_asset_purchases': 'PaymentsToAcquireIntangibleAssets',
        'investment_sales': 'ProceedsFromSaleOfInvestments',
        'investing_cash_flow': 'NetCashProvidedByUsedInInvestingActivities',
        'investing_cash_flow_continuing': 'NetCashProvidedByUsedInInvestingActivitiesContinuingOperations',
        'investing_cash_flow_discontinued': 'CashProvidedByUsedInInvestingActivitiesDiscontinuedOperations',
        'stock_issuance': 'ProceedsFromIssuanceOfCommonStock',
        'dividends_paid': 'PaymentsOfDividends',
        'stock_repurchase': 'PaymentsForRepurchaseOfCommonStock',
        'financing_cash_flow': 'NetCashProvidedByUsedInFinancingActivities',
        'financing_cash_flow_continuing': 'NetCashProvidedByUsedInFinancingActivitiesContinuingOperations',
        'financing_cash_flow_discontinued': 'CashProvidedByUsedInFinancingActivitiesDiscontinuedOperations',
        'net_cash_change': 'CashPeriodIncreaseDecreaseIncludingExRateEffectFinal',
        'exchange_rate_effect': 'EffectOfExchangeRateFinal',
        'cash_ending': 'CashAndCashEquivalentsEndOfPeriod',
        'income_taxes_paid': 'IncomeTaxesPaidNet',
        'interest_paid': 'InterestPaidNet'
    }
    
    result = {}
    for field_name, column_name in cash_flow_fields.items():
        if column_name in period and pd.notna(period[column_name]):
            value = period[column_name]
            if pd.notna(value) and value != 0:
                result[field_name] = float(value)
    
    return result

def _calculate_margins(income_statement: Dict) -> None:
    """Calculate margin percentages (modifies dict in-place)
    
    Args:
        income_statement: Income statement dict to add margin calculations to
    """
    if 'revenues' not in income_statement or income_statement['revenues'] <= 0:
        return
    
    revenue = income_statement['revenues']
    
    if 'gross_profit' in income_statement and 'gross_margin_percent' not in income_statement:
        income_statement['gross_margin_percent'] = round(income_statement['gross_profit'] / revenue * 100, 2)
    if 'operating_income' in income_statement and 'operating_margin_percent' not in income_statement:
        income_statement['operating_margin_percent'] = round(income_statement['operating_income'] / revenue * 100, 2)
    if 'net_income' in income_statement and 'net_margin_percent' not in income_statement:
        income_statement['net_margin_percent'] = round(income_statement['net_income'] / revenue * 100, 2)


def _generate_aggregated_annual_from_quarterly(quarterly_data, existing_annual_data):
    """Generate aggregated annual data for years where we don't have official annual reports"""
    # Get years that already have official annual data
    existing_annual_years = {annual['fiscal_year'] for annual in existing_annual_data}
    
    # Group quarterly data by fiscal year
    quarterly_by_year = {}
    for quarter in quarterly_data:
        fiscal_year = quarter['fiscal_year']
        if fiscal_year not in quarterly_by_year:
            quarterly_by_year[fiscal_year] = []
        quarterly_by_year[fiscal_year].append(quarter)
    
    aggregated_annual = []
    
    # For each year with 4 quarters but no annual data, create aggregated annual
    for fiscal_year, quarters in quarterly_by_year.items():
        # Skip if we already have official annual data for this year
        if fiscal_year in existing_annual_years:
            continue
        
    # For each year with 3+ quarters but no separate annual data, create aggregated annual
    for fiscal_year, quarters in quarterly_by_year.items():
        annual_key = f"{fiscal_year}_ANNUAL"
        
        # Skip if we already have official annual data for this year
        if fiscal_year in existing_annual_years:
            continue
        
        # Aggregate if we have at least 3 quarters (common case: Q1, Q2, Q4 with Q3 in annual)
        if len(quarters) >= 3:
            # Sort quarters to ensure proper order
            quarters_sorted = sorted(quarters, key=lambda x: x['fiscal_quarter'])
            
            # Initialize annual data structure
            annual_data = {
                'quarter_key': f"{fiscal_year}_ANNUAL",
                'fiscal_year': fiscal_year,
                'fiscal_quarter': 4,  # Annual data maps to Q4
                'period_end_date': f"{fiscal_year}-12-31",
                'accession_number': 'AGGREGATED',
                'data_source': f'sec_is_aggregated_annual_{len(quarters)}q',
                'qtrs': 4,
                'is_annual': True,
                'aggregated_from_quarters': [q['quarter_key'] for q in quarters_sorted],
                'income_statement': {}
            }
            
            # Aggregate financial metrics
            aggregatable_fields = [
                'revenues', 'cost_of_revenue', 'gross_profit', 'operating_expenses', 
                'operating_income', 'pretax_income', 'tax_expense', 'net_income'
            ]
            
            for field in aggregatable_fields:
                total = 0
                count = 0
                for quarter in quarters_sorted:
                    income_stmt = quarter.get('income_statement', {})
                    if field in income_stmt and income_stmt[field] is not None:
                        total += income_stmt[field]
                        count += 1
                
                if count > 0:
                    annual_data['income_statement'][field] = total
            
            # Aggregate EPS (sum of quarterly EPS)
            annual_eps = 0
            eps_count = 0
            for quarter in quarters_sorted:
                income_stmt = quarter.get('income_statement', {})
                if 'earnings_per_share' in income_stmt and income_stmt['earnings_per_share'] is not None:
                    annual_eps += income_stmt['earnings_per_share']
                    eps_count += 1
            
            if eps_count > 0:
                annual_data['income_statement']['earnings_per_share_annual'] = annual_eps
            
            # Calculate derived metrics for aggregated data
            income_stmt = annual_data['income_statement']
            if 'revenues' in income_stmt and income_stmt['revenues'] > 0:
                revenue = income_stmt['revenues']
                
                # Margins
                if 'gross_profit' in income_stmt:
                    income_stmt['gross_margin_percent'] = round(income_stmt['gross_profit'] / revenue * 100, 2)
                if 'operating_income' in income_stmt:
                    income_stmt['operating_margin_percent'] = round(income_stmt['operating_income'] / revenue * 100, 2)
                if 'net_income' in income_stmt:
                    income_stmt['net_margin_percent'] = round(income_stmt['net_income'] / revenue * 100, 2)
            
            aggregated_annual.append(annual_data)
    
    return aggregated_annual

def extract_sec_financials(
    ticker: str,
    fiscal_year: int,
    fiscal_quarter: int,
    verbose: bool = False,
    cache_dir: str = './sec_data_cache',
    cached_data: Optional[Dict] = None
) -> Dict:
    """Extract financial data for a specific quarter from SEC filings
    
    Args:
        ticker: Stock ticker symbol
        fiscal_year: Fiscal year to extract (e.g., 2024)
        fiscal_quarter: Fiscal quarter 1-4
        verbose: Verbose output
        cache_dir: Directory containing cached SEC data
        cached_data: Pre-loaded SEC data (optional, for performance when calling multiple times)
        
    Returns:
        Dict containing single quarter financial data with keys:
        - ticker: Stock ticker
        - cik: Central Index Key
        - data: Quarter financial data dictionary
    """
    return _extract_single_ticker_data(ticker, fiscal_year, fiscal_quarter, verbose, cache_dir, cached_data)

def _extract_single_ticker_data(
    ticker: str,
    fiscal_year: int,
    fiscal_quarter: int,
    verbose: bool = False,
    cache_dir: str = './sec_data_cache',
    cached_data: Optional[Dict] = None
) -> Dict:
    """Extract data for a single ticker quarter (internal function)
    
    Core extraction logic - processes all data then returns requested quarter.
    Justification for processing all data:
    - Q4 derivation requires annual and Q3 cumulative data
    - Margin calculations need complete income statement
    """
    
    # Load and standardize data
    cik, is_df, bs_df, cf_df, fiscal_year_end = _load_and_standardize_data(
        ticker, cache_dir, verbose, fiscal_year, fiscal_quarter, cached_data
    )
    if cik is None:
        return {'error': f"Failed to load data for {ticker}"}
    
    # Process each statement type
    # IMPORTANT: Different statements are reported differently in SEC filings:
    # 
    # 1. INCOME STATEMENTS:
    #    - Q1, Q2, Q3: Available as individual quarters (qtrs=1)
    #    - Q4: NOT reported separately, must derive from Annual - Q3_cumulative
    #    - We use qtrs=1 for Q1-Q3 to get clean individual quarter data
    #
    # 2. BALANCE SHEETS:
    #    - Point-in-time snapshots (qtrs=0)
    #    - Match to quarters by exact period end date
    #    - Many companies only file balance sheets at fiscal year-end (Q4)
    #
    # 3. CASH FLOW STATEMENTS:
    #    - Q1: Individual quarter (qtrs=1)
    #    - Q2: Cumulative Q1+Q2 (qtrs=2) - must derive individual Q2 = Q2_cumulative - Q1
    #    - Q3: Cumulative Q1+Q2+Q3 (qtrs=3) - must derive individual Q3 = Q3_cumulative - Q2_cumulative
    #    - Q4: Must derive from Annual - Q3_cumulative
    #
    quarters, cumulative_data, annual_data_records = _process_income_statements(is_df, fiscal_year_end, verbose)
    _process_balance_sheets(bs_df, quarters, cumulative_data, annual_data_records, fiscal_year_end, verbose)
    _process_cash_flows(cf_df, quarters, cumulative_data, annual_data_records, fiscal_year_end, verbose)
    
    # Derive Q4 quarters (for both income statement and cash flow)
    _derive_q4_quarters(quarters, cumulative_data, annual_data_records)
    
    # Derive individual cash flow values from cumulative (Q2 and Q3)
    _derive_individual_cash_flows(quarters, verbose)
    
    for quarter_data in quarters.values():
        _calculate_margins(quarter_data['income_statement'])
    
    # Convert to sorted list and filter for non-annual quarters
    quarters_list = sorted(quarters.values(), key=lambda x: (x['fiscal_year'], x['fiscal_quarter']))
    quarterly_data = [q for q in quarters_list if not q.get('is_annual', False)]
    
    # Return specific quarter
    for q in quarterly_data:
        if q['fiscal_year'] == fiscal_year and q['fiscal_quarter'] == fiscal_quarter:
            return {
                'ticker': ticker,
                'cik': cik,
                'data': q
            }
    
    return {'error': f"Quarter {fiscal_year}Q{fiscal_quarter} not found for {ticker}"}

# Backward compatibility alias
extract_income_statement = extract_sec_financials


def _load_and_standardize_data(ticker: str, cache_dir: str, verbose: bool = False, 
                              target_fiscal_year: int = None, target_fiscal_quarter: int = None,
                              cached_data: Optional[Dict] = None):
    """Load cached SEC data and run standardizers
    
    Args:
        ticker: Stock ticker symbol
        cache_dir: Directory containing cached SEC data
        verbose: Verbose output
        target_fiscal_year: If specified, only process data needed for this year
        target_fiscal_quarter: If specified, only process data needed for this quarter
        cached_data: Pre-loaded SEC data (optional, for performance when calling multiple times)
    
    Returns:
        Tuple of (cik, is_standardized_df, bs_standardized_df, cf_standardized_df, fiscal_year_end)
        or (None, None, None, None, None) on error
    """
    global _sec_data_cache, _ticker_data_cache
    
    # Load cached SEC data if not provided
    if cached_data is None:
        # Use module-level cache
        if _sec_data_cache is None:
            if verbose:
                print(f"Loading cached SEC data for {ticker}...")
            _sec_data_cache = load_cached_data(cache_dir, verbose=False)  # Always suppress load messages
        cached_data = _sec_data_cache
        
    if not cached_data:
        return None, None, None, None, None
    
    # Check ticker-level cache
    cache_key = ticker.upper()
    if cache_key in _ticker_data_cache:
        ticker_data = _ticker_data_cache[cache_key]
    else:
        # Filter for this ticker and cache it (suppress filter messages)
        ticker_data = filter_by_ticker(cached_data, ticker, verbose=False)
        if not ticker_data:
            return None, None, None, None, None
        _ticker_data_cache[cache_key] = ticker_data
    
    # Get CIK for reference (using singleton to avoid reloading)
    cik_service = _get_cik_service()
    cik = cik_service.get_cik_by_ticker(ticker)
    
    # Merge dataframes for standardizer
    num_df = ticker_data['num_df']
    pre_df = ticker_data['pre_df']
    merged_df = num_df.merge(pre_df[['adsh', 'tag', 'report', 'line', 'negating']], 
                           on=['adsh', 'tag'], how='left')
    
    if verbose:
        print(f"Found {len(merged_df)} data points before standardization")
    
    # Detect fiscal year-end first (needed for filtering)
    # Use a quick pass on qtrs=4 records to detect fiscal year-end
    annual_records = merged_df[merged_df['qtrs'] == 4]
    fiscal_year_end = None
    if len(annual_records) > 0:
        first_annual_date = int(annual_records.iloc[0]['ddate'])
        date_str = str(first_annual_date)
        fiscal_year_end = (int(date_str[4:6]), int(date_str[6:8]))
    if not fiscal_year_end:
        fiscal_year_end = (12, 31)  # Default to calendar year
    
    if verbose:
        print(f"Detected fiscal year-end: {fiscal_year_end[0]:02d}-{fiscal_year_end[1]:02d}")
    
    # If target quarter specified, filter to only relevant periods using fiscal calendar
    if target_fiscal_year and target_fiscal_quarter:
        # Filter by fiscal year/quarter using detected fiscal year-end
        # This function handles all the logic for which qtrs values to include
        # based on how different statement types are reported in SEC filings
        def matches_target_period(row):
            fiscal_info = parse_date_with_fiscal_year_end(
                row['ddate'], fiscal_year_end[0], fiscal_year_end[1]
            )
            if not fiscal_info:
                return False
            
            # Balance sheets (qtrs=0) - keep those matching the target period end date
            if row['qtrs'] == 0:
                # For any quarter, keep balance sheets from that fiscal year/quarter
                return (fiscal_info['fiscal_year'] == target_fiscal_year and 
                       fiscal_info['fiscal_quarter'] == target_fiscal_quarter)
            
            # For Q1, Q2, Q3: use qtrs=1 for income statement (individual quarter data)
            # Also need qtrs=2 for Q2 cash flow, qtrs=3 for Q3 cash flow
            # Cash flow derivation needs previous quarters: Q2 needs Q1, Q3 needs Q1+Q2
            if target_fiscal_quarter in [1, 2, 3]:
                if row['qtrs'] == 1:
                    # For Q2: need Q1 and Q2 for cash flow derivation
                    if target_fiscal_quarter == 2:
                        return (fiscal_info['fiscal_year'] == target_fiscal_year and 
                               fiscal_info['fiscal_quarter'] in [1, 2])
                    # For Q3: need Q1, Q2, Q3 for cash flow derivation
                    elif target_fiscal_quarter == 3:
                        return (fiscal_info['fiscal_year'] == target_fiscal_year and 
                               fiscal_info['fiscal_quarter'] in [1, 2, 3])
                    # For Q1: just need Q1
                    else:
                        return (fiscal_info['fiscal_year'] == target_fiscal_year and 
                               fiscal_info['fiscal_quarter'] == 1)
                # Q2 needs qtrs=2 for cash flow (cumulative)
                if target_fiscal_quarter == 2 and row['qtrs'] == 2:
                    return (fiscal_info['fiscal_year'] == target_fiscal_year and 
                           fiscal_info['fiscal_quarter'] == 2)
                # Q3 needs qtrs=2 (Q2 cumulative for derivation) AND qtrs=3 for Q3 cash flow
                if target_fiscal_quarter == 3 and row['qtrs'] == 2:
                    return (fiscal_info['fiscal_year'] == target_fiscal_year and 
                           fiscal_info['fiscal_quarter'] == 2)
                if target_fiscal_quarter == 3 and row['qtrs'] == 3:
                    return (fiscal_info['fiscal_year'] == target_fiscal_year and 
                           fiscal_info['fiscal_quarter'] == 3)
            
            # For Q4: need qtrs=3 (Q1+Q2+Q3 cumulative) and qtrs=4 (annual) to derive Q4
            elif target_fiscal_quarter == 4:
                if row['qtrs'] == 3:
                    return (fiscal_info['fiscal_year'] == target_fiscal_year and 
                           fiscal_info['fiscal_quarter'] == 3)
                elif row['qtrs'] == 4:
                    return (fiscal_info['fiscal_year'] == target_fiscal_year and 
                           fiscal_info['fiscal_quarter'] == 4)
            
            return False
        
        merged_df = merged_df[merged_df.apply(matches_target_period, axis=1)].copy()
        
        if verbose:
            print(f"Filtered to {len(merged_df)} data points for target {target_fiscal_year}Q{target_fiscal_quarter}")
            if len(merged_df) > 0:
                qtrs_counts = merged_df['qtrs'].value_counts().to_dict()
                print(f"  qtrs distribution: {qtrs_counts}")
    
    # WORKAROUND for secfsdstools bug: Process each period separately to prevent
    # standardizer from picking comparative periods instead of main periods
    # Split by (ddate, qtrs) combinations and standardize each separately
    unique_periods = merged_df.groupby(['ddate', 'qtrs']).size().reset_index()[['ddate', 'qtrs']]
    
    if verbose:
        print(f"Processing {len(unique_periods)} unique periods separately to avoid standardizer bug")
    
    # Create standardizers once (reuse instances for performance)
    is_standardizer = IncomeStatementStandardizer()
    bs_standardizer = BalanceSheetStandardizer()
    cf_standardizer = CashFlowStandardizer()
    
    is_results = []
    bs_results = []
    cf_results = []
    
    for _, period in unique_periods.iterrows():
        ddate = period['ddate']
        qtrs = period['qtrs']
        
        # Filter to this specific period
        period_data = merged_df[(merged_df['ddate'] == ddate) & (merged_df['qtrs'] == qtrs)].copy()
        
        if verbose:
            print(f"  Processing period ddate={ddate}, qtrs={qtrs}, rows={len(period_data)}")
        
        if len(period_data) == 0:
            continue
        
        # Standardize income statement
        try:
            is_standardizer.process(period_data.copy())
            if len(is_standardizer.result) > 0:
                result_copy = is_standardizer.result.copy()
                if verbose:
                    print(f"    IS result: {len(result_copy)} rows, qtrs values: {result_copy['qtrs'].unique()}")
                is_results.append(result_copy)
        except Exception:
            pass  # Skip periods that fail standardization
        
        # Standardize balance sheet
        try:
            bs_standardizer.process(period_data.copy())
            if len(bs_standardizer.result) > 0:
                bs_results.append(bs_standardizer.result.copy())
        except Exception:
            pass
        
        # Standardize cash flow
        try:
            cf_standardizer.process(period_data.copy())
            if len(cf_standardizer.result) > 0:
                cf_results.append(cf_standardizer.result.copy())
        except Exception:
            pass
    
    # Combine results
    import pandas as pd
    is_standardized_df = pd.concat(is_results, ignore_index=True) if is_results else pd.DataFrame()
    bs_standardized_df = pd.concat(bs_results, ignore_index=True) if bs_results else pd.DataFrame()
    cf_standardized_df = pd.concat(cf_results, ignore_index=True) if cf_results else pd.DataFrame()
    
    if verbose and len(is_standardized_df) > 0:
        print(f"Before deduplication: {len(is_standardized_df)} income statements")
        print(f"  Unique (ddate, qtrs) combinations: {is_standardized_df[['ddate', 'qtrs']].drop_duplicates().to_dict('records')}")
    
    # Deduplicate: Multiple filings can have same (ddate, qtrs) due to amendments/restatements
    # Keep the latest filing (largest adsh = most recent accession number) for each (ddate, qtrs)
    if len(is_standardized_df) > 0:
        is_standardized_df = is_standardized_df.sort_values('adsh', ascending=False).drop_duplicates(subset=['ddate', 'qtrs'], keep='first')
    if len(bs_standardized_df) > 0:
        bs_standardized_df = bs_standardized_df.sort_values('adsh', ascending=False).drop_duplicates(subset=['ddate', 'qtrs'], keep='first')
    if len(cf_standardized_df) > 0:
        cf_standardized_df = cf_standardized_df.sort_values('adsh', ascending=False).drop_duplicates(subset=['ddate', 'qtrs'], keep='first')
    
    if verbose:
        print(f"Standardized to {len(is_standardized_df)} income statement periods (after deduplication)")
        print(f"Standardized to {len(bs_standardized_df)} balance sheet periods (after deduplication)")
        print(f"Standardized to {len(cf_standardized_df)} cash flow periods (after deduplication)")
    
    return cik, is_standardized_df, bs_standardized_df, cf_standardized_df, fiscal_year_end


def _process_income_statements(is_standardized_df, fiscal_year_end, verbose: bool = False):
    """Process income statement data into quarters, cumulative, and annual records
    
    Income statements can be individual (qtrs=1) or cumulative (qtrs=2,3,4).
    For cumulative data where no individual quarter exists, we store cumulative as-is.
    
    Returns:
        Tuple of (quarters, cumulative_data, annual_data_records)
    """
    fiscal_year_end_month, fiscal_year_end_day = fiscal_year_end
    quarters = {}
    cumulative_data = {}
    annual_data_records = {}
    
    for _, period in is_standardized_df.iterrows():
        try:
            fiscal_info = parse_date_with_fiscal_year_end(
                period['ddate'], fiscal_year_end_month, fiscal_year_end_day
            )
            if not fiscal_info:
                continue
            
            qtrs = int(period['qtrs'])
            fiscal_year = fiscal_info['fiscal_year']
            fiscal_quarter = fiscal_info['fiscal_quarter']
            
            if qtrs == 1:
                # Individual quarter
                quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
                if quarter_key not in quarters:
                    quarters[quarter_key] = {
                        'quarter_key': quarter_key,
                        'fiscal_year': fiscal_year,
                        'fiscal_quarter': fiscal_quarter,
                        'period_end_date': fiscal_info['period_end_date'],
                        'accession_number': period.get('adsh', ''),
                        'data_source': 'sec_is_standardized_quarterly',
                        'qtrs': qtrs,
                        'is_annual': False,
                        'income_statement': {},
                        'balance_sheet': {},
                        'cash_flow_statement': {}
                    }
                quarters[quarter_key]['income_statement'] = _extract_income_statement_fields(period, is_annual=False)
            
            elif qtrs == 2 and fiscal_quarter == 2:
                # Q2 cumulative data - skip it, we use qtrs=1 for individual Q2
                if verbose:
                    print(f"   ⏭️  Skipping Q2 cumulative (qtrs=2) for {fiscal_year}Q2 - using qtrs=1 for individual quarter")
                
            elif qtrs == 3 and fiscal_quarter == 3:
                # Q3 cumulative data - only store for Q4 derivation, don't create Q3 quarter
                # (we use qtrs=1 for individual Q3)
                cumulative_key = f"{fiscal_year}_Q3_CUMULATIVE"
                cumulative_data[cumulative_key] = {
                    'fiscal_year': fiscal_year,
                    'period_end_date': fiscal_info['period_end_date'],
                    'income_statement': _extract_income_statement_fields(period, is_annual=False),
                    'balance_sheet': {},
                    'cash_flow_statement': {}
                }
                
                if verbose:
                    print(f"   📊 Stored Q3 cumulative (qtrs=3) for {fiscal_year}Q3 (for Q4 derivation only)")
                
            elif qtrs == 4:
                # Annual report
                annual_key = f"{fiscal_year}_ANNUAL"
                annual_data_records[annual_key] = {
                    'quarter_key': annual_key,
                    'fiscal_year': fiscal_year,
                    'fiscal_quarter': 4,
                    'period_end_date': fiscal_info['period_end_date'],
                    'accession_number': period.get('adsh', ''),
                    'data_source': 'sec_is_standardized_annual',
                    'qtrs': qtrs,
                    'is_annual': True,
                    'income_statement': _extract_income_statement_fields(period, is_annual=True),
                    'balance_sheet': {},
                    'cash_flow_statement': {}
                }
                
        except Exception as e:
            if verbose:
                print(f"Error processing income statement period: {e}")
            continue
    
    return quarters, cumulative_data, annual_data_records


def _process_balance_sheets(bs_standardized_df, quarters, cumulative_data, annual_data_records, fiscal_year_end, verbose: bool = False):
    """Process balance sheet data and add to existing records
    
    Balance sheets are point-in-time snapshots (qtrs=0). Many companies only file
    balance sheets at fiscal year-end (Q4), so Q1-Q3 balance sheets may be empty.
    We match balance sheets to quarters by exact period end date.
    """
    fiscal_year_end_month, fiscal_year_end_day = fiscal_year_end
    
    matched_count = 0
    for _, period in bs_standardized_df.iterrows():
        try:
            fiscal_info = parse_date_with_fiscal_year_end(
                period['ddate'], fiscal_year_end_month, fiscal_year_end_day
            )
            if not fiscal_info:
                continue
            
            fiscal_year = fiscal_info['fiscal_year']
            fiscal_quarter = fiscal_info['fiscal_quarter']
            period_end_date = fiscal_info['period_end_date']
            
            # Match balance sheet to quarters by exact date match
            quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
            if quarter_key in quarters and quarters[quarter_key]['period_end_date'] == period_end_date:
                quarters[quarter_key]['balance_sheet'] = _extract_balance_sheet_fields(period)
                matched_count += 1
            
            # Also add to annual data if it's fiscal year-end (Q4)
            if fiscal_quarter == 4:
                annual_key = f"{fiscal_year}_ANNUAL"
                if annual_key in annual_data_records and annual_data_records[annual_key]['period_end_date'] == period_end_date:
                    annual_data_records[annual_key]['balance_sheet'] = _extract_balance_sheet_fields(period)
                
                # Also add to Q3 cumulative for proper Q4 derivation
                cumulative_key = f"{fiscal_year}_Q3_CUMULATIVE"
                if cumulative_key in cumulative_data:
                    cumulative_data[cumulative_key]['balance_sheet'] = _extract_balance_sheet_fields(period)
        
        except Exception as e:
            if verbose:
                print(f"Error processing balance sheet period: {e}")
            continue
    
    if verbose:
        print(f"Matched {matched_count} balance sheet periods (Note: companies often only file balance sheets at fiscal year-end)")


def _process_cash_flows(cf_standardized_df, quarters, cumulative_data, annual_data_records, fiscal_year_end, verbose: bool = False):
    """Process cash flow data and add to existing records
    
    Cash flow statements are reported cumulatively:
    - Q1: qtrs=1 (just Q1)
    - Q2: qtrs=2 (Q1+Q2 cumulative)
    - Q3: qtrs=3 (Q1+Q2+Q3 cumulative)
    - Q4: qtrs=4 (annual, all 4 quarters)
    
    We save the cumulative values as-is without deriving individual quarters.
    """
    fiscal_year_end_month, fiscal_year_end_day = fiscal_year_end
    
    for _, period in cf_standardized_df.iterrows():
        try:
            fiscal_info = parse_date_with_fiscal_year_end(
                period['ddate'], fiscal_year_end_month, fiscal_year_end_day
            )
            if not fiscal_info:
                continue
            
            qtrs = int(period['qtrs'])
            fiscal_year = fiscal_info['fiscal_year']
            fiscal_quarter = fiscal_info['fiscal_quarter']
            
            # For qtrs=1, match to the specific quarter
            if qtrs == 1:
                quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
                if quarter_key in quarters:
                    quarters[quarter_key]['cash_flow_statement'] = _extract_cash_flow_fields(period)
            
            # For qtrs=2 (Q1+Q2 cumulative) - match to Q2 quarter (will need to derive individual later)
            elif qtrs == 2 and fiscal_quarter == 2:
                quarter_key = f"{fiscal_year}Q2"
                if quarter_key in quarters:
                    cf_fields = _extract_cash_flow_fields(period)
                    # Mark as cumulative so we know to derive individual values
                    quarters[quarter_key]['cash_flow_statement'] = cf_fields
                    quarters[quarter_key]['cash_flow_is_cumulative'] = True
            
            # For qtrs=3 (Q1+Q2+Q3 cumulative) - match to Q3 AND store for Q4 derivation
            elif qtrs == 3 and fiscal_quarter == 3:
                quarter_key = f"{fiscal_year}Q3"
                if quarter_key in quarters:
                    cf_fields = _extract_cash_flow_fields(period)
                    # Mark as cumulative so we know to derive individual values
                    quarters[quarter_key]['cash_flow_statement'] = cf_fields
                    quarters[quarter_key]['cash_flow_is_cumulative'] = True
                
                # Also store in cumulative_data for Q4 derivation
                cumulative_key = f"{fiscal_year}_Q3_CUMULATIVE"
                if cumulative_key in cumulative_data:
                    cumulative_data[cumulative_key]['cash_flow_statement'] = _extract_cash_flow_fields(period)
                
                if verbose:
                    print(f"   📊 Stored Q3 cumulative cash flow (qtrs=3) for Q4 derivation")
            
            # For qtrs=4 (annual), save to annual data
            elif qtrs == 4:
                annual_key = f"{fiscal_year}_ANNUAL"
                if annual_key in annual_data_records:
                    annual_data_records[annual_key]['cash_flow_statement'] = _extract_cash_flow_fields(period)
                
        except Exception as e:
            if verbose:
                print(f"Error processing cash flow period: {e}")
            continue


def _derive_q4_quarters(quarters, cumulative_data, annual_data_records):
    """Derive Q4 quarters from annual minus Q3 cumulative data"""
    for annual_key, annual_record in annual_data_records.items():
        fiscal_year = annual_record['fiscal_year']
        cumulative_key = f"{fiscal_year}_Q3_CUMULATIVE"
        
        if cumulative_key not in cumulative_data:
            continue
        
        # Calculate Q4 = Annual - Q3_cumulative
        q4_key = f"{fiscal_year}Q4"
        cumulative_stmt = cumulative_data[cumulative_key]['income_statement']
        annual_stmt = annual_record['income_statement']
        cumulative_cf = cumulative_data[cumulative_key]['cash_flow_statement']
        annual_cf = annual_record['cash_flow_statement']
        
        q4_stmt = {}
        
        # Derive Q4 EPS by subtracting Q3 cumulative from annual
        # Try both 'earnings_per_share_annual' and 'earnings_per_share' fields
        annual_eps = annual_stmt.get('earnings_per_share_annual') or annual_stmt.get('earnings_per_share')
        q3_cumulative_eps = cumulative_stmt.get('earnings_per_share')
        
        if annual_eps is not None and q3_cumulative_eps is not None:
            # Q4 EPS = Annual EPS - Q3_cumulative EPS (where Q3_cumulative = Q1+Q2+Q3)
            q4_stmt['earnings_per_share'] = annual_eps - q3_cumulative_eps
        
        # Calculate Q4 for other income statement fields
        for field in annual_stmt.keys():
            if field.endswith('_percent') or field.endswith('_annual') or field == 'earnings_per_share_annual':
                continue
            
            # Outstanding shares is a point-in-time value, use annual value directly
            if field == 'outstanding_shares':
                if annual_stmt.get(field) is not None:
                    q4_stmt[field] = annual_stmt[field]
                continue
            
            annual_value = annual_stmt.get(field)
            cumulative_value = cumulative_stmt.get(field)
            if annual_value is not None and cumulative_value is not None:
                q4_stmt[field] = annual_value - cumulative_value
        
        # Calculate Q4 cash flow
        q4_cf = {}
        for field in annual_cf.keys():
            annual_value = annual_cf.get(field)
            cumulative_value = cumulative_cf.get(field)
            if annual_value is not None and cumulative_value is not None:
                q4_cf[field] = annual_value - cumulative_value
        
        # Balance sheet is point-in-time (Q4 BS = Annual BS)
        q4_bs = annual_record['balance_sheet'].copy()
        
        # Only create Q4 if we have meaningful data
        if q4_stmt:
            quarters[q4_key] = {
                'quarter_key': q4_key,
                'fiscal_year': fiscal_year,
                'fiscal_quarter': 4,
                'period_end_date': annual_record['period_end_date'],
                'accession_number': annual_record['accession_number'],
                'data_source': 'sec_is_derived_q4',
                'qtrs': 1,
                'is_annual': False,
                'derived_from': 'annual_minus_q3_cumulative',
                'income_statement': q4_stmt,
                'balance_sheet': q4_bs,
                'cash_flow_statement': q4_cf
            }
            _calculate_margins(q4_stmt)


def _derive_individual_cash_flows(quarters, verbose: bool = False):
    """Derive individual cash flow values from cumulative data for Q2 and Q3
    
    SEC reports cash flow statements cumulatively:
    - Q1: qtrs=1 (individual Q1 values)
    - Q2: qtrs=2 (Q1+Q2 cumulative)
    - Q3: qtrs=3 (Q1+Q2+Q3 cumulative)
    
    We derive individual quarters by subtraction:
    - Individual Q2 = Q2_cumulative - Q1
    - Individual Q3 = Q3_cumulative - Q2_cumulative
    """
    if verbose:
        print("Deriving individual cash flow values from cumulative data...")
    
    # Group quarters by fiscal year
    quarters_by_year = {}
    for quarter_key, quarter_data in quarters.items():
        if quarter_data.get('is_annual'):
            continue
        fiscal_year = quarter_data['fiscal_year']
        if fiscal_year not in quarters_by_year:
            quarters_by_year[fiscal_year] = {}
        quarters_by_year[fiscal_year][quarter_data['fiscal_quarter']] = quarter_key
    
    # Process each fiscal year
    for fiscal_year, year_quarters in quarters_by_year.items():
        if verbose:
            print(f"  Processing fiscal year {fiscal_year}, quarters: {list(year_quarters.keys())}")
        
        # Store Q2_cumulative for Q3 derivation (before we overwrite it)
        q2_cumulative_stored = None
        
        # Derive Q2 cash flow if we have Q1 and Q2 (and Q2 is marked as cumulative)
        if 1 in year_quarters and 2 in year_quarters:
            q1_key = year_quarters[1]
            q2_key = year_quarters[2]
            
            q1_data = quarters[q1_key]
            q2_data = quarters[q2_key]
            
            # Check if Q2 cash flow is cumulative
            if q2_data.get('cash_flow_is_cumulative'):
                q1_cf = q1_data.get('cash_flow_statement', {})
                q2_cumulative_cf = q2_data['cash_flow_statement']
                
                # Store Q2_cumulative for Q3 derivation (actual SEC value)
                q2_cumulative_stored = dict(q2_cumulative_cf)
                
                # Derive individual Q2 = Q2_cumulative - Q1
                q2_individual_cf = {}
                for field, cumulative_value in q2_cumulative_cf.items():
                    q1_value = q1_cf.get(field, 0)
                    q2_individual_cf[field] = cumulative_value - q1_value
                
                # Update Q2 with individual cash flow values
                quarters[q2_key]['cash_flow_statement'] = q2_individual_cf
                del quarters[q2_key]['cash_flow_is_cumulative']
        
        # Derive Q3 cash flow if we have Q2 and Q3 (and Q3 is marked as cumulative)
        if 2 in year_quarters and 3 in year_quarters:
            q2_key = year_quarters[2]
            q3_key = year_quarters[3]
            
            q2_data = quarters[q2_key]
            q3_data = quarters[q3_key]
            
            # Check if Q3 cash flow is cumulative
            if q3_data.get('cash_flow_is_cumulative'):
                # Use the stored Q2_cumulative from SEC (not reconstructed from Q1+Q2_derived)
                if q2_cumulative_stored is not None:
                    q2_cumulative_cf = q2_cumulative_stored
                elif 1 in year_quarters:
                    # Fallback: reconstruct from Q1 + Q2 individual (if Q2 wasn't cumulative)
                    q1_cf = quarters[year_quarters[1]].get('cash_flow_statement', {})
                    q2_individual_cf = q2_data.get('cash_flow_statement', {})
                    
                    q2_cumulative_cf = {}
                    for field in set(list(q1_cf.keys()) + list(q2_individual_cf.keys())):
                        q1_value = q1_cf.get(field, 0)
                        q2_value = q2_individual_cf.get(field, 0)
                        q2_cumulative_cf[field] = q1_value + q2_value
                else:
                    # No Q1, use Q2 as-is
                    q2_cumulative_cf = q2_data.get('cash_flow_statement', {})
                
                # Derive individual Q3 = Q3_cumulative - Q2_cumulative
                q3_cumulative_cf = q3_data['cash_flow_statement']
                
                q3_individual_cf = {}
                for field, cumulative_value in q3_cumulative_cf.items():
                    q2_cum_value = q2_cumulative_cf.get(field, 0)
                    q3_individual_cf[field] = cumulative_value - q2_cum_value
                
                # Update Q3 with individual cash flow values
                quarters[q3_key]['cash_flow_statement'] = q3_individual_cf
                del quarters[q3_key]['cash_flow_is_cumulative']


def _derive_individual_quarters_from_cumulative(quarters, cumulative_data):
    """Derive individual Q2 and Q3 quarters from cumulative data
    
    SEC reports Q2 and Q3 as cumulative (year-to-date):
    - Q2 filing contains Q1+Q2 cumulative
    - Q3 filing contains Q1+Q2+Q3 cumulative
    
    We derive individual quarters by subtraction:
    - Individual Q2 = Q2_cumulative - Q1
    - Individual Q3 = Q3_cumulative - Q2_cumulative
    """
    # Group quarters by fiscal year
    quarters_by_year = {}
    for quarter_key, quarter_data in quarters.items():
        if quarter_data.get('is_annual'):
            continue
        fiscal_year = quarter_data['fiscal_year']
        if fiscal_year not in quarters_by_year:
            quarters_by_year[fiscal_year] = {}
        quarters_by_year[fiscal_year][quarter_data['fiscal_quarter']] = quarter_key
    
    # Process each fiscal year
    for fiscal_year, year_quarters in quarters_by_year.items():
        # Derive Q2 if we have Q1 and cumulative Q2 data
        if 1 in year_quarters and 2 in year_quarters:
            q1_key = year_quarters[1]
            q2_key = year_quarters[2]
            
            q1_data = quarters[q1_key]
            q2_data = quarters[q2_key]
            
            # Check if Q2 is cumulative (qtrs=2 or has is_cumulative flag)
            if q2_data.get('qtrs') == 2 or q2_data.get('is_cumulative'):
                # Derive individual Q2 = Q2_cumulative - Q1
                q2_cumulative_stmt = q2_data['income_statement'].copy()
                q1_stmt = q1_data['income_statement']
                
                q2_individual_stmt = {}
                for field, cumulative_value in q2_cumulative_stmt.items():
                    if field.endswith('_percent') or field.endswith('_annual'):
                        continue
                    q1_value = q1_stmt.get(field)
                    if q1_value is not None:
                        q2_individual_stmt[field] = cumulative_value - q1_value
                    else:
                        q2_individual_stmt[field] = cumulative_value
                
                # Update Q2 with individual values
                quarters[q2_key]['income_statement'] = q2_individual_stmt
                quarters[q2_key]['data_source'] = 'sec_is_derived_q2_individual'
                quarters[q2_key]['derived_from'] = 'q2_cumulative_minus_q1'
                quarters[q2_key]['qtrs'] = 1
                if 'is_cumulative' in quarters[q2_key]:
                    del quarters[q2_key]['is_cumulative']
        
        # Derive Q3 if we have Q2 and cumulative Q3 data
        if 2 in year_quarters and 3 in year_quarters:
            q2_key = year_quarters[2]
            q3_key = year_quarters[3]
            
            q2_data = quarters[q2_key]
            q3_data = quarters[q3_key]
            
            # Check if Q3 is cumulative (qtrs=3 or has is_cumulative flag)
            if q3_data.get('qtrs') == 3 or q3_data.get('is_cumulative'):
                # Get Q2 cumulative from cumulative_data if available, otherwise use Q2 individual
                q2_cumulative_key = f"{fiscal_year}_Q2_CUMULATIVE"
                if q2_cumulative_key in cumulative_data:
                    q2_cumulative_stmt = cumulative_data[q2_cumulative_key]['income_statement']
                else:
                    # Reconstruct Q2 cumulative from Q1 + Q2 individual
                    if 1 in year_quarters:
                        q1_stmt = quarters[year_quarters[1]]['income_statement']
                        q2_individual_stmt = q2_data['income_statement']
                        q2_cumulative_stmt = {}
                        for field in set(list(q1_stmt.keys()) + list(q2_individual_stmt.keys())):
                            if field.endswith('_percent') or field.endswith('_annual'):
                                continue
                            q1_value = q1_stmt.get(field, 0)
                            q2_value = q2_individual_stmt.get(field, 0)
                            q2_cumulative_stmt[field] = q1_value + q2_value
                    else:
                        q2_cumulative_stmt = q2_data['income_statement']
                
                # Derive individual Q3 = Q3_cumulative - Q2_cumulative
                q3_cumulative_stmt = q3_data['income_statement'].copy()
                
                q3_individual_stmt = {}
                for field, cumulative_value in q3_cumulative_stmt.items():
                    if field.endswith('_percent') or field.endswith('_annual'):
                        continue
                    q2_cum_value = q2_cumulative_stmt.get(field)
                    if q2_cum_value is not None:
                        q3_individual_stmt[field] = cumulative_value - q2_cum_value
                    else:
                        q3_individual_stmt[field] = cumulative_value
                
                # Update Q3 with individual values
                quarters[q3_key]['income_statement'] = q3_individual_stmt
                quarters[q3_key]['data_source'] = 'sec_is_derived_q3_individual'
                quarters[q3_key]['derived_from'] = 'q3_cumulative_minus_q2_cumulative'
                quarters[q3_key]['qtrs'] = 1
                if 'is_cumulative' in quarters[q3_key]:
                    del quarters[q3_key]['is_cumulative']


class SECFinancialsService:
    """Service for extracting SEC financial data with simple, focused methods
    
    Provides a simple interface:
    - Load ticker data once
    - Request specific quarters or years as needed
    - No complex orchestration - caller controls the logic
    """
    
    def __init__(self, cache_dir: str = './sec_data_cache'):
        """Initialize the SEC financials service
        
        Args:
            cache_dir: Directory containing cached SEC data
        """
        self.cache_dir = cache_dir
        self.cik_lookup = _get_cik_service()  # Use singleton
        self._loaded_tickers = {}  # Cache loaded data per ticker
    
    def _load_ticker_data(self, ticker: str, verbose: bool = False) -> bool:
        """Load and process SEC data for a ticker (internal method)
        
        Args:
            ticker: Stock ticker symbol
            verbose: Enable verbose output
            
        Returns:
            True if successful, False otherwise
        """
        if ticker in self._loaded_tickers:
            return True  # Already loaded
        
        try:
            # Load and standardize all data for this ticker
            cik, is_df, bs_df, cf_df, fiscal_year_end = _load_and_standardize_data(
                ticker, self.cache_dir, verbose, None, None, None
            )
            
            if cik is None:
                if verbose:
                    print(f"Error loading {ticker}: Failed to load data")
                return False
            
            # Process each statement type
            quarters, cumulative_data, annual_data_records = _process_income_statements(is_df, fiscal_year_end, verbose)
            _process_balance_sheets(bs_df, quarters, cumulative_data, annual_data_records, fiscal_year_end, verbose)
            _process_cash_flows(cf_df, quarters, cumulative_data, annual_data_records, fiscal_year_end, verbose)
            
            # Derive Q4 quarters and calculate margins
            _derive_q4_quarters(quarters, cumulative_data, annual_data_records)
            
            # Derive individual Q2 and Q3 quarters from cumulative data
            _derive_individual_quarters_from_cumulative(quarters, cumulative_data)
            
            for quarter_data in quarters.values():
                _calculate_margins(quarter_data['income_statement'])
            
            # Convert to sorted lists
            quarters_list = sorted(quarters.values(), key=lambda x: (x['fiscal_year'], x['fiscal_quarter']))
            quarterly_data = [q for q in quarters_list if not q.get('is_annual', False)]
            annual_data = [q for q in quarters_list if q.get('is_annual', False)]
            
            # Store the processed data
            self._loaded_tickers[ticker] = {
                'ticker': ticker,
                'cik': cik,
                'quarterly_data': quarterly_data,
                'annual_data': annual_data
            }
            return True
            
        except Exception as e:
            if verbose:
                print(f"Exception loading {ticker}: {e}")
            return False
    
    def get_quarterly_data(
        self,
        ticker: str,
        fiscal_year: Optional[int] = None,
        fiscal_quarter: Optional[int] = None,
        verbose: bool = False
    ) -> Optional[Dict[str, Any]]:
        """Get quarterly financial data for a specific quarter or all quarters
        
        Args:
            ticker: Stock ticker symbol
            fiscal_year: Specific fiscal year (optional - returns all if None)
            fiscal_quarter: Specific fiscal quarter 1-4 (optional - returns all if None)
            verbose: Enable verbose output
            
        Returns:
            Single quarter dict if both year and quarter specified,
            List of quarters if filtering by year only or no filters,
            None if not found or error
        """
        # Ensure data is loaded
        if not self._load_ticker_data(ticker, verbose):
            return None
        
        ticker_data = self._loaded_tickers[ticker]
        quarterly_data = ticker_data.get('quarterly_data', [])
        
        # Filter by fiscal year and quarter if specified
        if fiscal_year is not None:
            quarterly_data = [q for q in quarterly_data if q['fiscal_year'] == fiscal_year]
            
            if fiscal_quarter is not None:
                # Return single quarter
                for q in quarterly_data:
                    if q['fiscal_quarter'] == fiscal_quarter:
                        return q
                return None  # Not found
        
        # Return all matching quarters
        return quarterly_data if quarterly_data else None
    
    def get_annual_data(
        self,
        ticker: str,
        fiscal_year: Optional[int] = None,
        verbose: bool = False
    ) -> Optional[Dict[str, Any]]:
        """Get annual financial data for a specific year or all years
        
        Args:
            ticker: Stock ticker symbol
            fiscal_year: Specific fiscal year (optional - returns all if None)
            verbose: Enable verbose output
            
        Returns:
            Single year dict if fiscal_year specified,
            List of years if no filter,
            None if not found or error
        """
        # Ensure data is loaded
        if not self._load_ticker_data(ticker, verbose):
            return None
        
        ticker_data = self._loaded_tickers[ticker]
        annual_data = ticker_data.get('annual_data', [])
        
        # Filter by fiscal year if specified
        if fiscal_year is not None:
            for year_data in annual_data:
                if year_data['fiscal_year'] == fiscal_year:
                    return year_data
            return None  # Not found
        
        # Return all years
        return annual_data if annual_data else None
    
    def get_all_available_periods(self, ticker: str, verbose: bool = False) -> Optional[Dict[str, Any]]:
        """Get summary of all available periods for a ticker
        
        Args:
            ticker: Stock ticker symbol
            verbose: Enable verbose output
            
        Returns:
            Dict with quarterly_periods, annual_periods, fiscal_years lists
        """
        if not self._load_ticker_data(ticker, verbose):
            return None
        
        ticker_data = self._loaded_tickers[ticker]
        quarterly_data = ticker_data.get('quarterly_data', [])
        annual_data = ticker_data.get('annual_data', [])
        
        # Extract available periods
        quarterly_periods = [(q['fiscal_year'], q['fiscal_quarter']) for q in quarterly_data]
        annual_periods = [a['fiscal_year'] for a in annual_data]
        
        return {
            'ticker': ticker,
            'cik': ticker_data.get('cik'),
            'quarterly_periods': quarterly_periods,
            'annual_periods': annual_periods,
            'total_quarters': len(quarterly_data),
            'total_years': len(annual_data)
        }
    
    def prepare_for_cache(
        self,
        ticker: str,
        data: Dict[str, Any],
        is_annual: bool = False
    ) -> Dict[str, Any]:
        """Prepare financial data for Firebase caching
        
        Args:
            ticker: Stock ticker symbol
            data: Raw quarter or annual data from get_quarterly_data/get_annual_data
            is_annual: True if annual data, False if quarterly
            
        Returns:
            Formatted data ready for Firebase storage
        """
        cache_data = {
            'ticker': ticker.upper(),
            'fiscal_year': data['fiscal_year'],
            'period_end_date': data['period_end_date'],
            'data_source': data['data_source'],
            'accession_number': data['accession_number'],
            'is_annual': is_annual,
            
            # Financial Statements
            'income_statement': data.get('income_statement', {}),
            'balance_sheet': data.get('balance_sheet', {}),
            'cash_flow_statement': data.get('cash_flow_statement', {}),
            
            # Metadata
            'updated_at': datetime.now().isoformat(),
            'statement_type': 'annual' if is_annual else 'quarterly'
        }
        
        # Add quarter-specific fields
        if not is_annual:
            cache_data['fiscal_quarter'] = data['fiscal_quarter']
            cache_data['derived_from'] = data.get('derived_from')
        else:
            cache_data['aggregated_from_quarters'] = data.get('aggregated_from_quarters')
        
        return cache_data
    
    def get_cik_for_ticker(self, ticker: str) -> Optional[str]:
        """Get SEC CIK (Central Index Key) for a ticker symbol
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            CIK number as string, or None if not found
        """
        return self.cik_lookup.get_cik_by_ticker(ticker)


def main():
    parser = argparse.ArgumentParser(
        description='Extract SEC financial data for specific quarter',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Extract specific quarter
  python extract_sec_financials.py AAPL 2024Q1 --pretty
  
  # Verbose output with extraction details
  python extract_sec_financials.py AAPL 2024Q2 --verbose --pretty
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
    
    # Extract financial data
    data = extract_sec_financials(
        ticker=ticker,
        fiscal_year=year,
        fiscal_quarter=quarter,
        verbose=args.verbose,
        cache_dir=args.cache_dir
    )
    
    # Print results
    if args.pretty:
        print(json.dumps(data, indent=2, default=str))
    else:
        print(json.dumps(data, default=str))
        print(json.dumps(data, default=str))

if __name__ == '__main__':
    main()