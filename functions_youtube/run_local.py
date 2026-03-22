#!/usr/bin/env python3
"""
Run YouTube refresh locally for one subscription (same logic as the deployed Pub/Sub function).
Loads ../data-fetcher/.env.local for Firebase. Subscription ID from argv or prompt/default.
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

from youtube.refresh_driver import refresh_one_subscription

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    subscription_id = (sys.argv[1] if len(sys.argv) > 1 else "").strip()
    if not subscription_id:
        logger.info("Usage: python run_local.py <subscription_id>")
        sys.exit(1)
    logger.info("Running YouTube refresh locally for subscription %s...", subscription_id)
    result = refresh_one_subscription(
        subscription_id,
        max_videos_per_feed=5,
        timeout_seconds=60,
        verbose=True,
    )
    logger.info(
        "refresh_one_subscription result: ok=%s, upserted=%s, reason=%s",
        result.get("ok"), result.get("upserted", 0), result.get("reason"),
    )
    if not result.get("ok"):
        logger.warning("Error: %s", result.get("error_message", result.get("reason")))
    logger.info("Done.")


if __name__ == "__main__":
    main()
    sys.exit(0)
