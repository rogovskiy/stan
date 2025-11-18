#!/usr/bin/env python3
"""
Quick test of SEC data extraction with fixed date parsing
"""

import pandas as pd
import numpy as np
from typing import Dict, List, Optional, Any
import logging
from secfsdstools.e_collector.companycollecting import CompanyReportCollector

# Set up logging
logging.getLogger('secfsdstools').setLevel(logging.WARNING)

def parse_fiscal_period_from_date_FIXED(date_value) -> Optional[Dict]:
    """FIXED date parser that handles numpy.int64"""
    try:
        if pd.isna(date_value):
            return None
        
        # Handle numpy.int64, int, float, and string formats
        if isinstance(date_value, (int, float)) or hasattr(date_value, 'item'):
            # Convert numpy types to regular Python int
            if hasattr(date_value, 'item'):
                date_int = int(date_value.item())
            else:
                date_int = int(date_value)
            
            date_str = str(date_int)
            if len(date_str) == 8:  # YYYYMMDD format
                year = int(date_str[:4])
                month = int(date_str[4:6])
                day = int(date_str[6:8])
                date_obj = pd.Timestamp(year=year, month=month, day=day)
            else:
                return None
        else:
            date_obj = pd.to_datetime(date_value)
        
        fiscal_year = date_obj.year
        month = date_obj.month
        
        # Determine quarter based on month
        if month <= 3:
            fiscal_quarter = 1
        elif month <= 6:
            fiscal_quarter = 2
        elif month <= 9:
            fiscal_quarter = 3
        else:
            fiscal_quarter = 4
        
        return {
            'fiscal_year': fiscal_year,
            'fiscal_quarter': fiscal_quarter,
            'period_end_date': date_obj.strftime('%Y-%m-%d')
        }
        
    except Exception as e:
        print(f'Error parsing date {date_value}: {e}')
        return None

def test_fixed_extraction():
    """Test SEC extraction with fixed date parsing"""
    print("🧪 Testing SEC extraction with FIXED date parsing...")
    
    # Get AAPL data
    collector = CompanyReportCollector.get_company_collector([320193])
    raw_data_bag = collector.collect()
    num_df = raw_data_bag.num_df
    
    print(f"Found {len(num_df)} financial data points")
    
    # Test extraction with fixed parser
    quarters_found = {}
    revenue_tags = ['Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax']
    
    # Group by adsh and ddate
    grouped = num_df.groupby(['adsh', 'ddate'])
    print(f"Found {len(grouped)} unique (filing, date) combinations")
    
    for (adsh, ddate), group in grouped:
        # Test the FIXED date parser
        fiscal_info = parse_fiscal_period_from_date_FIXED(ddate)
        if fiscal_info:
            quarter_key = f"{fiscal_info['fiscal_year']}Q{fiscal_info['fiscal_quarter']}"
            
            # Look for revenue in this period
            revenue_data = group[group['tag'].isin(revenue_tags)]
            if not revenue_data.empty:
                revenue_value = revenue_data.iloc[-1]['value']
                
                quarters_found[quarter_key] = {
                    'fiscal_year': fiscal_info['fiscal_year'],
                    'fiscal_quarter': fiscal_info['fiscal_quarter'],
                    'period_end_date': fiscal_info['period_end_date'],
                    'revenue': revenue_value,
                    'accession': adsh
                }
    
    print(f"\n✅ Successfully extracted {len(quarters_found)} quarters with revenue data!")
    
    # Show sample results
    sorted_quarters = sorted(quarters_found.items(), key=lambda x: (x[1]['fiscal_year'], x[1]['fiscal_quarter']))
    
    print(f"\n📊 Sample quarters (showing first 10):")
    for i, (quarter_key, data) in enumerate(sorted_quarters[:10]):
        revenue_b = data['revenue'] / 1e9
        print(f"  {i+1}. {quarter_key} ({data['period_end_date']}): Revenue ${revenue_b:.1f}B")
    
    if len(sorted_quarters) > 10:
        print(f"  ... and {len(sorted_quarters) - 10} more quarters")
    
    # Show date range
    if sorted_quarters:
        years = sorted(list(set([q[1]['fiscal_year'] for q in sorted_quarters])))
        print(f"\n📅 Data spans: {min(years)} to {max(years)} ({len(years)} years)")
    
    return len(quarters_found)

if __name__ == "__main__":
    quarters_count = test_fixed_extraction()
    print(f"\n🎯 RESULT: Extracted {quarters_count} quarters with fixed date parsing!")