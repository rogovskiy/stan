#!/usr/bin/env python3
"""
Macro risk score computation (risk-on / risk-off).

Pure logic: features, channel scores, global score, mode, transition, reasons.
Uses only price series; no I/O.
"""

from typing import Dict, Optional, Any
import numpy as np
import pandas as pd


# Channel weights (v1)
WEIGHTS = {
    "EQUITIES": 0.35,
    "CREDIT": 0.25,
    "VOL": 0.25,
    "USD": 0.10,
    "OIL": 0.05,
}

REASON_LABELS = {
    "EQUITIES": {
        1: "Equity trend strong (SPY above 200D, positive 60D momentum)",
        -1: "Equity trend weakening (SPY below 200D or weak 60D momentum)",
    },
    "CREDIT": {
        1: "Credit risk appetite healthy (HYG/LQD above 50D trend)",
        -1: "Credit risk appetite weakening (HYG/LQD below 50D trend)",
    },
    "VOL": {
        1: "Volatility subdued (VIX below 20D or realized vol below median)",
        -1: "Volatility rising (VIX above 20D)",
    },
    "USD": {
        0: None,
        -0.5: "USD tightening impulse (UUP uptrend)",
        -1: "USD tightening impulse (UUP uptrend)",
    },
    "OIL": {
        0: None,
        -1: "Oil impulse (USO +8%/20d)",
    },
}


def _last(s: pd.Series, n: int = 1) -> float:
    """Last value(s); if series too short return NaN."""
    if s is None or len(s) < n:
        return np.nan
    return float(s.iloc[-n]) if n == 1 else s.iloc[-n:].values


def _align_dates(series_dict: Dict[str, pd.Series]) -> pd.DatetimeIndex:
    """Common index for all series (intersection of dates)."""
    if not series_dict:
        return pd.DatetimeIndex([])
    idx = None
    for s in series_dict.values():
        if s is not None and len(s) > 0:
            if idx is None:
                idx = s.index
            else:
                idx = idx.intersection(s.index)
    return idx if idx is not None else pd.DatetimeIndex([])


def compute_features(price: pd.Series) -> Optional[Dict[str, float]]:
    """Compute ma50, ma200, mom20, mom60, realized_vol20 for a price series."""
    if price is None or len(price) < 60:
        return None
    price = price.dropna()
    if len(price) < 60:
        return None
    last = float(price.iloc[-1])
    ma50 = float(price.rolling(50).mean().iloc[-1]) if len(price) >= 50 else np.nan
    ma200 = float(price.rolling(200).mean().iloc[-1]) if len(price) >= 200 else np.nan
    mom20 = (last / float(price.iloc[-21]) - 1.0) if len(price) >= 21 else np.nan
    mom60 = (last / float(price.iloc[-61]) - 1.0) if len(price) >= 61 else np.nan
    returns = price.pct_change().dropna()
    if len(returns) >= 20:
        rv20 = float(returns.iloc[-20:].std() * np.sqrt(252))
    else:
        rv20 = np.nan
    return {
        "last": last,
        "ma50": ma50,
        "ma200": ma200,
        "mom20": mom20,
        "mom60": mom60,
        "realized_vol20": rv20,
    }


def channel_equities(series_by_ticker: Dict[str, pd.Series]) -> Optional[float]:
    """EQUITIES channel: SPY vs MA200 and mom60. Score in [-1, +1]."""
    spy = series_by_ticker.get("SPY")
    feats = compute_features(spy) if spy is not None else None
    if feats is None or np.isnan(feats.get("ma200")) or np.isnan(feats.get("mom60")):
        return None
    score = 0.0
    score += 0.6 if feats["last"] > feats["ma200"] else -0.6
    score += 0.4 if feats["mom60"] > 0 else -0.4
    return max(-1.0, min(1.0, score))


def channel_credit(series_by_ticker: Dict[str, pd.Series]) -> Optional[float]:
    """CREDIT channel: HYG/LQD ratio vs its MA50. +1 or -1."""
    hyg = series_by_ticker.get("HYG")
    lqd = series_by_ticker.get("LQD")
    if hyg is None or lqd is None:
        return None
    idx = _align_dates({"HYG": hyg, "LQD": lqd})
    if len(idx) < 50:
        return None
    rs = hyg.reindex(idx).ffill().bfill() / lqd.reindex(idx).ffill().bfill()
    rs = rs.dropna()
    if len(rs) < 50:
        return None
    rs_ma50 = float(rs.rolling(50).mean().iloc[-1])
    last_rs = float(rs.iloc[-1])
    return 1.0 if last_rs > rs_ma50 else -1.0


def channel_vol(
    series_by_ticker: Dict[str, pd.Series],
    vix_floor: float = 18.0,
) -> Optional[float]:
    """VOL channel: VIX vs MA20 and floor, or SPY realized vol vs 1y median."""
    vix = series_by_ticker.get("^VIX")
    if vix is None:
        vix = series_by_ticker.get("VIX")
    if vix is not None and len(vix) >= 20:
        vix = vix.dropna()
        if len(vix) >= 20:
            vix_level = float(vix.iloc[-1])
            vix_ma20 = float(vix.rolling(20).mean().iloc[-1])
            if vix_level > vix_ma20 and vix_level > vix_floor:
                return -1.0
            return 1.0
    spy = series_by_ticker.get("SPY")
    if spy is None or len(spy) < 252:
        return None
    returns = spy.pct_change().dropna()
    if len(returns) < 252:
        return None
    rv20_series = returns.rolling(20).std() * np.sqrt(252)
    rv20_1y = rv20_series.iloc[-252:]
    rv20_1y = rv20_1y.dropna()
    if len(rv20_1y) < 20:
        return None
    median_rv = float(np.nanmedian(rv20_1y))
    current_rv = float(rv20_series.iloc[-1])
    return -1.0 if current_rv > median_rv else 1.0


