#!/usr/bin/env python3
"""
Time Series Data Utility

Utility for retrieving and working with time series data from SEC filings.
Provides easy access to EPS, revenue, and dividend time series.
"""

import json
from datetime import datetime
from typing import Dict, List, Optional, Any
import pandas as pd

from sec_data_service import SECDataService
from firebase_cache import FirebaseCache


class TimeSeriesDataUtil:
    """Utility for working with time series data from SEC filings"""
    
    def __init__(self):
        self.sec_service = SECDataService()
        self.cache = FirebaseCache()
    
    def get_chartable_data(self, ticker: str, metrics: List[str] = None) -> Dict[str, Any]:
        """
        Get chartable time series data for specified metrics
        
        Args:
            ticker: Stock ticker symbol
            metrics: List of metrics to retrieve ['revenue', 'eps', 'dividends']
                    If None, retrieves all available metrics
        
        Returns:
            Dictionary with chartable data for each metric
        """
        if metrics is None:
            metrics = ['revenue', 'eps', 'dividends']
        
        result = {
            'ticker': ticker.upper(),
            'generated_at': datetime.now().isoformat(),
            'available_metrics': [],
            'chart_data': {}
        }
        
        for metric in metrics:
            series_data = self.sec_service.get_time_series_data(ticker, metric)
            
            if series_data and 'series' in series_data:
                result['available_metrics'].append(metric)
                result['chart_data'][metric] = self._format_for_charting(series_data, metric)
        
        return result
    
    def get_quarterly_series(self, ticker: str, metric: str) -> Optional[List[Dict]]:
        """Get quarterly time series data for a specific metric"""
        series_data = self.sec_service.get_time_series_data(ticker, metric)
        
        if series_data and 'series' in series_data and 'quarterly' in series_data['series']:
            return series_data['series']['quarterly']
        
        return None
    
    def get_annual_series(self, ticker: str, metric: str) -> Optional[List[Dict]]:
        """Get annual time series data for a specific metric"""
        series_data = self.sec_service.get_time_series_data(ticker, metric)
        
        if series_data and 'series' in series_data and 'annual' in series_data['series']:
            return series_data['series']['annual']
        
        return None
    
    def export_to_csv(self, ticker: str, metric: str, output_file: str = None) -> str:
        """Export time series data to CSV file"""
        if output_file is None:
            output_file = f"{ticker.lower()}_{metric}_timeseries.csv"
        
        quarterly_data = self.get_quarterly_series(ticker, metric)
        
        if not quarterly_data:
            print(f"No {metric} data found for {ticker}")
            return None
        
        # Convert to DataFrame
        df = pd.DataFrame(quarterly_data)
        
        # Reorder columns for better readability
        column_order = ['date', 'fiscal_year', 'fiscal_quarter', 'value', 'quarter_key']
        if 'type' in df.columns:
            column_order.append('type')
        
        df = df[column_order]
        
        # Save to CSV
        df.to_csv(output_file, index=False)
        
        print(f"Exported {len(df)} {metric} data points to {output_file}")
        return output_file
    
    def get_summary_stats(self, ticker: str, metric: str) -> Dict[str, Any]:
        """Get summary statistics for a time series"""
        quarterly_data = self.get_quarterly_series(ticker, metric)
        
        if not quarterly_data:
            return {'error': f'No {metric} data found for {ticker}'}
        
        values = [point['value'] for point in quarterly_data]
        
        summary = {
            'ticker': ticker.upper(),
            'metric': metric,
            'total_quarters': len(quarterly_data),
            'date_range': {
                'start': quarterly_data[0]['date'],
                'end': quarterly_data[-1]['date']
            },
            'statistics': {
                'min': min(values),
                'max': max(values),
                'mean': sum(values) / len(values),
                'latest': quarterly_data[-1]['value'],
                'growth_rate': self._calculate_growth_rate(quarterly_data)
            }
        }
        
        return summary
    
    def compare_metrics(self, ticker: str, metrics: List[str]) -> Dict[str, Any]:
        """Compare multiple metrics for a ticker"""
        comparison = {
            'ticker': ticker.upper(),
            'metrics_compared': metrics,
            'comparison_data': {},
            'generated_at': datetime.now().isoformat()
        }
        
        for metric in metrics:
            stats = self.get_summary_stats(ticker, metric)
            if 'error' not in stats:
                comparison['comparison_data'][metric] = stats['statistics']
        
        return comparison
    
    def _format_for_charting(self, series_data: Dict, metric: str) -> Dict[str, Any]:
        """Format time series data for charting libraries"""
        if 'series' not in series_data or 'quarterly' not in series_data['series']:
            return {'error': 'No quarterly data available'}
        
        quarterly = series_data['series']['quarterly']
        
        chart_data = {
            'type': 'time_series',
            'metric': metric,
            'units': series_data.get('metadata', {}).get('units', 'USD'),
            'description': series_data.get('metadata', {}).get('description', ''),
            'data_points': len(quarterly),
            'x_axis': [point['date'] for point in quarterly],
            'y_axis': [point['value'] for point in quarterly],
            'labels': [f"Q{point['fiscal_quarter']} {point['fiscal_year']}" for point in quarterly],
            'quarterly_data': quarterly
        }
        
        # Add annual data if available
        if 'annual' in series_data['series']:
            annual = series_data['series']['annual']
            chart_data['annual_totals'] = {
                'years': [point['year'] for point in annual],
                'totals': [point['total_value'] for point in annual],
                'averages': [point['avg_value'] for point in annual]
            }
        
        return chart_data
    
    def _calculate_growth_rate(self, quarterly_data: List[Dict]) -> float:
        """Calculate quarter-over-quarter growth rate"""
        if len(quarterly_data) < 2:
            return 0.0
        
        latest = quarterly_data[-1]['value']
        previous = quarterly_data[-2]['value']
        
        if previous == 0:
            return 0.0
        
        return ((latest - previous) / previous) * 100
    
    def print_summary(self, ticker: str, metrics: List[str] = None):
        """Print a summary of available time series data"""
        if metrics is None:
            metrics = ['revenue', 'eps', 'dividends']
        
        print(f"\n📊 Time Series Data Summary for {ticker.upper()}")
        print("=" * 50)
        
        for metric in metrics:
            stats = self.get_summary_stats(ticker, metric)
            
            if 'error' in stats:
                print(f"\n{metric.upper()}: No data available")
                continue
            
            print(f"\n{metric.upper()}:")
            print(f"  • Data Points: {stats['total_quarters']} quarters")
            print(f"  • Date Range: {stats['date_range']['start']} to {stats['date_range']['end']}")
            print(f"  • Latest Value: ${stats['statistics']['latest']:,.2f}")
            print(f"  • Min/Max: ${stats['statistics']['min']:,.2f} / ${stats['statistics']['max']:,.2f}")
            print(f"  • Average: ${stats['statistics']['mean']:,.2f}")
            print(f"  • Q/Q Growth: {stats['statistics']['growth_rate']:+.2f}%")
    
    def cache_status(self, ticker: str) -> Dict[str, Any]:
        """Check cache status for time series data"""
        metrics = ['revenue', 'eps', 'dividends']
        status = {
            'ticker': ticker.upper(),
            'cached_metrics': [],
            'missing_metrics': [],
            'last_check': datetime.now().isoformat()
        }
        
        for metric in metrics:
            series_data = self.sec_service.get_time_series_data(ticker, metric)
            if series_data:
                status['cached_metrics'].append(metric)
            else:
                status['missing_metrics'].append(metric)
        
        return status


