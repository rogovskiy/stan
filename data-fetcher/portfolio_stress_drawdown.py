#!/usr/bin/env python3
"""
Shim: implementation lives in ../functions_portfolio/portfolio_stress_drawdown.py.

Usage:
    cd data-fetcher && source venv/bin/activate
    python portfolio_stress_drawdown.py <PORTFOLIO_ID> [--percentile 0.9] [-v]
"""

import os
import sys

_root = os.path.dirname(os.path.abspath(__file__))
_fp = os.path.join(_root, "..", "functions_portfolio")
_vendor = os.path.join(_fp, "vendor")
for _p in (_vendor, _fp):
    if _p not in sys.path:
        sys.path.insert(0, _p)

if __name__ == "__main__":
    from portfolio_stress_drawdown import main

    raise SystemExit(main())
