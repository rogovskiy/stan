"""Unit tests for portfolio_stress_drawdown math helpers (no Firebase)."""

import os
import sys
import unittest
from datetime import datetime, timedelta

import numpy as np

_pkg = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_pkg, "vendor")
for _p in (_vendor, _pkg):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from portfolio_stress_drawdown import (  # noqa: E402
    _extract_eps_from_quarter_raw,
    calculate_normal_pe_ratio,
    rolling_drawdown_series,
    stress_from_historical_percentile,
    trim_quarterly_to_lookback,
    use_historical_stress_path,
)


class TestRollingDrawdown(unittest.TestCase):
    def test_flat_prices_zero_drawdown(self):
        closes = np.ones(80)
        dd = rolling_drawdown_series(closes)
        self.assertTrue(np.allclose(dd, 0.0))

    def test_single_spike_down(self):
        closes = np.array([100.0] * 40 + [50.0] * 40)
        dd = rolling_drawdown_series(closes)
        self.assertGreater(dd[-1], 0.45)
        self.assertLess(dd[-1], 0.55)


class TestHistoricalPercentile(unittest.TestCase):
    def test_need_minimum_days(self):
        pm = {f"2020-01-{i+1:02d}": 100.0 for i in range(30)}
        self.assertIsNone(stress_from_historical_percentile(pm, 0.9))

    def test_returns_percentile_in_range(self):
        rng = np.random.default_rng(42)
        prices = 100 * np.cumprod(1 + rng.normal(0, 0.01, size=120))
        base = datetime(2020, 1, 1)
        pm = {(base + timedelta(days=i)).strftime("%Y-%m-%d"): float(prices[i]) for i in range(120)}
        s = stress_from_historical_percentile(pm, 0.9)
        self.assertIsNotNone(s)
        assert s is not None
        self.assertGreaterEqual(s, 0.0)
        self.assertLessEqual(s, 1.0)


class TestTrimQuarterly(unittest.TestCase):
    def test_trims_old_quarters(self):
        end = datetime(2025, 6, 1)
        rows = [
            {"date": "1990-01-01", "eps_adjusted": 1.0},
            {"date": "2020-01-01", "eps_adjusted": 1.0},
            {"date": "2024-01-01", "eps_adjusted": 1.0},
        ]
        out = trim_quarterly_to_lookback(rows, end, years=10)
        self.assertEqual(len(out), 2)
        self.assertEqual(out[0]["date"], "2020-01-01")


class TestStressPolicy(unittest.TestCase):
    def test_equity_requires_valuation_path(self):
        self.assertFalse(use_historical_stress_path("EQUITY", 0))
        self.assertFalse(use_historical_stress_path("EQUITY", 10))

    def test_etf_uses_historical_only(self):
        self.assertTrue(use_historical_stress_path("ETF", 0))
        self.assertTrue(use_historical_stress_path("ETF", 5))

    def test_unknown_with_quarterly_assumes_equity(self):
        self.assertFalse(use_historical_stress_path(None, 4))

    def test_unknown_without_quarterly_assumes_fund(self):
        self.assertTrue(use_historical_stress_path(None, 0))


class TestExtractEps(unittest.TestCase):
    def test_top_level_eps(self):
        self.assertAlmostEqual(_extract_eps_from_quarter_raw({"eps": 2.5}), 2.5)

    def test_earnings_eps_actual_nested(self):
        row = {"earnings": {"eps_actual": 3.1}}
        self.assertAlmostEqual(_extract_eps_from_quarter_raw(row), 3.1)

    def test_income_statement_eps(self):
        row = {"income_statement": {"earnings_per_share": 1.25}}
        self.assertAlmostEqual(_extract_eps_from_quarter_raw(row), 1.25)


class TestNormalPe(unittest.TestCase):
    def test_simple_average_pe(self):
        # Two quarters with same annualized EPS path so PE is well-defined
        qc = [
            {
                "date": "2023-03-31",
                "eps_adjusted": 1.0,
                "earnings": 1.0,
                "stock_price": 20.0,
            },
            {
                "date": "2023-06-30",
                "eps_adjusted": 1.0,
                "earnings": 1.0,
                "stock_price": 20.0,
            },
            {
                "date": "2023-09-30",
                "eps_adjusted": 1.0,
                "earnings": 1.0,
                "stock_price": 20.0,
            },
            {
                "date": "2023-12-31",
                "eps_adjusted": 1.0,
                "earnings": 1.0,
                "stock_price": 20.0,
            },
        ]
        npe = calculate_normal_pe_ratio(qc)
        self.assertIsNotNone(npe)
        # annual EPS = 4.0, price 20 -> PE = 5 at each point
        self.assertAlmostEqual(npe, 5.0, places=4)


if __name__ == "__main__":
    unittest.main()
