#!/usr/bin/env python3
"""
Quarterly Time Series Generator

Extracts EPS, revenue, and dividends from quarterly financial data cache
and generates optimized time series objects for UI consumption.
"""

import os
import sys
import json
import argparse
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dotenv import load_dotenv

# Load environment variables first
load_dotenv('.env.local')

from firebase_cache import FirebaseCache


def validate_firebase_config():
    """Validate required Firebase environment variables"""
    required_vars = [
        'FIREBASE_PROJECT_ID',
        'FIREBASE_PRIVATE_KEY_ID', 
        'FIREBASE_PRIVATE_KEY',
        'FIREBASE_CLIENT_EMAIL',
        'FIREBASE_CLIENT_ID',
        'FIREBASE_AUTH_URI',
        'FIREBASE_TOKEN_URI'
    ]
    
    missing_vars = [var for var in required_vars if not os.getenv(var)]
    
    if missing_vars:
        print('❌ Missing required Firebase environment variables:')
        for var in missing_vars:
            print(f'   - {var}')
        print('\n💡 Please check your .env.local file in the project root.')
        print('   Make sure all Firebase configuration variables are set.')
        sys.exit(1)
    
    print('✅ Firebase configuration loaded successfully')
    print(f'📍 Project ID: {os.getenv("FIREBASE_PROJECT_ID")}')


