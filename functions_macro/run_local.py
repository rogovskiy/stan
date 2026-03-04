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


def _run_merge_from_file(file_path: str) -> None:
    """Load shifts from JSON file and existing Firestore, run clustering + merge LLM; verbose output, no write."""
    import json
    from market_shifts.scan_market_shifts import normalize_shift
    from market_shifts.market_shift_service import MarketShiftService
    from extraction_utils import get_genai_client
    from market_shifts.market_shift_merge import (
        cluster_shifts,
        load_merge_prompt_template,
        merge_cluster_via_llm,
    )

    path = os.path.abspath(file_path)
    if not os.path.isfile(path):
        logger.error("File not found: %s", path)
        sys.exit(1)

    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        file_shifts_raw = data
    else:
        file_shifts_raw = data.get("marketShifts") or data.get("shifts") or []
    if not isinstance(file_shifts_raw, list):
        logger.error("Expected JSON array or object with 'marketShifts' or 'shifts' key")
        sys.exit(1)

    normalized_file = [normalize_shift(s) for s in file_shifts_raw]
    for i, s in enumerate(normalized_file):
        s["id"] = f"f-{i}"
        s.setdefault("momentumScore", 0)
        s.setdefault("firstSeenAt", None)
        s.setdefault("articleRefs", s.get("articleRefs") or [])

    svc = MarketShiftService()
    existing = svc.get_all_shifts()
    combined = existing + normalized_file
    logger.info(
        "Loaded %d shifts from file + %d existing from Firestore = %d total",
        len(normalized_file),
        len(existing),
        len(combined),
    )

    clusters = cluster_shifts(combined)
    multi = {k: v for k, v in clusters.items() if len(v) > 1}
    single = {k: v for k, v in clusters.items() if len(v) == 1}

    logger.info("Clusters: %d total, %d with duplicates (merge candidates)", len(clusters), len(multi))
    print("", flush=True)

    for cluster_key, members in sorted(clusters.items()):
        typ, category, ch = cluster_key.split("|", 2) if "|" in cluster_key else (cluster_key, "", "")
        print(f"--- Cluster: type={typ} category={category} channels={ch} ---", flush=True)
        print(f"  Count: {len(members)}", flush=True)
        for m in members:
            sid = m.get("id", "?")
            headline = (m.get("headline") or "")[:70]
            from_file = " (from file)" if sid.startswith("f-") else ""
            print(f"    id={sid}{from_file}: {headline}", flush=True)
        print("", flush=True)

    if not multi:
        logger.info("No clusters with duplicates; nothing to merge.")
        return

    try:
        client = get_genai_client()
    except ValueError:
        logger.error("GEMINI_API_KEY or GOOGLE_AI_API_KEY required for merge LLM")
        sys.exit(1)
    template = load_merge_prompt_template()

    for cluster_key, cluster in sorted(multi.items()):
        print(f"=== Merge LLM for cluster (key={cluster_key}) ===", flush=True)
        print("  --- BEFORE (inputs) ---", flush=True)
        for s in cluster:
            sid = s.get("id", "?")
            hl = (s.get("headline") or "")[:70]
            summary = (s.get("summary") or "")[:120]
            timeline = s.get("timeline") or {}
            driver = (timeline.get("canonicalDriver") or s.get("canonicalDriver") or "")
            devs = timeline.get("majorDevelopments") or []
            print(f"    id={sid}", flush=True)
            print(f"      headline: {hl}", flush=True)
            print(f"      summary: {summary}{'...' if len((s.get('summary') or '')) > 120 else ''}", flush=True)
            if driver:
                print(f"      canonicalDriver: {driver[:80]}{'...' if len(driver) > 80 else ''}", flush=True)
            if devs:
                print(f"      majorDevelopments: {len(devs)} entries", flush=True)
        print("", flush=True)
        decision, usage = merge_cluster_via_llm(cluster, client, template, verbose=True)
        merged = decision is not None and len(decision.get("mergeIntoCanonical") or []) > 0
        print(f"  Merge: {'YES' if merged else 'NO'}", flush=True)
        if decision:
            print(f"  canonicalId={decision.get('canonicalId')}  mergeInto={decision.get('mergeIntoCanonical')}", flush=True)
            print("  --- AFTER (merged result) ---", flush=True)
            print(f"    canonicalHeadline: {decision.get('canonicalHeadline') or ''}", flush=True)
            summary_after = (decision.get("canonicalSummary") or "")[:200]
            print(f"    canonicalSummary: {summary_after}{'...' if len(decision.get('canonicalSummary') or '') > 200 else ''}", flush=True)
            tl = decision.get("timeline") or {}
            if tl.get("canonicalDriver"):
                print(f"    canonicalDriver: {(tl['canonicalDriver'] or '')[:80]}{'...' if len(tl.get('canonicalDriver') or '') > 80 else ''}", flush=True)
            if tl.get("firstSurfacedAt"):
                print(f"    firstSurfacedAt: {tl['firstSurfacedAt']}", flush=True)
            devs_after = tl.get("majorDevelopments") or []
            if devs_after:
                print(f"    majorDevelopments: {len(devs_after)} entries", flush=True)
            print(f"  Tokens: prompt={usage.get('prompt_tokens', 0)} response={usage.get('response_tokens', 0)}", flush=True)
        else:
            print("  (no merge: LLM chose not to merge or parse error)", flush=True)
        print("", flush=True)
        input("Press Enter to continue to next cluster...")
    logger.info("Merge-from-file done (no changes written to Firestore).")


def main() -> None:
    import argparse
    parser = argparse.ArgumentParser(description="Run macro refresh locally")
    parser.add_argument(
        "--extraction-only",
        action="store_true",
        help="Run only market-shift extraction (no refresh, save, merge, or summaries)",
    )
    parser.add_argument(
        "--merge-from-file",
        metavar="PATH",
        help="Run merge clustering only: load shifts from JSON file (and existing from Firestore), cluster, run merge LLM on duplicates. Verbose output per cluster. No write.",
    )
    parser.add_argument(
        "--migrate-shifts-to-primary-secondary",
        action="store_true",
        help="One-time migration: for each shift that has channelIds but no primaryChannel, set primaryChannel=channelIds[0], secondaryChannels=channelIds[1:] and update Firestore.",
    )
    parser.add_argument(
        "--clear-market-shifts",
        action="store_true",
        help="Delete all market shift documents and meta (fresh start).",
    )
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    if args.clear_market_shifts:
        from market_shifts.market_shift_service import MarketShiftService
        logger.info("Clearing market shifts collection and meta...")
        svc = MarketShiftService()
        n = svc.clear_market_shifts(verbose=args.verbose)
        logger.info("Done. Removed %d shift(s).", n)
        return

    if args.migrate_shifts_to_primary_secondary:
        from market_shifts.market_shift_service import MarketShiftService
        logger.info("Migrating existing market shifts to primaryChannel + secondaryChannels...")
        svc = MarketShiftService()
        n = svc.migrate_shifts_to_primary_secondary(verbose=args.verbose)
        logger.info("Migrated %d shift document(s). Existing data preserved.", n)
        return

    if args.merge_from_file:
        _run_merge_from_file(args.merge_from_file)
        return

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
        skip_deep_analysis=False, skip_merge=False, verbose=True
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
