#!/usr/bin/env python3
"""
SEC Data Service - Simplified Version

Simplified version that works with the actual secfsdstools API.
"""

import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import json
from secfsdstools.e_collector.companycollecting import CompanyReportCollector
from secfsdstools.f_standardize.is_standardize import IncomeStatementStandardizer
from secfsdstools.f_standardize.bs_standardize import BalanceSheetStandardizer  
from secfsdstools.f_standardize.cf_standardize import CashFlowStandardizer

from firebase_cache import FirebaseCache


class SECDataService:
    """Simplified service for fetching SEC financial data"""
    
    def __init__(self):
        self.cache = FirebaseCache()
        print("✅ SEC data service initialized")
    
    def test_basic_functionality(self, ticker: str) -> Dict[str, Any]:
        """Test basic SEC data access"""
        try:
            print(f'Testing SEC data access for {ticker}...')
            
            # Try to get a collector
            collector = CompanyReportCollector.get_company_collector(ticker.upper())
            print(f'✅ Created collector for {ticker}')
            
            # Try to get data bags
            try:
                raw_bags = collector.get_all_company_filing_rawdatabags()
                print(f'✅ Found {len(raw_bags)} data bags')
                
                # Show first few bags
                if raw_bags:
                    for i, bag in enumerate(raw_bags[:3]):
                        print(f'   Bag {i+1}: {bag.form} from {bag.filing_date}')
                
                return {
                    'success': True,
                    'bags_found': len(raw_bags),
                    'message': f'Successfully accessed {len(raw_bags)} SEC filings for {ticker}'
                }
                
            except Exception as e:
                print(f'Error accessing data bags: {e}')
                return {
                    'success': False,
                    'error': str(e),
                    'message': f'Could not access SEC filings for {ticker}'
                }
                
        except Exception as e:
            print(f'Error creating collector: {e}')
            return {
                'success': False,
                'error': str(e),
                'message': f'Could not create collector for {ticker}'
            }
    
    def get_time_series_data(self, ticker: str, metric: str) -> Optional[Dict[str, Any]]:
        """Get cached time series data"""
        try:
            series_key = f"{ticker}_{metric}_timeseries"
            return self.cache.get_custom_data(series_key, max_age_hours=24)
        except Exception as e:
            print(f'Error getting time series data: {e}')
            return None
    
    def _empty_financial_results(self) -> Dict[str, Any]:
        """Return empty results"""
        return {
            'quarters_processed': 0,
            'reports_found': 0,
            'time_series_generated': {},
            'data_source': 'sec_filings'
        }