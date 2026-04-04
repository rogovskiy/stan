#!/usr/bin/env python3
"""Run quarterly timeseries aggregation and return a result dict for refresh_driver / job_runs."""

from datetime import datetime
from typing import Any, Dict

from yahoo.generate_quarterly_timeseries import QuarterlyTimeSeriesGenerator


def refresh_quarterly_timeseries(ticker: str, verbose: bool = False) -> Dict[str, Any]:
    """
    Regenerate tickers/{TICKER}/timeseries/quarterly from Firestore quarters.

    Returns keys: success, error (optional), started_at, finished_at (datetime UTC),
    payload_summary (optional dict for Firestore job payload).
    """
    started_at = datetime.utcnow()
    try:
        gen = QuarterlyTimeSeriesGenerator()
        data = gen.generate_quarterly_timeseries(ticker, save_to_cache=True, verbose=verbose)
        finished_at = datetime.utcnow()
        summary = data.get('summary') or {}
        total = summary.get('total_quarters')
        if total is None:
            total = len(data['data']) if isinstance(data.get('data'), list) else 0
        return {
            'success': True,
            'error': None,
            'started_at': started_at,
            'finished_at': finished_at,
            'payload_summary': {
                'total_quarters': total,
                'latest_quarter': summary.get('latest_quarter'),
                'eps_count': summary.get('eps_count'),
                'revenue_count': summary.get('revenue_count'),
            },
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e),
            'started_at': started_at,
            'finished_at': datetime.utcnow(),
            'payload_summary': None,
        }