class QuarterlyTimeSeriesGenerator:
    """Generates time series data from quarterly financial cache"""
    
    def __init__(self):
        self.cache = FirebaseCache()
    
    def generate_quarterly_timeseries(self, ticker: str, years_back: int = 10, 
                                    save_to_cache: bool = True, verbose: bool = False) -> Dict[str, Any]:
        """Generate quarterly time series for EPS, revenue, and dividends"""
        
        print(f'\n📊 Generating quarterly time series for {ticker.upper()}')
        print(f'Extracting data from last {years_back} years...')
        
        try:
            # Calculate date range
            end_date = datetime.now()
            start_date = end_date - timedelta(days=years_back * 365)
            
            # Get all quarterly financial data for the range
            quarterly_data = self.cache.get_financial_data_range(ticker, start_date, end_date)
            
            if not quarterly_data:
                print(f'❌ No quarterly data found for {ticker}')
                return self._create_empty_timeseries(ticker)
            
            print(f'📋 Found {len(quarterly_data)} quarters of data')
            
            # Extract time series data
            timeseries = self._extract_timeseries_data(quarterly_data, ticker, verbose)
            
            # Add metadata
            timeseries['metadata'] = {
                'ticker': ticker.upper(),
                'quarters_processed': len(quarterly_data),
                'date_range': {
                    'start': start_date.strftime('%Y-%m-%d'),
                    'end': end_date.strftime('%Y-%m-%d')
                },
                'generated_at': datetime.now().isoformat(),
                'data_sources': list(set([q.get('data_source', 'unknown') for q in quarterly_data]))
            }
            
            # Save to cache if requested
            if save_to_cache:
                cache_key = f'{ticker.upper()}_quarterly_timeseries'
                self.cache.cache_custom_data(cache_key, timeseries)
                print(f'✅ Cached quarterly time series as: {cache_key}')
            
            if verbose:
                self._print_summary(timeseries)
            
            return timeseries
            
        except Exception as error:
            print(f'❌ Error generating quarterly time series for {ticker}: {error}')
            return self._create_empty_timeseries(ticker)
    
    def _extract_timeseries_data(self, quarterly_data: List[Dict[str, Any]], 
                                ticker: str, verbose: bool) -> Dict[str, Any]:
        """Extract and organize time series data from quarterly records"""
        
        eps_data = []
        revenue_data = []
        dividends_data = []
        
        for quarter in quarterly_data:
            try:
                # Create common quarter info using period_end_date
                quarter_info = {
                    'quarter': f"Q{quarter['fiscal_quarter']}",
                    'year': quarter['fiscal_year'],
                    'quarter_key': f"{quarter['fiscal_year']}Q{quarter['fiscal_quarter']}",
                    'period_end_date': quarter.get('period_end_date'),
                    'report_date': quarter.get('report_date')
                }
                
                # Extract EPS data
                eps_value = self._extract_eps_value(quarter)
                if eps_value is not None:
                    eps_data.append({
                        **quarter_info,
                        'value': eps_value,
                        'estimated': quarter.get('estimated', False),
                        'data_source': quarter.get('data_source', 'unknown')
                    })
                
                # Extract revenue data
                revenue_value = self._extract_revenue_value(quarter)
                if revenue_value is not None:
                    revenue_data.append({
                        **quarter_info,
                        'value': revenue_value,
                        'estimated': quarter.get('estimated', False),
                        'data_source': quarter.get('data_source', 'unknown')
                    })
                
                # Extract dividends data
                dividend_value = self._extract_dividend_value(quarter)
                if dividend_value is not None:
                    dividends_data.append({
                        **quarter_info,
                        'value': dividend_value,
                        'estimated': quarter.get('estimated', False),
                        'data_source': quarter.get('data_source', 'unknown')
                    })
                
            except Exception as e:
                if verbose:
                    print(f'   ⚠️  Error processing quarter {quarter.get("quarter_key", "unknown")}: {e}')
                continue
        
        # Sort all data by fiscal year and quarter
        eps_data.sort(key=lambda x: (x['year'], int(x['quarter'][1:])))
        revenue_data.sort(key=lambda x: (x['year'], int(x['quarter'][1:])))
        dividends_data.sort(key=lambda x: (x['year'], int(x['quarter'][1:])))
        
        return {
            'ticker': ticker.upper(),
            'eps': {
                'data': eps_data,
                'count': len(eps_data),
                'latest_value': eps_data[-1]['value'] if eps_data else None,
                'latest_quarter': eps_data[-1]['quarter_key'] if eps_data else None
            },
            'revenue': {
                'data': revenue_data,
                'count': len(revenue_data),
                'latest_value': revenue_data[-1]['value'] if revenue_data else None,
                'latest_quarter': revenue_data[-1]['quarter_key'] if revenue_data else None
            },
            'dividends': {
                'data': dividends_data,
                'count': len(dividends_data),
                'latest_value': dividends_data[-1]['value'] if dividends_data else None,
                'latest_quarter': dividends_data[-1]['quarter_key'] if dividends_data else None
            }
        }
    
    def _extract_eps_value(self, quarter: Dict[str, Any]) -> Optional[float]:
        """Extract EPS value from quarter data"""
        # Try multiple potential sources for EPS
        sources = [
            # From earnings section
            ('earnings', 'eps_actual'),
            ('earnings', 'eps_diluted'),
            ('earnings', 'eps'),
            # From earnings section
            ('earnings', 'eps_actual'),
            ('earnings', 'eps_diluted'),
            ('earnings', 'eps'),
            # From financials section
            ('financials', 'eps_diluted'),
            ('financials', 'eps'),
            ('financials', 'eps_basic'),
            # Direct from quarter
            ('eps_actual',),
            ('eps_diluted',),
            ('eps',)
        ]
        
        for source_path in sources:
            value = self._get_nested_value(quarter, source_path)
            if value is not None and isinstance(value, (int, float)):
                return float(value)
        
        return None
    
    def _extract_revenue_value(self, quarter: Dict[str, Any]) -> Optional[float]:
        """Extract revenue value from quarter data"""
        # Try multiple potential sources for revenue
        sources = [
            # From financials section
            ('financials', 'revenue'),
            ('financials', 'total_revenue'),
            ('financials', 'revenues'),
            ('financials', 'sales_revenue_net'),
            # Direct from quarter
            ('revenue',),
            ('total_revenue',),
            ('revenues',)
        ]
        
        for source_path in sources:
            value = self._get_nested_value(quarter, source_path)
            if value is not None and isinstance(value, (int, float)):
                return float(value)
        
        return None
    
    def _extract_dividend_value(self, quarter: Dict[str, Any]) -> Optional[float]:
        """Extract dividend value from quarter data"""
        # Try multiple potential sources for dividends
        sources = [
            # From financials section
            ('financials', 'dividends_per_share'),
            ('financials', 'dividend_per_share'),
            ('financials', 'dividends'),
            ('financials', 'dividend'),
            # From earnings section
            ('earnings', 'dividends_per_share'),
            ('earnings', 'dividend'),
            # Direct from quarter
            ('dividends_per_share',),
            ('dividend_per_share',),
            ('dividends',),
            ('dividend',)
        ]
        
        for source_path in sources:
            value = self._get_nested_value(quarter, source_path)
            if value is not None and isinstance(value, (int, float)):
                return float(value)
        
        return None
    
    def _get_nested_value(self, data: Dict[str, Any], path: Tuple[str, ...]) -> Any:
        """Get nested value from dictionary using path tuple"""
        current = data
        for key in path:
            if isinstance(current, dict) and key in current:
                current = current[key]
            else:
                return None
        return current
    
    def _create_empty_timeseries(self, ticker: str) -> Dict[str, Any]:
        """Create empty time series structure"""
        return {
            'ticker': ticker.upper(),
            'eps': {'data': [], 'count': 0, 'latest_value': None, 'latest_quarter': None},
            'revenue': {'data': [], 'count': 0, 'latest_value': None, 'latest_quarter': None},
            'dividends': {'data': [], 'count': 0, 'latest_value': None, 'latest_quarter': None},
            'metadata': {
                'ticker': ticker.upper(),
                'quarters_processed': 0,
                'generated_at': datetime.now().isoformat(),
                'data_sources': []
            }
        }
    
    def _print_summary(self, timeseries: Dict[str, Any]) -> None:
        """Print summary of generated time series"""
        print(f'\n📈 Time Series Summary for {timeseries["ticker"]}:')
        print(f'   EPS: {timeseries["eps"]["count"]} quarters')
        if timeseries["eps"]["latest_value"]:
            print(f'       Latest: ${timeseries["eps"]["latest_value"]:.2f} ({timeseries["eps"]["latest_quarter"]})')
        
        print(f'   Revenue: {timeseries["revenue"]["count"]} quarters')
        if timeseries["revenue"]["latest_value"]:
            revenue_b = timeseries["revenue"]["latest_value"] / 1_000_000_000
            print(f'       Latest: ${revenue_b:.2f}B ({timeseries["revenue"]["latest_quarter"]})')
        
        print(f'   Dividends: {timeseries["dividends"]["count"]} quarters')
        if timeseries["dividends"]["latest_value"]:
            print(f'       Latest: ${timeseries["dividends"]["latest_value"]:.2f} ({timeseries["dividends"]["latest_quarter"]})')
    
    def get_cached_timeseries(self, ticker: str, max_age_hours: int = 24) -> Optional[Dict[str, Any]]:
        """Get cached quarterly time series"""
        cache_key = f'{ticker.upper()}_quarterly_timeseries'
        return self.cache.get_custom_data(cache_key, max_age_hours)
    
    def generate_for_multiple_tickers(self, tickers: List[str], years_back: int = 10,
                                    save_to_cache: bool = True, verbose: bool = False) -> Dict[str, Dict[str, Any]]:
        """Generate quarterly time series for multiple tickers"""
        results = {}
        
        print(f'\n🔄 Generating quarterly time series for {len(tickers)} tickers...')
        
        for i, ticker in enumerate(tickers, 1):
            print(f'\nProcessing {i}/{len(tickers)}: {ticker}')
            timeseries = self.generate_quarterly_timeseries(
                ticker=ticker,
                years_back=years_back,
                save_to_cache=save_to_cache,
                verbose=verbose
            )
            results[ticker.upper()] = timeseries
        
        print(f'\n🎉 Completed processing {len(tickers)} tickers')
        return results