def channel_usd(series_by_ticker: Dict[str, pd.Series]) -> float:
    """USD channel: UUP mom20 > 0 and UUP > MA50 -> -0.5 else 0."""
    uup = series_by_ticker.get("UUP")
    feats = compute_features(uup) if uup is not None else None
    if feats is None or np.isnan(feats.get("mom20")) or np.isnan(feats.get("ma50")):
        return 0.0
    if feats["mom20"] > 0 and feats["last"] > feats["ma50"]:
        return -0.5
    return 0.0


def channel_oil(series_by_ticker: Dict[str, pd.Series]) -> float:
    """OIL channel: oil_mom20 > 8% -> -1 else 0."""
    uso = series_by_ticker.get("USO")
    feats = compute_features(uso) if uso is not None else None
    if feats is None or np.isnan(feats.get("mom20")):
        return 0.0
    return -1.0 if feats["mom20"] > 0.08 else 0.0


def compute_channel_scores(series_by_ticker: Dict[str, pd.Series]) -> Dict[str, float]:
    """All channel scores; missing channels omitted from returned dict."""
    scores = {}
    eq = channel_equities(series_by_ticker)
    if eq is not None:
        scores["EQUITIES"] = eq
    cr = channel_credit(series_by_ticker)
    if cr is not None:
        scores["CREDIT"] = cr
    vol = channel_vol(series_by_ticker)
    if vol is not None:
        scores["VOL"] = vol
    scores["USD"] = channel_usd(series_by_ticker)
    scores["OIL"] = channel_oil(series_by_ticker)
    return scores


def compute_global_score(channel_scores: Dict[str, float]) -> float:
    """Weighted sum; missing channel contributes 0."""
    total = 0.0
    for ch, w in WEIGHTS.items():
        total += w * channel_scores.get(ch, 0.0)
    return total


def macro_mode(global_score: float) -> str:
    """RISK_ON if >= 0.25, RISK_OFF if <= -0.25, else MIXED."""
    if global_score >= 0.25:
        return "RISK_ON"
    if global_score <= -0.25:
        return "RISK_OFF"
    return "MIXED"


def confidence(global_score: float) -> float:
    """min(1.0, abs(global_score) / 0.75)."""
    return min(1.0, abs(global_score) / 0.75)


def transition(global_score: float, global_score_prev: Optional[float]) -> str:
    """DETERIORATING if delta <= -0.15, IMPROVING if delta >= +0.15, else STABLE."""
    if global_score_prev is None:
        return "STABLE"
    delta = global_score - global_score_prev
    if delta <= -0.15:
        return "DETERIORATING"
    if delta >= 0.15:
        return "IMPROVING"
    return "STABLE"


def top_reasons(
    channel_scores: Dict[str, float],
    mode: str,
    trans: str,
    n: int = 2,
) -> list:
    """Top n reasons by absolute contribution; prefer negative impact when risk-off/deteriorating."""
    contribs = []
    for ch, score in channel_scores.items():
        w = WEIGHTS.get(ch, 0)
        c = w * score
        labels = REASON_LABELS.get(ch, {})
        if ch == "USD":
            label = labels.get(score)
        elif ch == "OIL":
            label = labels.get(score)
        else:
            label = labels.get(1) if score >= 0 else labels.get(-1)
        if label is None:
            continue
        contribs.append((abs(c), c, label))
    contribs.sort(key=lambda x: -x[0])
    want_negative = mode == "RISK_OFF" or trans == "DETERIORATING"
    if want_negative:
        negative = [(a, c, l) for a, c, l in contribs if c < 0]
        chosen = negative[:n] if negative else contribs[:n]
    else:
        chosen = contribs[:n]
    return [label for _, _, label in chosen]


def compute_global_score_prev(
    series_by_ticker_10d_ago: Dict[str, pd.Series],
) -> Optional[float]:
    """Compute global score as of 10d-ago series (for transition)."""
    if not series_by_ticker_10d_ago:
        return None
    channel_scores = compute_channel_scores(series_by_ticker_10d_ago)
    if not channel_scores:
        return None
    return compute_global_score(channel_scores)


def compute_macro_scores(
    series_by_ticker: Dict[str, pd.Series],
    as_of_date: str,
    series_by_ticker_10d_ago: Optional[Dict[str, pd.Series]] = None,
) -> Dict[str, Any]:
    """
    Full macro score payload: asOf, macroMode, globalScore, confidence, transition, channelScores, reasons.
    If series_by_ticker_10d_ago is provided, transition is computed; else STABLE.
    """
    channel_scores = compute_channel_scores(series_by_ticker)
    global_score = compute_global_score(channel_scores)
    global_score_prev = None
    if series_by_ticker_10d_ago:
        global_score_prev = compute_global_score_prev(series_by_ticker_10d_ago)
    trans = transition(global_score, global_score_prev)
    mode = macro_mode(global_score)
    reasons = top_reasons(channel_scores, mode, trans, n=2)
    return {
        "asOf": as_of_date,
        "macroMode": mode,
        "globalScore": round(global_score, 4),
        "confidence": round(confidence(global_score), 4),
        "transition": trans,
        "channelScores": {k: round(v, 4) for k, v in channel_scores.items()},
        "reasons": reasons,
    }
