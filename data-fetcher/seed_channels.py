#!/usr/bin/env python3
"""
Seed macro risk channel config into Firebase.

Writes channel documents to macro/us_market/channels/{CHANNEL}.
Run once to populate, then manage channels through Firebase console or this script.

Each channel includes:
- weight: contribution to global risk score
- tickers: list of ticker symbols used for computation
- reasonLabels: human-readable labels keyed by score value
- scoringType: selects the generic scoring function
- params: all tunable parameters for the scoring function

Usage:
    cd data-fetcher
    source venv/bin/activate
    python seed_channels.py
"""

import os
import sys

from dotenv import load_dotenv
load_dotenv('.env.local')

from services.channels_config_service import ChannelsConfigService

CHANNELS = {
    "EQUITIES_US": {
        "weight": 0.20,
        "tickers": ["SPY", "QQQ", "IWM"],
        "scoringType": "breadth_trend",
        "params": {
            "ma_period": 200,
            "momentum_period": 60,
            "trend_weight": 0.6,
            "momentum_weight": 0.4,
        },
        "reasonLabels": {
            "1": "Equity breadth strong (SPY/QQQ/IWM above 200D, positive 60D momentum)",
            "-1": "Equity breadth weakening (SPY/QQQ/IWM below 200D or weak 60D momentum)",
        },
    },
    "CREDIT": {
        "weight": 0.15,
        "tickers": ["HYG", "LQD"],
        "scoringType": "ratio_trend",
        "params": {
            "ma_period": 50,
            "score_above": 1.0,
            "score_below": -1.0,
        },
        "reasonLabels": {
            "1": "Credit risk appetite healthy (HYG/LQD above 50D trend)",
            "-1": "Credit risk appetite weakening (HYG/LQD below 50D trend)",
        },
    },
    "VOL": {
        "weight": 0.15,
        "tickers": ["^VIX"],
        "scoringType": "level_vs_ma",
        "params": {
            "ma_period": 20,
            "floor": 18.0,
            "score_above": -1.0,
            "score_below": 1.0,
        },
        "reasonLabels": {
            "1": "Volatility subdued (VIX below 20D MA or floor)",
            "-1": "Volatility rising (VIX above 20D MA and floor)",
        },
    },
    "RATES_SHORT": {
        "weight": 0.08,
        "tickers": ["^IRX"],
        "scoringType": "trend_momentum",
        "params": {
            "ma_period": 50,
            "momentum_period": 20,
            "score_bullish": -1.0,
            "score_bearish": 1.0,
            "score_mixed": 0.0,
        },
        "reasonLabels": {
            "1": "Short rates easing (13-week yield falling, below 50D)",
            "-1": "Short rates tightening (13-week yield rising, above 50D)",
            "0": None,
        },
    },
    "RATES_LONG": {
        "weight": 0.08,
        "tickers": ["IEF", "TLT"],
        "scoringType": "trend_momentum",
        "params": {
            "ma_period": 50,
            "momentum_period": 20,
            "score_bullish": 1.0,
            "score_bearish": -1.0,
            "score_mixed": 0.0,
        },
        "reasonLabels": {
            "1": "Long rates supportive (TLT above 50D, positive momentum)",
            "-1": "Long rates headwind (TLT below 50D, negative momentum)",
            "0": None,
        },
    },
    "USD": {
        "weight": 0.08,
        "tickers": ["UUP"],
        "scoringType": "momentum_threshold",
        "params": {
            "ma_period": 50,
            "momentum_period": 20,
            "momentum_threshold": 0.0,
            "require_above_ma": True,
            "score_triggered": -0.5,
            "score_default": 0.0,
        },
        "reasonLabels": {
            "0": None,
            "-0.5": "USD tightening impulse (UUP uptrend)",
        },
    },
    "OIL": {
        "weight": 0.05,
        "tickers": ["USO"],
        "scoringType": "momentum_threshold",
        "params": {
            "ma_period": 50,
            "momentum_period": 20,
            "momentum_threshold": 0.08,
            "require_above_ma": False,
            "score_triggered": -1.0,
            "score_default": 0.0,
        },
        "reasonLabels": {
            "0": None,
            "-1": "Oil impulse (USO +8%/20d)",
        },
    },
    "GOLD": {
        "weight": 0.07,
        "tickers": ["GLD"],
        "scoringType": "confirmed_momentum_threshold",
        "params": {
            "ma_period": 50,
            "momentum_period": 20,
            "momentum_threshold": 0.03,
            "require_above_ma": True,
            "score_triggered": -0.5,
            "score_default": 0.0,
            "confirmations": [
                {"ticker": "UUP", "type": "above_ma", "ma_period": 50},
                {"ticker": "^VIX", "type": "above_level", "level": 20},
            ],
        },
        "reasonLabels": {
            "0": None,
            "-0.5": "Gold safe-haven demand confirmed by USD strength or elevated VIX",
        },
    },
    "INFLATION": {
        "weight": 0.07,
        "tickers": ["TIP", "IEF"],
        "scoringType": "ratio_trend",
        "params": {
            "ma_period": 50,
            "score_above": -0.5,
            "score_below": 0.0,
        },
        "reasonLabels": {
            "0": None,
            "-0.5": "Inflation expectations rising (TIP/IEF above 50D trend)",
        },
    },
    "GLOBAL_RISK": {
        "weight": 0.07,
        "tickers": ["EEM"],
        "scoringType": "trend_momentum",
        "params": {
            "ma_period": 200,
            "momentum_period": 60,
            "score_bullish": 1.0,
            "score_bearish": -1.0,
            "score_mixed": 0.0,
        },
        "reasonLabels": {
            "1": "Global risk appetite healthy (EEM above 200D, positive momentum)",
            "-1": "Global risk appetite weak (EEM below 200D or negative momentum)",
            "0": None,
        },
    },
}


def main():
    svc = ChannelsConfigService()
    for key, config in CHANNELS.items():
        svc.save_channel(key, config)
        print(f"  Saved channel {key} (weight={config['weight']}, tickers={config['tickers']}, scoringType={config['scoringType']})")
    print(f"\nSeeded {len(CHANNELS)} channels to macro/us_market/channels")


if __name__ == "__main__":
    main()
