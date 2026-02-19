#!/usr/bin/env python3
"""
Macro risk score computation (risk-on / risk-off).

Config-driven scoring engine. Each channel is scored by a generic scoring
function selected via the ``scoringType`` field in its Firebase config.
All thresholds, MA periods, and score values come from ``params``.

Pure logic: no I/O, no hardcoded channel definitions.
"""

from typing import Dict, Optional, Any, List
import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

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


def _ma(price: pd.Series, period: int) -> float:
    """Rolling mean of *period* on *price*; NaN if too short."""
    if price is None or len(price) < period:
        return np.nan
    return float(price.rolling(period).mean().iloc[-1])


def _momentum(price: pd.Series, period: int) -> float:
    """Return over *period* trading days; NaN if too short."""
    need = period + 1
    if price is None or len(price) < need:
        return np.nan
    return float(price.iloc[-1]) / float(price.iloc[-need]) - 1.0


# ---------------------------------------------------------------------------
# Generic scoring functions
# ---------------------------------------------------------------------------

def score_breadth_trend(
    series_by_ticker: Dict[str, pd.Series],
    tickers: List[str],
    params: Dict[str, Any],
) -> Optional[float]:
    """Score based on how many tickers are above their MA with positive momentum.

    Each ticker contributes a sub-score weighted by trend_weight (MA check)
    and momentum_weight (momentum check), then averaged across tickers.

    params:
        ma_period (int): moving-average look-back
        momentum_period (int): momentum look-back
        trend_weight (float): weight for above/below MA component
        momentum_weight (float): weight for momentum component
    """
    ma_period = int(params["ma_period"])
    mom_period = int(params["momentum_period"])
    tw = float(params["trend_weight"])
    mw = float(params["momentum_weight"])

    sub_scores: list[float] = []
    for t in tickers:
        price = series_by_ticker.get(t)
        if price is None:
            continue
        price = price.dropna()
        ma_val = _ma(price, ma_period)
        mom_val = _momentum(price, mom_period)
        if np.isnan(ma_val) or np.isnan(mom_val):
            continue
        last = float(price.iloc[-1])
        s = 0.0
        s += tw if last > ma_val else -tw
        s += mw if mom_val > 0 else -mw
        sub_scores.append(max(-1.0, min(1.0, s)))

    if not sub_scores:
        return None
    return max(-1.0, min(1.0, sum(sub_scores) / len(sub_scores)))


def score_ratio_trend(
    series_by_ticker: Dict[str, pd.Series],
    tickers: List[str],
    params: Dict[str, Any],
) -> Optional[float]:
    """Score based on the ratio of ticker[0]/ticker[1] vs its MA.

    params:
        ma_period (int): moving-average look-back for the ratio
        score_above (float): score when ratio is above MA
        score_below (float): score when ratio is below MA
    """
    if len(tickers) < 2:
        return None
    numerator = series_by_ticker.get(tickers[0])
    denominator = series_by_ticker.get(tickers[1])
    if numerator is None or denominator is None:
        return None

    ma_period = int(params["ma_period"])
    idx = _align_dates({tickers[0]: numerator, tickers[1]: denominator})
    if len(idx) < ma_period:
        return None

    ratio = (
        numerator.reindex(idx).ffill().bfill()
        / denominator.reindex(idx).ffill().bfill()
    )
    ratio = ratio.dropna()
    if len(ratio) < ma_period:
        return None

    ratio_ma = float(ratio.rolling(ma_period).mean().iloc[-1])
    last_ratio = float(ratio.iloc[-1])

    score_above = float(params.get("score_above", 1.0))
    score_below = float(params.get("score_below", -1.0))
    return score_above if last_ratio > ratio_ma else score_below


def score_level_vs_ma(
    series_by_ticker: Dict[str, pd.Series],
    tickers: List[str],
    params: Dict[str, Any],
) -> Optional[float]:
    """Score when a level (e.g. VIX) is above both its MA and a floor.

    params:
        ma_period (int): moving-average look-back
        floor (float): absolute floor level
        score_above (float): score when level > MA *and* level > floor
        score_below (float): score otherwise
    """
    ticker = tickers[0]
    series = series_by_ticker.get(ticker)
    if series is None:
        series = series_by_ticker.get(ticker.lstrip("^"))
    if series is None:
        return None

    series = series.dropna()
    ma_period = int(params["ma_period"])
    if len(series) < ma_period:
        return None

    level = float(series.iloc[-1])
    level_ma = float(series.rolling(ma_period).mean().iloc[-1])
    floor_val = float(params.get("floor", 0.0))
    score_above = float(params.get("score_above", -1.0))
    score_below = float(params.get("score_below", 1.0))

    if level > level_ma and level > floor_val:
        return score_above
    return score_below


