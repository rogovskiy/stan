#!/usr/bin/env python3
"""
Refresh Macro Risk Scores

Fetches ~400 trading days of price data for macro channel tickers,
computes risk-on/risk-off score, and saves to Firebase at macro/us_market/risk_scores.

All channel definitions (tickers, weights, scoring types, params) are read from
Firebase at macro/us_market/channels -- no hardcoded channel config.
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

from services.channels_config_service import ChannelsConfigService
from macro.macro_scores import compute_macro_scores
from macro.macro_scores_service import MacroScoresService

logger = logging.getLogger(__name__)

LOOKBACK_CALENDAR_DAYS = 504


def load_channel_config() -> Dict[str, Any]:
    """Load channel config from Firebase and derive tickers, weights, reason_labels, channel_configs."""
    svc = ChannelsConfigService()
    channels = svc.get_all_channels()
    if not channels:
        raise RuntimeError("No channel config found in macro/us_market/channels")
    macro_tickers = svc.derive_macro_tickers(channels)
    weights = svc.extract_weights(channels)
    reason_labels = svc.extract_reason_labels(channels)
    channel_configs = svc.extract_channel_configs(channels)
    logger.info(
        "Loaded %d channels from Firebase: %s (tickers: %s)",
        len(channels), list(channels.keys()), macro_tickers,
    )
    return {
        "macro_tickers": macro_tickers,
        "channel_configs": channel_configs,
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
    week_ends = []
    current_week = None
    for d in dates:
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
        channel_configs=cfg["channel_configs"],
        weights=cfg["weights"],
        reason_labels=cfg["reason_labels"],
        series_by_ticker_10d_ago=series_10d_ago,
    )

    if save_to_firebase:
        MacroScoresService().save_macro_scores(result, verbose=verbose)

    return result
