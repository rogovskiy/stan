#!/usr/bin/env python3
"""
SEC Data Service - Working Version

Working version that properly uses the secfsdstools 2.4.3 API.
"""

import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import logging
from secfsdstools.e_collector.companycollecting import CompanyReportCollector

# Known company CIKs for major stocks
TICKER_TO_CIK = {
    'AAPL': 320193,
    'MSFT': 789019,
    'GOOGL': 1652044,
    'GOOG': 1652044,
    'AMZN': 1018724,
    'TSLA': 1318605,
    'META': 1326801,
    'NVDA': 1045810,
    'NFLX': 1065280,
    'AMD': 2488
}

class SECDataService:
    """Working service for fetching SEC financial data"""
    
    def __init__(self):
        # Set up logging to reduce noise
        logging.getLogger('secfsdstools').setLevel(logging.WARNING)
        # Import Firebase cache here to avoid circular imports
        from firebase_cache import FirebaseCache
        self.cache = FirebaseCache()
        print("✅ SEC data service initialized")
    
    def get_cik_for_ticker(self, ticker: str) -> Optional[int]:
        """Get CIK number for a ticker symbol"""
        return TICKER_TO_CIK.get(ticker.upper())
    
    def fetch_comprehensive_financial_data(self, ticker: str, years_back: int = 10) -> Dict[str, Any]:
        """
        Fetch comprehensive financial data from SEC filings
        """
        try:
            cik = self.get_cik_for_ticker(ticker)
            if not cik:
                print(f'   ⚠️  CIK not found for ticker {ticker}')
                return self._empty_financial_results()
            
            print(f'   Using CIK {cik} for {ticker}')
            
            # Get company data collector
            collector = CompanyReportCollector.get_company_collector([cik])
            raw_data_bag = collector.collect()
            
            # Get statistics
            stats = raw_data_bag.statistics()
            print(f'   Found {stats.number_of_reports} SEC reports')
            print(f'   Report types: {stats.reports_per_form}')
            
            # Extract financial data from the pre-processed dataframe
            pre_df = raw_data_bag.pre_df
            print(f'   Processing {len(pre_df)} financial data entries')
            
            # Extract time series data
            time_series_results = self._extract_time_series_from_pre_df(pre_df, ticker)
            
            return {
                'ticker': ticker.upper(),
                'cik': cik,
                'reports_found': stats.number_of_reports,
                'data_entries': len(pre_df),
                'report_types': stats.reports_per_form,
                'time_series_generated': time_series_results,
                'data_source': 'sec_filings',
                'success': True
            }
            
        except Exception as error:
            print(f'❌ Error fetching SEC data for {ticker}: {error}')
            return self._empty_financial_results()
    
    def _extract_time_series_from_pre_df(self, pre_df: pd.DataFrame, ticker: str) -> Dict[str, Any]:
        """Extract time series data from the pre-processed DataFrame and CACHE to Firebase"""
        try:
            time_series = {}
            
            # Get the actual numerical values from the RawDataBag
            # We need to access the sub_df which contains the actual values
            collector = CompanyReportCollector.get_company_collector([self.get_cik_for_ticker(ticker)])
            raw_data_bag = collector.collect()
            sub_df = raw_data_bag.sub_df  # This contains the actual numerical values
            
            print(f'   📊 Processing {len(sub_df)} numerical values from SEC data')
            
            # Revenue time series (look for revenue-related tags)
            revenue_tags = ['Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax']
            revenue_cached = self._extract_and_cache_metric_time_series(pre_df, sub_df, revenue_tags, 'revenue', ticker)
            if revenue_cached > 0:
                time_series['revenue'] = revenue_cached
                print(f'   ✅ Extracted and CACHED {revenue_cached} revenue quarters to Firebase')
            
            # Net Income time series  
            net_income_tags = ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic']
            net_income_cached = self._extract_and_cache_metric_time_series(pre_df, sub_df, net_income_tags, 'net_income', ticker)
            if net_income_cached > 0:
                time_series['net_income'] = net_income_cached
                print(f'   ✅ Extracted and CACHED {net_income_cached} net income quarters to Firebase')
            
            # EPS time series
            eps_tags = ['EarningsPerShareDiluted', 'EarningsPerShareBasic']
            eps_cached = self._extract_and_cache_metric_time_series(pre_df, sub_df, eps_tags, 'eps', ticker)
            if eps_cached > 0:
                time_series['eps'] = eps_cached
                print(f'   ✅ Extracted and CACHED {eps_cached} EPS quarters to Firebase')
            
            return time_series
            
        except Exception as e:
            print(f'   ⚠️  Error extracting and caching time series: {e}')
            import traceback
            traceback.print_exc()
            return {}
    
    def _extract_and_cache_metric_time_series(self, pre_df: pd.DataFrame, sub_df: pd.DataFrame, tag_list: List[str], metric_name: str, ticker: str) -> int:
        """Extract time series for a specific metric and CACHE each quarter to Firebase"""
        try:
            # Filter for the relevant tags in pre_df
            metric_pre_df = pre_df[pre_df['tag'].isin(tag_list)]
            
            if metric_pre_df.empty:
                print(f'   No {metric_name} data found in SEC filings')
                return 0
            
            # Join with sub_df to get the actual values
            # pre_df has the metadata, sub_df has the values
            # They are linked by report and line numbers
            merged_df = metric_pre_df.merge(
                sub_df, 
                on=['adsh', 'tag'], 
                how='inner'
            )
            
            if merged_df.empty:
                print(f'   No {metric_name} values found after joining with sub_df')
                return 0
            
            print(f'   Found {len(merged_df)} {metric_name} values to process')
            
            # Group by adsh (accession number) and period to get unique quarterly data
            quarters_cached = 0
            
            for (adsh, ddate), group in merged_df.groupby(['adsh', 'ddate']):
                try:
                    if len(group) == 0:
                        continue
                    
                    # Get the best entry (latest or most recent)
                    entry = group.iloc[-1]  # Take the last entry if multiple
                    
                    # Parse the date to determine fiscal year and quarter
                    fiscal_info = self._parse_fiscal_period_from_date(entry['ddate'])
                    if not fiscal_info:
                        continue
                    
                    quarter_key = f"{fiscal_info['fiscal_year']}Q{fiscal_info['fiscal_quarter']}"
                    
                    # Create financial data structure in the format your system expects
                    financial_data = {
                        'fiscal_year': fiscal_info['fiscal_year'],
                        'fiscal_quarter': fiscal_info['fiscal_quarter'],
                        'quarter_key': quarter_key,
                        'form_type': '10-K' if fiscal_info['fiscal_quarter'] == 4 else '10-Q',
                        'filing_date': None,  # We could extract this from adsh if needed
                        'period_end_date': entry['ddate'].strftime('%Y-%m-%d'),
                        'data_source': 'sec_filings',
                        'estimated': False,
                        'accession_number': adsh
                    }
                    
                    # Add the specific financial data based on metric type
                    if metric_name == 'revenue':
                        financial_data['financials'] = {
                            'revenue': float(entry['value']),
                            'data_source': 'sec_filings'
                        }
                    elif metric_name == 'net_income':
                        financial_data['financials'] = {
                            'net_income': float(entry['value']),
                            'data_source': 'sec_filings'
                        }
                        financial_data['earnings'] = {
                            'net_income': float(entry['value']),
                            'data_source': 'sec_filings'
                        }
                    elif metric_name == 'eps':
                        financial_data['financials'] = {
                            'eps_diluted': float(entry['value']),
                            'data_source': 'sec_filings'
                        }
                        financial_data['earnings'] = {
                            'eps_actual': float(entry['value']),
                            'data_source': 'sec_filings'
                        }
                    
                    # Cache to Firebase
                    self.cache.cache_quarterly_financial_data(ticker, quarter_key, financial_data)
                    quarters_cached += 1
                    
                except Exception as quarter_error:
                    print(f'   ⚠️  Error processing quarter {adsh}: {quarter_error}')
                    continue
            
            print(f'   📁 Successfully cached {quarters_cached} {metric_name} quarters to Firebase')
            return quarters_cached
            
        except Exception as e:
            print(f'   ❌ Error extracting and caching {metric_name}: {e}')
            import traceback
            traceback.print_exc()
            return 0
    
    def _parse_fiscal_period_from_date(self, date_value) -> Optional[Dict]:
        """Parse fiscal year and quarter from a date"""
        try:
            if pd.isna(date_value):
                return None
            
            # Convert to datetime if it's not already
            if isinstance(date_value, str):
                date_obj = pd.to_datetime(date_value)
            else:
                date_obj = date_value
            
            fiscal_year = date_obj.year
            month = date_obj.month
            
            # Determine quarter based on month (standard calendar quarters)
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
            print(f'   Error parsing date {date_value}: {e}')
            return None

    def test_basic_functionality(self, ticker: str) -> Dict[str, Any]:
        """Test basic SEC data access for a ticker"""
        try:
            cik = self.get_cik_for_ticker(ticker)
            if not cik:
                return {
                    'success': False,
                    'error': f'CIK not found for {ticker}',
                    'available_tickers': list(TICKER_TO_CIK.keys())
                }
            
            print(f'Testing SEC data access for {ticker} (CIK: {cik})...')
            
            collector = CompanyReportCollector.get_company_collector([cik])
            result = collector.collect()
            stats = result.statistics()
            
            return {
                'success': True,
                'ticker': ticker,
                'cik': cik,
                'reports_found': stats.number_of_reports,
                'data_entries': len(result.pre_df),
                'report_types': stats.reports_per_form,
                'message': f'Successfully accessed {stats.number_of_reports} SEC filings for {ticker}'
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e),
                'ticker': ticker
            }
    
    def _empty_financial_results(self) -> Dict[str, Any]:
        """Return empty results structure"""
        return {
            'quarters_processed': 0,
            'reports_found': 0,
            'time_series_generated': {},
            'data_source': 'sec_filings',
            'success': False
        }

# Convenience function for quick testing
def test_sec_data(ticker: str = 'AAPL'):
    """Quick test function"""
    service = SECDataService()
    result = service.test_basic_functionality(ticker)
    
    print(f"\n📊 SEC Test Results for {ticker}:")
    if result['success']:
        print(f"✅ Success!")
        print(f"   Reports found: {result['reports_found']}")
        print(f"   Data entries: {result['data_entries']}")
        print(f"   Report types: {result['report_types']}")
    else:
        print(f"❌ Failed: {result['error']}")
        if 'available_tickers' in result:
            print(f"   Available tickers: {result['available_tickers']}")
    
    return result

if __name__ == "__main__":
    # Test the service
    test_sec_data('AAPL')