def score_trend_momentum(
    series_by_ticker: Dict[str, pd.Series],
    tickers: List[str],
    params: Dict[str, Any],
) -> Optional[float]:
    """Score based on a single ticker's MA trend + momentum direction.

    Uses the *last* ticker in the list that has sufficient data
    (allows primary + fallback ordering).

    params:
        ma_period (int): moving-average look-back
        momentum_period (int): momentum look-back
        score_bullish (float): score when above MA and positive momentum
        score_bearish (float): score when below MA and negative momentum
        score_mixed (float): score when signals disagree
    """
    ma_period = int(params["ma_period"])
    mom_period = int(params["momentum_period"])
    score_bull = float(params.get("score_bullish", 1.0))
    score_bear = float(params.get("score_bearish", -1.0))
    score_mix = float(params.get("score_mixed", 0.0))

    for t in reversed(tickers):
        price = series_by_ticker.get(t)
        if price is None:
            continue
        price = price.dropna()
        ma_val = _ma(price, ma_period)
        mom_val = _momentum(price, mom_period)
        if np.isnan(ma_val) or np.isnan(mom_val):
            continue
        last = float(price.iloc[-1])
        above_ma = last > ma_val
        positive_mom = mom_val > 0
        if above_ma and positive_mom:
            return score_bull
        if not above_ma and not positive_mom:
            return score_bear
        return score_mix
    return None


def score_momentum_threshold(
    series_by_ticker: Dict[str, pd.Series],
    tickers: List[str],
    params: Dict[str, Any],
) -> Optional[float]:
    """Score triggered when momentum exceeds a threshold, optionally requiring price > MA.

    params:
        ma_period (int): moving-average look-back
        momentum_period (int): momentum look-back
        momentum_threshold (float): trigger when momentum > this value
        require_above_ma (bool): also require price > MA to trigger
        score_triggered (float): score when condition met
        score_default (float): score otherwise
    """
    ma_period = int(params["ma_period"])
    mom_period = int(params["momentum_period"])
    mom_threshold = float(params["momentum_threshold"])
    require_above_ma = bool(params.get("require_above_ma", False))
    score_triggered = float(params["score_triggered"])
    score_default = float(params.get("score_default", 0.0))

    ticker = tickers[0]
    price = series_by_ticker.get(ticker)
    if price is None:
        return score_default
    price = price.dropna()

    mom_val = _momentum(price, mom_period)
    if np.isnan(mom_val):
        return score_default

    triggered = mom_val > mom_threshold
    if triggered and require_above_ma:
        ma_val = _ma(price, ma_period)
        if np.isnan(ma_val):
            return score_default
        triggered = triggered and float(price.iloc[-1]) > ma_val

    return score_triggered if triggered else score_default


def score_confirmed_momentum_threshold(
    series_by_ticker: Dict[str, pd.Series],
    tickers: List[str],
    params: Dict[str, Any],
) -> Optional[float]:
    """Like momentum_threshold, but requires at least one confirming signal from other tickers.

    Useful for signals (e.g. gold) that are ambiguous on their own and need
    cross-asset confirmation (e.g. USD strength or elevated VIX).

    params:
        ma_period (int): MA look-back for primary ticker
        momentum_period (int): momentum look-back for primary ticker
        momentum_threshold (float): trigger when momentum > this value
        require_above_ma (bool): also require primary price > MA
        score_triggered (float): score when primary + confirmation met
        score_default (float): score otherwise
        confirmations (list[dict]): each entry has:
            - ticker (str): confirming ticker symbol
            - type (str): "above_ma" or "above_level"
            - ma_period (int): MA period (for "above_ma")
            - level (float): absolute level threshold (for "above_level")
    """
    ma_period = int(params["ma_period"])
    mom_period = int(params["momentum_period"])
    mom_threshold = float(params["momentum_threshold"])
    require_above_ma = bool(params.get("require_above_ma", False))
    score_triggered = float(params["score_triggered"])
    score_default = float(params.get("score_default", 0.0))
    confirmations = params.get("confirmations", [])

    ticker = tickers[0]
    price = series_by_ticker.get(ticker)
    if price is None:
        return score_default
    price = price.dropna()

    mom_val = _momentum(price, mom_period)
    if np.isnan(mom_val):
        return score_default

    primary_triggered = mom_val > mom_threshold
    if primary_triggered and require_above_ma:
        ma_val = _ma(price, ma_period)
        if np.isnan(ma_val):
            return score_default
        primary_triggered = primary_triggered and float(price.iloc[-1]) > ma_val

    if not primary_triggered:
        return score_default

    confirmed = not confirmations
    for conf in confirmations:
        conf_ticker = conf.get("ticker", "")
        conf_series = series_by_ticker.get(conf_ticker)
        if conf_series is None:
            conf_series = series_by_ticker.get(conf_ticker.lstrip("^"))
        if conf_series is None or conf_series.empty:
            continue
        conf_series = conf_series.dropna()
        conf_type = conf.get("type", "above_ma")

        if conf_type == "above_ma":
            conf_ma_period = int(conf.get("ma_period", 50))
            conf_ma = _ma(conf_series, conf_ma_period)
            if not np.isnan(conf_ma) and float(conf_series.iloc[-1]) > conf_ma:
                confirmed = True
                break
        elif conf_type == "above_level":
            conf_level = float(conf.get("level", 0))
            if float(conf_series.iloc[-1]) > conf_level:
                confirmed = True
                break

    return score_triggered if confirmed else score_default


