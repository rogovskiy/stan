#!/usr/bin/env python3
"""
Fetch raw price data from yfinance for a ticker and optional date.
Use this to verify values (e.g. debug wrong price for a specific date).

By default uses auto_adjust=False so you get unadjusted OHLC (no dividend
adjustment). Use --adjusted to get dividend-adjusted prices (yfinance default).

Usage:
  python scripts/fetch_raw_yfinance.py TLT
  python scripts/fetch_raw_yfinance.py TLT --date 2024-05-29
  python scripts/fetch_raw_yfinance.py TLT --adjusted   # dividend-adjusted
"""

import argparse
import sys
from datetime import datetime, timedelta

import yfinance as yf
import pandas as pd


def fetch_raw(
    ticker: str,
    target_date: str | None = None,
    window_days: int = 5,
    auto_adjust: bool = False,
) -> None:
    ticker = ticker.upper()

    if target_date:
        dt = datetime.strptime(target_date, "%Y-%m-%d")
        start = dt - timedelta(days=window_days)
        end = dt + timedelta(days=window_days + 1)
        start_str = start.strftime("%Y-%m-%d")
        end_str = end.strftime("%Y-%m-%d")
        print(f"Ticker: {ticker}")
        print(f"Target date: {target_date} (window ±{window_days} days)")
        print(f"Range: {start_str} to {end_str}")
        print(f"auto_adjust (dividend adjustment): {auto_adjust}\n")
    else:
        end = datetime.now()
        start = end - timedelta(days=365)
        start_str = start.strftime("%Y-%m-%d")
        end_str = end.strftime("%Y-%m-%d")
        print(f"Ticker: {ticker}")
        print(f"Range: last year ({start_str} to {end_str})")
        print(f"auto_adjust (dividend adjustment): {auto_adjust}\n")

    stock = yf.Ticker(ticker)
    hist = stock.history(
        start=start_str, end=end_str, interval="1d", auto_adjust=auto_adjust
    )

    if hist.empty:
        print("No data returned from yfinance.")
        sys.exit(1)

    # Raw DataFrame (no rounding)
    print("--- Raw DataFrame (yfinance .history) ---")
    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", None)
    pd.set_option("display.float_format", "{:.6f}".format)
    print(hist.to_string())
    print()

    if target_date:
        if target_date in hist.index.strftime("%Y-%m-%d"):
            row = hist.loc[target_date]
            print(f"--- Row for {target_date} ---")
            print(row.to_string())
            print()
            close = row.get("Close")
            if pd.notna(close):
                print(f"Close (raw):  {close}")
                print(f"Close (2dp):  {float(close):.2f}")
        else:
            print(f"Date {target_date} not in result. Available dates in range:")
            for d in hist.index.strftime("%Y-%m-%d"):
                print(f"  {d}")


def main() -> None:
    p = argparse.ArgumentParser(description="Fetch raw yfinance price data for a ticker")
    p.add_argument("ticker", nargs="?", default="TLT", help="Ticker symbol (default: TLT)")
    p.add_argument("--date", "-d", default="2024-05-29", help="Target date YYYY-MM-DD (default: 2024-05-29)")
    p.add_argument("--window", "-w", type=int, default=5, help="Days before/after target date (default: 5)")
    p.add_argument("--no-date", action="store_true", help="Fetch last year only, ignore --date")
    p.add_argument(
        "--adjusted",
        "-a",
        action="store_true",
        help="Use dividend-adjusted prices (yfinance default; default is unadjusted)",
    )
    args = p.parse_args()

    fetch_raw(
        args.ticker,
        target_date=None if args.no_date else args.date,
        window_days=args.window,
        auto_adjust=args.adjusted,
    )


if __name__ == "__main__":
    main()
