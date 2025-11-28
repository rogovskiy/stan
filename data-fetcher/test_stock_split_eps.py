#!/usr/bin/env python3
"""
Test SEC Financial Data Extraction - Stock Split Handling

Tests that EPS extraction correctly handles stock splits:
- Before split: Uses original filings (pre-split share counts)
- After split: Uses post-split filings (post-split share counts)
- Q4 EPS: Calculated from net income / shares (not subtracting EPS values)

Apple had a 4-for-1 stock split on August 31, 2020.
This test verifies that:
1. 2018Q4 (before split) uses original filing with pre-split shares
2. 2020Q4 (after split) uses post-split filing with post-split shares
3. EPS is never negative (calculated from net income / shares)
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
    
    # Validate income statement
    income_stmt = data.get('income_statement', {})
    
    # Critical: EPS must never be negative
    eps = income_stmt.get('earnings_per_share')
    if eps is not None and eps < 0:
        errors.append(f"{year}Q{quarter}: CRITICAL - earnings_per_share is negative: {eps}")
    
    # Check that outstanding_shares is present and positive
    if 'outstanding_shares' not in income_stmt:
        errors.append(f"{year}Q{quarter}: Missing income_statement.outstanding_shares")
    elif income_stmt.get('outstanding_shares') is None:
        errors.append(f"{year}Q{quarter}: income_statement.outstanding_shares is None")
    elif income_stmt.get('outstanding_shares') <= 0:
        errors.append(f"{year}Q{quarter}: income_statement.outstanding_shares should be positive, got {income_stmt.get('outstanding_shares')}")
    
    # Validate expected values
    for field, expected_value in expected_data.get('income_statement', {}).items():
        actual_value = income_stmt.get(field)
        if actual_value is None:
            errors.append(f"{year}Q{quarter}: Missing income_statement.{field}")
        elif field == 'earnings_per_share':
            # EPS tolerance: allow 5% difference due to rounding and share count methodology
            tolerance = abs(expected_value * 0.05)
            if abs(actual_value - expected_value) > tolerance:
                errors.append(f"{year}Q{quarter}: income_statement.{field} expected ~{expected_value:.2f}, got {actual_value:.2f}")
        elif abs(actual_value - expected_value) > abs(expected_value * 0.01):  # Allow 1% tolerance
            # Format large numbers (> 100) with commas, small numbers (< 100) with decimals
            if abs(expected_value) >= 100:
                errors.append(f"{year}Q{quarter}: income_statement.{field} expected ~{expected_value:,.0f}, got {actual_value:,.0f}")
            else:
                errors.append(f"{year}Q{quarter}: income_statement.{field} expected ~{expected_value:.2f}, got {actual_value:.2f}")
    
    # Validate that we're using the correct filing (original vs restatement)
    accession_number = data.get('accession_number', '')
    if 'expected_accession_prefix' in expected_data and expected_data['expected_accession_prefix'] is not None:
        expected_prefix = expected_data['expected_accession_prefix']
        if not accession_number.startswith(expected_prefix):
            errors.append(f"{year}Q{quarter}: Expected accession number starting with '{expected_prefix}' (original filing), got '{accession_number}' (may be restatement)")
    
    # For post-split periods, validate that shares are post-split (much higher than pre-split)
    if 'expected_post_split' in expected_data and expected_data['expected_post_split']:
        shares = income_stmt.get('outstanding_shares')
        if shares and shares < 10000000000:  # Less than 10B shares suggests pre-split
            errors.append(f"{year}Q{quarter}: Expected post-split shares (>10B), got {shares:,.0f} (may be using pre-split filing)")
    
    # For pre-split periods, validate that shares are pre-split (much lower than post-split)
    if 'expected_pre_split' in expected_data and expected_data['expected_pre_split']:
        shares = income_stmt.get('outstanding_shares')
        if shares and shares > 10000000000:  # More than 10B shares suggests post-split
            errors.append(f"{year}Q{quarter}: Expected pre-split shares (<10B), got {shares:,.0f} (may be using post-split restatement)")
    
    return len(errors) == 0, errors


def run_tests():
    """Run stock split handling tests for AAPL"""
    
    # Apple had a 4-for-1 stock split on August 31, 2020
    # Fiscal year ends September 30, so:
    # - 2018Q4 (ended Sep 30, 2018): Before split, should use original filing
    # - 2020Q3 (ended Jun 30, 2020): Before split, should use pre-split shares (split was Aug 31)
    # - 2020Q4 (ended Sep 30, 2020): After split, should use post-split filing
    
    test_cases = [
        # 2018Q4 - BEFORE SPLIT
        # Should use original filing (0000320193-18-000145) with pre-split shares (~4.96B)
        {
            'ticker': 'AAPL',
            'year': 2018,
            'quarter': 4,
            'expected': {
                'income_statement': {
                    'revenues': 62900000000.0,
                    'net_income': 14125000000.0,
                    'outstanding_shares': 4955377000.0,  # Pre-split shares
                    'earnings_per_share': 2.85,  # Calculated: 14.125B / 4.96B = 2.85
                },
                'expected_accession_prefix': '0000320193-18',  # Original 2018 filing, not 2020 restatement
            }
        },
        # 2020Q3 - BEFORE SPLIT (ended Jun 30, 2020, split was Aug 31, 2020)
        # Should use pre-split shares similar to 2018Q4
        # This verifies that values don't drastically change just because we're in 2020
        {
            'ticker': 'AAPL',
            'year': 2020,
            'quarter': 3,
            'expected': {
                'income_statement': {
                    'revenues': 59685000000.0,
                    'net_income': 11253000000.0,
                    'outstanding_shares': 4312573000.0,  # Pre-split shares (similar to 2018Q4)
                    'earnings_per_share': 2.61,  # Pre-split EPS (similar level to 2018Q4's 2.85)
                },
                # Should use pre-split shares (< 10B), not post-split
                'expected_pre_split': True,  # Flag to validate pre-split shares
            }
        },
        # 2020Q4 - AFTER SPLIT
        # Should use post-split filing with post-split shares
        # Note: The actual filing may be from 2022 (restatement), but shares should be post-split
        {
            'ticker': 'AAPL',
            'year': 2020,
            'quarter': 4,
            'expected': {
                'income_statement': {
                    'revenues': 64698000000.0,
                    'net_income': 12673000000.0,
                    'outstanding_shares': 17352119000.0,  # Post-split shares
                    'earnings_per_share': 0.73,  # Post-split EPS (calculated from net income / shares)
                },
                # After split, we expect post-split share counts (much higher than pre-split)
                # Accession number may vary, but shares should be > 10B (post-split)
                'expected_accession_prefix': None,  # Don't check accession for post-split
                'expected_post_split': True,  # Flag to validate post-split shares
            }
        },
    ]
    
    print("=" * 80)
    print("Testing Stock Split Handling - AAPL 2018Q4, 2020Q3, 2020Q4")
    print("=" * 80)
    print()
    print("Apple had a 4-for-1 stock split on August 31, 2020")
    print("This test verifies:")
    print("  1. 2018Q4 uses original filing (pre-split shares ~4.96B)")
    print("  2. 2020Q3 (ended Jun 30, before split) uses pre-split shares (~4.31B)")
    print("  3. 2020Q4 (ended Sep 30, after split) uses post-split shares (~17.35B)")
    print("  4. EPS is calculated from net income / shares (never negative)")
    print("  5. Values don't drastically change just because of the split")
    print()
    
    total_tests = len(test_cases)
    passed_tests = 0
    all_errors = []
    
    for test_case in test_cases:
        ticker = test_case['ticker']
        year = test_case['year']
        quarter = test_case['quarter']
        expected = test_case['expected']
        
        # Extract to get data source and accession number
        result = extract_sec_financials(ticker, year, quarter, verbose=False)
        data = result.get('data', {})
        data_source = data.get('data_source', 'unknown')
        accession = data.get('accession_number', 'unknown')
        eps = data.get('income_statement', {}).get('earnings_per_share', 'N/A')
        shares = data.get('income_statement', {}).get('outstanding_shares', 'N/A')
        
        print(f"Testing {ticker} {year}Q{quarter}...")
        print(f"  Accession: {accession}")
        print(f"  Shares: {shares:,.0f}" if isinstance(shares, (int, float)) else f"  Shares: {shares}")
        print(f"  EPS: {eps}")
        print(f"  Data source: {data_source}")
        
        passed, errors = test_quarter(ticker, year, quarter, expected)
        
        if passed:
            print(f"  ✓ PASS")
            passed_tests += 1
        else:
            print(f"  ✗ FAIL")
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
        print("✓ Stock split handling is working correctly")
        print("✓ EPS is calculated from net income / shares (no negative values)")
        print()
        return True


if __name__ == '__main__':
    import sys
    success = run_tests()
    sys.exit(0 if success else 1)

