#!/usr/bin/env python3
"""
Run macro refresh locally (same logic as the deployed scheduled function).
Loads ../data-fetcher/.env.local for Firebase and Gemini keys. No other options.
"""
import logging
import os
import sys

# vendor/ = shared code; package root = macro/ and market_shifts/
_root = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_root, "vendor")
for _p in (_vendor, _root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Local run always uses ../data-fetcher/.env.local
_env = os.path.join(os.path.dirname(_root), "data-fetcher", ".env.local")
if not os.path.isfile(_env):
    print("Missing ../data-fetcher/.env.local. Create it with FIREBASE_* and GEMINI/GOOGLE_AI API keys.")
    sys.exit(1)
from dotenv import load_dotenv
load_dotenv(_env)

if not os.getenv("FIREBASE_PRIVATE_KEY"):
    print("FIREBASE_PRIVATE_KEY not set. Add Firebase service account vars to ../data-fetcher/.env.local")
    sys.exit(1)

# Firebase is initialized by FirebaseBaseService using FIREBASE_* from env

from macro.refresh_macro_scores import refresh_macro_scores
from market_shifts.scan_market_shifts import run_scan_market_shifts

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    logger.info("Running macro refresh locally...")
    result = refresh_macro_scores(verbose=True, save_to_firebase=True)
    logger.info("refresh_macro_scores result: asOf=%s", result.get("asOf"))
    shifts_result = run_scan_market_shifts(
        skip_deep_analysis=True, skip_merge=True, verbose=True
    )
    logger.info(
        "run_scan_market_shifts result: shift_count=%s, merges_applied=%s",
        shifts_result.get("shift_count"),
        shifts_result.get("merges_applied"),
    )
    logger.info("Done.")


if __name__ == "__main__":
    main()
    sys.exit(0)
