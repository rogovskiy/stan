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
    import argparse
    parser = argparse.ArgumentParser(description="Run macro refresh locally")
    parser.add_argument(
        "--extraction-only",
        action="store_true",
        help="Run only market-shift extraction (no refresh, save, merge, or summaries)",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    if args.extraction_only:
        from datetime import datetime, timedelta
        from market_shifts.scan_market_shifts import run_extraction
        from market_shifts.market_shift_service import MarketShiftService
        import json
        logger.info("Running market-shift extraction only (no save/merge/summaries)...")
        now = datetime.utcnow()
        current_date = now.strftime("%Y-%m-%d")
        cutoff_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")
        svc = MarketShiftService()
        normalized, usage, markdown_text = run_extraction(
            svc,
            current_date,
            cutoff_date,
            skip_deep_analysis=True,
            verbose=True,
            return_markdown=True,
        )
        # Save discovery markdown to /tmp
        tmp_dir = "/tmp"
        markdown_path = os.path.join(
            tmp_dir,
            f"market_shift_discovery_{now.strftime('%Y%m%d_%H%M%S')}.md",
        )
        with open(markdown_path, "w", encoding="utf-8") as f:
            f.write(markdown_text)
        logger.info("Step 1 (discovery) markdown saved to: %s", markdown_path)
        logger.info(
            "Extracted %d shifts | prompt_tokens=%s, response_tokens=%s, total_tokens=%s",
            len(normalized),
            usage.get("prompt_tokens", 0),
            usage.get("response_tokens", 0),
            usage.get("total_tokens", 0),
        )
        # Print discovered market shifts JSON
        if normalized:
            out = [
                {
                    "type": s["type"],
                    "category": s["category"],
                    "headline": s["headline"],
                    "summary": s["summary"],
                    "primaryChannel": s.get("primaryChannel"),
                    "secondaryChannels": s.get("secondaryChannels", []),
                    "status": s["status"],
                    "articleRefs": s.get("articleRefs", []),
                }
                for s in normalized
            ]
            print("\n--- Discovered market shifts (JSON) ---", flush=True)
            print(json.dumps({"marketShifts": out}, indent=2))
        return

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
