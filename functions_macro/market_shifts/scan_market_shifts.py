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
from pathlib import Path

from google import genai
from google.genai import types

from extraction_utils import get_gemini_model
from market_shifts.market_shift_service import MarketShiftService, slug_from_headline
from market_shifts.market_shift_merge import run_merge_step

logger = logging.getLogger(__name__)

# Suppress noisy HTTP and genai client logs (e.g. "HTTP Request: POST ...", "AFC is enabled")
for _logger_name in ("urllib3", "urllib3.connectionpool", "httpcore", "httpx", "google", "google.genai"):
    logging.getLogger(_logger_name).setLevel(logging.WARNING)

# Production Gemini settings (align with scan_ir_website / ir_crawler: low temperature, sufficient tokens)
def _gemini_temperature() -> float:
    return float(os.getenv("GEMINI_TEMPERATURE", "0.1"))


def _gemini_max_output_tokens(default: int) -> int:
    return int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", str(default)))


def _usage_from_response(response) -> dict:
    """Extract token usage from a Gemini GenerateContent response. Returns dict with prompt_tokens, response_tokens, total_tokens (0 if missing)."""
    u = getattr(response, "usage_metadata", None)
    if u is None:
        return {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    return {
        "prompt_tokens": getattr(u, "prompt_token_count", 0) or 0,
        "response_tokens": getattr(u, "candidates_token_count", 0) or 0,
        "total_tokens": getattr(u, "total_token_count", 0) or 0,
    }


def _add_usage(acc: dict, inc: dict) -> None:
    """Add inc token counts into acc in place."""
    acc["prompt_tokens"] = acc.get("prompt_tokens", 0) + inc.get("prompt_tokens", 0)
    acc["response_tokens"] = acc.get("response_tokens", 0) + inc.get("response_tokens", 0)
    acc["total_tokens"] = acc.get("total_tokens", 0) + inc.get("total_tokens", 0)


def _extract_json_from_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks and stray text)."""
    if not response_text:
        return ""
    text = response_text.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()
    # Isolate a single JSON object (handles trailing garbage / partial output)
    start = text.find("{")
    if start >= 0:
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
    return text


def load_prompt() -> str:
    """Load the market shift extraction prompt. Prompts live in functions_macro/prompts."""
    prompts_dir = Path(__file__).resolve().parent.parent / "prompts"
    prompt_path = prompts_dir / "market_shift_extraction_prompt.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def load_timeline_prompt_template() -> str:
    """Load the market shift timeline prompt template. Prompts live in functions_macro/prompts."""
    prompts_dir = Path(__file__).resolve().parent.parent / "prompts"
    prompt_path = prompts_dir / "market_shift_timeline_prompt.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def fetch_market_shifts(prompt: str, verbose: bool = False) -> tuple[list[dict], dict]:
    """
    Call Gemini with Google Search grounding to extract market shifts.
    Returns (list of shift dicts, usage dict with prompt_tokens, response_tokens, total_tokens).
    """
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable is not set")

    client = genai.Client(api_key=api_key)
    model = get_gemini_model()
    max_remote_calls = int(os.getenv("GEMINI_MAX_REMOTE_CALLS", "50"))

    config = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        temperature=_gemini_temperature(),
        max_output_tokens=_gemini_max_output_tokens(8192),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(
            maximum_remote_calls=max_remote_calls,
        ),
    )

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=config,
    )
    print("Market shifts: Gemini response received, parsing...", flush=True)

    usage = _usage_from_response(response)
    if not response.text:
        raise RuntimeError("Gemini returned empty response")

    if verbose:
        logger.info("Received response, parsing JSON...")

    json_str = _extract_json_from_response(response.text)
    data = json.loads(json_str)

    market_shifts = data.get("marketShifts", [])
    if not isinstance(market_shifts, list):
        raise ValueError("Expected marketShifts to be an array")

    return market_shifts, usage


def fetch_shift_timeline(
    shift: dict,
    timeline_prompt_template: str,
    client: genai.Client,
    current_date: str,
    cutoff_date: str,
    verbose: bool = False,
) -> tuple[dict | None, dict]:
    """
    Call Gemini with Google Search grounding to research timeline for one shift.
    Returns (timeline dict with firstSurfacedAt and majorDevelopments or None, usage dict).
    """
    model = os.getenv("GEMINI_TIMELINE_MODEL", get_gemini_model())
    max_remote_calls = int(os.getenv("GEMINI_MAX_REMOTE_CALLS", "50"))
    prompt = timeline_prompt_template.format(
        type=shift.get("type", "RISK"),
        category=shift.get("category", "MARKET_SENTIMENT"),
        headline=shift.get("headline", ""),
        summary=shift.get("summary", ""),
        current_date=current_date,
        cutoff_date=cutoff_date,
    )
    config = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        temperature=_gemini_temperature(),
        max_output_tokens=_gemini_max_output_tokens(4096),
        automatic_function_calling=types.AutomaticFunctionCallingConfig(
            maximum_remote_calls=max_remote_calls,
        ),
    )
    if verbose:
        logger.info("  Deep analysis for: %s", shift.get("headline", "")[:60])
    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        usage = _usage_from_response(response)
        if not response.text:
            logger.warning("Gemini returned empty response for timeline")
            return None, usage
        json_str = _extract_json_from_response(response.text)
        data = json.loads(json_str)
        first = data.get("firstSurfacedAt")
        devs = data.get("majorDevelopments")
        if not isinstance(devs, list):
            devs = []
        return {"firstSurfacedAt": first or "", "majorDevelopments": devs}, usage
    except (json.JSONDecodeError, KeyError, RuntimeError) as e:
        logger.warning("Timeline parse or API error for %s: %s", shift.get("headline", "")[:40], e)
        try:
            return None, _usage_from_response(response)
        except NameError:
            return None, {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}


def load_summary_prompt_template() -> str:
    """Load the market state summary prompt template. Prompts live in functions_macro/prompts."""
    prompts_dir = Path(__file__).resolve().parent.parent / "prompts"
    prompt_path = prompts_dir / "market_state_summary_prompt.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def fetch_market_summary(
    shifts: list[dict],
    risk_scores: list[dict],
    channel_scores: dict[str, float],
    date_range: str,
    summary_template: str,
    client: genai.Client,
    verbose: bool = False,
) -> tuple[dict | None, dict]:
    """
    Call Gemini to generate a structured market state summary for the given date range.
    Returns (dict with mood, moodDetail, drivers[] or None, usage dict).
    """
    compact_shifts = [
        {
            "type": s.get("type"),
            "category": s.get("category"),
            "headline": s.get("headline"),
            "summary": s.get("summary"),
            "status": s.get("status"),
            "channelIds": s.get("channelIds"),
            "momentumScore": s.get("momentumScore", 0),
        }
        for s in shifts
    ]
    prompt = summary_template.replace("{shifts_json}", json.dumps(compact_shifts, indent=2))
    prompt = prompt.replace("{risk_scores_json}", json.dumps(risk_scores, indent=2))
    prompt = prompt.replace("{channel_scores_json}", json.dumps(channel_scores, indent=2))
    prompt = prompt.replace("{date_range}", date_range)

    model = get_gemini_model()
    config = types.GenerateContentConfig(
        temperature=_gemini_temperature(),
        max_output_tokens=_gemini_max_output_tokens(4096),
    )
    if verbose:
        logger.info("Generating market summary for: %s", date_range)
    zero_usage = {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    for attempt in range(2):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            usage = _usage_from_response(response)
            if not response.text:
                if attempt == 0 and verbose:
                    logger.info("Summary empty, retrying once for: %s", date_range)
                else:
                    logger.warning("Gemini returned empty response for summary (%s)", date_range)
                if attempt == 0:
                    continue
                return None, usage
            json_str = _extract_json_from_response(response.text)
            data = json.loads(json_str)
            if "mood" in data and "drivers" in data:
                return data, usage
            return None, usage
        except (json.JSONDecodeError, KeyError, RuntimeError) as e:
            logger.warning("Summary generation error (%s): %s", date_range, e)
            if attempt == 0:
                continue
            return None, zero_usage
    return None, zero_usage


def normalize_shift(shift: dict) -> dict:
    """Ensure shift has required fields with sensible defaults."""
    return {
        "type": shift.get("type", "RISK"),
        "category": shift.get("category", "MARKET_SENTIMENT"),
        "headline": shift.get("headline", "Unknown"),
        "summary": shift.get("summary", ""),
        "channelIds": shift.get("channelIds") or [],
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
) -> tuple[list[dict], dict]:
    """
    Fetch market shifts via Gemini, normalize, optionally run deep (timeline) analysis.
    Returns (list of normalized shift dicts ready for save_market_shifts, usage dict).
    """
    extraction_prompt = load_prompt()
    extraction_prompt = extraction_prompt.replace("{current_date}", current_date).replace(
        "{cutoff_date}", cutoff_date
    )
    market_shifts, usage_acc = fetch_market_shifts(extraction_prompt, verbose=verbose)
    normalized = [normalize_shift(s) for s in market_shifts]
    _compute_shift_ids(normalized)

    if not skip_deep_analysis:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
        if not api_key:
            logger.warning("No API key; skipping deep analysis")
        else:
            client = genai.Client(api_key=api_key)
            timeline_template = load_timeline_prompt_template()
            existing_with_timeline = svc.get_existing_shift_ids_with_timeline()
            done = 0
            for shift in normalized:
                if done >= MAX_DEEP_ANALYSIS_PER_RUN:
                    break
                shift_id = shift.get("_shift_id")
                if shift_id and shift_id not in existing_with_timeline:
                    timeline, u = fetch_shift_timeline(
                        shift, timeline_template, client, current_date, cutoff_date, verbose=verbose
                    )
                    _add_usage(usage_acc, u)
                    if timeline:
                        shift["timeline"] = timeline
                        shift["analyzedAt"] = datetime.utcnow().isoformat() + "Z"
                        done += 1
                        existing_with_timeline.add(shift_id)

    for s in normalized:
        s.pop("_shift_id", None)
    return normalized, usage_acc


def run_summaries(
    svc: MarketShiftService,
    as_of: str,
    client: genai.Client,
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
        summary_template = load_summary_prompt_template()
        risk_scores = svc.get_risk_scores_history(limit=10)
        latest_scores = risk_scores[-1] if risk_scores else {}
        channel_scores = latest_scores.get("channelScores") or {}
        summaries = {}
        for key, label in [("yesterdayToday", "yesterday and today"), ("lastWeek", "last 7 days")]:
            result, u = fetch_market_summary(
                shifts, risk_scores, channel_scores, label, summary_template,
                client, verbose=verbose,
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
    Run the full market shifts pipeline: extract -> save -> optional merge -> summaries.
    Call after refresh_macro_scores() so summaries use fresh risk scores from Firestore.
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

    normalized, usage_acc = run_extraction(svc, current_date, cutoff_date, skip_deep_analysis, verbose)
    print(f"Market shifts: saving {len(normalized)} shifts to Firestore...", flush=True)
    svc.save_market_shifts(as_of, normalized, verbose=verbose)

    merge_changed = False
    merges_applied = 0
    if not skip_merge:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
        if api_key:
            client = genai.Client(api_key=api_key)
            merge_changed, merges_applied, merge_usage = run_merge_step(svc, as_of, client, verbose=verbose, dry_run=False)
            _add_usage(usage_acc, merge_usage)
        else:
            logger.warning("No API key; skipping merge step")

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
    if api_key:
        print("Market shifts: generating summaries...", flush=True)
        client = genai.Client(api_key=api_key)
        run_summaries(svc, as_of, client, verbose=verbose, usage_accumulator=usage_acc)

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
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
        if not api_key:
            logger.warning("No API key; cannot run merge (needs Gemini)")
        else:
            client = genai.Client(api_key=api_key)
            merge_changed, merges_applied, _ = run_merge_step(svc, as_of, client, verbose=args.verbose, dry_run=args.dry_run)
            if merge_changed and not args.dry_run:
                run_summaries(svc, as_of, client, verbose=args.verbose)
            if args.verbose:
                logger.info("Merge-only run complete (merge_changed=%s, merges_applied=%d)", merge_changed, merges_applied)
        return

    # --- Full pipeline: extract -> save -> merge (optional) -> summaries ---
    if args.dry_run:
        normalized, _ = run_extraction(svc, current_date, cutoff_date, args.skip_deep_analysis, verbose=args.verbose)
        out = [
            {"type": s["type"], "category": s["category"], "headline": s["headline"], "summary": s["summary"], "channelIds": s["channelIds"], "status": s["status"], "articleRefs": s["articleRefs"]}
            for s in normalized
        ]
        print(json.dumps({"marketShifts": out}, indent=2))
        print(f"\n[DRY RUN] Would save {len(normalized)} market shifts to Firestore")
        if not args.skip_deep_analysis and normalized:
            api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
            if api_key:
                client = genai.Client(api_key=api_key)
                timeline_template = load_timeline_prompt_template()
                first = normalized[0]
                logger.info("Running deep analysis for first shift (dry-run)...")
                timeline, _ = fetch_shift_timeline(
                    first, timeline_template, client, current_date, cutoff_date, verbose=args.verbose
                )
                if timeline:
                    print("\n[DRY RUN] Timeline for first shift:")
                    print(json.dumps(timeline, indent=2))
                try:
                    summary_template = load_summary_prompt_template()
                    channel_scores = {}
                    summary, _ = fetch_market_summary(
                        normalized, [], channel_scores, "yesterday and today",
                        summary_template, client, verbose=args.verbose,
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
