#!/usr/bin/env python3
"""
Yahoo Finance Service - Python Version

Handles data fetching from Yahoo Finance API using yfinance library.
Enhanced with SEC filings data from secfsdstools.
Now supports dynamic CIK lookup for any publicly traded company.
"""

import yfinance as yf
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
import re
import json

from firebase_cache import FirebaseCache
from cik_lookup_service import CIKLookupService

class YFinanceService:
    """Service for fetching data from Yahoo Finance and SEC filings"""
    
    def __init__(self):
        self.cache = FirebaseCache()
        self.cik_lookup = CIKLookupService()
        print("✅ YFinance service initialized with dynamic SEC CIK lookup")
    
    def get_cik_for_ticker(self, ticker: str) -> Optional[int]:
        """Get CIK number for any ticker symbol using dynamic lookup"""
        return self.cik_lookup.get_cik_by_ticker(ticker)
    
    def fetch_and_cache_ticker_metadata(self, ticker: str) -> Dict[str, Any]:
        """Fetch and cache company metadata for a ticker"""
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            
            metadata = {
                'name': info.get('longName', self._get_company_name_fallback(ticker)),
                'exchange': info.get('exchange', 'NASDAQ'),
                'sector': info.get('sector', 'Technology'),
                'last_updated': datetime.now().isoformat()
            }
            
            self.cache.cache_ticker_metadata(ticker, metadata)
            return metadata
            
        except Exception as error:
            print(f"Could not fetch metadata for {ticker}, using fallback: {error}")
            fallback_metadata = {
                'name': self._get_company_name_fallback(ticker),
                'exchange': 'NASDAQ',
                'sector': 'Technology',
                'last_updated': datetime.now().isoformat()
            }
            
            self.cache.cache_ticker_metadata(ticker, fallback_metadata)
            return fallback_metadata
    
    def fetch_max_historical_data(self, ticker: str, max_years_back: int = 50) -> Dict[str, Any]:
        """Fetch and cache maximum available historical data for a ticker"""
        try:
            # Calculate maximum date range
            end_date = datetime.now()
            start_date = end_date - timedelta(days=max_years_back * 365)
            
            print(f'   Fetching data from {start_date.strftime("%Y-%m-%d")} to {end_date.strftime("%Y-%m-%d")}')
            
            # Fetch maximum historical data
            stock = yf.Ticker(ticker)
            historical = stock.history(start=start_date, end=end_date, interval='1d')
            
            print(f'   Retrieved {len(historical)} daily price points')
            
            if historical.empty:
                return {
                    'years_processed': 0,
                    'data_points_retrieved': 0,
                    'years_range': 'No data available'
                }
            
            # Group data by years
            annual_data = self._group_data_by_years(historical, ticker)
            print(f'   Organized data into {len(annual_data)} years')
            
            # Cache each year separately
            cached_years = 0
            for year_str, price_data in annual_data.items():
                year = int(year_str)
                try:
                    self.cache.cache_annual_price_data(ticker, year, price_data)
                    cached_years += 1
                except Exception as error:
                    print(f'   ❌ Failed to cache year {year}: {error}')
            
            return {
                'years_processed': cached_years,
                'data_points_retrieved': len(historical),
                'years_range': f'{start_date.strftime("%Y-%m-%d")} to {end_date.strftime("%Y-%m-%d")}'
            }
            
        except Exception as error:
            print(f'❌ Error fetching historical data for {ticker}: {error}')
            raise error
    
    def fetch_max_financial_data(self, ticker: str) -> Dict[str, Any]:
        """Fetch comprehensive historical financial data from both Yahoo Finance and SEC filings"""
        try:
            print(f'   📊 Fetching comprehensive financial data from multiple sources...')
            
            # First, get basic data from Yahoo Finance
            yfinance_results = self._fetch_yfinance_financial_data(ticker)
            
            # Then, get comprehensive data from SEC filings using the working extraction
            sec_results = self._fetch_sec_financial_data_integrated(ticker)
            
            # Combine results
            if sec_results['success']:
                total_quarters = yfinance_results['quarters_processed'] + sec_results['quarters_processed']
                total_earnings = yfinance_results['historical_earnings'] + sec_results['quarters_processed']
                
                print(f'   ✅ Combined financial data summary:')
                print(f'     - Yahoo Finance: {yfinance_results["quarters_processed"]} quarters')
                print(f'     - SEC Filings: {sec_results["quarters_processed"]} quarters cached')
                print(f'     - SEC Reports: {sec_results["reports_found"]} reports processed')
                print(f'     - Total quarters cached: {total_quarters}')
                print(f'     - Total earnings records: {total_earnings}')
                
                return {
                    'quarters_processed': total_quarters,
                    'historical_earnings': total_earnings,
                    'forecast_quarters': yfinance_results['forecast_quarters'],
                    'sec_reports_processed': sec_results['reports_found'],
                    'sec_time_series': sec_results.get('time_series_generated', {}),
                    'data_sources': ['yfinance', 'sec_filings']
                }
            else:
                print(f'   ⚠️  SEC data not available for {ticker}, using Yahoo Finance only')
                return yfinance_results
            
        except Exception as error:
            print(f'❌ Error fetching comprehensive financial data for {ticker}: {error}')
            # Fall back to just Yahoo Finance data
            return self._fetch_yfinance_financial_data(ticker)
    
    def _fetch_yfinance_financial_data(self, ticker: str) -> Dict[str, Any]:
        """Fetch financial data from Yahoo Finance only (original implementation)"""
        stock = yf.Ticker(ticker)
        
        cached_quarters = 0
        historical_count = 0
        forecast_count = 0
        
        # Get income statement for earnings data
        try:
            income_stmt = stock.quarterly_income_stmt
            if income_stmt is not None and not income_stmt.empty:
                historical_count = len(income_stmt.columns)
                print(f'   Found {historical_count} quarterly financial records')
                
                for date_col in income_stmt.columns:
                    quarter_key = self._get_quarter_key_from_date(date_col)
                    if quarter_key:
                        # Extract net income as earnings
                        net_income = income_stmt.loc['Net Income', date_col] if 'Net Income' in income_stmt.index else None
                        
                        if pd.notna(net_income):
                            financial_data = {
                                'fiscal_year': int(quarter_key[:4]),
                                'fiscal_quarter': int(quarter_key[5:]),
                                'start_date': self._get_quarter_start_date(quarter_key),
                                'end_date': self._get_quarter_end_date(quarter_key),
                                'report_date': date_col.strftime('%Y-%m-%d') if hasattr(date_col, 'strftime') else None,
                                'financials': {
                                    'net_income': float(net_income),
                                    'data_source': 'yfinance_actual',
                                    'estimated': False
                                }
                            }
                            
                            self.cache.cache_quarterly_financial_data(ticker, quarter_key, financial_data)
                            cached_quarters += 1
                        
        except Exception as e:
            print(f'   Could not fetch income statement: {e}')
        
        # Try to get earnings calendar/estimates
        try:
            info = stock.info
            if info and 'earningsDate' in info:
                # This is very limited data from yfinance
                print(f'   Found earnings date info in stock info')
                forecast_count = 1
                
        except Exception as e:
            print(f'   Could not fetch earnings estimates: {e}')
        
        print(f'   ✅ Financial data summary:')
        print(f'     - Historical earnings: {historical_count} quarters')
        print(f'     - Forecasts: {forecast_count} quarters')
        print(f'     - Total cached: {cached_quarters} quarters')
        
        return {
            'quarters_processed': cached_quarters,
            'historical_earnings': historical_count,
            'forecast_quarters': forecast_count
        }
    
    def _fetch_sec_financial_data_integrated(self, ticker: str) -> Dict[str, Any]:
        """Integrated SEC data fetching with dynamic CIK lookup"""
        try:
            from secfsdstools.e_collector.companycollecting import CompanyReportCollector
            import logging
            logging.getLogger('secfsdstools').setLevel(logging.WARNING)
            
            # Get CIK using dynamic lookup (supports any ticker)
            cik = self.get_cik_for_ticker(ticker)
            if not cik:
                print(f'   ⚠️  CIK not found for ticker {ticker} in SEC database')
                return {'success': False, 'quarters_processed': 0, 'reports_found': 0}
            
            print(f'   📊 Fetching SEC data for {ticker} (CIK: {cik})...')
            
            # Get company data collector
            collector = CompanyReportCollector.get_company_collector([cik])
            raw_data_bag = collector.collect()
            
            # Get statistics and numerical data
            stats = raw_data_bag.statistics()
            num_df = raw_data_bag.num_df
            
            print(f'   Found {stats.number_of_reports} SEC reports with {len(num_df)} data points')
            
            # Extract and cache quarterly data using proven logic
            quarters_cached = self._extract_and_cache_sec_quarters(num_df, ticker)
            
            return {
                'success': True,
                'quarters_processed': quarters_cached,
                'reports_found': stats.number_of_reports,
                'time_series_generated': {'total_quarters': quarters_cached}
            }
            
        except Exception as e:
            print(f'   ❌ Error fetching SEC data: {e}')
            return {'success': False, 'quarters_processed': 0, 'reports_found': 0}
    
    def _extract_and_cache_sec_quarters(self, num_df: pd.DataFrame, ticker: str) -> int:
        """Extract and cache SEC quarterly data using the proven working approach"""
        try:
            # Financial metrics to extract
            financial_tags = {
                'revenue': ['Revenues', 'SalesRevenueNet', 'RevenueFromContractWithCustomerExcludingAssessedTax'],
                'net_income': ['NetIncomeLoss', 'ProfitLoss', 'NetIncomeLossAvailableToCommonStockholdersBasic'],
                'eps': ['EarningsPerShareDiluted', 'EarningsPerShareBasic']
            }
            
            quarters_cached = 0
            cached_quarters = {}
            
            # Group by adsh and ddate
            grouped = num_df.groupby(['adsh', 'ddate'])
            
            for (adsh, ddate), period_group in grouped:
                try:
                    if pd.isna(ddate):
                        continue
                    
                    # Parse date using the FIXED parser
                    fiscal_info = self._parse_date_fixed(ddate)
                    if not fiscal_info:
                        continue
                    
                    quarter_key = f"{fiscal_info['fiscal_year']}Q{fiscal_info['fiscal_quarter']}"
                    
                    # Skip if already processed this quarter
                    if quarter_key in cached_quarters:
                        continue
                    
                    # Extract metrics for this quarter
                    quarter_data = {
                        'fiscal_year': fiscal_info['fiscal_year'],
                        'fiscal_quarter': fiscal_info['fiscal_quarter'],
                        'quarter_key': quarter_key,
                        'period_end_date': fiscal_info['period_end_date'],
                        'accession_number': adsh,
                        'data_source': 'sec_filings',
                        'estimated': False,
                        'financials': {'data_source': 'sec_filings'}
                    }
                    
                    # Extract financial metrics
                    has_data = False
                    for metric_name, tag_list in financial_tags.items():
                        metric_values = period_group[period_group['tag'].isin(tag_list)]
                        if not metric_values.empty:
                            # Prefer quarterly data (qtrs=1)
                            quarterly_values = metric_values[metric_values['qtrs'] == 1]
                            value_row = quarterly_values.iloc[-1] if not quarterly_values.empty else metric_values.iloc[-1]
                            
                            if pd.notna(value_row['value']) and value_row['value'] != 0:
                                quarter_data['financials'][metric_name] = float(value_row['value'])
                                has_data = True
                                
                                # Add to earnings section if relevant
                                if metric_name in ['net_income', 'eps']:
                                    if 'earnings' not in quarter_data:
                                        quarter_data['earnings'] = {'data_source': 'sec_filings'}
                                    if metric_name == 'eps':
                                        quarter_data['earnings']['eps_actual'] = float(value_row['value'])
                                    else:
                                        quarter_data['earnings'][metric_name] = float(value_row['value'])
                    
                    # Cache if we have meaningful data
                    if has_data:
                        self.cache.cache_quarterly_financial_data(ticker, quarter_key, quarter_data)
                        cached_quarters[quarter_key] = True
                        quarters_cached += 1
                        
                except Exception:
                    continue
            
            print(f'   📁 Cached {quarters_cached} SEC quarters to Firebase')
            return quarters_cached
            
        except Exception as e:
            print(f'   ❌ Error caching SEC quarters: {e}')
            return 0
    
    def _parse_date_fixed(self, date_value):
        """Fixed date parser for numpy.int64 SEC dates"""
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
                
                quarter = (month - 1) // 3 + 1
                
                return {
                    'fiscal_year': year,
                    'fiscal_quarter': quarter,
                    'period_end_date': date_obj.strftime('%Y-%m-%d')
                }
            return None
        except:
            return None
    
    def _group_data_by_years(self, historical: pd.DataFrame, ticker: str) -> Dict[str, Dict[str, Any]]:
        """Group daily historical data by years"""
        annual_data = {}
        
        for date_index, row in historical.iterrows():
            year = date_index.year
            year_str = str(year)
            date_str = date_index.strftime('%Y-%m-%d')
            
            if year_str not in annual_data:
                annual_data[year_str] = {
                    'ticker': ticker.upper(),
                    'year': year,
                    'currency': 'USD',
                    'timezone': 'America/New_York',
                    'data': {},
                    'metadata': {
                        'total_days': 0,
                        'generated_at': datetime.now().isoformat(),
                        'source': 'yfinance_python'
                    }
                }
            
            annual_data[year_str]['data'][date_str] = {
                'o': round(float(row.get('Open', row.get('Close', 0))), 2),
                'h': round(float(row.get('High', row.get('Close', 0))), 2),
                'l': round(float(row.get('Low', row.get('Close', 0))), 2),
                'c': round(float(row.get('Close', 0)), 2),
                'v': int(row.get('Volume', 0))
            }
        
        # Update total_days metadata for each year
        for year_str, data in annual_data.items():
            data['metadata']['total_days'] = len(data['data'])
        
        return annual_data
    
    def _get_quarter_key_from_date(self, date) -> Optional[str]:
        """Generate quarter key from date (e.g., '2024Q1')"""
        try:
            if hasattr(date, 'year') and hasattr(date, 'month'):
                year = date.year
                quarter = (date.month - 1) // 3 + 1
                return f"{year}Q{quarter}"
            return None
        except Exception:
            return None
    
    def _get_quarter_start_date(self, quarter_key: str) -> str:
        """Get quarter start date from quarter key"""
        year = int(quarter_key[:4])
        quarter = int(quarter_key[5:])
        start_month = (quarter - 1) * 3 + 1
        return datetime(year, start_month, 1).strftime('%Y-%m-%d')
    
    def _get_quarter_end_date(self, quarter_key: str) -> str:
        """Get quarter end date from quarter key"""
        year = int(quarter_key[:4])
        quarter = int(quarter_key[5:])
        end_month = quarter * 3
        # Get last day of the quarter
        if end_month == 12:
            end_date = datetime(year + 1, 1, 1) - timedelta(days=1)
        else:
            end_date = datetime(year, end_month + 1, 1) - timedelta(days=1)
        return end_date.strftime('%Y-%m-%d')
    
    def _create_financial_data_from_earnings(self, row: pd.Series, quarter_key: str, date_index) -> Dict[str, Any]:
        """Create financial data structure from earnings data"""
        year = int(quarter_key[:4])
        quarter = int(quarter_key[5:])
        
        start_month = (quarter - 1) * 3
        end_month = start_month + 2
        
        earnings_data = {}
        if 'Earnings' in row and pd.notna(row['Earnings']):
            earnings_data['eps_actual'] = float(row['Earnings'])
        
        financials = {
            'data_source': 'yfinance_actual',
            'estimated': False
        }
        
        if 'Earnings' in row and pd.notna(row['Earnings']):
            financials['eps_diluted'] = float(row['Earnings'])
        
        if 'Revenue' in row and pd.notna(row['Revenue']):
            financials['revenue'] = float(row['Revenue'])
        
        result = {
            'fiscal_year': year,
            'fiscal_quarter': quarter,
            'start_date': datetime(year, start_month + 1, 1).strftime('%Y-%m-%d'),
            'end_date': datetime(year, end_month + 1, 1).replace(day=1) - timedelta(days=1),
            'report_date': date_index.strftime('%Y-%m-%d') if hasattr(date_index, 'strftime') else None
        }
        
        if earnings_data:
            result['earnings'] = earnings_data
        if len(financials) > 2:  # More than just data_source and estimated
            result['financials'] = financials
        
        return result
    
    def _create_financial_data_from_forecast(self, row: pd.Series, quarter_key: str, date_index) -> Dict[str, Any]:
        """Create financial data structure from forecast data"""
        year = int(quarter_key[:4])
        quarter = int(quarter_key[5:])
        
        start_month = (quarter - 1) * 3
        end_month = start_month + 2
        
        forecast_data = {}
        if 'Earnings Estimate' in row and pd.notna(row['Earnings Estimate']):
            forecast_data['estimate'] = float(row['Earnings Estimate'])
        
        financials = {
            'data_source': 'yfinance_forecast',
            'estimated': True
        }
        
        if 'Earnings Estimate' in row and pd.notna(row['Earnings Estimate']):
            financials['eps_diluted'] = float(row['Earnings Estimate'])
        
        result = {
            'fiscal_year': year,
            'fiscal_quarter': quarter,
            'start_date': datetime(year, start_month + 1, 1).strftime('%Y-%m-%d'),
            'end_date': (datetime(year, end_month + 1, 1).replace(day=1) - timedelta(days=1)).strftime('%Y-%m-%d')
        }
        
        if forecast_data:
            result['forecast'] = forecast_data
        if len(financials) > 2:
            result['financials'] = financials
        
        return result
    
    def _get_company_name_fallback(self, ticker: str) -> str:
        """Fallback company names for well-known tickers"""
        company_names = {
            'AAPL': 'Apple Inc.',
            'MSFT': 'Microsoft Corporation',
            'GOOGL': 'Alphabet Inc.',
            'GOOG': 'Alphabet Inc.',
            'AMZN': 'Amazon.com Inc.',
            'TSLA': 'Tesla Inc.',
            'META': 'Meta Platforms Inc.',
            'NVDA': 'NVIDIA Corporation',
            'NFLX': 'Netflix Inc.',
            'AMD': 'Advanced Micro Devices Inc.'
        }
        
        return company_names.get(ticker.upper(), f'{ticker.upper()} Inc.')