# Convenience functions for quick access
def get_revenue_data(ticker: str) -> Optional[List[Dict]]:
    """Quick function to get revenue time series"""
    util = TimeSeriesDataUtil()
    return util.get_quarterly_series(ticker, 'revenue')

def get_eps_data(ticker: str) -> Optional[List[Dict]]:
    """Quick function to get EPS time series"""
    util = TimeSeriesDataUtil()
    return util.get_quarterly_series(ticker, 'eps')

def get_dividend_data(ticker: str) -> Optional[List[Dict]]:
    """Quick function to get dividend time series"""
    util = TimeSeriesDataUtil()
    return util.get_quarterly_series(ticker, 'dividends')

def export_all_metrics(ticker: str, output_dir: str = ".") -> List[str]:
    """Export all available metrics to CSV files"""
    util = TimeSeriesDataUtil()
    exported_files = []
    
    metrics = ['revenue', 'eps', 'dividends']
    
    for metric in metrics:
        try:
            output_file = f"{output_dir}/{ticker.lower()}_{metric}_timeseries.csv"
            result = util.export_to_csv(ticker, metric, output_file)
            if result:
                exported_files.append(result)
        except Exception as e:
            print(f"Failed to export {metric} data: {e}")
    
    return exported_files

if __name__ == "__main__":
    # Example usage
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python time_series_util.py <TICKER> [metric]")
        print("Example: python time_series_util.py AAPL")
        print("Example: python time_series_util.py AAPL revenue")
        sys.exit(1)
    
    ticker = sys.argv[1]
    
    util = TimeSeriesDataUtil()
    
    if len(sys.argv) >= 3:
        metric = sys.argv[2].lower()
        if metric in ['revenue', 'eps', 'dividends']:
            stats = util.get_summary_stats(ticker, metric)
            print(json.dumps(stats, indent=2))
        else:
            print(f"Unknown metric: {metric}. Available: revenue, eps, dividends")
    else:
        # Print summary for all metrics
        util.print_summary(ticker)