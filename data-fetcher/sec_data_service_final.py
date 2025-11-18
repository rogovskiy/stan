#!/usr/bin/env python3
"""
SEC Data Service - Final Working Version

Final version that properly extracts quarterly financial data from SEC filings.
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

class SECDataServiceFinal:
    """Final working service for extracting SEC financial data"""
    
    def __init__(self):
        # Set up logging to reduce noise
        logging.getLogger('secfsdstools').setLevel(logging.WARNING)
        print("✅ SEC final data service initialized")
    
    def get_cik_for_ticker(self, ticker: str) -> Optional[int]:
        """Get CIK number for a ticker symbol"""
        return TICKER_TO_CIK.get(ticker.upper())
    
    def extract_quarterly_financial_data(self, ticker: str) -> Dict[str, Any]:
        """Extract quarterly financial data and show detailed breakdown"""
        try:
            print(f'📊 Extracting quarterly SEC data for {ticker}...')
            
            # Get CIK for ticker
            cik = self.get_cik_for_ticker(ticker)
            if not cik:
                print(f'⚠️ CIK not found for ticker {ticker}')
                return self._empty_results()
            
            print(f'Using CIK {cik} for {ticker}')
            
            # Get company data collector
            collector = CompanyReportCollector.get_company_collector([cik])
            raw_data_bag = collector.collect()
            
            # Get the numerical data (this has the actual values!)
            num_df = raw_data_bag.num_df
            print(f'Found {len(num_df)} financial data points in SEC filings')
            
            # Extract quarterly data using the correct DataFrame
            quarterly_data = self._extract_quarterly_data_from_num_df(num_df, ticker)
            
            if quarterly_data:
                years = sorted(list(set([q['fiscal_year'] for q in quarterly_data])))
                print(f'✅ Extracted {len(quarterly_data)} quarters spanning {min(years)}-{max(years)}')
                
                # Show breakdown by metric
                metrics_count = {}
                for quarter in quarterly_data:
                    for metric in quarter['metrics'].keys():
                        metrics_count[metric] = metrics_count.get(metric, 0) + 1
                
                print(f'📈 Financial metrics found:')
                for metric, count in metrics_count.items():
                    print(f'   {metric}: {count} quarters')
            
            return {
                'ticker': ticker.upper(),
                'cik': cik,
                'quarterly_data': quarterly_data,
                'quarters_extracted': len(quarterly_data),
                'success': True
            }
            
        except Exception as error:
            print(f'❌ Error extracting SEC data for {ticker}: {error}')
            import traceback
            traceback.print_exc()
            return self._empty_results()
    
    def _extract_quarterly_data_from_num_df(self, num_df: pd.DataFrame, ticker: str) -> List[Dict]:
        """Extract quarterly data from num_df using proper date parsing"""
        try:
            quarterly_data = []
            
            # Key financial metrics to look for
            financial_tags = {
                'revenue': ['Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
                'net_income': ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
                'eps': ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
                'total_assets': ['Assets'],
                'cash': ['CashAndCashEquivalentsAtCarryingValue']
            }
            
            print(f'Processing {len(num_df)} financial entries...')
            
            # Group by adsh and ddate to get unique quarterly periods
            grouped = num_df.groupby(['adsh', 'ddate'])
            print(f'Found {len(grouped)} unique (filing, date) combinations')
            
            for (adsh, ddate), period_group in grouped:
                try:
                    if pd.isna(ddate):
                        continue
                    
                    # Parse fiscal information from date using our fixed parser
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
                            # Take the best value (prefer quarterly data over annual)
                            quarterly_values = metric_values[metric_values['qtrs'] == 1]
                            if not quarterly_values.empty:
                                best_value = quarterly_values.iloc[-1]
                            else:
                                best_value = metric_values.iloc[-1]
                            
                            if pd.notna(best_value['value']) and best_value['value'] != 0:
                                quarter_metrics[metric_name] = {
                                    'value': float(best_value['value']),
                                    'tag': best_value['tag'],
                                    'units': best_value.get('uom', 'USD'),
                                    'quarters_span': best_value.get('qtrs', 1)
                                }
                    
                    # Only include quarters with at least one meaningful metric
                    if quarter_metrics:
                        quarter_data = {
                            'quarter_key': quarter_key,
                            'fiscal_year': fiscal_info['fiscal_year'],
                            'fiscal_quarter': fiscal_info['fiscal_quarter'],
                            'period_end_date': fiscal_info['period_end_date'],
                            'accession_number': adsh,
                            'metrics': quarter_metrics,
                            'data_source': 'sec_filings'
                        }
                        
                        # Create readable summary
                        summary_parts = []
                        if 'revenue' in quarter_metrics:
                            rev = quarter_metrics['revenue']['value']
                            summary_parts.append(f"Revenue: ${rev/1e9:.1f}B")
                        if 'net_income' in quarter_metrics:
                            ni = quarter_metrics['net_income']['value']
                            summary_parts.append(f"Net Income: ${ni/1e9:.1f}B")
                        if 'eps' in quarter_metrics:
                            eps = quarter_metrics['eps']['value']
                            summary_parts.append(f"EPS: ${eps:.2f}")
                        
                        quarter_data['summary'] = ', '.join(summary_parts) if summary_parts else f"{len(quarter_metrics)} metrics"
                        quarterly_data.append(quarter_data)
                        
                except Exception as period_error:
                    # Skip problematic periods
                    continue
            
            # Remove duplicate quarters (keep the one with more metrics)
            unique_quarters = {}
            for quarter in quarterly_data:
                key = quarter['quarter_key']
                if key not in unique_quarters or len(quarter['metrics']) > len(unique_quarters[key]['metrics']):
                    unique_quarters[key] = quarter
            
            # Sort by fiscal year and quarter
            final_data = list(unique_quarters.values())
            final_data.sort(key=lambda x: (x['fiscal_year'], x['fiscal_quarter']))
            
            print(f'📊 Successfully extracted {len(final_data)} unique quarters')
            return final_data
            
        except Exception as e:
            print(f'❌ Error in quarterly extraction: {e}')
            import traceback
            traceback.print_exc()
            return []
    
    def _parse_fiscal_period_from_date(self, date_value) -> Optional[Dict]:
        """Parse fiscal year and quarter from a date (handles integer format like 20060930)"""
        try:
            if pd.isna(date_value):
                return None
            
            # Convert integer dates like 20060930 to datetime
            if isinstance(date_value, (int, float)):
                date_str = str(int(date_value))
                if len(date_str) == 8:  # YYYYMMDD format
                    year = int(date_str[:4])
                    month = int(date_str[4:6])
                    day = int(date_str[6:8])
                    date_obj = pd.Timestamp(year=year, month=month, day=day)
                else:
                    return None
            elif isinstance(date_value, str):
                if len(date_value) == 8 and date_value.isdigit():  # "20060930"
                    year = int(date_value[:4])
                    month = int(date_value[4:6])
                    day = int(date_value[6:8])
                    date_obj = pd.Timestamp(year=year, month=month, day=day)
                else:
                    date_obj = pd.to_datetime(date_value)
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
    
    def show_sample_quarters(self, ticker: str, limit: int = 10):
        """Show a sample of extracted quarterly data"""
        result = self.extract_quarterly_financial_data(ticker)
        
        if not result['success'] or not result['quarterly_data']:
            print('No quarterly data available')
            return
        
        print(f'\n📋 Sample Quarterly Data for {ticker}:')
        print('=' * 80)
        
        for i, quarter in enumerate(result['quarterly_data'][:limit]):
            print(f'\n{i+1}. {quarter["quarter_key"]} ({quarter["period_end_date"]})')
            print(f'   Filing: {quarter["accession_number"]}')
            print(f'   Summary: {quarter["summary"]}')
            
            for metric_name, metric_data in quarter['metrics'].items():
                value = metric_data['value']
                if metric_name == 'eps':
                    print(f'     {metric_name}: ${value:.2f}')
                elif value > 1e9:
                    print(f'     {metric_name}: ${value/1e9:.1f}B')
                elif value > 1e6:
                    print(f'     {metric_name}: ${value/1e6:.1f}M')
                else:
                    print(f'     {metric_name}: ${value:,.0f}')
        
        if len(result['quarterly_data']) > limit:
            print(f'\n... and {len(result["quarterly_data"]) - limit} more quarters')
        
        return result
    
    def _empty_results(self) -> Dict[str, Any]:
        """Return empty results structure"""
        return {
            'quarterly_data': [],
            'quarters_extracted': 0,
            'success': False
        }

def test_final_extraction(ticker: str = 'AAPL'):
    """Test the final SEC data extraction"""
    print(f"🧪 Final SEC Data Extraction Test for {ticker}")
    print("=" * 60)
    
    service = SECDataServiceFinal()
    result = service.show_sample_quarters(ticker, limit=8)
    
    return result

if __name__ == "__main__":
    # Test the final extraction
    test_final_extraction('AAPL')