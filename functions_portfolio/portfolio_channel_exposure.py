#!/usr/bin/env python3
"""
Portfolio Channel Exposure

Computes factor betas (exposure) of a portfolio to each macro risk channel.
Loads prices from Firebase; falls back to yfinance for tickers not in Firebase.
Stores results in the portfolio document as channelExposures.

Shared by Cloud Functions (main.py) and local CLI.

Usage:
    cd functions_portfolio && source venv/bin/activate && make vendor
    python portfolio_channel_exposure.py <PORTFOLIO_ID> [--period 1y|2y] [--verbose]

Or from data-fetcher: python portfolio_channel_exposure.py ... (shim; needs ../functions_portfolio + vendor).
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

import numpy as np

_pkg = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_pkg, "vendor")
for _p in (_vendor, _pkg):
    if _p not in sys.path:
        sys.path.insert(0, _p)

logger = logging.getLogger(__name__)

MIN_TRADING_DAYS = 60
TOP_CONTRIBUTORS = 8  # max holdings listed per channel in Firestore / UI

# Exit codes for run_channel_exposure / CLI
EXIT_OK = 0
EXIT_ERROR = 1
EXIT_SKIPPED = 2  # insufficient history or snapshots — warn only, not a failed job


def parse_period(period: str) -> int:
    """Parse period string (e.g. 1y, 2y) to calendar days."""
    period = period.lower()
    if period.endswith("y"):
        years = int(period[:-1])
        return years * 365
    return 365


def fetch_prices_firebase(
    ticker: str,
    start: datetime,
    end: datetime,
    price_svc: Any,
) -> Optional[Dict[str, float]]:
    """Fetch prices from Firebase. Returns {date_str: close} or None."""
    try:
        raw = price_svc.get_price_data_range(ticker, start, end)
        if not raw:
            return None
        return {d: float(v.get("c", 0)) for d, v in raw.items() if "c" in v and v["c"]}
    except Exception as e:
        logger.debug("Firebase fetch failed for %s: %s", ticker, e)
        return None


def fetch_prices_yfinance(
    ticker: str,
    start: datetime,
    end: datetime,
) -> Optional[Dict[str, float]]:
    """Fetch prices via yfinance. Returns {date_str: close} or None."""
    try:
        import yfinance as yf

        obj = yf.Ticker(ticker)
        hist = obj.history(start=start, end=end, interval="1d", auto_adjust=True)
        if hist is None or hist.empty or len(hist) < 20:
            return None
        col = "Adj Close" if "Adj Close" in hist.columns and hist["Adj Close"].notna().any() else "Close"
        s = hist[col].dropna()
        if len(s) == 0:
            return None
        return {str(k.date()): float(v) for k, v in s.items()}
    except Exception as e:
        logger.warning("yfinance fetch failed for %s: %s", ticker, e)
        return None


def fetch_prices(
    ticker: str,
    start: datetime,
    end: datetime,
    price_svc: Any,
) -> Optional[Dict[str, float]]:
    """Try Firebase first, then yfinance."""
    out = fetch_prices_firebase(ticker, start, end, price_svc)
    if out and len(out) >= 20:
        return out
    return fetch_prices_yfinance(ticker, start, end)


def get_price_at_date(date_str: str, price_map: Dict[str, float]) -> float:
    """Get price for date_str; if missing, use latest on or before."""
    if date_str in price_map:
        return price_map[date_str]
    sorted_dates = sorted(price_map.keys())
    on_or_before = [d for d in sorted_dates if d <= date_str]
    use_date = on_or_before[-1] if on_or_before else sorted_dates[0]
    return price_map.get(use_date, 0.0)


def value_from_snapshot(
    snapshot: Dict[str, Any],
    date_str: str,
    price_maps: Dict[str, Dict[str, float]],
) -> float:
    """Portfolio value at date_str using snapshot positions and prices."""
    total = float(snapshot.get("cashBalance", 0))
    for p in snapshot.get("positions", []):
        if p.get("quantity", 0) <= 0:
            continue
        ticker = p.get("ticker", "")
        if ticker not in price_maps:
            continue
        price = get_price_at_date(date_str, price_maps[ticker])
        if price > 0:
            total += p["quantity"] * price
    return total


def get_snapshot_for_date(
    snapshots_asc: List[Dict[str, Any]],
    date_str: str,
) -> Optional[Dict[str, Any]]:
    """Latest snapshot with snapshot.date <= date_str."""
    best = None
    for s in snapshots_asc:
        if s["date"] <= date_str:
            best = s
    return best


def compute_returns(prices: Dict[str, float]) -> Dict[str, float]:
    """Daily returns: {date: (p_t - p_{t-1}) / p_{t-1}}."""
    sorted_dates = sorted(prices.keys())
    returns = {}
    for i in range(1, len(sorted_dates)):
        d = sorted_dates[i]
        d_prev = sorted_dates[i - 1]
        p = prices[d]
        p_prev = prices[d_prev]
        if p_prev > 0:
            returns[d] = (p - p_prev) / p_prev
    return returns


def ols_beta_r2(y: np.ndarray, x: np.ndarray) -> tuple:
    """Simple OLS: y = alpha + beta*x. Returns (beta, r_squared)."""
    if len(y) < 2 or len(x) < 2 or len(y) != len(x):
        return (np.nan, np.nan)
    mask = ~(np.isnan(y) | np.isnan(x))
    if mask.sum() < MIN_TRADING_DAYS:
        return (np.nan, np.nan)
    y_ = y[mask]
    x_ = x[mask]
    X = np.column_stack([np.ones(len(x_)), x_])
    try:
        coeffs, _, _, _ = np.linalg.lstsq(X, y_, rcond=None)
        beta = float(coeffs[1])
        y_pred = X @ coeffs
        ss_res = np.sum((y_ - y_pred) ** 2)
        ss_tot = np.sum((y_ - np.mean(y_)) ** 2)
        r2 = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0
        return (beta, float(r2))
    except Exception:
        return (np.nan, np.nan)


def r_squared_multivariate(y: np.ndarray, x_factors: np.ndarray) -> float:
    """
    R² for OLS y ~ 1 + x_factors.
    x_factors has shape (n, k) with k >= 0; k == 0 returns 0 (no factors).
    """
    if x_factors.size == 0 or x_factors.shape[1] == 0:
        return 0.0
    if len(y) != x_factors.shape[0]:
        return float("nan")
    mask = np.isfinite(y)
    for j in range(x_factors.shape[1]):
        mask &= np.isfinite(x_factors[:, j])
    if mask.sum() < MIN_TRADING_DAYS:
        return float("nan")
    y_ = y[mask]
    xf = x_factors[mask]
    X = np.column_stack([np.ones(len(y_)), xf])
    try:
        coeffs, _, _, _ = np.linalg.lstsq(X, y_, rcond=None)
        y_pred = X @ coeffs
        ss_tot = np.sum((y_ - np.mean(y_)) ** 2)
        if ss_tot <= 0:
            return 0.0
        ss_res = np.sum((y_ - y_pred) ** 2)
        return float(1.0 - ss_res / ss_tot)
    except Exception:
        return float("nan")


def sequential_incremental_r2(
    y: np.ndarray,
    ordered_channels: List[str],
    channel_proxy_arrays: Dict[str, np.ndarray],
) -> Dict[str, float]:
    """
    Type I sequential incremental R²: factor (i) adds
    R²(y ~ x1..xi) - R²(y ~ x1..x_{i-1}).
    ordered_channels: strongest univariate first (caller sorts).
    """
    out: Dict[str, float] = {}
    if not ordered_channels:
        return out
    for i in range(len(ordered_channels)):
        ch = ordered_channels[i]
        cols = [channel_proxy_arrays[c] for c in ordered_channels[: i + 1]]
        x_curr = np.column_stack(cols) if cols else np.zeros((len(y), 0))
        r2_curr = r_squared_multivariate(y, x_curr)
        if i == 0:
            inc = r2_curr if np.isfinite(r2_curr) else 0.0
        else:
            cols_prev = [channel_proxy_arrays[c] for c in ordered_channels[:i]]
            x_prev = np.column_stack(cols_prev)
            r2_prev = r_squared_multivariate(y, x_prev)
            if not np.isfinite(r2_curr) or not np.isfinite(r2_prev):
                inc = 0.0
            else:
                inc = max(0.0, float(r2_curr - r2_prev))
        out[ch] = inc
    return out


def run_channel_exposure(
    portfolio_id: str,
    *,
    period: str = "1y",
    verbose: bool = False,
    save_to_firebase: bool = True,
    quiet: bool = False,
) -> int:
    """
    Compute channel exposures for one portfolio and optionally persist to Firestore.

    Returns:
        EXIT_OK on success, EXIT_ERROR on failure, EXIT_SKIPPED when history/snapshots
        are insufficient to compute exposure (logged as warning, not an error).
    """
    from services.portfolio_service import PortfolioService
    from services.channels_config_service import ChannelsConfigService
    from services.price_data_service import PriceDataService

    port_svc = PortfolioService()
    channels_svc = ChannelsConfigService()
    price_svc = PriceDataService()

    portfolio = port_svc.get_portfolio(portfolio_id)
    if not portfolio:
        logger.error("Portfolio not found: %s", portfolio_id)
        return EXIT_ERROR

    positions = portfolio.get("positions", [])
    if not positions or all(p.get("quantity", 0) <= 0 for p in positions):
        logger.error("Portfolio has no positions.")
        return EXIT_ERROR

    channels = channels_svc.get_all_channels()
    if not channels:
        logger.error("No channel config found in macro/us_market/channels")
        return EXIT_ERROR

    channel_proxies: Dict[str, str] = {}
    for ch, cfg in channels.items():
        tickers = cfg.get("tickers", [])
        if tickers:
            channel_proxies[ch] = tickers[0]

    portfolio_tickers = list({p["ticker"] for p in positions if p.get("quantity", 0) > 0})
    proxy_tickers = list(set(channel_proxies.values()))
    all_tickers = list(dict.fromkeys(portfolio_tickers + proxy_tickers))

    days_back = parse_period(period)
    end = datetime.now()
    start = end - timedelta(days=days_back)

    logger.info("Fetching prices for %d tickers from %s to %s", len(all_tickers), start.date(), end.date())

    price_maps: Dict[str, Dict[str, float]] = {}
    for t in all_tickers:
        pm = fetch_prices(t, start, end, price_svc)
        if pm and len(pm) >= 20:
            price_maps[t] = pm
        elif t in portfolio_tickers:
            logger.error("Missing price data for portfolio ticker %s", t)
            return EXIT_ERROR
        else:
            logger.warning("Skipping channel proxy %s (no price data)", t)

    all_dates = set()
    for pm in price_maps.values():
        all_dates.update(pm.keys())
    dates = sorted([d for d in all_dates if start.date().isoformat() <= d <= end.date().isoformat()])

    if len(dates) < MIN_TRADING_DAYS:
        logger.warning(
            "Insufficient trading days: %d (need >= %d); skipping exposure",
            len(dates),
            MIN_TRADING_DAYS,
        )
        return EXIT_SKIPPED

    date_max = dates[-1]
    snapshots = port_svc.get_snapshots_up_to_date(portfolio_id, date_max)

    portfolio_values: Dict[str, float] = {}
    for d in dates:
        snap = get_snapshot_for_date(snapshots, d)
        if snap:
            portfolio_values[d] = value_from_snapshot(snap, d, price_maps)

    port_dates = sorted(portfolio_values.keys())
    if len(port_dates) < MIN_TRADING_DAYS:
        logger.warning(
            "Portfolio has value on only %d days (need >= %d); skipping exposure "
            "(add snapshots or wait for more history)",
            len(port_dates),
            MIN_TRADING_DAYS,
        )
        return EXIT_SKIPPED

    port_returns = compute_returns({d: portfolio_values[d] for d in port_dates})

    aligned_dates = sorted(port_returns.keys())
    if len(aligned_dates) < MIN_TRADING_DAYS:
        logger.warning(
            "Insufficient aligned returns (%d days, need >= %d); skipping exposure",
            len(aligned_dates),
            MIN_TRADING_DAYS,
        )
        return EXIT_SKIPPED

    port_ret_arr = np.array([port_returns[d] for d in aligned_dates])

    snap_last = get_snapshot_for_date(snapshots, aligned_dates[-1])
    last_d = aligned_dates[-1]
    total_val = value_from_snapshot(snap_last, last_d, price_maps) if snap_last else 0.0
    weight_frac: Dict[str, float] = {}
    if snap_last and total_val > 0:
        for p in snap_last.get("positions", []):
            if p.get("quantity", 0) <= 0:
                continue
            t = p.get("ticker", "")
            if t not in price_maps:
                continue
            price = get_price_at_date(last_d, price_maps[t])
            if price > 0:
                v = p["quantity"] * price
                weight_frac[t] = weight_frac.get(t, 0) + v / total_val

    ticker_return_arrays: Dict[str, np.ndarray] = {}
    for t in portfolio_tickers:
        if t not in price_maps:
            continue
        pr = compute_returns(price_maps[t])
        ticker_return_arrays[t] = np.array([pr.get(d, np.nan) for d in aligned_dates])

    exposures: Dict[str, Dict[str, Any]] = {}
    rows: List[tuple] = []

    for ch, proxy in channel_proxies.items():
        if proxy not in price_maps:
            continue
        proxy_returns = compute_returns(price_maps[proxy])
        proxy_ret_arr = np.array([proxy_returns.get(d, np.nan) for d in aligned_dates])
        beta, r2 = ols_beta_r2(port_ret_arr, proxy_ret_arr)

        contributors: List[Dict[str, Any]] = []
        for ticker in portfolio_tickers:
            if ticker not in ticker_return_arrays:
                continue
            pos_ret_arr = ticker_return_arrays[ticker]
            pb, _ = ols_beta_r2(pos_ret_arr, proxy_ret_arr)
            if np.isnan(pb):
                continue
            w = weight_frac.get(ticker, 0.0)
            contrib = float(w) * float(pb)
            contributors.append(
                {
                    "ticker": ticker,
                    "weightPct": round(100.0 * w, 2),
                    "beta": round(float(pb), 4),
                    "contribution": round(contrib, 4),
                }
            )
        contributors.sort(key=lambda x: abs(x["contribution"]), reverse=True)
        contributors = contributors[:TOP_CONTRIBUTORS]

        exposures[ch] = {
            "proxy": proxy,
            "beta": round(beta, 4),
            "rSquared": round(r2, 4),
            "contributors": contributors,
        }
        rows.append((ch, proxy, beta, r2, proxy_ret_arr))

    ordered_ch: List[str] = []
    incremental: Dict[str, float] = {}
    if rows:
        rows.sort(
            key=lambda t: (
                -(t[3] if np.isfinite(t[3]) else -1.0),
                -(abs(t[2]) if np.isfinite(t[2]) else 0.0),
                t[0],
            )
        )
        ordered_ch = [t[0] for t in rows]
        channel_proxy_arrays = {t[0]: t[4] for t in rows}
        incremental = sequential_incremental_r2(port_ret_arr, ordered_ch, channel_proxy_arrays)
        for rank, ch in enumerate(ordered_ch, start=1):
            inc = float(incremental.get(ch, 0.0))
            exposures[ch]["incrementalR2"] = round(inc, 4)
            exposures[ch]["sequentialRank"] = rank

    if not quiet:
        print(f"\nPortfolio: {portfolio.get('name', '')}")
        print(f"Period: {aligned_dates[0]} to {aligned_dates[-1]} ({len(aligned_dates)} trading days)\n")
        print(f"{'Channel':<14} {'Proxy':<8} {'Beta':>8} {'R²':>8} {'IncR²':>8} {'Rank':>4}")
        print("-" * 54)
        for ch, proxy, beta, r2, _ in rows:
            beta_str = f"{beta:.4f}" if not np.isnan(beta) else "   N/A"
            r2_str = f"{r2:.4f}" if not np.isnan(r2) else "   N/A"
            inc = incremental.get(ch, 0.0) if incremental else 0.0
            inc_str = f"{inc:.4f}"
            rk = exposures[ch].get("sequentialRank", "")
            rk_str = str(rk) if rk != "" else ""
            print(f"{ch:<14} {proxy:<8} {beta_str:>8} {r2_str:>8} {inc_str:>8} {rk_str:>4}")
        print()

    if save_to_firebase and exposures:
        metadata = {
            "asOf": aligned_dates[-1],
            "periodStart": aligned_dates[0],
            "tradingDays": len(aligned_dates),
        }
        port_svc.save_channel_exposures(portfolio_id, exposures, metadata)
        logger.info("Saved channelExposures to portfolio %s", portfolio_id)

    return EXIT_OK


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compute portfolio exposure to macro risk channels"
    )
    parser.add_argument("portfolio_id", help="Portfolio document ID")
    parser.add_argument("--period", default="1y", help="Lookback period (e.g. 1y, 2y)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    parser.add_argument("--no-firebase", action="store_true", help="Skip writing to Firestore")
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    else:
        logging.basicConfig(level=logging.WARNING)

    rc = run_channel_exposure(
        args.portfolio_id,
        period=args.period,
        verbose=args.verbose,
        save_to_firebase=not args.no_firebase,
    )
    # Skip (insufficient data) is not a CLI failure for make/scripts
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
