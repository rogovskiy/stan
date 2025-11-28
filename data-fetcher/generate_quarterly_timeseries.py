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
env_path = os.path.join(os.path.dirname(__file__), '.env.local')
load_dotenv(env_path)

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
    
    def generate_quarterly_timeseries(self, ticker: str, save_to_cache: bool = True, verbose: bool = False) -> Dict[str, Any]:
        """Generate quarterly time series for EPS, revenue, and dividends"""
        
        print(f'\n📊 Generating quarterly time series for {ticker.upper()}')
        print('Extracting all available quarterly data...')
        
        try:
            # Get all available quarterly financial data (no date restrictions)
            quarterly_data = self.cache.get_all_financial_data(ticker)
            
            if not quarterly_data:
                print(f'❌ No quarterly data found for {ticker}')
                return self._create_empty_timeseries(ticker)
            
            print(f'📋 Found {len(quarterly_data)} quarters of data')
            
            # Extract time series data
            timeseries = self._extract_timeseries_data(quarterly_data, ticker, verbose)
            
            # Show missing dividends in verbose mode
            if verbose and timeseries['dividends']['count'] < len(quarterly_data):
                self._print_missing_dividends(quarterly_data, timeseries['dividends']['data'])
            
            # Add metadata
            timeseries['metadata'] = {
                'ticker': ticker.upper(),
                'quarters_processed': len(quarterly_data),
                'date_range': {
                    'start': 'all_available',
                    'end': datetime.now().strftime('%Y-%m-%d')
                },
                'generated_at': datetime.now().isoformat(),
                'data_sources': list(set([q.get('data_source', 'unknown') for q in quarterly_data]))
            }
            
            # Save to cache if requested
            if save_to_cache:
                self.cache.cache_quarterly_timeseries(ticker, timeseries)
                print(f'✅ Cached quarterly time series in tickers/{ticker.upper()}/timeseries/quarterly')
            
            if verbose:
                self._print_summary(timeseries)
            
            return timeseries
            
        except Exception as error:
            print(f'❌ Error generating quarterly time series for {ticker}: {error}')
            return self._create_empty_timeseries(ticker)
    
    def _extract_timeseries_data(self, quarterly_data: List[Dict[str, Any]], 
                                ticker: str, verbose: bool) -> Dict[str, Any]:
        """Extract and organize time series data from unified quarterly records"""
        
        eps_data = []
        revenue_data = []
        dividends_data = []
        
        for quarter in quarterly_data:
            try:
                # Create common quarter info using the unified format
                quarter_info = {
                    'quarter': f"Q{quarter['fiscal_quarter']}",
                    'year': quarter['fiscal_year'],
                    'quarter_key': quarter.get('quarter_key', f"{quarter['fiscal_year']}Q{quarter['fiscal_quarter']}"),
                    'period_end_date': quarter.get('period_end_date'),
                    'report_date': quarter.get('report_date')
                }
                
                # Extract EPS data from unified format (try multiple locations)
                eps_value = None
                if 'eps' in quarter and quarter['eps'] is not None:
                    eps_value = quarter['eps']
                elif 'income_statement' in quarter and quarter['income_statement']:
                    income_stmt = quarter['income_statement']
                    if 'earnings_per_share' in income_stmt and income_stmt['earnings_per_share'] is not None:
                        eps_value = income_stmt['earnings_per_share']
                    elif 'eps' in income_stmt and income_stmt['eps'] is not None:
                        eps_value = income_stmt['eps']
                elif 'financials' in quarter and quarter['financials'] and 'eps' in quarter['financials']:
                    eps_value = quarter['financials']['eps']
                elif 'financials' in quarter and quarter['financials'] and 'epsDiluted' in quarter['financials']:
                    eps_value = quarter['financials']['epsDiluted']
                elif 'earnings' in quarter and quarter['earnings'] and 'eps_actual' in quarter['earnings']:
                    eps_value = quarter['earnings']['eps_actual']
                
                if eps_value is not None:
                    eps_data.append({
                        **quarter_info,
                        'value': float(eps_value),
                        'estimated': quarter.get('estimated', False),
                        'data_source': quarter.get('data_source', 'unknown')
                    })
                
                # Extract revenue data from unified format
                revenue_value = None
                if 'revenue' in quarter and quarter['revenue'] is not None:
                    revenue_value = quarter['revenue']
                elif 'income_statement' in quarter and quarter['income_statement']:
                    income_stmt = quarter['income_statement']
                    if 'revenues' in income_stmt and income_stmt['revenues'] is not None:
                        revenue_value = income_stmt['revenues']
                    elif 'revenue' in income_stmt and income_stmt['revenue'] is not None:
                        revenue_value = income_stmt['revenue']
                elif 'financials' in quarter and quarter['financials'] and 'revenue' in quarter['financials']:
                    revenue_value = quarter['financials']['revenue']
                
                if revenue_value is not None:
                    revenue_data.append({
                        **quarter_info,
                        'value': float(revenue_value),
                        'estimated': quarter.get('estimated', False),
                        'data_source': quarter.get('data_source', 'unknown')
                    })
                
                # Calculate dividend per share using outstanding_shares
                cash_flow = quarter.get('cash_flow_statement', {})
                income_stmt = quarter.get('income_statement', {})
                
                dividends_paid = cash_flow.get('dividends_paid')
                outstanding_shares = income_stmt.get('outstanding_shares')
                
                # For older quarters without outstanding_shares, calculate from EPS and net_income
                if not outstanding_shares or outstanding_shares <= 0:
                    eps = income_stmt.get('earnings_per_share')
                    net_income = income_stmt.get('net_income')
                    if eps and eps != 0 and net_income:
                        outstanding_shares = abs(float(net_income)) / abs(float(eps))
                
                # Use outstanding_shares directly if available and positive
                if dividends_paid is not None and dividends_paid != 0 and outstanding_shares and outstanding_shares > 0:
                    # Calculate dividend per share: dividends_paid / outstanding_shares
                    dividend_per_share = abs(float(dividends_paid)) / float(outstanding_shares)
                    dividends_data.append({
                        **quarter_info,
                        'value': dividend_per_share,
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
        
        # Calculate growth rates (YoY - comparing to same quarter previous year)
        self._calculate_growth_rates(eps_data)
        self._calculate_growth_rates(revenue_data)
        self._calculate_growth_rates(dividends_data)
        
        return {
            'ticker': ticker.upper(),
            'eps': {
                'data': eps_data,
                'count': len(eps_data),
                'latest_value': eps_data[-1]['value'] if eps_data else None,
                'latest_quarter': eps_data[-1]['quarter_key'] if eps_data else None,
                'latest_growth_rate': eps_data[-1].get('growth_rate') if eps_data else None
            },
            'revenue': {
                'data': revenue_data,
                'count': len(revenue_data),
                'latest_value': revenue_data[-1]['value'] if revenue_data else None,
                'latest_quarter': revenue_data[-1]['quarter_key'] if revenue_data else None,
                'latest_growth_rate': revenue_data[-1].get('growth_rate') if revenue_data else None
            },
            'dividends': {
                'data': dividends_data,
                'count': len(dividends_data),
                'latest_value': dividends_data[-1]['value'] if dividends_data else None,
                'latest_quarter': dividends_data[-1]['quarter_key'] if dividends_data else None,
                'latest_growth_rate': dividends_data[-1].get('growth_rate') if dividends_data else None
            }
        }
    
    def _create_empty_timeseries(self, ticker: str) -> Dict[str, Any]:
        """Create empty time series structure"""
        return {
            'ticker': ticker.upper(),
            'eps': {'data': [], 'count': 0, 'latest_value': None, 'latest_quarter': None, 'latest_growth_rate': None},
            'revenue': {'data': [], 'count': 0, 'latest_value': None, 'latest_quarter': None, 'latest_growth_rate': None},
            'dividends': {'data': [], 'count': 0, 'latest_value': None, 'latest_quarter': None, 'latest_growth_rate': None},
            'metadata': {
                'ticker': ticker.upper(),
                'quarters_processed': 0,
                'generated_at': datetime.now().isoformat(),
                'data_sources': []
            }
        }
    
    def _calculate_growth_rates(self, data: List[Dict[str, Any]]) -> None:
        """Calculate YoY growth rates for time series data (comparing to same quarter previous year)
        
        Args:
            data: List of quarter data points, must be sorted by year and quarter
        """
        # Create lookup by quarter key for faster access
        data_by_key = {d['quarter_key']: d for d in data}
        
        for item in data:
            year = item['year']
            quarter_num = int(item['quarter'][1:])  # Extract quarter number from 'Q1', 'Q2', etc.
            
            # Look for same quarter in previous year
            previous_year_key = f"{year - 1}Q{quarter_num}"
            
            if previous_year_key in data_by_key:
                previous_value = data_by_key[previous_year_key]['value']
                current_value = item['value']
                
                if previous_value != 0:
                    growth_rate = ((current_value - previous_value) / previous_value) * 100
                    item['growth_rate'] = round(growth_rate, 2)  # Percentage
                else:
                    item['growth_rate'] = None
            else:
                item['growth_rate'] = None  # No comparison data available
    
    def _print_missing_dividends(self, quarterly_data: List[Dict[str, Any]], dividends_data: List[Dict[str, Any]]) -> None:
        """Print which quarters are missing dividend data"""
        # Create set of quarter keys that have dividends
        quarters_with_dividends = {d['quarter_key'] for d in dividends_data}
        
        # Find quarters without dividends
        missing_quarters = []
        for quarter in quarterly_data:
            quarter_key = f"{quarter['fiscal_year']}Q{quarter['fiscal_quarter']}"
            if quarter_key not in quarters_with_dividends:
                missing_quarters.append(quarter_key)
        
        if missing_quarters:
            print(f'\n⚠️  Quarters missing dividends data ({len(missing_quarters)}):')
            # Group by year for better readability
            by_year = {}
            for q in missing_quarters:
                year = q[:4]
                if year not in by_year:
                    by_year[year] = []
                by_year[year].append(q)
            
            for year in sorted(by_year.keys()):
                quarters = ', '.join(by_year[year])
                print(f'   {year}: {quarters}')
    
    def _print_summary(self, timeseries: Dict[str, Any]) -> None:
        """Print summary of generated time series"""
        print(f'\n📈 Time Series Summary for {timeseries["ticker"]}:')
        print(f'   EPS: {timeseries["eps"]["count"]} quarters')
        if timeseries["eps"]["latest_value"]:
            latest_growth = timeseries["eps"].get("latest_growth_rate")
            growth_str = f' ({latest_growth:+.1f}% YoY)' if latest_growth is not None else ''
            print(f'       Latest: ${timeseries["eps"]["latest_value"]:.2f} ({timeseries["eps"]["latest_quarter"]}){growth_str}')
        
        print(f'   Revenue: {timeseries["revenue"]["count"]} quarters')
        if timeseries["revenue"]["latest_value"]:
            revenue_b = timeseries["revenue"]["latest_value"] / 1_000_000_000
            latest_growth = timeseries["revenue"].get("latest_growth_rate")
            growth_str = f' ({latest_growth:+.1f}% YoY)' if latest_growth is not None else ''
            print(f'       Latest: ${revenue_b:.2f}B ({timeseries["revenue"]["latest_quarter"]}){growth_str}')
        
        print(f'   Dividends: {timeseries["dividends"]["count"]} quarters')
        if timeseries["dividends"]["latest_value"]:
            dividends_b = timeseries["dividends"]["latest_value"] / 1_000_000_000
            latest_growth = timeseries["dividends"].get("latest_growth_rate")
            growth_str = f' ({latest_growth:+.1f}% YoY)' if latest_growth is not None else ''
            print(f'       Latest: ${dividends_b:.3f}B ({timeseries["dividends"]["latest_quarter"]}){growth_str}')
    
    def get_cached_quarterly_timeseries(self, ticker: str, max_age_hours: int = 24) -> Optional[Dict[str, Any]]:
        """Get cached quarterly time series"""
        return self.cache.get_quarterly_timeseries(ticker, max_age_hours)
    
    def generate_for_multiple_tickers(self, tickers: List[str], save_to_cache: bool = True, verbose: bool = False) -> Dict[str, Dict[str, Any]]:
        """Generate quarterly time series for multiple tickers"""
        results = {}
        
        print(f'\n🔄 Generating quarterly time series for {len(tickers)} tickers...')
        
        for i, ticker in enumerate(tickers, 1):
            print(f'\\nProcessing {i}/{len(tickers)}: {ticker}')
            timeseries = self.generate_quarterly_timeseries(
                ticker,
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
  python generate_quarterly_timeseries.py AAPL --verbose
  python generate_quarterly_timeseries.py AAPL MSFT GOOGL
  python generate_quarterly_timeseries.py AAPL --no-cache --verbose
        '''
    )
    
    parser.add_argument('tickers', nargs='+', help='One or more stock ticker symbols')
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
                save_to_cache=not args.no_cache,
                verbose=args.verbose
            )
            results = {ticker: timeseries}
        else:
            # Multiple tickers
            results = generator.generate_for_multiple_tickers(
                args.tickers,
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