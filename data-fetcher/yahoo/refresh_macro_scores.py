#!/usr/bin/env python3
"""
Refresh Macro Risk Scores

Fetches ~400 trading days of price data for macro tickers (SPY, HYG, LQD, UUP, USO, VIX, etc.),
computes risk-on/risk-off score, and saves to Firebase at macro/us_market/risk_scores.

Invocation:
- CLI: python yahoo/refresh_macro_scores.py [--out path] [--verbose] [--no-firebase]
- Pub/Sub: POST /refresh-macro (calls refresh_macro_scores()).
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

import pandas as pd
import yfinance as yf

# Add parent directory so we can import modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv('.env.local')

from yahoo.macro_scores import compute_macro_scores
from services.channels_config_service import ChannelsConfigService

logger = logging.getLogger(__name__)

# ~400 trading days; use 504 calendar days buffer
LOOKBACK_CALENDAR_DAYS = 504

VIX_TICKER = "^VIX"


def load_channel_config() -> Dict[str, Any]:
    """Load channel config from Firebase and derive tickers, weights, reason_labels."""
    svc = ChannelsConfigService()
    channels = svc.get_all_channels()
    if not channels:
        raise RuntimeError("No channel config found in macro/us_market/channels")
    macro_tickers = svc.derive_macro_tickers(channels)
    weights = svc.extract_weights(channels)
    reason_labels = svc.extract_reason_labels(channels)
    active_channels = list(channels.keys())
    logger.info(
        "Loaded %d channels from Firebase: %s (tickers: %s)",
        len(channels), active_channels, macro_tickers,
    )
    return {
        "macro_tickers": macro_tickers,
        "active_channels": active_channels,
        "weights": weights,
        "reason_labels": reason_labels,
    }


def fetch_prices(
    tickers: list,
    start: datetime,
    end: datetime,
    auto_adjust: bool = True,
) -> Dict[str, pd.Series]:
    """
    Fetch adjusted close (or close) for each ticker. Returns dict ticker -> Series with DatetimeIndex.
    """
    out = {}
    for t in tickers:
        try:
            obj = yf.Ticker(t)
            hist = obj.history(start=start, end=end, interval="1d", auto_adjust=auto_adjust)
            if hist is None or hist.empty or len(hist) < 20:
                continue
            if "Adj Close" in hist.columns and hist["Adj Close"].notna().any():
                s = hist["Adj Close"]
            else:
                s = hist["Close"]
            s = s.dropna()
            if len(s) > 0:
                out[t] = s
        except Exception as e:
            logger.warning("Skip ticker %s: %s", t, e)
    return out


def fetch_vix(start: datetime, end: datetime) -> Optional[pd.Series]:
    """Fetch VIX; optional, skip if unavailable."""
    try:
        for sym in ("^VIX", "VIX"):
            obj = yf.Ticker(sym)
            hist = obj.history(start=start, end=end, interval="1d")
            if hist is not None and not hist.empty and len(hist) >= 5:
                s = hist["Close"].dropna()
                if len(s) > 0:
                    return s
    except Exception as e:
        logger.debug("VIX not available: %s", e)
    return None


def build_series_as_of(
    series_by_ticker: Dict[str, pd.Series],
    as_of_date: str,
) -> Dict[str, pd.Series]:
    """Truncate all series to end on or before as_of_date."""
    out = {}
    for t, s in series_by_ticker.items():
        if s is None or s.empty:
            continue
        target = pd.Timestamp(as_of_date)
        if s.index.tz is not None:
            target = target.tz_localize(s.index.tz)
        mask = s.index <= target
        if mask.any():
            out[t] = s.loc[mask]
    return out


def get_last_trading_date(series_by_ticker: Dict[str, pd.Series]) -> Optional[str]:
    """Latest date present in any series (prefer SPY)."""
    if not series_by_ticker:
        return None
    spy = series_by_ticker.get("SPY")
    if spy is not None and not spy.empty:
        return spy.index.max().strftime("%Y-%m-%d")
    best = None
    for s in series_by_ticker.values():
        if s is not None and len(s) > 0:
            d = s.index.max()
            if best is None or d > best:
                best = d
    return best.strftime("%Y-%m-%d") if best is not None else None


def get_date_10d_ago(series_by_ticker: Dict[str, pd.Series]) -> Optional[str]:
    """Date that is 10 trading days before the last date (for transition)."""
    spy = series_by_ticker.get("SPY")
    if spy is None or len(spy) < 12:
        return None
    dates = spy.index.sort_values()
    return dates[-11].strftime("%Y-%m-%d")


def get_date_10d_before(
    series_by_ticker: Dict[str, pd.Series],
    as_of_date: str,
) -> Optional[str]:
    """Date that is 10 trading days before as_of_date (for transition at any date)."""
    spy = series_by_ticker.get("SPY")
    if spy is None or len(spy) < 12:
        return None
    target = pd.Timestamp(as_of_date)
    if spy.index.tz is not None:
        target = target.tz_localize(spy.index.tz)
    mask = spy.index <= target
    dates = spy.index[mask].sort_values()
    if len(dates) < 12:
        return None
    return dates[-11].strftime("%Y-%m-%d")


def get_weekly_dates_last_year(
    series_by_ticker: Dict[str, pd.Series],
) -> list:
    """Last trading day of each calendar week (Mon–Sun) in the past year. Oldest first."""
    spy = series_by_ticker.get("SPY")
    if spy is None or spy.empty:
        return []
    one_year_ago = pd.Timestamp.now() - pd.Timedelta(days=365)
    if spy.index.tz is not None:
        one_year_ago = one_year_ago.tz_localize(spy.index.tz)
    mask = (spy.index >= one_year_ago) & (spy.index <= spy.index.max())
    dates = spy.index[mask].sort_values().unique()
    if len(dates) == 0:
        return []
    # Group by ISO week (year, week); take last trading day per week
    week_ends = []
    current_week = None
    for d in dates:
        # (year, week number) for Monday-based week
        w = (d.year, d.isocalendar().week)
        if current_week != w:
            if current_week is not None:
                week_ends.append(last_date)
            current_week = w
        last_date = d
    if current_week is not None:
        week_ends.append(last_date)
    return [pd.Timestamp(d).strftime("%Y-%m-%d") for d in week_ends]


def refresh_macro_scores(
    verbose: bool = True,
    save_to_firebase: bool = True,
) -> Dict[str, Any]:
    """
    Fetch macro data, compute scores, optionally save to Firebase. Returns the payload dict.
    """
    cfg = load_channel_config()
    macro_tickers = cfg["macro_tickers"]

    end = datetime.now()
    start = end - timedelta(days=LOOKBACK_CALENDAR_DAYS)

    if verbose:
        logger.info("Fetching macro tickers from %s to %s", start.date(), end.date())

    series_by_ticker = fetch_prices(macro_tickers, start, end, auto_adjust=True)
    vix = fetch_vix(start, end)
    if vix is not None:
        series_by_ticker[VIX_TICKER] = vix

    if not series_by_ticker:
        raise RuntimeError("No macro price data returned")

    as_of = get_last_trading_date(series_by_ticker)
    if not as_of:
        raise RuntimeError("Could not determine as-of date")

    series_as_of = build_series_as_of(series_by_ticker, as_of)

    date_10d_ago = get_date_10d_ago(series_by_ticker)
    series_10d_ago = None
    if date_10d_ago:
        series_10d_ago = build_series_as_of(series_by_ticker, date_10d_ago)

    result = compute_macro_scores(
        series_as_of,
        as_of,
        series_by_ticker_10d_ago=series_10d_ago,
        active_channels=cfg["active_channels"],
        weights=cfg["weights"],
        reason_labels=cfg["reason_labels"],
    )

    if save_to_firebase:
        from services.macro_scores_service import MacroScoresService

        MacroScoresService().save_macro_scores(result, verbose=verbose)

    return result


def refresh_macro_scores_weekly_backfill(
    verbose: bool = True,
    save_to_firebase: bool = True,
) -> list:
    """
    Compute risk score for the last trading day of each week in the past year.
    Fetches data once, then iterates over weekly dates. Returns list of payload dicts.
    """
    cfg = load_channel_config()
    macro_tickers = cfg["macro_tickers"]

    end = datetime.now()
    start = end - timedelta(days=LOOKBACK_CALENDAR_DAYS)

    if verbose:
        logger.info("Fetching macro tickers from %s to %s (weekly backfill)", start.date(), end.date())

    series_by_ticker = fetch_prices(macro_tickers, start, end, auto_adjust=True)
    vix = fetch_vix(start, end)
    if vix is not None:
        series_by_ticker[VIX_TICKER] = vix

    if not series_by_ticker:
        raise RuntimeError("No macro price data returned")

    weekly_dates = get_weekly_dates_last_year(series_by_ticker)
    if not weekly_dates:
        raise RuntimeError("No weekly dates in range")

    if verbose:
        logger.info("Computing scores for %d weeks (oldest to newest)", len(weekly_dates))

    results = []
    for i, as_of in enumerate(weekly_dates):
        if verbose:
            logger.info("Week %d/%d: %s", i + 1, len(weekly_dates), as_of)
        series_as_of = build_series_as_of(series_by_ticker, as_of)
        date_10d_ago = get_date_10d_before(series_by_ticker, as_of)
        series_10d_ago = None
        if date_10d_ago:
            series_10d_ago = build_series_as_of(series_by_ticker, date_10d_ago)
        result = compute_macro_scores(
            series_as_of,
            as_of,
            series_by_ticker_10d_ago=series_10d_ago,
            active_channels=cfg["active_channels"],
            weights=cfg["weights"],
            reason_labels=cfg["reason_labels"],
        )
        results.append(result)
        if save_to_firebase:
            from services.macro_scores_service import MacroScoresService

            MacroScoresService().save_macro_scores(result, verbose=False)
            if verbose and (i + 1) % 10 == 0:
                logger.info("Saved %d/%d weeks", i + 1, len(weekly_dates))

    if save_to_firebase and results:
        from services.macro_scores_service import MacroScoresService

        MacroScoresService().save_macro_scores(results[-1], verbose=verbose)

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compute macro risk scores and save to Firebase (macro/us_market/risk_scores)"
    )
    parser.add_argument(
        "--out",
        "-o",
        metavar="PATH",
        help="Also write JSON to this file",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        default=True,
        help="Log progress (default: True)",
    )
    parser.add_argument(
        "--no-firebase",
        action="store_true",
        help="Skip Firestore write (e.g. local testing)",
    )
    parser.add_argument(
        "--quiet",
        action="store_true",
        help="Less logging",
    )
    parser.add_argument(
        "--weekly-backfill",
        action="store_true",
        help="Compute score for the last trading day of each week in the past year (saves each to Firebase)",
    )
    args = parser.parse_args()

    if args.quiet:
        logging.basicConfig(level=logging.WARNING)
    else:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    try:
        if args.weekly_backfill:
            results = refresh_macro_scores_weekly_backfill(
                verbose=args.verbose and not args.quiet,
                save_to_firebase=not args.no_firebase,
            )
            if args.out:
                with open(args.out, "w") as f:
                    json.dump(results, f, indent=2)
                if args.verbose and not args.quiet:
                    logger.info("Wrote %d weeks to %s", len(results), args.out)
            if not args.quiet:
                print(json.dumps({"weeks_computed": len(results), "date_range": [results[0]["asOf"], results[-1]["asOf"]] if results else None}, indent=2))
        else:
            result = refresh_macro_scores(
                verbose=args.verbose and not args.quiet,
                save_to_firebase=not args.no_firebase,
            )
            json_str = json.dumps(result, indent=2)
            print(json_str)
            if args.out:
                with open(args.out, "w") as f:
                    f.write(json_str)
                if args.verbose and not args.quiet:
                    logger.info("Wrote %s", args.out)
    except Exception as e:
        logger.exception("Macro refresh failed: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
