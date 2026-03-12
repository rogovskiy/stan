#!/usr/bin/env python3
"""
Options Data Refresh

Fetches option chains from Yahoo Finance for a ticker, computes IV at write
(py_vollib Black-Scholes, same convention as a.py: lastPrice or mid bid/ask),
and writes one snapshot per date to option_data/<ticker>/<as_of>.csv.gz (gzip).
"""

import argparse
import csv
import gzip
import io
import logging
import os
from datetime import datetime, timezone

import pandas as pd
import yfinance as yf
from py_vollib.black_scholes.implied_volatility import implied_volatility

logger = logging.getLogger(__name__)


def year_fraction_from(as_of_str: str, expiry_str: str) -> float:
    """Year fraction from as_of date to expiry. Both YYYY-MM-DD."""
    as_of_dt = datetime.strptime(as_of_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    expiry_dt = datetime.strptime(expiry_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    days = (expiry_dt - as_of_dt).total_seconds() / 86400.0
    return max(days / 365.25, 0.0)


def _option_price_from_row(row: pd.Series) -> float | None:
    """Option market price: lastPrice or mid of bid/ask."""
    price = row.get("lastPrice")
    if pd.notna(price) and price > 0:
        return float(price)
    bid, ask = row.get("bid"), row.get("ask")
    if pd.notna(bid) and pd.notna(ask) and bid > 0 and ask > 0:
        return float((bid + ask) / 2.0)
    return None


def compute_iv_from_price(
    price: float,
    spot: float,
    strike: float,
    t_years: float,
    r: float,
    flag: str,
) -> float | None:
    """Black-Scholes implied volatility. flag: 'c' or 'p'."""
    if t_years <= 0 or price <= 0 or spot <= 0 or strike <= 0:
        return None
    try:
        iv = implied_volatility(price, spot, strike, t_years, r, flag)
        return float(iv) if iv > 0 else None
    except Exception:
        return None


def get_spot_price(ticker: yf.Ticker) -> float:
    """Current/last spot price from fast_info or history."""
    info = {}
    try:
        info = ticker.fast_info
    except Exception:
        pass
    for key in ["lastPrice", "last_price", "regularMarketPrice", "previousClose"]:
        try:
            value = info.get(key)
            if value is not None and value > 0:
                return float(value)
        except Exception:
            pass
    hist = ticker.history(period="5d", auto_adjust=False)
    if hist.empty:
        raise RuntimeError("Could not determine spot price from Yahoo data.")
    return float(hist["Close"].dropna().iloc[-1])


def _to_json_safe(value) -> float | int | str | None:
    """Convert NaN/NaT to None for JSON; otherwise pass through."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, (int, float)):
        return value
    return str(value)


def _normalize_option_row(
    row: pd.Series,
    spot: float,
    t_years: float,
    r: float,
    flag: str,
) -> dict:
    """Build one option row dict with raw fields and computed iv."""
    strike_val = row.get("strike")
    strike = float(strike_val) if pd.notna(strike_val) else None
    price = _option_price_from_row(row)
    iv_val = None
    if strike is not None and price is not None:
        iv_val = compute_iv_from_price(price, spot, strike, t_years, r, flag)
        iv_val = float(iv_val) if iv_val is not None else None
    return {
        "contractSymbol": _to_json_safe(row.get("contractSymbol")),
        "strike": strike,
        "lastPrice": _to_json_safe(row.get("lastPrice")),
        "bid": _to_json_safe(row.get("bid")),
        "ask": _to_json_safe(row.get("ask")),
        "iv": iv_val,
        "volume": _to_json_safe(row.get("volume")),
        "openInterest": _to_json_safe(row.get("openInterest")),
        "impliedVolatility": _to_json_safe(row.get("impliedVolatility")),
    }


def fetch_options_snapshot(
    ticker: str,
    as_of: str,
    risk_free_rate: float = 0.05,
    max_expiries: int = 52,
    max_years: float = 1.0,
    verbose: bool = False,
) -> dict:
    """
    Fetch option chains for one ticker and one as_of date; compute IV at write.
    Returns snapshot dict ready for JSON (ticker, as_of, spot, risk_free_rate, expiries).
    """
    sym = ticker.upper()
    yf_ticker = yf.Ticker(sym)
    spot = get_spot_price(yf_ticker)
    expiries_list = yf_ticker.options
    if not expiries_list:
        raise RuntimeError(f"No listed options found for {sym}.")

    expiries_out = []
    for expiry in expiries_list[:max_expiries]:
        t_years = year_fraction_from(as_of, expiry)
        if t_years <= 0 or t_years > max_years:
            if verbose:
                logger.debug("Skip expiry %s (t_years=%.4f)", expiry, t_years)
            continue
        try:
            chain = yf_ticker.option_chain(expiry)
        except Exception as e:
            if verbose:
                logger.warning("Skipping expiry %s: %s", expiry, e)
            continue
        calls_df = chain.calls
        puts_df = chain.puts
        if calls_df.empty and puts_df.empty:
            continue
        calls = [
            _normalize_option_row(row, spot, t_years, risk_free_rate, "c")
            for _, row in calls_df.iterrows()
        ]
        puts = [
            _normalize_option_row(row, spot, t_years, risk_free_rate, "p")
            for _, row in puts_df.iterrows()
        ]
        expiries_out.append({
            "expiry": expiry,
            "t_years": round(t_years, 6),
            "calls": calls,
            "puts": puts,
        })

    if not expiries_out:
        raise RuntimeError(f"Could not build any expiry data for {sym} as_of {as_of}.")

    snapshot = {
        "ticker": sym,
        "as_of": as_of,
        "spot": round(spot, 4),
        "risk_free_rate": risk_free_rate,
        "expiries": expiries_out,
        "metadata": {
            "source": "yfinance",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        },
    }
    return snapshot


CSV_HEADER = [
    "ticker", "as_of", "spot", "risk_free_rate", "expiry", "t_years",
    "type", "contractSymbol", "strike", "lastPrice", "bid", "ask", "iv",
    "volume", "openInterest", "impliedVolatility",
]


def _csv_cell(value) -> str:
    """Format a value for CSV (None/NaN -> empty string)."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    if isinstance(value, float):
        return str(value)
    return str(value)


def write_snapshot(
    snapshot: dict,
    output_dir: str,
    verbose: bool = False,
) -> str:
    """Write snapshot to option_data/<ticker>/<as_of>.csv.gz (gzip). Returns path written."""
    ticker = snapshot["ticker"].upper()
    as_of = snapshot["as_of"]
    spot = snapshot["spot"]
    r = snapshot["risk_free_rate"]
    dir_path = os.path.join(output_dir, "option_data", ticker)
    os.makedirs(dir_path, exist_ok=True)
    path = os.path.join(dir_path, f"{as_of}.csv.gz")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(CSV_HEADER)
    for exp in snapshot["expiries"]:
        expiry = exp["expiry"]
        t_years = exp["t_years"]
        for row in exp["calls"]:
            w.writerow([
                ticker, as_of, spot, r, expiry, t_years, "call",
                _csv_cell(row.get("contractSymbol")),
                _csv_cell(row.get("strike")),
                _csv_cell(row.get("lastPrice")),
                _csv_cell(row.get("bid")),
                _csv_cell(row.get("ask")),
                _csv_cell(row.get("iv")),
                _csv_cell(row.get("volume")),
                _csv_cell(row.get("openInterest")),
                _csv_cell(row.get("impliedVolatility")),
            ])
        for row in exp["puts"]:
            w.writerow([
                ticker, as_of, spot, r, expiry, t_years, "put",
                _csv_cell(row.get("contractSymbol")),
                _csv_cell(row.get("strike")),
                _csv_cell(row.get("lastPrice")),
                _csv_cell(row.get("bid")),
                _csv_cell(row.get("ask")),
                _csv_cell(row.get("iv")),
                _csv_cell(row.get("volume")),
                _csv_cell(row.get("openInterest")),
                _csv_cell(row.get("impliedVolatility")),
            ])
    csv_bytes = buf.getvalue().encode("utf-8")
    with gzip.open(path, "wb") as f:
        f.write(csv_bytes)
    if verbose:
        logger.info("Wrote %s", path)
    return path


def _upload_options_to_storage(path: str, ticker: str, as_of: str, verbose: bool = False) -> bool:
    """Upload option_data/<ticker>/<as_of>.csv.gz to Firebase Storage. Returns True if uploaded."""
    try:
        from services.price_data_service import PriceDataService
        service = PriceDataService()
        storage_path = f"option_data/{ticker.upper()}/{as_of}.csv.gz"
        blob = service.bucket.blob(storage_path)
        blob.upload_from_filename(path, content_type="application/gzip")
        if verbose:
            logger.info("Uploaded options to Storage: %s", storage_path)
        return True
    except Exception as e:
        logger.debug("Could not upload options to Storage (e.g. no Firebase): %s", e)
        return False


def refresh_options_data(
    ticker: str,
    as_of: str | None = None,
    risk_free_rate: float = 0.05,
    max_expiries: int = 52,
    max_years: float = 1.0,
    output_dir: str | None = None,
    verbose: bool = False,
) -> dict:
    """
    Fetch options snapshot for ticker and write to option_data/<ticker>/<as_of>.csv.gz.

    Args:
        ticker: Symbol (e.g. USO, AAPL).
        as_of: Date YYYY-MM-DD; default today.
        risk_free_rate: Risk-free rate for IV.
        max_expiries: Max number of expiries to fetch.
        max_years: Skip expiries beyond this many years.
        output_dir: Base directory for option_data/; default cwd.
        verbose: Log progress.

    Returns:
        Dict with success, path, snapshot (if success), error (if not).
    """
    if as_of is None:
        as_of = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if output_dir is None:
        output_dir = os.getcwd()
    try:
        snapshot = fetch_options_snapshot(
            ticker=ticker,
            as_of=as_of,
            risk_free_rate=risk_free_rate,
            max_expiries=max_expiries,
            max_years=max_years,
            verbose=verbose,
        )
        path = write_snapshot(snapshot, output_dir, verbose=verbose)
        uploaded = _upload_options_to_storage(path, ticker, as_of, verbose=verbose)
        return {
            "success": True,
            "path": path,
            "ticker": ticker,
            "as_of": as_of,
            "expiries_count": len(snapshot["expiries"]),
            "uploaded_to_storage": uploaded,
        }
    except Exception as e:
        logger.exception("Options refresh failed for %s as_of %s", ticker, as_of)
        return {
            "success": False,
            "ticker": ticker,
            "as_of": as_of,
            "error": str(e),
            "error_type": type(e).__name__,
        }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch options data for a ticker and write to option_data/<ticker>/<as_of>.csv.gz",
    )
    parser.add_argument("ticker", help="Ticker symbol (e.g. USO, AAPL)")
    parser.add_argument(
        "--as-of",
        default=None,
        help="Date YYYY-MM-DD (default: today)",
    )
    parser.add_argument("--risk-free-rate", type=float, default=0.05, help="Risk-free rate for IV")
    parser.add_argument("--max-expiries", type=int, default=52, help="Max expiries to fetch")
    parser.add_argument("--max-years", type=float, default=1.0, help="Max years to expiry")
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Base dir for option_data/ (default: cwd)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="Verbose output")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    result = refresh_options_data(
        ticker=args.ticker,
        as_of=args.as_of,
        risk_free_rate=args.risk_free_rate,
        max_expiries=args.max_expiries,
        max_years=args.max_years,
        output_dir=args.output_dir,
        verbose=args.verbose,
    )
    if result["success"]:
        logger.info("Options snapshot: %s (%s) -> %s", result["ticker"], result["as_of"], result["path"])
        return 0
    logger.error("Options refresh failed: %s", result.get("error", "Unknown"))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
