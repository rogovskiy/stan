#!/usr/bin/env python3
"""
Test SEC Financial Data Extraction

Tests that 2022-2023 quarterly data extraction produces expected output.
Validates all three financial statements: income statement, balance sheet, cash flow.
"""

import json
from extract_sec_financials import extract_sec_financials

def test_quarter(ticker, year, quarter, expected_data):
    """Test a single quarter extraction
    
    Args:
        ticker: Stock ticker symbol
        year: Fiscal year
        quarter: Fiscal quarter (1-4)
        expected_data: Dict with expected values to validate
        
    Returns:
        Tuple of (passed, errors) where passed is bool and errors is list of error messages
    """
    errors = []
    
    # Extract data
    result = extract_sec_financials(ticker, year, quarter, verbose=False)
    
    # Check for errors
    if 'error' in result:
        errors.append(f"{year}Q{quarter}: Extraction failed - {result['error']}")
        return False, errors
    
    data = result.get('data', {})
    
    # Validate fiscal year/quarter
    if data.get('fiscal_year') != year:
        errors.append(f"{year}Q{quarter}: Expected fiscal_year={year}, got {data.get('fiscal_year')}")
    if data.get('fiscal_quarter') != quarter:
        errors.append(f"{year}Q{quarter}: Expected fiscal_quarter={quarter}, got {data.get('fiscal_quarter')}")
    
    # Validate data source - Q1-Q3 should use individual quarter data (qtrs=1)
    data_source = data.get('data_source', '')
    if quarter in [1, 2, 3]:
        if data_source != 'sec_is_standardized_quarterly':
            errors.append(f"{year}Q{quarter}: Expected data_source='sec_is_standardized_quarterly' (qtrs=1), got '{data_source}'")
        if data.get('qtrs') != 1:
            errors.append(f"{year}Q{quarter}: Expected qtrs=1 (individual quarter), got qtrs={data.get('qtrs')}")
    elif quarter == 4:
        if data_source != 'sec_is_derived_q4':
            errors.append(f"{year}Q{quarter}: Expected data_source='sec_is_derived_q4', got '{data_source}'")
    
    # Validate income statement
    income_stmt = data.get('income_statement', {})
    
    # Check that outstanding_shares is present and positive
    if 'outstanding_shares' not in income_stmt:
        errors.append(f"{year}Q{quarter}: Missing income_statement.outstanding_shares")
    elif income_stmt.get('outstanding_shares') is None:
        errors.append(f"{year}Q{quarter}: income_statement.outstanding_shares is None")
    elif income_stmt.get('outstanding_shares') <= 0:
        errors.append(f"{year}Q{quarter}: income_statement.outstanding_shares should be positive, got {income_stmt.get('outstanding_shares')}")
    
    for field, expected_value in expected_data.get('income_statement', {}).items():
        actual_value = income_stmt.get(field)
        if actual_value is None:
            errors.append(f"{year}Q{quarter}: Missing income_statement.{field}")
        elif abs(actual_value - expected_value) > abs(expected_value * 0.01):  # Allow 1% tolerance
            # Format large numbers (> 100) with commas, small numbers (< 100) with decimals
            if abs(expected_value) >= 100:
                errors.append(f"{year}Q{quarter}: income_statement.{field} expected ~{expected_value:,.0f}, got {actual_value:,.0f}")
            else:
                errors.append(f"{year}Q{quarter}: income_statement.{field} expected ~{expected_value:.2f}, got {actual_value:.2f}")
    
    # Validate balance sheet (if expected)
    balance_sheet = data.get('balance_sheet', {})
    for field, expected_value in expected_data.get('balance_sheet', {}).items():
        actual_value = balance_sheet.get(field)
        if actual_value is None:
            errors.append(f"{year}Q{quarter}: Missing balance_sheet.{field}")
        elif abs(actual_value - expected_value) > abs(expected_value * 0.01):  # Allow 1% tolerance
            errors.append(f"{year}Q{quarter}: balance_sheet.{field} expected ~{expected_value:,.0f}, got {actual_value:,.0f}")
    
    # Validate cash flow (if expected)
    cash_flow = data.get('cash_flow_statement', {})
    for field, expected_value in expected_data.get('cash_flow_statement', {}).items():
        actual_value = cash_flow.get(field)
        if actual_value is None:
            errors.append(f"{year}Q{quarter}: Missing cash_flow_statement.{field}")
        else:
            # Use 5% tolerance for cash flows due to derivation from cumulative values
            # Q2 = Q2_cumulative - Q1, Q3 = Q3_cumulative - Q2_cumulative
            # Each subtraction compounds rounding errors and filing amendments
            tolerance = abs(expected_value * 0.05)  # 5% tolerance
            if abs(actual_value - expected_value) > tolerance:
                errors.append(f"{year}Q{quarter}: cash_flow_statement.{field} expected ~{expected_value:,.0f}, got {actual_value:,.0f}")
    
    return len(errors) == 0, errors