# ---------------------------------------------------------------------------
# Scoring type registry
# ---------------------------------------------------------------------------

SCORING_TYPE_REGISTRY: Dict[str, Any] = {
    "breadth_trend": score_breadth_trend,
    "ratio_trend": score_ratio_trend,
    "level_vs_ma": score_level_vs_ma,
    "trend_momentum": score_trend_momentum,
    "momentum_threshold": score_momentum_threshold,
    "confirmed_momentum_threshold": score_confirmed_momentum_threshold,
}


# ---------------------------------------------------------------------------
# Channel + global score computation
# ---------------------------------------------------------------------------

def compute_channel_scores(
    series_by_ticker: Dict[str, pd.Series],
    channel_configs: Dict[str, Dict[str, Any]],
) -> Dict[str, float]:
    """Compute all channel scores using config-driven dispatch.

    Args:
        series_by_ticker: Price series keyed by ticker symbol.
        channel_configs: Per-channel config dicts, each containing
            ``scoringType``, ``tickers``, and ``params``.

    Returns:
        Dict mapping channel key to its score.  Channels whose scoring
        function returns None are omitted.
    """
    scores: Dict[str, float] = {}
    for ch_key, cfg in channel_configs.items():
        scoring_type = cfg.get("scoringType")
        fn = SCORING_TYPE_REGISTRY.get(scoring_type) if scoring_type else None
        if fn is None:
            continue
        tickers = cfg.get("tickers", [])
        params = cfg.get("params", {})
        result = fn(series_by_ticker, tickers, params)
        if result is not None:
            scores[ch_key] = result
    return scores


def compute_global_score(
    channel_scores: Dict[str, float],
    weights: Dict[str, float],
) -> float:
    """Weighted sum; missing channel contributes 0."""
    total = 0.0
    for ch, weight in weights.items():
        total += weight * channel_scores.get(ch, 0.0)
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
    weights: Dict[str, float] = None,
    reason_labels: Dict[str, Dict[float, Optional[str]]] = None,
) -> list:
    """Top n reasons by absolute contribution; prefer negative when risk-off/deteriorating.

    For each channel, label lookup tries an exact match on the score value first,
    then falls back to the nearest matching key (positive -> score >= 0, negative -> score < 0).
    """
    if weights is None or reason_labels is None:
        return []

    contribs: list = []
    for ch, score in channel_scores.items():
        w = weights.get(ch, 0)
        c = w * score
        labels = reason_labels.get(ch, {})
        label = labels.get(score)
        if label is None:
            if score >= 0:
                label = labels.get(1) or labels.get(1.0)
            else:
                label = labels.get(-1) or labels.get(-1.0)
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


# ---------------------------------------------------------------------------
# Previous-period helper
# ---------------------------------------------------------------------------

def compute_global_score_prev(
    series_by_ticker_10d_ago: Dict[str, pd.Series],
    channel_configs: Dict[str, Dict[str, Any]],
    weights: Dict[str, float],
) -> Optional[float]:
    """Compute global score as of 10d-ago series (for transition)."""
    if not series_by_ticker_10d_ago:
        return None
    channel_scores = compute_channel_scores(series_by_ticker_10d_ago, channel_configs)
    if not channel_scores:
        return None
    return compute_global_score(channel_scores, weights=weights)


# ---------------------------------------------------------------------------
# Top-level entry point
# ---------------------------------------------------------------------------

def compute_macro_scores(
    series_by_ticker: Dict[str, pd.Series],
    as_of_date: str,
    channel_configs: Dict[str, Dict[str, Any]],
    weights: Dict[str, float],
    reason_labels: Dict[str, Dict[float, Optional[str]]],
    series_by_ticker_10d_ago: Optional[Dict[str, pd.Series]] = None,
) -> Dict[str, Any]:
    """
    Full macro score payload.

    Args:
        series_by_ticker: Price series keyed by ticker symbol.
        as_of_date: YYYY-MM-DD string.
        channel_configs: Per-channel config (scoringType, tickers, params).
        weights: {channel_key: weight} from Firebase.
        reason_labels: {channel_key: {score_float: label}} from Firebase.
        series_by_ticker_10d_ago: Optional 10-day-ago series for transition.
    """
    channel_scores = compute_channel_scores(series_by_ticker, channel_configs)
    global_score = compute_global_score(channel_scores, weights=weights)

    global_score_prev = None
    if series_by_ticker_10d_ago:
        global_score_prev = compute_global_score_prev(
            series_by_ticker_10d_ago, channel_configs, weights=weights,
        )
    trans = transition(global_score, global_score_prev)
    mode = macro_mode(global_score)
    reasons = top_reasons(
        channel_scores, mode, trans, n=2, weights=weights, reason_labels=reason_labels,
    )
    return {
        "asOf": as_of_date,
        "macroMode": mode,
        "globalScore": round(global_score, 4),
        "confidence": round(confidence(global_score), 4),
        "transition": trans,
        "channelScores": {k: round(v, 4) for k, v in channel_scores.items()},
        "reasons": reasons,
    }
