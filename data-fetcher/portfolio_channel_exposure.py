#!/usr/bin/env python3
"""
Shim: implementation lives in ../functions_portfolio/portfolio_channel_exposure.py.

Run from data-fetcher (after `make vendor` in functions_portfolio):

    python portfolio_channel_exposure.py <PORTFOLIO_ID> [--period 1y|2y] [--verbose]
"""

import os
import sys

_df_dir = os.path.dirname(os.path.abspath(__file__))
_repo_root = os.path.dirname(_df_dir)
_fp = os.path.join(_repo_root, "functions_portfolio")
# Only the package root; portfolio_channel_exposure.py prepends vendor/ for services.
sys.path.insert(0, _fp)

if __name__ == "__main__":
    from dotenv import load_dotenv

    load_dotenv(os.path.join(_df_dir, ".env.local"))
    from portfolio_channel_exposure import main

    sys.exit(main())
