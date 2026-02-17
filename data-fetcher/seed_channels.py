#!/usr/bin/env python3
"""
Seed macro risk channel config into Firebase.

Writes channel documents to macro/us_market/channels/{EQUITIES,CREDIT,VOL,USD,OIL}.
Run once to populate, then manage channels through Firebase console or this script.

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
    "EQUITIES": {
        "weight": 0.35,
        "tickers": ["SPY"],
        "reasonLabels": {
            "1": "Equity trend strong (SPY above 200D, positive 60D momentum)",
            "-1": "Equity trend weakening (SPY below 200D or weak 60D momentum)",
        },
    },
    "CREDIT": {
        "weight": 0.25,
        "tickers": ["HYG", "LQD"],
        "reasonLabels": {
            "1": "Credit risk appetite healthy (HYG/LQD above 50D trend)",
            "-1": "Credit risk appetite weakening (HYG/LQD below 50D trend)",
        },
    },
    "VOL": {
        "weight": 0.25,
        "tickers": ["^VIX", "SPY"],
        "reasonLabels": {
            "1": "Volatility subdued (VIX below 20D or realized vol below median)",
            "-1": "Volatility rising (VIX above 20D)",
        },
    },
    "USD": {
        "weight": 0.10,
        "tickers": ["UUP"],
        "reasonLabels": {
            "0": None,
            "-0.5": "USD tightening impulse (UUP uptrend)",
            "-1": "USD tightening impulse (UUP uptrend)",
        },
    },
    "OIL": {
        "weight": 0.05,
        "tickers": ["USO"],
        "reasonLabels": {
            "0": None,
            "-1": "Oil impulse (USO +8%/20d)",
        },
    },
}


def main():
    svc = ChannelsConfigService()
    for key, config in CHANNELS.items():
        svc.save_channel(key, config)
        print(f"  Saved channel {key} (weight={config['weight']}, tickers={config['tickers']})")
    print(f"\nSeeded {len(CHANNELS)} channels to macro/us_market/channels")


if __name__ == "__main__":
    main()
