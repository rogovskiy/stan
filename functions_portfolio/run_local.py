#!/usr/bin/env python3
"""
Run portfolio channel exposure locally (same logic as the Pub/Sub Cloud Function).

Usage:
    make run
    make run PORTFOLIO_ID=otherId
    python run_local.py
    python run_local.py otherId
"""
import argparse
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
    print("Missing ../data-fetcher/.env.local (FIREBASE_*).")
    sys.exit(1)

from dotenv import load_dotenv

load_dotenv(_env)

if not os.getenv("FIREBASE_PRIVATE_KEY"):
    print("FIREBASE_PRIVATE_KEY not set in ../data-fetcher/.env.local")
    sys.exit(1)

DEFAULT_PORTFOLIO_ID = "JrKlHwhZewfMNiY3pNzl"


def main() -> None:
    p = argparse.ArgumentParser(
        description="Run channel exposure locally for one portfolio"
    )
    p.add_argument(
        "portfolio_id",
        nargs="?",
        default=os.environ.get("PORTFOLIO_ID", DEFAULT_PORTFOLIO_ID),
        help=f"Firestore portfolio document ID (default: {DEFAULT_PORTFOLIO_ID})",
    )
    args = p.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    from portfolio_channel_exposure import EXIT_OK, EXIT_SKIPPED, run_channel_exposure
    from portfolio_stress_drawdown import EXIT_SKIPPED as STRESS_SKIP, run_stress_drawdown

    rc = run_channel_exposure(
        args.portfolio_id, period="1y", verbose=True, quiet=False
    )
    if rc != EXIT_OK and rc != EXIT_SKIPPED:
        sys.exit(rc)

    rc2 = run_stress_drawdown(args.portfolio_id, verbose=True, quiet=False)
    if rc2 == STRESS_SKIP:
        sys.exit(0)
    sys.exit(rc2)


if __name__ == "__main__":
    main()
