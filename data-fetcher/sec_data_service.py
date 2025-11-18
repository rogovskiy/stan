#!/usr/bin/env python3
"""
SEC Data Service - Final Integrated Version

Working version that properly extracts SEC quarterly data and caches it to Firebase.
"""

import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any
import logging
from secfsdstools.e_collector.companycollecting import CompanyReportCollector

from firebase_cache import FirebaseCache

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
    """Final working service for fetching and caching SEC financial data"""
    
    def __init__(self):
        # Set up logging to reduce noise
        logging.getLogger('secfsdstools').setLevel(logging.WARNING)
        self.cache = FirebaseCache()
        print("✅ SEC data service initialized with Firebase caching")
    
    def get_cik_for_ticker(self, ticker: str) -> Optional[int]:
        """Get CIK number for a ticker symbol"""
        return TICKER_TO_CIK.get(ticker.upper())
    
    def fetch_comprehensive_financial_data(self, ticker: str, years_back: int = 10) -> Dict[str, Any]:
        """
        Fetch comprehensive financial data from SEC filings and cache to Firebase
        """
        try:
            print(f'   📊 Fetching comprehensive SEC financial data for {ticker}...')
            
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
            
            # Extract and cache quarterly financial data
            num_df = raw_data_bag.num_df
            print(f'   Processing {len(num_df)} financial data entries')
            
            # Extract time series data and cache to Firebase
            time_series_results = self._extract_and_cache_quarterly_data(num_df, ticker)
            
            print(f'   ✅ SEC data summary:')
            print(f'     - Total reports processed: {stats.number_of_reports}')
            print(f'     - Revenue quarters cached: {time_series_results.get("revenue", 0)}')
            print(f'     - EPS quarters cached: {time_series_results.get("eps", 0)}')
            print(f'     - Net Income quarters cached: {time_series_results.get("net_income", 0)}')
            print(f'     - Total quarters cached: {time_series_results.get("total_quarters", 0)}')
            
            return {
                'quarters_processed': time_series_results.get("total_quarters", 0),
                'reports_found': stats.number_of_reports,
                'time_series_generated': time_series_results,
                'data_source': 'sec_filings',
                'success': True
            }
            
        except Exception as error:
            print(f'❌ Error fetching SEC data for {ticker}: {error}')
            import traceback
            traceback.print_exc()
            return self._empty_financial_results()
    
    def _extract_and_cache_quarterly_data(self, num_df: pd.DataFrame, ticker: str) -> Dict[str, Any]:
        """Extract quarterly data from num_df and cache each quarter to Firebase"""
        try:
            time_series_results = {}
            
            # Key financial metrics to extract
            financial_tags = {
                'revenue': ['Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
                'net_income': ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
                'eps': ['EarningsPerShareDiluted', 'EarningsPerShareBasic'],
                'total_assets': ['Assets'],
                'cash': ['CashAndCashEquivalentsAtCarryingValue']
            }
            
            # Group by adsh and ddate to get unique quarterly periods
            grouped = num_df.groupby(['adsh', 'ddate'])
            print(f'   🔍 Found {len(grouped)} unique (filing, date) combinations')
            
            # Track cached quarters
            quarters_cached = {}
            
            for (adsh, ddate), period_group in grouped:
                try:
                    if pd.isna(ddate):
                        continue
                    
                    # Parse fiscal information using the FIXED date parser
                    fiscal_info = self._parse_fiscal_period_from_date_FIXED(ddate)
                    if not fiscal_info:
                        continue
                    
                    quarter_key = f"{fiscal_info['fiscal_year']}Q{fiscal_info['fiscal_quarter']}"
                    
                    # Extract financial metrics for this quarter
                    quarter_metrics = {}
                    
                    for metric_name, tag_list in financial_tags.items():
                        # Find values for this metric in this period
                        metric_values = period_group[period_group['tag'].isin(tag_list)]
                        
                        if not metric_values.empty:
                            # Prefer quarterly data (qtrs=1) over annual/cumulative
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
                    
                    # Only cache quarters with meaningful financial data
                    if quarter_metrics:
                        # Check if we already have this quarter (keep the one with more metrics)
                        if quarter_key in quarters_cached:
                            if len(quarter_metrics) <= len(quarters_cached[quarter_key]['metrics']):
                                continue  # Skip if current quarter has fewer metrics
                        
                        # Create financial data structure for Firebase
                        financial_data = {
                            'fiscal_year': fiscal_info['fiscal_year'],
                            'fiscal_quarter': fiscal_info['fiscal_quarter'],
                            'quarter_key': quarter_key,
                            'form_type': '10-K' if fiscal_info['fiscal_quarter'] == 4 else '10-Q',
                            'filing_date': None,  # We could extract this from adsh if needed
                            'period_end_date': fiscal_info['period_end_date'],
                            'data_source': 'sec_filings',
                            'estimated': False,
                            'accession_number': adsh
                        }
                        
                        # Add financials section with extracted metrics
                        financial_data['financials'] = {}
                        if 'revenue' in quarter_metrics:
                            financial_data['financials']['revenue'] = quarter_metrics['revenue']['value']
                        if 'net_income' in quarter_metrics:
                            financial_data['financials']['net_income'] = quarter_metrics['net_income']['value']
                        if 'eps' in quarter_metrics:
                            financial_data['financials']['eps_diluted'] = quarter_metrics['eps']['value']
                        if 'total_assets' in quarter_metrics:
                            financial_data['financials']['total_assets'] = quarter_metrics['total_assets']['value']
                        if 'cash' in quarter_metrics:
                            financial_data['financials']['cash'] = quarter_metrics['cash']['value']
                        
                        financial_data['financials']['data_source'] = 'sec_filings'
                        
                        # Add earnings section if we have relevant data
                        if 'net_income' in quarter_metrics or 'eps' in quarter_metrics:
                            financial_data['earnings'] = {}
                            if 'net_income' in quarter_metrics:
                                financial_data['earnings']['net_income'] = quarter_metrics['net_income']['value']
                            if 'eps' in quarter_metrics:
                                financial_data['earnings']['eps_actual'] = quarter_metrics['eps']['value']
                            if 'revenue' in quarter_metrics:
                                financial_data['earnings']['revenue'] = quarter_metrics['revenue']['value']
                            financial_data['earnings']['data_source'] = 'sec_filings'
                        
                        # Cache to Firebase
                        try:
                            self.cache.cache_quarterly_financial_data(ticker, quarter_key, financial_data)
                            quarters_cached[quarter_key] = {
                                'metrics': quarter_metrics,
                                'fiscal_info': fiscal_info
                            }
                        except Exception as cache_error:
                            print(f'   ⚠️  Failed to cache {quarter_key}: {cache_error}')
                            continue
                        
                except Exception as period_error:
                    # Skip problematic periods
                    continue
            
            # Calculate results
            cached_quarters = list(quarters_cached.keys())
            
            # Count by metric type
            for metric_name in financial_tags.keys():
                count = sum(1 for q in quarters_cached.values() if metric_name in q['metrics'])
                if count > 0:
                    time_series_results[metric_name] = count
            
            time_series_results['total_quarters'] = len(cached_quarters)
            
            print(f'   📁 Successfully cached {len(cached_quarters)} quarters to Firebase')
            
            # Show sample of what was cached
            if cached_quarters:
                sorted_quarters = sorted(cached_quarters)
                sample_quarters = sorted_quarters[:3] + sorted_quarters[-2:] if len(sorted_quarters) > 5 else sorted_quarters
                print(f'   📋 Sample cached quarters: {", ".join(sample_quarters)}')
                
                years = sorted(list(set([q.split('Q')[0] for q in cached_quarters])))
                print(f'   📅 Data spans: {min(years)} to {max(years)} ({len(years)} years)')
            
            return time_series_results
            
        except Exception as e:
            print(f'   ❌ Error extracting and caching quarterly data: {e}')
            import traceback
            traceback.print_exc()
            return {}
    
    def _parse_fiscal_period_from_date_FIXED(self, date_value) -> Optional[Dict]:
        """FIXED date parser that handles numpy.int64 format like 20060930"""
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
            operating_items = ['Operating Income', 'Operating Income (Loss)', 'Income from Operations']
            for item in operating_items:
                if item in income_statement.index:
                    income_data['operating_income'] = float(income_statement.loc[item].iloc[-1])
                    break
            
            # EPS
            eps_items = ['Earnings Per Share - Basic', 'Earnings Per Share - Diluted', 'Basic Earnings Per Share']
            for item in eps_items:
                if item in income_statement.index:
                    income_data['eps_basic'] = float(income_statement.loc[item].iloc[-1])
                    break
                    
            eps_diluted_items = ['Earnings Per Share - Diluted', 'Diluted Earnings Per Share']
            for item in eps_diluted_items:
                if item in income_statement.index:
                    income_data['eps_diluted'] = float(income_statement.loc[item].iloc[-1])
                    break
            
            return income_data if income_data else None
            
        except Exception as e:
            print(f'   Error extracting income statement: {e}')
            return None
    
    def _extract_balance_sheet_data(self, balance_sheet: pd.DataFrame) -> Optional[Dict[str, Any]]:
        """Extract key metrics from balance sheet"""
        try:
            if balance_sheet.empty:
                return None
                
            balance_data = {}
            
            # Total Assets
            asset_items = ['Total Assets', 'Assets', 'Total Assets (Gross)']
            for item in asset_items:
                if item in balance_sheet.index:
                    balance_data['total_assets'] = float(balance_sheet.loc[item].iloc[-1])
                    break
            
            # Total Liabilities
            liability_items = ['Total Liabilities', 'Liabilities', 'Total Liabilities and Stockholders Equity']
            for item in liability_items:
                if item in balance_sheet.index:
                    balance_data['total_liabilities'] = float(balance_sheet.loc[item].iloc[-1])
                    break
            
            # Stockholders Equity
            equity_items = ['Stockholders Equity', 'Total Stockholders Equity', 'Total Shareholders Equity']
            for item in equity_items:
                if item in balance_sheet.index:
                    balance_data['stockholders_equity'] = float(balance_sheet.loc[item].iloc[-1])
                    break
            
            return balance_data if balance_data else None
            
        except Exception as e:
            print(f'   Error extracting balance sheet: {e}')
            return None
    
    def _extract_cash_flow_data(self, cash_flow: pd.DataFrame) -> Optional[Dict[str, Any]]:
        """Extract key metrics from cash flow statement"""
        try:
            if cash_flow.empty:
                return None
                
            cash_flow_data = {}
            
            # Operating Cash Flow
            operating_items = ['Net Cash Provided by Operating Activities', 'Cash Flow from Operating Activities']
            for item in operating_items:
                if item in cash_flow.index:
                    cash_flow_data['operating_cash_flow'] = float(cash_flow.loc[item].iloc[-1])
                    break
            
            # Investing Cash Flow
            investing_items = ['Net Cash Used in Investing Activities', 'Cash Flow from Investing Activities']
            for item in investing_items:
                if item in cash_flow.index:
                    cash_flow_data['investing_cash_flow'] = float(cash_flow.loc[item].iloc[-1])
                    break
            
            # Financing Cash Flow
            financing_items = ['Net Cash Used in Financing Activities', 'Cash Flow from Financing Activities']
            for item in financing_items:
                if item in cash_flow.index:
                    cash_flow_data['financing_cash_flow'] = float(cash_flow.loc[item].iloc[-1])
                    break
            
            # Look for dividend payments
            dividend_items = ['Dividends Paid', 'Cash Dividends Paid', 'Payments for Dividends']
            for item in dividend_items:
                if item in cash_flow.index:
                    cash_flow_data['dividends_paid'] = abs(float(cash_flow.loc[item].iloc[-1]))
                    break
            
            return cash_flow_data if cash_flow_data else None
            
        except Exception as e:
            print(f'   Error extracting cash flow: {e}')
            return None
    
    def _extract_earnings_data(self, income_data: Dict, fiscal_year: int, fiscal_quarter: int) -> Optional[Dict[str, Any]]:
        """Extract earnings-specific data from income statement"""
        earnings = {}
        
        if 'net_income' in income_data:
            earnings['net_income'] = income_data['net_income']
        
        if 'eps_diluted' in income_data:
            earnings['eps_actual'] = income_data['eps_diluted']
        elif 'eps_basic' in income_data:
            earnings['eps_actual'] = income_data['eps_basic']
        
        if 'revenue' in income_data:
            earnings['revenue'] = income_data['revenue']
        
        earnings['fiscal_year'] = fiscal_year
        earnings['fiscal_quarter'] = fiscal_quarter
        earnings['data_source'] = 'sec_filings'
        
        return earnings if len(earnings) > 3 else None  # Ensure we have meaningful earnings data
    
    def _get_fiscal_quarter_from_form(self, form_type: str, fiscal_period: str) -> int:
        """Determine fiscal quarter from form type and period"""
        if form_type == '10-K':
            return 4  # Annual report
        elif form_type == '10-Q' and fiscal_period:
            # Extract quarter from fiscal period (e.g., 'Q1', 'Q2', 'Q3')
            quarter_match = re.search(r'Q?(\d)', fiscal_period)
            if quarter_match:
                return int(quarter_match.group(1))
        
        return 1  # Default to Q1
    
    def _cache_earnings_summary(self, ticker: str, earnings_data: List[Dict]) -> None:
        """Cache a summary of earnings data"""
        try:
            earnings_summary = {
                'ticker': ticker.upper(),
                'total_quarters': len(earnings_data),
                'latest_update': datetime.now().isoformat(),
                'data_source': 'sec_filings',
                'earnings': earnings_data
            }
            
            # Cache with special key for earnings summary
            self.cache.cache_custom_data(f"{ticker}_earnings_summary", earnings_summary)
            
        except Exception as e:
            print(f'   Error caching earnings summary: {e}')
    
    def _extract_comprehensive_financial_data(self, report: IndexReport, standardized_data: Dict, ticker: str) -> Optional[Dict[str, Any]]:
        """Extract comprehensive financial data from a standardized SEC report"""
        try:
            # Determine fiscal period
            fiscal_year = report.fiscal_year
            fiscal_quarter = self._get_fiscal_quarter_from_form(report.form_type, report.fiscal_period)
            quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
            
            financial_data = {
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'quarter_key': quarter_key,
                'form_type': report.form_type,
                'filing_date': report.filing_date.strftime('%Y-%m-%d') if report.filing_date else None,
                'period_end_date': report.period_of_report.strftime('%Y-%m-%d') if report.period_of_report else None,
                'data_source': 'sec_filings',
                'estimated': False,
                'report_id': report.report_id,
                'company_name': report.company_name if hasattr(report, 'company_name') else None
            }
            
            # Extract income statement data
            if 'income_statement' in standardized_data:
                income_data = self._extract_income_statement_data(standardized_data['income_statement'])
                if income_data:
                    financial_data['income_statement'] = income_data
                    
                    # Extract earnings data
                    earnings = self._extract_earnings_data(income_data, fiscal_year, fiscal_quarter)
                    if earnings:
                        financial_data['earnings'] = earnings
            
            # Extract balance sheet data
            if 'balance_sheet' in standardized_data:
                balance_data = self._extract_balance_sheet_data(standardized_data['balance_sheet'])
                if balance_data:
                    financial_data['balance_sheet'] = balance_data
            
            # Extract cash flow data
            if 'cash_flow' in standardized_data:
                cash_flow_data = self._extract_cash_flow_data(standardized_data['cash_flow'])
                if cash_flow_data:
                    financial_data['cash_flow'] = cash_flow_data
            
            return financial_data if len(financial_data) > 8 else None  # Ensure we have actual financial data
            
        except Exception as e:
            print(f'   Error extracting comprehensive financial data from report: {e}')
            return None
    
    def _extract_dividend_data(self, cash_flow_data: Dict, financial_data: Dict) -> Optional[Dict[str, Any]]:
        """Extract dividend information from cash flow data"""
        try:
            # Look for dividend payments in cash flow data
            dividend_keys = [
                'dividends_paid', 'dividend_payments', 'cash_dividends_paid',
                'payments_for_dividends', 'dividend_payments_to_shareholders'
            ]
            
            dividend_amount = None
            for key in dividend_keys:
                if key in cash_flow_data:
                    dividend_amount = abs(cash_flow_data[key])  # Dividends are usually negative in cash flow
                    break
            
            if dividend_amount and dividend_amount > 0:
                return {
                    'date': financial_data['period_end_date'],
                    'fiscal_year': financial_data['fiscal_year'],
                    'fiscal_quarter': financial_data['fiscal_quarter'],
                    'value': dividend_amount,
                    'quarter_key': financial_data['quarter_key'],
                    'type': 'cash_dividend'
                }
            
            return None
            
        except Exception as e:
            print(f'   Error extracting dividend data: {e}')
            return None
    
    def _generate_time_series(self, data_points: List[Dict], metric_name: str) -> Dict[str, Any]:
        """Generate a chartable time series from data points"""
        try:
            # Sort by date
            sorted_data = sorted(data_points, key=lambda x: x['date'])
            
            # Create time series structure
            time_series = {
                'metric': metric_name,
                'data_source': 'sec_filings',
                'generated_at': datetime.now().isoformat(),
                'total_points': len(sorted_data),
                'date_range': {
                    'start': sorted_data[0]['date'] if sorted_data else None,
                    'end': sorted_data[-1]['date'] if sorted_data else None
                },
                'series': {
                    'quarterly': [],
                    'annual': []
                },
                'metadata': {
                    'units': self._get_metric_units(metric_name),
                    'description': self._get_metric_description(metric_name)
                }
            }
            
            # Build quarterly series
            for point in sorted_data:
                quarterly_point = {
                    'date': point['date'],
                    'value': point['value'],
                    'fiscal_year': point['fiscal_year'],
                    'fiscal_quarter': point['fiscal_quarter'],
                    'quarter_key': point['quarter_key']
                }
                
                # Add any additional metadata
                if 'type' in point:
                    quarterly_point['type'] = point['type']
                    
                time_series['series']['quarterly'].append(quarterly_point)
            
            # Build annual series by aggregating quarters
            annual_data = {}
            for point in sorted_data:
                year = point['fiscal_year']
                if year not in annual_data:
                    annual_data[year] = {
                        'year': year,
                        'quarters': [],
                        'total_value': 0,
                        'avg_value': 0
                    }
                
                annual_data[year]['quarters'].append({
                    'quarter': point['fiscal_quarter'],
                    'value': point['value']
                })
                annual_data[year]['total_value'] += point['value']
            
            # Calculate annual averages and build series
            for year_data in annual_data.values():
                year_data['avg_value'] = year_data['total_value'] / len(year_data['quarters'])
                
                annual_point = {
                    'year': year_data['year'],
                    'total_value': year_data['total_value'],
                    'avg_value': year_data['avg_value'],
                    'quarters_count': len(year_data['quarters']),
                    'quarters': year_data['quarters']
                }
                
                time_series['series']['annual'].append(annual_point)
            
            # Sort annual series by year
            time_series['series']['annual'].sort(key=lambda x: x['year'])
            
            return time_series
            
        except Exception as e:
            print(f'Error generating time series for {metric_name}: {e}')
            return {
                'metric': metric_name,
                'error': str(e),
                'generated_at': datetime.now().isoformat()
            }
    
    def _get_metric_units(self, metric_name: str) -> str:
        """Get appropriate units for a metric"""
        units_map = {
            'revenue': 'USD',
            'eps': 'USD per share',
            'dividends': 'USD',
            'earnings': 'USD'
        }
        return units_map.get(metric_name, 'USD')
    
    def _get_metric_description(self, metric_name: str) -> str:
        """Get description for a metric"""
        descriptions = {
            'revenue': 'Total revenue/sales from SEC filings',
            'eps': 'Earnings per share (diluted or basic) from SEC filings',
            'dividends': 'Cash dividend payments from SEC filings',
            'earnings': 'Net earnings/income from SEC filings'
        }
        return descriptions.get(metric_name, f'{metric_name} from SEC filings')
    
    def _cache_comprehensive_sec_data(self, ticker: str, all_financial_data: List[Dict]) -> None:
        """Cache comprehensive SEC data summary"""
        try:
            comprehensive_data = {
                'ticker': ticker.upper(),
                'total_periods': len(all_financial_data),
                'data_source': 'sec_filings',
                'last_updated': datetime.now().isoformat(),
                'date_range': {
                    'start': min(data['period_end_date'] for data in all_financial_data if data.get('period_end_date')),
                    'end': max(data['period_end_date'] for data in all_financial_data if data.get('period_end_date'))
                },
                'available_statements': {
                    'income_statement': sum(1 for data in all_financial_data if 'income_statement' in data),
                    'balance_sheet': sum(1 for data in all_financial_data if 'balance_sheet' in data),
                    'cash_flow': sum(1 for data in all_financial_data if 'cash_flow' in data)
                },
                'financial_data': all_financial_data
            }
            
            # Cache comprehensive data
            self.cache.cache_custom_data(f"{ticker}_comprehensive_sec_data", comprehensive_data)
            
            print(f'   Cached comprehensive SEC data: {len(all_financial_data)} periods')
            
        except Exception as e:
            print(f'   Error caching comprehensive SEC data: {e}')
    
    def _empty_financial_results(self) -> Dict[str, Any]:
        """Return empty results structure"""
        return {
            'quarters_processed': 0,
            'reports_found': 0,
            'time_series_generated': {},
            'data_source': 'sec_filings'
        }