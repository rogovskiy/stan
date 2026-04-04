#!/usr/bin/env python3
"""
Portfolio stress drawdown (scheduled job).

Per ticker:
  - EQUITY (Yahoo quoteType): valuation-based drawdown only — trailing EPS × historical average P/E
    (stocks-web calculateNormalPERatio + value page merge). Missing data raises ValuationStressDataError
    (no fallback to rolling drawdown).
  - ETFs / funds / indices (Yahoo quoteType ETF, MUTUALFUND, INDEX, …): rolling peak drawdown percentile
    from daily closes only.

Price history is capped to PRICE_HISTORY_YEARS (not full listing history). Per-ticker outputs are
cached under tickers/{T}/derived/stress_drawdown with a short TTL so overlapping holdings across
portfolios do not each pull decades of prices every run.

Persists stressDrawdown on the portfolio document (see PortfolioService.save_stress_drawdown).

Usage:
    cd functions_portfolio && source venv/bin/activate && make vendor
    python portfolio_stress_drawdown.py <PORTFOLIO_ID> [--percentile 0.9] [--verbose] [--force-cache-refresh]
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

_pkg = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_pkg, "vendor")
for _p in (_vendor, _pkg):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from portfolio_channel_exposure import (  # noqa: E402
    EXIT_ERROR,
    EXIT_OK,
    EXIT_SKIPPED,
    fetch_prices,
    get_price_at_date,
)

logger = logging.getLogger(__name__)

MIN_PRICE_DAYS_HISTORICAL = 60
DEFAULT_PERCENTILE = 0.90
# Rolling DD percentile and quarterly merge both use this window (not full company history).
PRICE_HISTORY_YEARS = 25
# Normal P/E uses quarterly rows within this window only (aligns with bounded price fetch).
TICKER_STRESS_CACHE_TTL_DAYS = 7
# Bump when stress method / EPS logic changes so per-ticker cache is recomputed.
STRESS_CACHE_SCHEMA_VERSION = 6

# Yahoo quoteType values that use rolling drawdown percentile only (no P/E valuation path).
QUOTETYPE_HISTORICAL_STRESS = frozenset(
    {"ETF", "MUTUALFUND", "INDEX", "ETN", "CRYPTOCURRENCY", "CURRENCY"}
)


class ValuationStressDataError(RuntimeError):
    """Equity ticker is missing data required for valuation-based stress drawdown (no silent fallback)."""


def _quote_type_from_yahoo(ticker: str) -> Optional[str]:
    """Yahoo Finance quoteType (EQUITY, ETF, ...). None if lookup fails."""
    try:
        import yfinance as yf

        info = yf.Ticker(ticker).info
        if not info:
            return None
        return info.get("quoteType") or info.get("quote_type")
    except Exception:
        return None


def use_historical_stress_path(quote_type: Optional[str], quarterly_full_len: int) -> bool:
    """
    True → use rolling drawdown percentile only.
    False → require valuation (normal P/E) path or ValuationStressDataError.

    Unknown quote type: if there is no quarterly timeseries at all, assume a fund/price-only
    instrument; if quarterly rows exist, assume equity and require valuation.
    """
    qt = (quote_type or "").strip().upper()
    if qt in QUOTETYPE_HISTORICAL_STRESS:
        return True
    if qt == "EQUITY":
        return False
    if not qt:
        return quarterly_full_len == 0
    # Other Yahoo types (e.g. some warrants): prefer historical unless we have fundamentals
    return quarterly_full_len == 0


def cache_matches_stress_policy(cached: Dict[str, Any], use_historical: bool) -> bool:
    """Cached method must match intended policy (no equity cached as historical)."""
    m = str(cached.get("method") or "")
    if use_historical:
        return m == "historical_percentile"
    return m == "normal_multiple"


def trim_quarterly_to_lookback(
    quarterly_rows: List[Dict[str, Any]], end: datetime, years: int
) -> List[Dict[str, Any]]:
    """Keep only quarters on/after (end - years) for normal P/E (matches bounded price window)."""
    if not quarterly_rows:
        return []
    cutoff = (end - timedelta(days=365 * years)).strftime("%Y-%m-%d")
    return [q for q in quarterly_rows if q.get("date", "")[:10] >= cutoff]


def _parse_quarterly_doc(data: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not data:
        return []
    if isinstance(data.get("data"), list):
        return list(data["data"])
    # Some stores may use raw list
    if isinstance(data, list):
        return list(data)
    return []


def _normalize_period_date_str(d: Any) -> Optional[str]:
    """Firestore Timestamp/datetime/str → YYYY-MM-DD for comparisons and merge."""
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.strftime("%Y-%m-%d")
    if hasattr(d, "timestamp") and callable(getattr(d, "timestamp", None)):
        try:
            ts = d.timestamp()
            return datetime.utcfromtimestamp(ts).strftime("%Y-%m-%d")
        except (AttributeError, OSError, OverflowError, ValueError):
            pass
    s = str(d).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        return s[:10]
    return None


def _quarter_row_date(item: Dict[str, Any]) -> Optional[str]:
    d = item.get("date") or item.get("period_end_date")
    return _normalize_period_date_str(d)


def _float_or_none(x: Any) -> Optional[float]:
    if x is None:
        return None
    try:
        v = float(x)
        if v != v:  # NaN
            return None
        return v
    except (TypeError, ValueError):
        return None


def _extract_eps_from_quarter_raw(item: Dict[str, Any]) -> Optional[float]:
    """
    Same EPS discovery order as yahoo.generate_quarterly_timeseries (unified quarterly rows).
    Some tickers only expose EPS under income_statement / financials / earnings.eps_actual.
    """
    v = _float_or_none(item.get("eps"))
    if v is not None:
        return v
    inc = item.get("income_statement")
    if isinstance(inc, dict):
        v = _float_or_none(inc.get("earnings_per_share"))
        if v is not None:
            return v
        v = _float_or_none(inc.get("eps"))
        if v is not None:
            return v
    fin = item.get("financials")
    if isinstance(fin, dict):
        v = _float_or_none(fin.get("eps"))
        if v is not None:
            return v
        v = _float_or_none(fin.get("epsDiluted"))
        if v is not None:
            return v
    earn = item.get("earnings")
    if isinstance(earn, dict):
        v = _float_or_none(earn.get("eps_actual"))
        if v is not None:
            return v
    if isinstance(earn, (int, float)):
        return _float_or_none(earn)
    return None


def load_quarterly_timeseries(db: Any, ticker: str) -> List[Dict[str, Any]]:
    """Load quarterly points from tickers/{TICKER}/timeseries/quarterly."""
    try:
        doc = (
            db.collection("tickers")
            .document(ticker.upper())
            .collection("timeseries")
            .document("quarterly")
            .get()
        )
        if not doc.exists:
            return []
        rows = _parse_quarterly_doc(doc.to_dict())
        out: List[Dict[str, Any]] = []
        for item in rows:
            dt = _quarter_row_date(item)
            if not dt:
                continue
            eps_adj = _float_or_none(item.get("eps_adjusted"))
            eps_fallback = _extract_eps_from_quarter_raw(item)
            if eps_fallback is None and item.get("eps") is None:
                eps_fallback = _float_or_none(item.get("earnings"))
            out.append(
                {
                    "date": dt,
                    "eps_adjusted": eps_adj,
                    "earnings": eps_fallback,
                }
            )
        out.sort(key=lambda x: x["date"])
        return out
    except Exception as e:
        logger.debug("Quarterly load failed for %s: %s", ticker, e)
        return []


def _merge_quarterly_stock_prices(
    quarterly: List[Dict[str, Any]],
    price_map: Dict[str, float],
) -> List[Dict[str, Any]]:
    """Match value page: last daily on or before quarter date."""
    if not quarterly or not price_map:
        return []
    sorted_daily = sorted(price_map.items(), key=lambda x: x[0])
    idx = 0
    merged: List[Dict[str, Any]] = []
    for item in quarterly:
        q_date = item["date"]
        q_ms = datetime.strptime(q_date, "%Y-%m-%d").timestamp() * 1000
        while idx + 1 < len(sorted_daily) and (
            datetime.strptime(sorted_daily[idx + 1][0], "%Y-%m-%d").timestamp() * 1000
            <= q_ms
        ):
            idx += 1
        d_i, p_i = sorted_daily[idx]
        if datetime.strptime(d_i, "%Y-%m-%d").timestamp() * 1000 <= q_ms:
            sp = p_i
        else:
            sp = sorted_daily[0][1]
        merged.append(
            {
                "date": q_date,
                "eps_adjusted": item.get("eps_adjusted"),
                "earnings": item.get("earnings"),
                "stock_price": sp,
            }
        )
    return merged


def _get_trailing_four_quarters(
    quarterly_calc: List[Dict[str, Any]], as_of: str
) -> List[Dict[str, Any]]:
    as_dt = datetime.strptime(as_of[:10], "%Y-%m-%d")
    eligible = [q for q in quarterly_calc if datetime.strptime(q["date"][:10], "%Y-%m-%d") <= as_dt]
    eligible.sort(key=lambda x: x["date"], reverse=True)
    return eligible[:4]


def _annual_eps_from_quarters(quarterly_eps_values: List[float]) -> float:
    if not quarterly_eps_values:
        return 0.0
    s = sum(quarterly_eps_values)
    n = len(quarterly_eps_values)
    if n < 4:
        return (s / n) * 4.0
    return float(s)


def _quarter_eps_like_ts(tq: Dict[str, Any]) -> float:
    """Match stocks-web calculations.ts: eps_adjusted else earnings else 0."""
    v = tq.get("eps_adjusted")
    if v is not None:
        try:
            return float(v)
        except (TypeError, ValueError):
            pass
    e = tq.get("earnings")
    if e is not None:
        try:
            return float(e)
        except (TypeError, ValueError):
            pass
    return 0.0


def calculate_normal_pe_ratio(quarterly_calc: List[Dict[str, Any]]) -> Optional[float]:
    """Historical average P/E at each quarter (stocks-web calculateNormalPERatio)."""
    points = [q for q in quarterly_calc if q.get("stock_price") and q["stock_price"] > 0]
    if not points:
        return None
    pe_vals: List[float] = []
    for item in points:
        current_date = item["date"]
        trailing = _get_trailing_four_quarters(quarterly_calc, current_date)
        if not trailing:
            continue
        qeps = [_quarter_eps_like_ts(tq) for tq in trailing]
        annual = _annual_eps_from_quarters(qeps)
        sp = float(item["stock_price"])
        if annual > 0 and sp > 0:
            pe_vals.append(sp / annual)
    if not pe_vals:
        return None
    return float(sum(pe_vals) / len(pe_vals))


def rolling_drawdown_series(closes: np.ndarray) -> np.ndarray:
    """Per-day (peak - price) / peak; peak is running max up to that day."""
    if closes.size == 0:
        return np.array([])
    peak = np.maximum.accumulate(closes)
    with np.errstate(divide="ignore", invalid="ignore"):
        dd = (peak - closes) / np.where(peak > 0, peak, np.nan)
    dd = np.nan_to_num(dd, nan=0.0, posinf=0.0, neginf=0.0)
    return np.clip(dd, 0.0, 1.0)


def historical_drawdown_snapshot(
    price_map: Dict[str, float], percentile: float
) -> Optional[Tuple[float, float, float]]:
    if not price_map or len(price_map) < MIN_PRICE_DAYS_HISTORICAL:
        return None
    sorted_dates = sorted(price_map.keys())
    closes = np.array([price_map[d] for d in sorted_dates], dtype=float)
    if np.any(closes <= 0):
        return None
    dd = rolling_drawdown_series(closes)
    if dd.size == 0:
        return None
    historical = float(np.percentile(dd, percentile * 100.0))
    current = float(dd[-1])
    remaining = max(0.0, historical - current)
    return historical, current, remaining


def stress_from_historical_percentile(
    price_map: Dict[str, float], percentile: float
) -> Optional[float]:
    snapshot = historical_drawdown_snapshot(price_map, percentile)
    if snapshot is None:
        return None
    historical, _, _ = snapshot
    return historical


def _trailing_quarters_for_latest_price(
    merged: List[Dict[str, Any]], latest_daily: str
) -> List[Dict[str, Any]]:
    """
    Trailing 4 fiscal quarters for EPS as of latest_daily (last close in price map).
    If none qualify (e.g. daily last date predates all fiscal rows), fall back to last
    quarter end in merged so we still align with stocks-web value logic when possible.
    """
    if not merged:
        return []
    tr = _get_trailing_four_quarters(merged, latest_daily)
    if tr:
        return tr
    return _get_trailing_four_quarters(merged, merged[-1]["date"])


def stress_for_ticker(
    ticker: str,
    price_map: Dict[str, float],
    quarterly_rows: List[Dict[str, Any]],
    percentile: float,
    *,
    quarterly_full_row_count: int = 0,
    use_historical_percentile: bool = False,
) -> Tuple[
    Optional[float],
    str,
    List[str],
    Optional[float],
    Optional[float],
    Optional[float],
    Optional[float],
]:
    """
    Returns (
        stress_pct or None,
        method,
        warnings,
        remaining_stress_pct,
        current_drawdown_pct,
        current_pe,
        normal_pe,
    ).

    use_historical_percentile=True (ETFs/funds/etc.): rolling drawdown percentile only — no fallback.
    use_historical_percentile=False (EQUITY): valuation-based stress only — raises ValuationStressDataError
    if quarterly/EPS/normal P/E cannot be computed (no silent fallback to historical).
    """
    warnings: List[str] = []
    if not price_map:
        raise ValuationStressDataError(f"{ticker}: no price data in window")

    sorted_dates = sorted(price_map.keys())
    latest = sorted_dates[-1]
    current = get_price_at_date(latest, price_map)
    if current <= 0:
        raise ValuationStressDataError(f"{ticker}: invalid last close price")

    if use_historical_percentile:
        snapshot = historical_drawdown_snapshot(price_map, percentile)
        if snapshot is None:
            raise ValuationStressDataError(
                f"{ticker}: insufficient daily price history for {percentile:.0%} rolling "
                "drawdown percentile (need more trading days / valid closes)"
            )
        hist, current_dd, remaining = snapshot
        return (
            round(hist * 100.0, 4),
            "historical_percentile",
            warnings,
            round(remaining * 100.0, 4),
            round(current_dd * 100.0, 4),
            None,
            None,
        )

    # Equity: valuation-based path only
    if not quarterly_rows:
        if quarterly_full_row_count > 0:
            raise ValuationStressDataError(
                f"{ticker}: all {quarterly_full_row_count} quarterly row(s) fell outside the "
                f"{PRICE_HISTORY_YEARS}y lookback after trim, or had unparseable period dates"
            )
        raise ValuationStressDataError(
            f"{ticker}: missing tickers/{ticker}/timeseries/quarterly data (empty or missing "
            "'data' array, or no EPS/revenue/dividend rows — run python -m yahoo.generate_quarterly_timeseries from functions_yahoo)"
        )

    merged = _merge_quarterly_stock_prices(quarterly_rows, price_map)
    if not merged:
        raise ValuationStressDataError(
            f"{ticker}: could not merge quarterly period ends with daily price bars (check date formats)"
        )

    normal_pe = calculate_normal_pe_ratio(merged)
    if normal_pe is None or normal_pe <= 0:
        raise ValuationStressDataError(
            f"{ticker}: could not compute historical average P/E from merged quarters "
            "(need EPS fields + aligned stock prices on quarterly rows)"
        )

    trailing = _trailing_quarters_for_latest_price(merged, latest)
    qeps = [_quarter_eps_like_ts(tq) for tq in trailing] if trailing else []
    annual_eps = _annual_eps_from_quarters(qeps) if qeps else 0.0
    if annual_eps <= 0:
        raise ValuationStressDataError(
            f"{ticker}: trailing annual EPS is {annual_eps:.4f} (must be > 0 for valuation-based stress)"
        )

    normal_price = annual_eps * normal_pe
    dd = max(0.0, (current - normal_price) / current * 100.0)
    current_pe = float(current / annual_eps)
    return (
        round(dd, 4),
        "normal_multiple",
        warnings,
        None,
        None,
        round(current_pe, 4),
        round(float(normal_pe), 4),
    )


def _parse_stored_time(raw: Any) -> Optional[datetime]:
    if raw is None:
        return None
    if hasattr(raw, "timestamp"):
        return datetime.utcfromtimestamp(raw.timestamp())
    if isinstance(raw, datetime):
        return raw.replace(tzinfo=None) if raw.tzinfo else raw
    s = str(raw).replace("Z", "+00:00")
    try:
        d = datetime.fromisoformat(s)
        return d.replace(tzinfo=None) if d.tzinfo else d
    except Exception:
        return None


def read_ticker_stress_cache(db: Any, ticker: str) -> Optional[Dict[str, Any]]:
    try:
        doc = (
            db.collection("tickers")
            .document(ticker.upper())
            .collection("derived")
            .document("stress_drawdown")
            .get()
        )
        if not doc.exists:
            return None
        return doc.to_dict()
    except Exception as e:
        logger.debug("stress cache read failed for %s: %s", ticker, e)
        return None


def ticker_stress_cache_is_usable(
    cache: Dict[str, Any],
    *,
    percentile: float,
    history_years: int,
    ttl_days: int,
) -> bool:
    if cache.get("schemaVersion") != STRESS_CACHE_SCHEMA_VERSION:
        return False
    if cache.get("stressDrawdownPct") is None:
        return False
    if cache.get("percentile") is None:
        return False
    if abs(float(cache["percentile"]) - percentile) > 1e-6:
        return False
    if cache.get("historyYears") != history_years:
        return False
    ts = _parse_stored_time(cache.get("computedAt"))
    if ts is None:
        return False
    return datetime.utcnow() - ts <= timedelta(days=ttl_days)


def write_ticker_stress_cache(db: Any, ticker: str, payload: Dict[str, Any]) -> None:
    try:
        db.collection("tickers").document(ticker.upper()).collection("derived").document(
            "stress_drawdown"
        ).set(payload, merge=True)
    except Exception as e:
        logger.warning("stress cache write failed for %s: %s", ticker, e)


def aggregate_stress_drawdown_pct(position_rows: List[Dict[str, Any]]) -> Optional[float]:
    """Portfolio aggregate uses remaining downside for historical rows, raw stress otherwise."""
    numer = 0.0
    wsum = 0.0
    for row in position_rows:
        v = row.get("valueUsd")
        if v is None or v <= 0:
            continue
        method = row.get("method")
        if method == "historical_percentile":
            s = row.get("remainingStressDrawdownPct")
        else:
            s = row.get("stressDrawdownPct")
        if s is None:
            continue
        numer += (s / 100.0) * v
        wsum += v
    if wsum <= 0:
        return None
    return round((numer / wsum) * 100.0, 4)


def run_stress_drawdown(
    portfolio_id: str,
    *,
    percentile: float = DEFAULT_PERCENTILE,
    verbose: bool = False,
    save_to_firebase: bool = True,
    quiet: bool = False,
    force_refresh_cache: bool = False,
) -> int:
    from services.portfolio_service import PortfolioService
    from services.price_data_service import PriceDataService

    port_svc = PortfolioService()
    price_svc = PriceDataService()
    db = port_svc.db

    portfolio = port_svc.get_portfolio(portfolio_id)
    if not portfolio:
        logger.error("Portfolio not found: %s", portfolio_id)
        return EXIT_ERROR

    positions = [p for p in portfolio.get("positions", []) if p.get("quantity", 0) > 0]
    if not positions:
        logger.warning("No positions for portfolio %s", portfolio_id)
        return EXIT_SKIPPED

    end = datetime.now()
    price_start = end - timedelta(days=365 * PRICE_HISTORY_YEARS)

    qty_by_ticker: Dict[str, float] = {}
    for p in positions:
        t = p["ticker"].upper()
        qty_by_ticker[t] = qty_by_ticker.get(t, 0.0) + float(p.get("quantity", 0))

    position_rows: List[Dict[str, Any]] = []
    stress_errors: List[str] = []
    ticker_cache_hits = 0
    for t in sorted(qty_by_ticker.keys()):
        qty = qty_by_ticker[t]
        quarterly_full = load_quarterly_timeseries(db, t)
        quote_type = _quote_type_from_yahoo(t)
        use_hist = use_historical_stress_path(quote_type, len(quarterly_full))

        cached = None if force_refresh_cache else read_ticker_stress_cache(db, t)
        if (
            cached
            and ticker_stress_cache_is_usable(
                cached,
                percentile=percentile,
                history_years=PRICE_HISTORY_YEARS,
                ttl_days=TICKER_STRESS_CACHE_TTL_DAYS,
            )
            and cache_matches_stress_policy(cached, use_hist)
        ):
            stress = cached.get("stressDrawdownPct")
            remaining_stress = cached.get("remainingStressDrawdownPct")
            current_drawdown = cached.get("currentDrawdownPct")
            method = str(cached.get("method") or "none")
            px = cached.get("lastPriceUsd")
            if px is None or not isinstance(px, (int, float)) or float(px) <= 0:
                pm_short = fetch_prices(t, end - timedelta(days=21), end, price_svc)
                if pm_short and len(pm_short) >= 1:
                    last_d = sorted(pm_short.keys())[-1]
                    px = get_price_at_date(last_d, pm_short)
                else:
                    px = None
            val = qty * float(px) if px is not None and float(px) > 0 else None
            ticker_cache_hits += 1
            position_rows.append(
                {
                    "ticker": t,
                    "quantity": qty,
                    "stressDrawdownPct": float(stress) if stress is not None else None,
                    "remainingStressDrawdownPct": (
                        float(remaining_stress) if remaining_stress is not None else None
                    ),
                    "currentDrawdownPct": (
                        float(current_drawdown) if current_drawdown is not None else None
                    ),
                    "method": method,
                    "valueUsd": round(val, 2) if val is not None else None,
                    "currentPe": cached.get("currentPe"),
                    "normalPe": cached.get("normalPe"),
                }
            )
            continue

        quarterly_trim = trim_quarterly_to_lookback(quarterly_full, end, PRICE_HISTORY_YEARS)
        pm = fetch_prices(t, price_start, end, price_svc)
        if not pm or len(pm) < MIN_PRICE_DAYS_HISTORICAL:
            stress_errors.append(
                f"{t}: fewer than {MIN_PRICE_DAYS_HISTORICAL} trading days with prices "
                f"in the {PRICE_HISTORY_YEARS}y window (cannot compute stress)"
            )
            continue

        try:
            (
                stress,
                method,
                warns,
                remaining_stress,
                current_drawdown,
                current_pe,
                normal_pe,
            ) = stress_for_ticker(
                t,
                pm,
                quarterly_trim,
                percentile,
                quarterly_full_row_count=len(quarterly_full),
                use_historical_percentile=use_hist,
            )
        except ValuationStressDataError as e:
            stress_errors.append(str(e))
            continue
        last_d = sorted(pm.keys())[-1]
        px = get_price_at_date(last_d, pm)
        val = qty * px if px and px > 0 else None

        if save_to_firebase and stress is not None:
            cache_payload: Dict[str, Any] = {
                "schemaVersion": STRESS_CACHE_SCHEMA_VERSION,
                "computedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                "stressDrawdownPct": stress,
                "remainingStressDrawdownPct": remaining_stress,
                "currentDrawdownPct": current_drawdown,
                "method": method,
                "percentile": percentile,
                "historyYears": PRICE_HISTORY_YEARS,
                "lastPriceUsd": round(float(px), 6) if px and px > 0 else None,
                "lastPriceDate": last_d,
            }
            if current_pe is not None:
                cache_payload["currentPe"] = float(current_pe)
            if normal_pe is not None:
                cache_payload["normalPe"] = float(normal_pe)
            write_ticker_stress_cache(db, t, cache_payload)

        position_rows.append(
            {
                "ticker": t,
                "quantity": qty,
                "stressDrawdownPct": stress,
                "remainingStressDrawdownPct": remaining_stress,
                "currentDrawdownPct": current_drawdown,
                "method": method,
                "valueUsd": round(val, 2) if val is not None else None,
                "currentPe": float(current_pe) if current_pe is not None else None,
                "normalPe": float(normal_pe) if normal_pe is not None else None,
            }
        )

    if stress_errors:
        if not quiet:
            print(f"\nStress drawdown — {portfolio.get('name', portfolio_id)}")
            print("Errors (no results written to Firestore):")
            for msg in stress_errors:
                print(f"  • {msg}")
            print()
        logger.error("Stress drawdown failed for %s: %s", portfolio_id, stress_errors)
        return EXIT_ERROR

    aggregate: Optional[float] = None
    remaining_aggregate: Optional[float] = None
    remaining_wsum = 0.0
    remaining_numer = 0.0
    for row in position_rows:
        remaining_s = row.get("remainingStressDrawdownPct")
        v = row.get("valueUsd")
        if remaining_s is not None and v is not None and v > 0:
            remaining_numer += (remaining_s / 100.0) * v
            remaining_wsum += v
    aggregate = aggregate_stress_drawdown_pct(position_rows)
    if remaining_wsum > 0:
        remaining_aggregate = round((remaining_numer / remaining_wsum) * 100.0, 4)

    payload = {
        "computedAt": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "percentile": percentile,
        "historyYears": PRICE_HISTORY_YEARS,
        "aggregatePct": aggregate,
        "remainingAggregatePct": remaining_aggregate,
        "positions": sorted(position_rows, key=lambda x: x["ticker"]),
        "warnings": [],
    }

    if not quiet:
        print(f"\nStress drawdown — {portfolio.get('name', portfolio_id)}")
        print(f"Aggregate (value-weighted): {aggregate}%")
        for row in position_rows:
            current_dd = row.get("currentDrawdownPct")
            remaining_dd = row.get("remainingStressDrawdownPct")
            extras = ""
            if current_dd is not None and row.get("method") == "historical_percentile":
                extras = f", current DD {current_dd}%"
                if remaining_dd is not None:
                    extras += f", remaining {remaining_dd}%"
            print(
                f"  {row['ticker']}: {row.get('stressDrawdownPct')}% "
                f"({row.get('method')}{extras})"
            )
        if ticker_cache_hits > 0 and not force_refresh_cache:
            print(
                f"Note: {ticker_cache_hits} ticker(s) used cached stress "
                f"(tickers/{{T}}/derived/stress_drawdown). Use --force-cache-refresh to recompute."
            )
        print()

    if save_to_firebase:
        port_svc.save_stress_drawdown(portfolio_id, payload)
        logger.info("Saved stressDrawdown to portfolio %s", portfolio_id)

    return EXIT_OK


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute portfolio stress drawdown")
    parser.add_argument("portfolio_id", help="Portfolio document ID")
    parser.add_argument(
        "--percentile",
        type=float,
        default=DEFAULT_PERCENTILE,
        help="Historical path percentile (default 0.9)",
    )
    parser.add_argument("-v", "--verbose", action="store_true")
    parser.add_argument("--no-firebase", action="store_true")
    parser.add_argument(
        "--force-cache-refresh",
        action="store_true",
        help="Recompute per-ticker stress (ignore tickers/{T}/derived/stress_drawdown cache)",
    )
    args = parser.parse_args()
    if args.verbose:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    rc = run_stress_drawdown(
        args.portfolio_id,
        percentile=args.percentile,
        verbose=args.verbose,
        save_to_firebase=not args.no_firebase,
        force_refresh_cache=args.force_cache_refresh,
    )
    if rc == EXIT_SKIPPED:
        return EXIT_OK
    return rc


if __name__ == "__main__":
    from dotenv import load_dotenv

    _repo_root = os.path.dirname(_pkg)
    _env_df = os.path.join(_repo_root, "data-fetcher", ".env.local")
    if os.path.isfile(_env_df):
        load_dotenv(_env_df)
    else:
        load_dotenv(os.path.join(_pkg, ".env.local"))
    sys.exit(main())
