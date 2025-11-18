#!/usr/bin/env python3
"""
SEC Data Service - Test Version (No Firebase)

Test version that extracts SEC data without requiring Firebase credentials.
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

class SECDataServiceTest:
    """Test service for extracting SEC financial data without Firebase"""
    
    def __init__(self):
        # Set up logging to reduce noise
        logging.getLogger('secfsdstools').setLevel(logging.WARNING)
        print("✅ SEC test data service initialized (No Firebase)")
    
    def get_cik_for_ticker(self, ticker: str) -> Optional[int]:
        """Get CIK number for a ticker symbol"""
        return TICKER_TO_CIK.get(ticker.upper())
    
    def extract_comprehensive_financial_data(self, ticker: str) -> Dict[str, Any]:
        """
        Extract comprehensive financial data from SEC filings and show detailed results
        """
        try:
            print(f'   📊 Extracting SEC financial data for {ticker}...')
            
            # Get CIK for ticker
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
            
            # Get both pre_df and sub_df
            pre_df = raw_data_bag.pre_df  # Metadata
            sub_df = raw_data_bag.sub_df  # Values
            
            print(f'   Processing {len(pre_df)} metadata entries and {len(sub_df)} value entries')
            
            # Extract detailed financial data
            financial_quarters = self._extract_detailed_quarterly_data(pre_df, sub_df, ticker)
            
            print(f'   ✅ Extracted {len(financial_quarters)} quarterly records spanning multiple years')
            
            # Show sample of the data
            if financial_quarters:
                print(f'\n   📋 Sample of extracted quarterly data:')
                for i, quarter in enumerate(financial_quarters[:5]):  # Show first 5
                    print(f'     {i+1}. {quarter["quarter_key"]}: {quarter.get("summary", "No summary")}')
                
                if len(financial_quarters) > 5:
                    print(f'     ... and {len(financial_quarters) - 5} more quarters')
                
                # Show date range
                years = sorted(list(set([q['fiscal_year'] for q in financial_quarters])))
                print(f'   📅 Data spans from {min(years)} to {max(years)} ({len(years)} years)')
            
            return {
                'ticker': ticker.upper(),
                'cik': cik,
                'reports_found': stats.number_of_reports,
                'data_entries': len(pre_df),
                'value_entries': len(sub_df),
                'report_types': stats.reports_per_form,
                'quarters_extracted': len(financial_quarters),
                'quarterly_data': financial_quarters,
                'data_source': 'sec_filings',
                'success': True
            }
            
        except Exception as error:
            print(f'❌ Error extracting SEC data for {ticker}: {error}')
            import traceback
            traceback.print_exc()
            return self._empty_financial_results()
    
    def _extract_detailed_quarterly_data(self, pre_df: pd.DataFrame, sub_df: pd.DataFrame, ticker: str) -> List[Dict]:
        """Extract detailed quarterly financial data using the num_df with actual values"""
        try:
            quarterly_data = []
            
            # Get the collector again to access num_df (which has the actual values)
            cik = self.get_cik_for_ticker(ticker)
            collector = CompanyReportCollector.get_company_collector([cik])
            raw_data_bag = collector.collect()
            
            # THIS is the key - num_df has the actual financial values!
            num_df = raw_data_bag.num_df
            print(f'   🔍 Found {len(num_df)} financial values in num_df')
            
            # Key financial metrics to extract
            financial_tags = {
                'revenue': ['Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'TotalRevenues'],
                'net_income': ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
                'eps': ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
                'total_assets': ['Assets', 'AssetsCurrent'],
                'cash': ['CashAndCashEquivalentsAtCarryingValue', 'Cash']
            }
            
            # Group num_df by adsh and ddate to get unique quarterly periods
            for (adsh, ddate), period_group in num_df.groupby(['adsh', 'ddate']):
                try:
                    if pd.isna(ddate):
                        continue
                    
                    # Parse fiscal information from date
                    fiscal_info = self._parse_fiscal_period_from_date(ddate)
                    if not fiscal_info:
                        continue
                    
                    quarter_key = f"{fiscal_info['fiscal_year']}Q{fiscal_info['fiscal_quarter']}"
                    
                    # Extract financial metrics for this quarter
                    quarter_metrics = {}
                    
                    for metric_name, tag_list in financial_tags.items():
                        # Find values for this metric in this period
                        metric_values = period_group[period_group['tag'].isin(tag_list)]
                        
                        if not metric_values.empty:
                            # Take the most recent/relevant value
                            best_value = metric_values.iloc[-1]
                            
                            if pd.notna(best_value['value']) and best_value['value'] != 0:
                                quarter_metrics[metric_name] = {
                                    'value': float(best_value['value']),
                                    'tag': best_value['tag'],
                                    'units': best_value.get('uom', 'USD'),
                                    'quarters': best_value.get('qtrs', 1)
                                }
                    
                    # Only include quarters that have meaningful financial data
                    if len(quarter_metrics) >= 1:  # At least 1 financial metric
                        quarter_data = {
                            'quarter_key': quarter_key,
                            'fiscal_year': fiscal_info['fiscal_year'],
                            'fiscal_quarter': fiscal_info['fiscal_quarter'],
                            'period_end_date': fiscal_info['period_end_date'],
                            'accession_number': adsh,
                            'metrics': quarter_metrics,
                            'data_source': 'sec_filings'
                        }
                        
                        # Create summary string
                        summary_parts = []
                        if 'revenue' in quarter_metrics:
                            rev = quarter_metrics['revenue']['value']
                            summary_parts.append(f"Revenue: ${rev:,.0f}")
                        if 'net_income' in quarter_metrics:
                            ni = quarter_metrics['net_income']['value']
                            summary_parts.append(f"Net Income: ${ni:,.0f}")
                        if 'eps' in quarter_metrics:
                            eps = quarter_metrics['eps']['value']
                            summary_parts.append(f"EPS: ${eps:.2f}")
                        
                        quarter_data['summary'] = ', '.join(summary_parts) if summary_parts else f"{len(quarter_metrics)} metrics"
                        quarterly_data.append(quarter_data)
                        
                except Exception as period_error:
                    continue
            
            # Remove duplicates and sort by fiscal year and quarter
            unique_quarters = {}
            for quarter in quarterly_data:
                key = quarter['quarter_key']
                if key not in unique_quarters or len(quarter['metrics']) > len(unique_quarters[key]['metrics']):
                    unique_quarters[key] = quarter
            
            quarterly_data = list(unique_quarters.values())
            quarterly_data.sort(key=lambda x: (x['fiscal_year'], x['fiscal_quarter']))
            
            print(f'   📊 Successfully extracted {len(quarterly_data)} unique quarters with financial data')
            
            return quarterly_data
            
        except Exception as e:
            print(f'   ❌ Error extracting quarterly data: {e}')
            import traceback
            traceback.print_exc()
            return []
    
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
            return None
    
    def show_available_tags(self, ticker: str, limit: int = 20):
        """Show what financial tags are available in the SEC data"""
        try:
            cik = self.get_cik_for_ticker(ticker)
            if not cik:
                print(f'CIK not found for {ticker}')
                return
            
            collector = CompanyReportCollector.get_company_collector([cik])
            raw_data_bag = collector.collect()
            
            pre_df = raw_data_bag.pre_df
            sub_df = raw_data_bag.sub_df
            
            print(f'\n📋 Available Financial Tags in SEC Data for {ticker}:')
            print('=' * 60)
            
            # Get unique tags from sub_df (which has the values)
            unique_tags = sub_df['tag'].value_counts().head(limit)
            
            for tag, count in unique_tags.items():
                # Get a sample label from pre_df
                sample_label = pre_df[pre_df['tag'] == tag]['plabel'].iloc[0] if tag in pre_df['tag'].values else 'No label'
                print(f'{tag:50} ({count:3} values) - {sample_label}')
            
            print(f'\nShowing top {limit} tags out of {len(sub_df["tag"].unique())} total unique tags')
            
        except Exception as e:
            print(f'Error showing tags: {e}')
    
    def _empty_financial_results(self) -> Dict[str, Any]:
        """Return empty results structure"""
        return {
            'quarters_extracted': 0,
            'reports_found': 0,
            'quarterly_data': [],
            'data_source': 'sec_filings',
            'success': False
        }

def test_sec_extraction(ticker: str = 'AAPL'):
    """Test SEC data extraction without Firebase"""
    print(f"🧪 Testing SEC Data Extraction for {ticker}")
    print("=" * 60)
    
    service = SECDataServiceTest()
    
    # Show available tags first
    print("\n1. Checking available financial tags...")
    service.show_available_tags(ticker, limit=15)
    
    # Extract comprehensive data
    print(f"\n2. Extracting comprehensive financial data...")
    result = service.extract_comprehensive_financial_data(ticker)
    
    if result['success']:
        print(f"\n✅ SUCCESS! Extracted {result['quarters_extracted']} quarters from {result['reports_found']} SEC reports")
        
        if result['quarterly_data']:
            # Show some sample quarterly data details
            print(f"\n📊 Sample Quarterly Financial Data:")
            for i, quarter in enumerate(result['quarterly_data'][:3]):
                print(f"\n   Quarter {i+1}: {quarter['quarter_key']} ({quarter['period_end_date']})")
                for metric_name, metric_data in quarter['metrics'].items():
                    value = metric_data['value']
                    if metric_name == 'eps':
                        print(f"     {metric_name}: ${value:.2f}")
                    else:
                        print(f"     {metric_name}: ${value:,.0f}")
    else:
        print("❌ Failed to extract SEC data")
    
    return result

if __name__ == "__main__":
    # Test the extraction
    test_sec_extraction('AAPL')