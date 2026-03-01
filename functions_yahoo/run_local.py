#!/usr/bin/env python3
"""
Run Yahoo refresh locally for one ticker (same logic as the deployed Pub/Sub function).
Loads ../data-fetcher/.env.local for Firebase. Ticker from argv or default AAPL.
"""
import logging
import os
import sys

_root = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_root, "vendor")
for _p in (_vendor, _root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

_env = os.path.join(os.path.dirname(_root), "data-fetcher", ".env.local")
if not os.path.isfile(_env):
    print("Missing ../data-fetcher/.env.local. Create it with FIREBASE_* (service account).")
    sys.exit(1)
from dotenv import load_dotenv
load_dotenv(_env)

if not os.getenv("FIREBASE_PRIVATE_KEY"):
    print("FIREBASE_PRIVATE_KEY not set. Add Firebase service account vars to ../data-fetcher/.env.local")
    sys.exit(1)

from yahoo.refresh_driver import refresh_yahoo_data

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    ticker = (sys.argv[1] if len(sys.argv) > 1 else "AAPL").upper()
    logger.info("Running Yahoo refresh locally for %s...", ticker)
    result = refresh_yahoo_data(ticker, verbose=True)
    logger.info("refresh_yahoo_data result: success=%s", result.get("success"))
    logger.info("Done.")


if __name__ == "__main__":
    main()
    sys.exit(0)
