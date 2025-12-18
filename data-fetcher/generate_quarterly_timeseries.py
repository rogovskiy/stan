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

from services.financial_data_service import FinancialDataService
from services.timeseries_service import TimeseriesService
from services.price_data_service import PriceDataService


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
        self.financial_service = FinancialDataService()
        self.timeseries_service = TimeseriesService()
        self.price_service = PriceDataService()
    
    def generate_quarterly_timeseries(self, ticker: str, save_to_cache: bool = True, verbose: bool = False) -> Dict[str, Any]:
        """Generate quarterly time series for EPS, revenue, and dividends"""
        
        print(f'\n📊 Generating quarterly time series for {ticker.upper()}')
        print('Extracting all available quarterly data...')
        
        try:
            # Get all available quarterly financial data (no date restrictions)
            quarterly_data = self.financial_service.get_all_financial_data(ticker)
            
            if not quarterly_data:
                print(f'❌ No quarterly data found for {ticker}')
                return self._create_empty_timeseries(ticker)
            
            print(f'📋 Found {len(quarterly_data)} quarters of data')
            
            # Extract time series data
            timeseries = self._extract_timeseries_data(quarterly_data, ticker, verbose)
            
            # Show missing dividends in verbose mode
            if verbose and timeseries.get('missing_dividends'):
                self._print_missing_dividends(timeseries['missing_dividends'])
            
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
                self.timeseries_service.cache_quarterly_timeseries(ticker, timeseries)
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
        
        # Load split history for split-adjusted EPS calculation
        splits = self.price_service.get_split_history(ticker)
        sorted_splits = sorted(splits, key=lambda x: x['date']) if splits else []
        
        if verbose and splits:
            print(f'   📉 Loaded {len(splits)} stock splits for adjustment')
        
        timeseries_data = []
        quarters_with_reasons = []  # Track quarters missing dividends with reasons
        
        for quarter in quarterly_data:
            try:
                # Create data point with all metrics
                data_point = {
                    'date': quarter.get('period_end_date'),  # Date when metrics are measured (quarter end)
                    'quarter_key': quarter.get('quarter_key', f"{quarter['fiscal_year']}Q{quarter['fiscal_quarter']}"),
                    'data_source': quarter.get('data_source', 'unknown')
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
                    eps_original = float(eps_value)
                    data_point['eps'] = eps_original
                    
                    # Calculate split-adjusted EPS
                    period_date = quarter.get('period_end_date')
                    if period_date and sorted_splits:
                        adjustment_factor = self._calculate_split_adjustment_factor(period_date, sorted_splits)
                        if adjustment_factor != 1.0:
                            eps_adjusted = eps_original / adjustment_factor
                            data_point['eps_adjusted'] = round(eps_adjusted, 4)
                            if verbose:
                                print(f'   {data_point["quarter_key"]}: EPS ${eps_original:.2f} → ${eps_adjusted:.2f} (adjusted by {adjustment_factor:.2f}x)')
                
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
                    data_point['revenue'] = float(revenue_value)
                
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
                    data_point['dividend_per_share'] = dividend_per_share
                else:
                    # Track reason for missing dividend
                    reason = None
                    if dividends_paid is None or dividends_paid == 0:
                        if not cash_flow:
                            reason = 'no_cash_flow_statement'
                        else:
                            reason = 'no_dividends_paid'
                    elif not outstanding_shares or outstanding_shares <= 0:
                        reason = 'no_outstanding_shares'
                    
                    if reason:
                        quarter_info_with_reason = {
                            'quarter_key': data_point['quarter_key'],
                            'missing_dividend_reason': reason
                        }
                        quarters_with_reasons.append(quarter_info_with_reason)
                
                # Only add data point if it has at least one metric
                if 'eps' in data_point or 'revenue' in data_point or 'dividend_per_share' in data_point:
                    timeseries_data.append(data_point)
                
            except Exception as e:
                if verbose:
                    print(f'   ⚠️  Error processing quarter {quarter.get("quarter_key", "unknown")}: {e}')
                continue
        
        # Sort by quarter_key (format: YYYYQN)
        timeseries_data.sort(key=lambda x: x['quarter_key'])
        
        # Calculate split-adjusted EPS for all quarters (if not already done)
        if sorted_splits:
            self._apply_split_adjustments(timeseries_data, sorted_splits)
        
        # Calculate growth rates (YoY - comparing to same quarter previous year)
        self._calculate_growth_rates_unified(timeseries_data)
        
        # Calculate summary stats
        eps_count = sum(1 for d in timeseries_data if 'eps' in d)
        revenue_count = sum(1 for d in timeseries_data if 'revenue' in d)
        dividend_count = sum(1 for d in timeseries_data if 'dividend_per_share' in d)
        
        latest_with_eps = next((d for d in reversed(timeseries_data) if 'eps' in d), None)
        latest_with_revenue = next((d for d in reversed(timeseries_data) if 'revenue' in d), None)
        latest_with_dividend = next((d for d in reversed(timeseries_data) if 'dividend_per_share' in d), None)
        
        # Use split-adjusted EPS in summary if available
        latest_eps_value = None
        if latest_with_eps:
            latest_eps_value = latest_with_eps.get('eps_adjusted') or latest_with_eps.get('eps')
        
        return {
            'ticker': ticker.upper(),
            'data': timeseries_data,
            'summary': {
                'total_quarters': len(timeseries_data),
                'eps_count': eps_count,
                'revenue_count': revenue_count,
                'dividend_count': dividend_count,
                'latest_eps': latest_eps_value,
                'latest_eps_adjusted': latest_with_eps.get('eps_adjusted') if latest_with_eps else None,
                'latest_revenue': latest_with_revenue['revenue'] if latest_with_revenue else None,
                'latest_dividend': latest_with_dividend['dividend_per_share'] if latest_with_dividend else None,
                'latest_quarter': timeseries_data[-1]['quarter_key'] if timeseries_data else None
            },
            'missing_dividends': quarters_with_reasons
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
    
    def _calculate_split_adjustment_factor(self, period_date: str, sorted_splits: List[Dict[str, Any]]) -> float:
        """Calculate the cumulative split adjustment factor for a given period date
        
        The adjustment factor is the product of all split ratios for splits that occurred
        AFTER the period date. This adjusts historical EPS to be comparable to current shares.
        
        Args:
            period_date: Period end date in YYYY-MM-DD format
            sorted_splits: List of splits sorted by date (oldest first), each with 'date' and 'split_ratio'
            
        Returns:
            Cumulative adjustment factor (1.0 if no adjustments needed)
        """
        if not period_date or not sorted_splits:
            return 1.0
        
        try:
            period_dt = datetime.strptime(period_date, '%Y-%m-%d')
            adjustment_factor = 1.0
            
            # Multiply all split ratios for splits that occurred after the period date
            for split in sorted_splits:
                try:
                    split_date = datetime.strptime(split['date'], '%Y-%m-%d')
                    split_ratio = split['split_ratio']
                    
                    # If split occurred after the period, multiply the adjustment factor
                    if split_date > period_dt:
                        adjustment_factor *= split_ratio
                except (ValueError, KeyError, TypeError):
                    continue
            
            return adjustment_factor
            
        except (ValueError, TypeError):
            return 1.0
    
    def _apply_split_adjustments(self, timeseries_data: List[Dict[str, Any]], 
                                sorted_splits: List[Dict[str, Any]]) -> None:
        """Apply split adjustments to EPS values in timeseries data
        
        Args:
            timeseries_data: List of quarter data points
            sorted_splits: List of splits sorted by date (oldest first)
        """
        for data_point in timeseries_data:
            if 'eps' in data_point and 'eps_adjusted' not in data_point:
                period_date = data_point.get('date')
                if period_date:
                    adjustment_factor = self._calculate_split_adjustment_factor(period_date, sorted_splits)
                    if adjustment_factor != 1.0:
                        eps_original = data_point['eps']
                        eps_adjusted = eps_original / adjustment_factor
                        data_point['eps_adjusted'] = round(eps_adjusted, 4)
    
    def _calculate_growth_rates_unified(self, data: List[Dict[str, Any]]) -> None:
        """Calculate YoY growth rates for unified time series data
        
        Args:
            data: List of quarter data points with eps, revenue, dividend_per_share fields
        """
        # Create lookup by quarter key for faster access
        data_by_key = {d['quarter_key']: d for d in data}
        
        for item in data:
            quarter_key = item['quarter_key']  # Format: YYYYQN
            year = int(quarter_key[:4])
            quarter_num = int(quarter_key[5])  # Extract N from YYYYQN
            
            # Look for same quarter in previous year
            previous_year_key = f"{year - 1}Q{quarter_num}"
            
            if previous_year_key in data_by_key:
                prev_item = data_by_key[previous_year_key]
                
                # Calculate EPS growth (use split-adjusted if both periods have it, otherwise use unadjusted)
                # This ensures we're comparing like-for-like values
                use_adjusted = 'eps_adjusted' in item and 'eps_adjusted' in prev_item
                
                if use_adjusted:
                    eps_current = item.get('eps_adjusted')
                    eps_prev = prev_item.get('eps_adjusted')
                else:
                    eps_current = item.get('eps')
                    eps_prev = prev_item.get('eps')
                
                if eps_current is not None and eps_prev is not None and eps_prev != 0:
                    growth_rate = ((eps_current - eps_prev) / eps_prev) * 100
                    item['eps_growth'] = round(growth_rate, 2)
                    # Mark whether growth was calculated using adjusted values
                    if use_adjusted:
                        item['eps_growth_adjusted'] = True
                
                # Calculate Revenue growth
                if 'revenue' in item and 'revenue' in prev_item and prev_item['revenue'] != 0:
                    growth_rate = ((item['revenue'] - prev_item['revenue']) / prev_item['revenue']) * 100
                    item['revenue_growth'] = round(growth_rate, 2)
                
                # Calculate Dividend growth
                if 'dividend_per_share' in item and 'dividend_per_share' in prev_item and prev_item['dividend_per_share'] != 0:
                    growth_rate = ((item['dividend_per_share'] - prev_item['dividend_per_share']) / prev_item['dividend_per_share']) * 100
                    item['dividend_growth'] = round(growth_rate, 2)
    
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
    
    def _print_missing_dividends(self, missing_dividends: List[Dict[str, Any]]) -> None:
        """Print which quarters are missing dividend data with reasons"""
        if not missing_dividends:
            return
            
        print(f'\n⚠️  Quarters missing dividends data ({len(missing_dividends)}):')
        
        # Group by year and reason
        by_year = {}
        for q in missing_dividends:
            quarter_key = q['quarter_key']  # Format: YYYYQN
            year = quarter_key[:4]
            if year not in by_year:
                by_year[year] = []
            
            reason_text = {
                'no_cash_flow_statement': 'no cash flow',
                'no_dividends_paid': 'no dividends',
                'no_outstanding_shares': 'no shares data'
            }.get(q['missing_dividend_reason'], 'unknown')
            
            by_year[year].append(f"{quarter_key} ({reason_text})")
        
        for year in sorted(by_year.keys()):
            quarters = ', '.join(by_year[year])
            print(f'   {year}: {quarters}')
    
    def _print_summary(self, timeseries: Dict[str, Any]) -> None:
        """Print summary of generated time series"""
        summary = timeseries.get('summary', {})
        
        print(f'\n📈 Time Series Summary for {timeseries["ticker"]}:')
        print(f'   Total quarters: {summary.get("total_quarters", 0)}')
        print(f'   EPS: {summary.get("eps_count", 0)} quarters')
        if summary.get('latest_eps'):
            print(f'       Latest: ${summary["latest_eps"]:.2f}')
        
        print(f'   Revenue: {summary.get("revenue_count", 0)} quarters')
        if summary.get('latest_revenue'):
            revenue_b = summary['latest_revenue'] / 1_000_000_000
            print(f'       Latest: ${revenue_b:.2f}B')
        
        print(f'   Dividends: {summary.get("dividend_count", 0)} quarters')
        if summary.get('latest_dividend'):
            print(f'       Latest: ${summary["latest_dividend"]:.4f} per share')
    
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
            summary = data.get('summary', {})
            quarters = metadata.get('quarters_processed', 0)
            eps_count = summary.get('eps_count', 0)
            revenue_count = summary.get('revenue_count', 0)
            dividends_count = summary.get('dividend_count', 0)
            
            print(f'   {ticker}: {quarters} quarters → EPS: {eps_count}, Revenue: {revenue_count}, Dividends: {dividends_count}')
        
        sys.exit(0)
        
    except Exception as error:
        print(f'\n💥 Error generating quarterly time series: {error}')
        sys.exit(1)


if __name__ == '__main__':
    main()