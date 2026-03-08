#!/usr/bin/env python3
"""
Scan Market Shifts

Fetches market shifts (systematic risks and tailwinds) from recent financial news
via Gemini API with Google Search grounding, and saves to Firestore at
macro/us_market/market_shifts.

Uses the google-genai package (google.genai). Requires GEMINI_API_KEY or GOOGLE_AI_API_KEY.

Invocation:
- CLI: python scan_market_shifts.py [--dry-run] [--merge-only] [--skip-merge] [--skip-deep-analysis] [--verbose]
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timedelta

from extraction_utils import (
    extract_json_from_llm_response,
    get_genai_client,
)
from dynamic_prompt_runner import run_llm_with_prompt_name
from market_shifts.market_shift_service import MarketShiftService, slug_from_headline
from market_shifts.market_shift_merge import (
    run_merge_step,
    run_merge_step_in_memory,
    apply_merge,
)

logger = logging.getLogger(__name__)

# Suppress noisy HTTP and genai client logs (e.g. "HTTP Request: POST ...", "AFC is enabled")
for _logger_name in ("urllib3", "urllib3.connectionpool", "httpcore", "httpx", "google", "google.genai"):
    logging.getLogger(_logger_name).setLevel(logging.WARNING)

def _add_usage(acc: dict, inc: dict) -> None:
    """Add inc token counts into acc in place."""
    acc["prompt_tokens"] = acc.get("prompt_tokens", 0) + inc.get("prompt_tokens", 0)
    acc["response_tokens"] = acc.get("response_tokens", 0) + inc.get("response_tokens", 0)
    acc["total_tokens"] = acc.get("total_tokens", 0) + inc.get("total_tokens", 0)


def _parse_json_from_response_text(response_text: str) -> dict:
    """
    Parse JSON from LLM response. Uses extraction_utils to strip markdown;
    if that fails, extracts the first complete {...} object (handles trailing garbage).
    """
    json_str = extract_json_from_llm_response(response_text)
    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        start = json_str.find("{")
        if start >= 0:
            depth = 0
            for i in range(start, len(json_str)):
                if json_str[i] == "{":
                    depth += 1
                elif json_str[i] == "}":
                    depth -= 1
                    if depth == 0:
                        return json.loads(json_str[start : i + 1])
        raise


def fetch_market_shifts_markdown(
    current_date: str, cutoff_date: str, verbose: bool = False
) -> tuple[str, dict]:
    """
    Step 1: Call Gemini with Google Search grounding; return raw markdown (no JSON).
    Returns (markdown text, usage dict). Uses prompt framework prompt 'market_shift_discovery'.
    """
    result, _, usage = run_llm_with_prompt_name(
        "market_shift_discovery",
        {"current_date": current_date, "cutoff_date": cutoff_date},
        max_output_tokens=8192,
    )
    text = result if isinstance(result, str) else ""
    if not (text or "").strip():
        raise RuntimeError("Gemini returned empty response for discovery")
    return text.strip(), usage


def markdown_to_market_shifts_json(markdown: str, verbose: bool = False) -> tuple[list[dict], dict]:
    """
    Step 2: Convert discovery markdown to structured JSON using schema (no tools).
    Returns (list of shift dicts, usage dict). Uses prompt framework prompt 'market_shift_markdown_to_json'.
    """
    result, _, usage = run_llm_with_prompt_name(
        "market_shift_markdown_to_json",
        {"markdown_content": markdown},
        max_output_tokens=8192,
    )
    if not isinstance(result, dict):
        raise RuntimeError("Gemini returned non-JSON response for markdown-to-JSON")
    market_shifts = result.get("marketShifts", [])
    if not isinstance(market_shifts, list):
        raise ValueError("Expected marketShifts to be an array")
    return market_shifts, usage


def fetch_market_shifts(
    current_date: str,
    cutoff_date: str,
    verbose: bool = False,
    return_markdown: bool = False,
) -> tuple[list[dict], dict] | tuple[list[dict], dict, str]:
    """
    Two-step extraction: (1) discover shifts in markdown via Google Search,
    (2) convert markdown to structured JSON with schema.
    Returns (list of shift dicts, usage dict) or (list, usage, markdown_text) when return_markdown=True.
    """
    print("Market shifts: step 1 (discovery with Google Search)...", flush=True)
    markdown_text, usage1 = fetch_market_shifts_markdown(current_date, cutoff_date, verbose=verbose)
    if verbose:
        logger.info("Discovery markdown length: %d chars", len(markdown_text))

    print("Market shifts: step 2 (markdown to JSON)...", flush=True)
    market_shifts, usage2 = markdown_to_market_shifts_json(markdown_text, verbose=verbose)

    _add_usage(usage1, usage2)
    if return_markdown:
        return market_shifts, usage1, markdown_text
    return market_shifts, usage1


def fetch_shift_timeline(
    shift: dict,
    current_date: str,
    cutoff_date: str,
    verbose: bool = False,
) -> tuple[dict | None, dict]:
    """
    Call Gemini with Google Search grounding to research timeline for one shift.
    Returns (timeline dict with firstSurfacedAt and majorDevelopments or None, usage dict).
    Uses prompt framework prompt 'market_shift_deep_analysis'.
    """
    article_refs = shift.get("articleRefs") or []
    article_refs_text = "\n".join(
        f"• {ref.get('title') or 'Untitled'} ({ref.get('source') or 'Unknown'}, {ref.get('publishedAt') or 'no date'}): {ref.get('url') or ''}"
        for ref in article_refs
    ) if article_refs else "None provided."
    zero_usage = {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    try:
        result, _, usage = run_llm_with_prompt_name(
            "market_shift_deep_analysis",
            {
                "type": shift.get("type", "RISK"),
                "category": shift.get("category", "MARKET_SENTIMENT"),
                "headline": shift.get("headline", ""),
                "summary": shift.get("summary", ""),
                "article_refs": article_refs_text,
                "current_date": current_date,
                "cutoff_date": cutoff_date,
            },
            max_output_tokens=4096,
        )
        text = result if isinstance(result, str) else ""
        if not (text or "").strip():
            logger.warning("Gemini returned empty response for timeline")
            return None, usage
        data = _parse_json_from_response_text(text)
        canonical_driver = data.get("canonicalDriver") or ""
        canonical_driver_rationale = data.get("canonicalDriverRationale") or ""
        first = data.get("firstSurfacedAt")
        devs = data.get("majorDevelopments")
        if not isinstance(devs, list):
            devs = []
        return {
            "canonicalDriver": canonical_driver,
            "canonicalDriverRationale": canonical_driver_rationale,
            "firstSurfacedAt": first or "",
            "majorDevelopments": devs,
        }, usage
    except (json.JSONDecodeError, KeyError, RuntimeError) as e:
        logger.warning("Timeline parse or API error for %s: %s", shift.get("headline", "")[:40], e)
        return None, zero_usage


def fetch_market_summary(
    shifts: list[dict],
    risk_scores: list[dict],
    channel_scores: dict[str, float],
    date_range: str,
    verbose: bool = False,
) -> tuple[dict | None, dict]:
    """
    Call Gemini to generate a structured market state summary for the given date range.
    Returns (dict with mood, moodDetail, drivers[] or None, usage dict).
    Uses prompt framework prompt 'market_state_summary'.
    """
    compact_shifts = [
        {
            "type": s.get("type"),
            "category": s.get("category"),
            "headline": s.get("headline"),
            "summary": s.get("summary"),
            "status": s.get("status"),
            "primaryChannel": s.get("primaryChannel"),
            "secondaryChannels": s.get("secondaryChannels") or [],
            "momentumScore": s.get("momentumScore", 0),
        }
        for s in shifts
    ]
    template_vars = {
        "shifts_json": json.dumps(compact_shifts, indent=2),
        "risk_scores_json": json.dumps(risk_scores, indent=2),
        "channel_scores_json": json.dumps(channel_scores, indent=2),
        "date_range": date_range,
    }
    zero_usage = {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    if verbose:
        logger.info("Generating market summary for: %s", date_range)
    for attempt in range(2):
        try:
            result, _, usage = run_llm_with_prompt_name(
                "market_state_summary",
                template_vars,
                max_output_tokens=4096,
            )
            if not isinstance(result, dict):
                if attempt == 0 and verbose:
                    logger.info("Summary empty or non-dict, retrying once for: %s", date_range)
                else:
                    logger.warning("Gemini returned non-dict for summary (%s)", date_range)
                if attempt == 0:
                    continue
                return None, usage
            if "mood" in result and "drivers" in result:
                return result, usage
            if attempt == 0:
                continue
            return None, usage
        except (ValueError, json.JSONDecodeError, KeyError, RuntimeError) as e:
            logger.warning("Summary generation error (%s): %s", date_range, e)
            if attempt == 0:
                continue
            return None, zero_usage
    return None, zero_usage


def normalize_shift(shift: dict) -> dict:
    """Ensure shift has required fields with sensible defaults. Uses primaryChannel + secondaryChannels."""
    primary = shift.get("primaryChannel")
    secondary = shift.get("secondaryChannels") or []
    if primary is None and not secondary:
        # Legacy: derive from channelIds
        channel_ids = shift.get("channelIds") or []
        channel_ids = [c for c in channel_ids if c]
        primary = channel_ids[0] if channel_ids else None
        secondary = channel_ids[1:] if len(channel_ids) > 1 else []
    return {
        "type": shift.get("type", "RISK"),
        "category": shift.get("category", "MARKET_SENTIMENT"),
        "headline": shift.get("headline", "Unknown"),
        "summary": shift.get("summary", ""),
        "primaryChannel": primary,
        "secondaryChannels": list(secondary) if secondary else [],
        "status": shift.get("status", "EMERGING"),
        "articleRefs": shift.get("articleRefs") or [],
    }


# Max number of deep (timeline) analyses per run to control cost/latency
MAX_DEEP_ANALYSIS_PER_RUN = 5


def _compute_shift_ids(normalized: list[dict]) -> None:
    """Attach _shift_id to each shift (slug from headline, unique per run)."""
    used_ids: set[str] = set()
    for shift in normalized:
        base_slug = slug_from_headline(shift.get("headline", "unknown"))
        shift_id = base_slug
        suffix = 0
        while shift_id in used_ids:
            suffix += 1
            shift_id = f"{base_slug}-{suffix}"
        used_ids.add(shift_id)
        shift["_shift_id"] = shift_id


def run_extraction(
    svc: MarketShiftService,
    current_date: str,
    cutoff_date: str,
    skip_deep_analysis: bool,
    verbose: bool = False,
    return_markdown: bool = False,
) -> tuple[list[dict], dict] | tuple[list[dict], dict, str]:
    """
    Fetch market shifts via Gemini, normalize, optionally run deep (timeline) analysis.
    Returns (normalized shift dicts, usage dict) or (normalized, usage, markdown_text) when return_markdown=True.
    """
    result = fetch_market_shifts(
        current_date, cutoff_date, verbose=verbose, return_markdown=return_markdown
    )
    if return_markdown:
        market_shifts, usage_acc, markdown_text = result
    else:
        market_shifts, usage_acc = result
        markdown_text = None
    normalized = [normalize_shift(s) for s in market_shifts]
    _compute_shift_ids(normalized)

    if not skip_deep_analysis:
        try:
            client = get_genai_client()
        except ValueError:
            logger.warning("No API key; skipping deep analysis")
            client = None
        if client is not None:
            existing_with_timeline = svc.get_existing_shift_ids_with_timeline()
            new_ids = [s.get("_shift_id") for s in normalized if s.get("_shift_id") and s.get("_shift_id") not in existing_with_timeline]
            if new_ids:
                print(f"Market shifts: running deep analysis (timeline + canonical driver) for {min(len(new_ids), MAX_DEEP_ANALYSIS_PER_RUN)} new shift(s)...", flush=True)
            done = 0
            for shift in normalized:
                if done >= MAX_DEEP_ANALYSIS_PER_RUN:
                    break
                shift_id = shift.get("_shift_id")
                if shift_id and shift_id not in existing_with_timeline:
                    timeline, u = fetch_shift_timeline(
                        shift, current_date, cutoff_date, verbose=verbose
                    )
                    _add_usage(usage_acc, u)
                    if timeline:
                        shift["timeline"] = timeline
                        shift["analyzedAt"] = datetime.utcnow().isoformat() + "Z"
                        if timeline.get("canonicalDriver"):
                            print(f"  Canonical driver: {timeline['canonicalDriver']}", flush=True)
                        if timeline.get("canonicalDriverRationale"):
                            print(f"  Rationale: {timeline['canonicalDriverRationale']}", flush=True)
                        done += 1
                        existing_with_timeline.add(shift_id)

    for s in normalized:
        s.pop("_shift_id", None)
    if return_markdown and markdown_text is not None:
        return normalized, usage_acc, markdown_text
    return normalized, usage_acc


def run_summaries(
    svc: MarketShiftService,
    as_of: str,
    verbose: bool = False,
    usage_accumulator: dict | None = None,
) -> None:
    """
    Load current shifts from Firestore, generate AI market state summaries, and save.
    Call after extract+save+merge so summaries reflect the final (possibly merged) set.
    If usage_accumulator is provided, adds summary call token usage to it in place.
    """
    shifts = svc.get_all_shifts()
    if not shifts:
        logger.warning("No shifts in Firestore; skipping summary generation")
        return
    try:
        risk_scores = svc.get_risk_scores_history(limit=10)
        latest_scores = risk_scores[-1] if risk_scores else {}
        channel_scores = latest_scores.get("channelScores") or {}
        summaries = {}
        for key, label in [("yesterdayToday", "yesterday and today"), ("lastWeek", "last 7 days")]:
            result, u = fetch_market_summary(
                shifts, risk_scores, channel_scores, label, verbose=verbose
            )
            if usage_accumulator is not None:
                _add_usage(usage_accumulator, u)
            summaries[key] = result
        svc.save_market_summaries(as_of, summaries, verbose=verbose)
    except Exception as e:
        logger.warning("Market summary generation failed (non-fatal): %s", e)


def run_scan_market_shifts(
    skip_deep_analysis: bool = True,
    skip_merge: bool = True,
    verbose: bool = False,
) -> dict:
    """
    Run the full market shifts pipeline.

    When merge is not skipped: extract (step 1) -> merge clustering in memory -> deep analysis
    only for shifts that were not merged into existing (step 2) -> save and apply merges (steps 3-5) -> summaries.
    Anything that wasn't merged into an existing shift is considered "new" and gets deep analysis.

    When merge is skipped: extract (with optional deep analysis) -> save -> summaries.
    Returns dict with as_of, shift_count, merge_changed, merges_applied, prompt_tokens, response_tokens, total_tokens.
    """
    print("Market shifts: starting extraction (Gemini + Google Search; can take 1-3 min)...", flush=True)
    now = datetime.utcnow()
    current_date = now.strftime("%Y-%m-%d")
    cutoff_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    as_of = current_date
    print("Market shifts: connecting to Firestore...", flush=True)
    svc = MarketShiftService()
    print("Market shifts: calling Gemini with Google Search grounding (can take 1-3 min)...", flush=True)

    merge_changed = False
    merges_applied = 0

    if skip_merge:
        # Original flow: extract (with optional deep analysis) -> save -> summaries
        normalized, usage_acc = run_extraction(
            svc, current_date, cutoff_date, skip_deep_analysis, verbose
        )
        print(f"Market shifts: saving {len(normalized)} shifts to Firestore...", flush=True)
        svc.save_market_shifts(as_of, normalized, verbose=verbose)
    else:
        # Merge-first flow: extract (no deep analysis) -> merge in memory -> deep analysis on new only -> save + apply
        normalized, usage_acc = run_extraction(
            svc, current_date, cutoff_date, skip_deep_analysis=True, verbose=verbose
        )
        _compute_shift_ids(normalized)
        for s in normalized:
            s["id"] = s.get("_shift_id")

        existing = svc.get_all_shifts()
        existing_ids = {s["id"] for s in existing}

        if existing or normalized:
            combined = existing + normalized
            merge_decisions, merge_usage = run_merge_step_in_memory(
                combined, verbose=verbose
            )
            _add_usage(usage_acc, merge_usage)
            # Extracted shifts that were merged into an existing shift are not "new"
            extracted_merged_into_existing = set()
            for _ck, _cluster, decision in merge_decisions:
                cid = decision.get("canonicalId")
                if cid in existing_ids:
                    for mid in decision.get("mergeIntoCanonical") or []:
                        if mid not in existing_ids:
                            extracted_merged_into_existing.add(mid)
            new_extracted = [s for s in normalized if s.get("_shift_id") not in extracted_merged_into_existing]
        else:
            merge_decisions = []
            new_extracted = normalized

        # Step 2: deep analysis only for new (unmerged) extracted shifts
        if new_extracted and not skip_deep_analysis:
            try:
                client = get_genai_client()
            except ValueError:
                client = None
            if client is not None:
                n_new = min(len(new_extracted), MAX_DEEP_ANALYSIS_PER_RUN)
                print(
                    f"Market shifts: running deep analysis (timeline + canonical driver) for {n_new} new shift(s)...",
                    flush=True,
                )
                done = 0
                for shift in new_extracted:
                    if done >= MAX_DEEP_ANALYSIS_PER_RUN:
                        break
                    timeline, u = fetch_shift_timeline(
                        shift, current_date, cutoff_date, verbose=verbose
                    )
                    _add_usage(usage_acc, u)
                    if timeline:
                        shift["timeline"] = timeline
                        shift["analyzedAt"] = datetime.utcnow().isoformat() + "Z"
                        if timeline.get("canonicalDriver") and verbose:
                            print(f"  Canonical driver: {timeline['canonicalDriver']}", flush=True)
                        if timeline.get("canonicalDriverRationale") and verbose:
                            print(f"  Rationale: {timeline['canonicalDriverRationale']}", flush=True)
                        done += 1

        # Pop _shift_id before save; keep id for apply_merge
        for s in normalized:
            s.pop("_shift_id", None)

        # Apply merge decisions to Firestore (updates canonicals, deletes duplicates)
        saved_canonical_ids = set()
        new_extracted_by_id = {s["id"]: s for s in new_extracted if s.get("id")}
        for cluster_key, cluster, decision in merge_decisions:
            # Merge in timeline from new_extracted so canonical has it when written
            cluster_with_updates = []
            for sh in cluster:
                updated = new_extracted_by_id.get(sh.get("id"), sh)
                cluster_with_updates.append(updated)
            apply_merge(svc, decision, cluster_with_updates, as_of, verbose=verbose)
            saved_canonical_ids.add(decision.get("canonicalId"))

        # Save singleton new extracted (not canonical in any merge)
        to_save = [s for s in new_extracted if s.get("id") not in saved_canonical_ids]
        if to_save:
            print(f"Market shifts: saving {len(to_save)} new shift(s) to Firestore...", flush=True)
            for s in to_save:
                s.pop("id", None)
            svc.save_market_shifts(as_of, to_save, verbose=verbose)
        merges_applied = len(merge_decisions)
        merge_changed = merges_applied > 0

    try:
        client = get_genai_client()
        print("Market shifts: generating summaries...", flush=True)
        run_summaries(svc, as_of, verbose=verbose, usage_accumulator=usage_acc)
    except ValueError:
        logger.warning("No API key; skipping summaries")

    return {
        "as_of": as_of,
        "shift_count": len(normalized),
        "merge_changed": merge_changed,
        "merges_applied": merges_applied,
        "prompt_tokens": usage_acc.get("prompt_tokens", 0),
        "response_tokens": usage_acc.get("response_tokens", 0),
        "total_tokens": usage_acc.get("total_tokens", 0),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch market shifts via Gemini and save to Firestore")
    parser.add_argument("--dry-run", action="store_true", help="Call Gemini, print JSON, do not write to Firestore")
    parser.add_argument("--merge-only", action="store_true", help="Skip extract/save; run only merge on current Firestore state, then summaries if merge changed anything")
    parser.add_argument("--skip-merge", action="store_true", help="Skip the merge step (full run only)")
    parser.add_argument("--skip-deep-analysis", action="store_true", help="Skip timeline deep analysis (faster runs)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.INFO, format="%(message)s")

    now = datetime.utcnow()
    current_date = now.strftime("%Y-%m-%d")
    cutoff_date = (now - timedelta(days=30)).strftime("%Y-%m-%d")
    as_of = current_date
    svc = MarketShiftService()

    # --- Merge-only mode: load shifts, merge, then regenerate summaries if merge changed anything ---
    if args.merge_only:
        try:
            client = get_genai_client()
            merge_changed, merges_applied, _ = run_merge_step(svc, as_of, client, verbose=args.verbose, dry_run=args.dry_run)
            if merge_changed and not args.dry_run:
                run_summaries(svc, as_of, verbose=args.verbose)
            if args.verbose:
                logger.info("Merge-only run complete (merge_changed=%s, merges_applied=%d)", merge_changed, merges_applied)
        except ValueError:
            logger.warning("No API key; cannot run merge (needs Gemini)")
        return

    # --- Full pipeline: extract -> save -> merge (optional) -> summaries ---
    if args.dry_run:
        normalized, _ = run_extraction(svc, current_date, cutoff_date, args.skip_deep_analysis, verbose=args.verbose)
        out = [
            {"type": s["type"], "category": s["category"], "headline": s["headline"], "summary": s["summary"], "primaryChannel": s.get("primaryChannel"), "secondaryChannels": s.get("secondaryChannels", []), "status": s["status"], "articleRefs": s["articleRefs"]}
            for s in normalized
        ]
        print(json.dumps({"marketShifts": out}, indent=2))
        print(f"\n[DRY RUN] Would save {len(normalized)} market shifts to Firestore")
        if not args.skip_deep_analysis and normalized:
            try:
                get_genai_client()  # verify API key
            except ValueError:
                logger.warning("No API key; skipping dry-run deep analysis and summary")
            else:
                first = normalized[0]
                logger.info("Running deep analysis for first shift (dry-run)...")
                timeline, _ = fetch_shift_timeline(
                    first, current_date, cutoff_date, verbose=args.verbose
                )
                if timeline:
                    print("\n[DRY RUN] Timeline for first shift:")
                    print(json.dumps(timeline, indent=2))
                try:
                    channel_scores = {}
                    summary, _ = fetch_market_summary(
                        normalized, [], channel_scores, "yesterday and today",
                        verbose=args.verbose,
                    )
                    if summary:
                        print("\n[DRY RUN] Market summary (yesterday/today):")
                        print(json.dumps(summary, indent=2))
                except Exception as e:
                    logger.warning("Dry-run summary failed: %s", e)
        return

    result = run_scan_market_shifts(
        skip_deep_analysis=args.skip_deep_analysis,
        skip_merge=args.skip_merge,
        verbose=args.verbose,
    )
    if args.verbose:
        logger.info(
            "Done. Saved %d market shifts for %s (merge_changed=%s)",
            result["shift_count"],
            result["as_of"],
            result["merge_changed"],
        )


if __name__ == "__main__":
    main()
    sys.exit(0)