def main():
    """Main CLI interface"""
    validate_firebase_config()
    
    parser = argparse.ArgumentParser(
        description='Generate quarterly time series data from Firebase cache',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  python generate_quarterly_timeseries.py AAPL
  python generate_quarterly_timeseries.py AAPL --years 5 --verbose
  python generate_quarterly_timeseries.py AAPL MSFT GOOGL --years 10
  python generate_quarterly_timeseries.py AAPL --no-cache --verbose
        '''
    )
    
    parser.add_argument('tickers', nargs='+', help='One or more stock ticker symbols')
    parser.add_argument('--years', type=int, default=10,
                       help='Number of years back to process (default: 10)')
    parser.add_argument('--no-cache', action='store_true',
                       help='Do not save results to cache')
    parser.add_argument('--verbose', action='store_true',
                       help='Show detailed processing information')
    parser.add_argument('--output', type=str,
                       help='Save results to JSON file')
    
    args = parser.parse_args()
    
    generator = QuarterlyTimeSeriesGenerator()
    
    try:
        if len(args.tickers) == 1:
            # Single ticker
            ticker = args.tickers[0].upper()
            timeseries = generator.generate_quarterly_timeseries(
                ticker=ticker,
                years_back=args.years,
                save_to_cache=not args.no_cache,
                verbose=args.verbose
            )
            results = {ticker: timeseries}
        else:
            # Multiple tickers
            results = generator.generate_for_multiple_tickers(
                tickers=args.tickers,
                years_back=args.years,
                save_to_cache=not args.no_cache,
                verbose=args.verbose
            )
        
        # Save to file if requested
        if args.output:
            with open(args.output, 'w') as f:
                json.dump(results, f, indent=2)
            print(f'\n💾 Results saved to {args.output}')
        
        # Print summary
        print(f'\n📊 Generation Summary:')
        for ticker, data in results.items():
            metadata = data.get('metadata', {})
            quarters = metadata.get('quarters_processed', 0)
            eps_count = data.get('eps', {}).get('count', 0)
            revenue_count = data.get('revenue', {}).get('count', 0)
            dividends_count = data.get('dividends', {}).get('count', 0)
            
            print(f'   {ticker}: {quarters} quarters → EPS: {eps_count}, Revenue: {revenue_count}, Dividends: {dividends_count}')
        
        sys.exit(0)
        
    except Exception as error:
        print(f'\n💥 Error generating quarterly time series: {error}')
        sys.exit(1)


if __name__ == '__main__':
    main()