def run_tests():
    """Run all quarterly tests for AAPL 2022-2023"""
    
    # Expected data from Apple's actual SEC filings
    # Source: 10-Q and 10-K filings from SEC EDGAR
    #
    # NOTE: These are INDIVIDUAL QUARTER values (not cumulative)
    # The extraction code derives individual quarters from SEC cumulative data
    test_cases = [
        # 2022Q1 (filed 2022-01-27 for quarter ended 2021-12-25)
        {
            'ticker': 'AAPL',
            'year': 2022,
            'quarter': 1,
            'expected': {
                'income_statement': {
                    'revenues': 123945000000.0,
                    'net_income': 34630000000.0,
                    'earnings_per_share': 2.10,
                },
                'balance_sheet': {
                    'total_assets': 381191000000.0,
                },
                'cash_flow_statement': {
                    'operating_cash_flow': 46966000000.0,
                }
            }
        },
        # 2022Q2 (individual quarter, derived from cumulative)
        {
            'ticker': 'AAPL',
            'year': 2022,
            'quarter': 2,
            'expected': {
                'income_statement': {
                    'revenues': 97278000000.0,
                    'net_income': 25010000000.0,
                    'earnings_per_share': 1.54,
                },
                'cash_flow_statement': {
                    'dividends_paid': -3745000000.0,
                }
            }
        },
        # 2022Q3 (individual quarter, derived from cumulative)
        {
            'ticker': 'AAPL',
            'year': 2022,
            'quarter': 3,
            'expected': {
                'income_statement': {
                    'revenues': 82959000000.0,
                    'net_income': 19442000000.0,
                    'earnings_per_share': 1.20,
                },
                'cash_flow_statement': {
                    'dividends_paid': -3733000000.0,
                }
            }
        },
        # 2022Q4 (derived from annual minus Q3 cumulative)
        {
            'ticker': 'AAPL',
            'year': 2022,
            'quarter': 4,
            'expected': {
                'income_statement': {
                    'revenues': 90146000000.0,
                    'net_income': 20721000000.0,
                    'earnings_per_share': 1.29,  # Derived: Annual (6.11) - Q1-Q3 (4.82) = 1.29
                },
                'balance_sheet': {
                    'total_assets': 352755000000.0,
                }
            }
        },
        # 2023Q1 (filed 2023-02-02 for quarter ended 2022-12-31)
        {
            'ticker': 'AAPL',
            'year': 2023,
            'quarter': 1,
            'expected': {
                'income_statement': {
                    'revenues': 117154000000.0,
                    'net_income': 29998000000.0,
                    'earnings_per_share': 1.88,
                },
                'balance_sheet': {
                    'total_assets': 346747000000.0,
                }
            }
        },
        # 2023Q2 (individual quarter, derived from cumulative)
        {
            'ticker': 'AAPL',
            'year': 2023,
            'quarter': 2,
            'expected': {
                'income_statement': {
                    'revenues': 94836000000.0,
                    'net_income': 24160000000.0,
                    'earnings_per_share': 1.52,
                },
                'cash_flow_statement': {
                    'dividends_paid': -3751000000.0,
                }
            }
        },
        # 2023Q3 (individual quarter, derived from cumulative)
        {
            'ticker': 'AAPL',
            'year': 2023,
            'quarter': 3,
            'expected': {
                'income_statement': {
                    'revenues': 81797000000.0,
                    'net_income': 19881000000.0,
                    'earnings_per_share': 1.26,
                },
                'cash_flow_statement': {
                    'dividends_paid': -3752000000.0,
                }
            }
        },
        # 2023Q4 (derived from annual minus Q3 cumulative)
        {
            'ticker': 'AAPL',
            'year': 2023,
            'quarter': 4,
            'expected': {
                'income_statement': {
                    'revenues': 89498000000.0,
                    'net_income': 22956000000.0,
                    'earnings_per_share': 1.46,  # Derived: Annual (6.13) - Q1-Q3 (4.67) = 1.46
                },
                'balance_sheet': {
                    'total_assets': 352583000000.0,
                }
            }
        },
    ]
    
    print("=" * 80)
    print("Testing SEC Financial Data Extraction - AAPL 2022-2023")
    print("=" * 80)
    print()
    
    total_tests = len(test_cases)
    passed_tests = 0
    all_errors = []
    
    for test_case in test_cases:
        ticker = test_case['ticker']
        year = test_case['year']
        quarter = test_case['quarter']
        expected = test_case['expected']
        
        # Extract to get data source
        result = extract_sec_financials(ticker, year, quarter, verbose=False)
        data_source = result.get('data', {}).get('data_source', 'unknown')
        
        print(f"Testing {ticker} {year}Q{quarter} [{data_source}]...", end=' ')
        
        passed, errors = test_quarter(ticker, year, quarter, expected)
        
        if passed:
            print("✓ PASS")
            passed_tests += 1
        else:
            print("✗ FAIL")
            all_errors.extend(errors)
    
    print()
    print("=" * 80)
    print(f"Results: {passed_tests}/{total_tests} tests passed")
    print("=" * 80)
    
    if all_errors:
        print("\nErrors:")
        for error in all_errors:
            print(f"  • {error}")
        print()
        return False
    else:
        print("\n✓ All tests passed!")
        print()
        return True


if __name__ == '__main__':
    import sys
    success = run_tests()
    sys.exit(0 if success else 1)
