#!/usr/bin/env python3
"""
Scan Market Shifts

Fetches market shifts (systematic risks and tailwinds) from recent financial news
via Gemini API with Google Search grounding, and saves to Firestore at
macro/us_market/market_shifts.

Uses the google-genai package (google.genai). Requires GEMINI_API_KEY or GOOGLE_AI_API_KEY.

Invocation:
- CLI: python scan_market_shifts.py [--dry-run] [--skip-deep-analysis] [--verbose]
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime
from pathlib import Path

# Add parent directory so we can import modules
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

load_dotenv(".env.local")

from google import genai
from google.genai import types

from services.market_shift_service import MarketShiftService, slug_from_headline

logger = logging.getLogger(__name__)


def _extract_json_from_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks)."""
    if "```json" in response_text:
        return response_text.split("```json")[1].split("```")[0].strip()
    if "```" in response_text:
        return response_text.split("```")[1].split("```")[0].strip()
    return response_text.strip()


def load_prompt() -> str:
    """Load the market shift extraction prompt."""
    prompts_dir = Path(__file__).parent / "prompts"
    prompt_path = prompts_dir / "market_shift_extraction_prompt.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def load_timeline_prompt_template() -> str:
    """Load the market shift timeline prompt template (expects {headline}, {summary}, {type}, {category})."""
    prompts_dir = Path(__file__).parent / "prompts"
    prompt_path = prompts_dir / "market_shift_timeline_prompt.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def fetch_market_shifts(prompt: str, verbose: bool = False) -> list[dict]:
    """
    Call Gemini with Google Search grounding to extract market shifts.
    Returns list of shift dicts.
    """
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable is not set")

    client = genai.Client(api_key=api_key)
    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    max_remote_calls = int(os.getenv("GEMINI_MAX_REMOTE_CALLS", "50"))

    config = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        temperature=0.2,
        max_output_tokens=8192,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(
            maximum_remote_calls=max_remote_calls,
        ),
    )

    if verbose:
        logger.info("Calling Gemini with Google Search grounding...")

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=config,
    )

    if not response.text:
        raise RuntimeError("Gemini returned empty response")

    if verbose:
        logger.info("Received response, parsing JSON...")

    json_str = _extract_json_from_response(response.text)
    data = json.loads(json_str)

    market_shifts = data.get("marketShifts", [])
    if not isinstance(market_shifts, list):
        raise ValueError("Expected marketShifts to be an array")

    return market_shifts


def fetch_shift_timeline(
    shift: dict,
    timeline_prompt_template: str,
    client: genai.Client,
    verbose: bool = False,
) -> dict | None:
    """
    Call Gemini with Google Search grounding to research timeline for one shift.
    Returns timeline dict with firstSurfacedAt and majorDevelopments, or None on failure.
    """
    model = os.getenv("GEMINI_TIMELINE_MODEL", os.getenv("GEMINI_MODEL", "gemini-2.0-flash"))
    max_remote_calls = int(os.getenv("GEMINI_MAX_REMOTE_CALLS", "50"))
    prompt = timeline_prompt_template.format(
        type=shift.get("type", "RISK"),
        category=shift.get("category", "MARKET_SENTIMENT"),
        headline=shift.get("headline", ""),
        summary=shift.get("summary", ""),
    )
    config = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        temperature=0.2,
        max_output_tokens=4096,
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
        if not response.text:
            logger.warning("Gemini returned empty response for timeline")
            return None
        json_str = _extract_json_from_response(response.text)
        data = json.loads(json_str)
        first = data.get("firstSurfacedAt")
        devs = data.get("majorDevelopments")
        if not isinstance(devs, list):
            devs = []
        return {"firstSurfacedAt": first or "", "majorDevelopments": devs}
    except (json.JSONDecodeError, KeyError, RuntimeError) as e:
        logger.warning("Timeline parse or API error for %s: %s", shift.get("headline", "")[:40], e)
        return None


def load_summary_prompt_template() -> str:
    """Load the market state summary prompt template (expects {shifts_json}, {risk_scores_json}, {date_range})."""
    prompts_dir = Path(__file__).parent / "prompts"
    prompt_path = prompts_dir / "market_state_summary_prompt.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def fetch_market_summary(
    shifts: list[dict],
    risk_scores: list[dict],
    date_range: str,
    summary_template: str,
    client: genai.Client,
    verbose: bool = False,
) -> dict | None:
    """
    Call Gemini to generate a structured market state summary for the given date range.
    Returns dict with mood, moodDetail, drivers[] or None on failure.
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
    prompt = prompt.replace("{date_range}", date_range)

    model = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
    config = types.GenerateContentConfig(
        temperature=0.3,
        max_output_tokens=1024,
    )
    if verbose:
        logger.info("Generating market summary for: %s", date_range)
    try:
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        if not response.text:
            logger.warning("Gemini returned empty response for summary (%s)", date_range)
            return None
        json_str = _extract_json_from_response(response.text)
        data = json.loads(json_str)
        if "mood" in data and "drivers" in data:
            return data
        return None
    except (json.JSONDecodeError, KeyError, RuntimeError) as e:
        logger.warning("Summary generation error (%s): %s", date_range, e)
        return None


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


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch market shifts via Gemini and save to Firestore")
    parser.add_argument("--dry-run", action="store_true", help="Call Gemini, print JSON, do not write to Firestore")
    parser.add_argument("--skip-deep-analysis", action="store_true", help="Skip timeline deep analysis (faster runs)")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.INFO, format="%(message)s")

    prompt = load_prompt()
    market_shifts = fetch_market_shifts(prompt, verbose=args.verbose)

    normalized = [normalize_shift(s) for s in market_shifts]
    _compute_shift_ids(normalized)

    if args.dry_run:
        # Remove internal key for output
        out = [{"type": s["type"], "category": s["category"], "headline": s["headline"], "summary": s["summary"], "channelIds": s["channelIds"], "status": s["status"], "articleRefs": s["articleRefs"]} for s in normalized]
        print(json.dumps({"marketShifts": out}, indent=2))
        print(f"\n[DRY RUN] Would save {len(normalized)} market shifts to Firestore")
        if not args.skip_deep_analysis and normalized:
            # Run deep analysis for first shift to verify prompt/parsing
            api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
            if api_key:
                client = genai.Client(api_key=api_key)
                timeline_template = load_timeline_prompt_template()
                first = normalized[0]
                logger.info("Running deep analysis for first shift (dry-run)...")
                timeline = fetch_shift_timeline(first, timeline_template, client, verbose=args.verbose)
                if timeline:
                    print("\n[DRY RUN] Timeline for first shift:")
                    print(json.dumps(timeline, indent=2))

                # Preview summary generation
                try:
                    summary_template = load_summary_prompt_template()
                    summary = fetch_market_summary(
                        normalized, [], "yesterday and today",
                        summary_template, client, verbose=args.verbose,
                    )
                    if summary:
                        print("\n[DRY RUN] Market summary (yesterday/today):")
                        print(json.dumps(summary, indent=2))
                except Exception as e:
                    logger.warning("Dry-run summary failed: %s", e)
        return

    as_of = datetime.utcnow().strftime("%Y-%m-%d")
    svc = MarketShiftService()
    existing_with_timeline = svc.get_existing_shift_ids_with_timeline()

    if not args.skip_deep_analysis:
        api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
        if not api_key:
            logger.warning("No API key; skipping deep analysis")
        else:
            client = genai.Client(api_key=api_key)
            timeline_template = load_timeline_prompt_template()
            done = 0
            for shift in normalized:
                if done >= MAX_DEEP_ANALYSIS_PER_RUN:
                    break
                shift_id = shift.get("_shift_id")
                if shift_id and shift_id not in existing_with_timeline:
                    timeline = fetch_shift_timeline(shift, timeline_template, client, verbose=args.verbose)
                    if timeline:
                        shift["timeline"] = timeline
                        shift["analyzedAt"] = datetime.utcnow().isoformat() + "Z"
                        done += 1
                        existing_with_timeline.add(shift_id)

    for s in normalized:
        s.pop("_shift_id", None)

    svc.save_market_shifts(as_of, normalized, verbose=args.verbose)

    # --- Generate AI market state summaries ---
    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
    if api_key and normalized:
        try:
            summary_template = load_summary_prompt_template()
            risk_scores = svc.get_risk_scores_history(limit=10)
            summary_client = genai.Client(api_key=api_key)

            summaries = {}
            for key, label in [("yesterdayToday", "yesterday and today"), ("lastWeek", "last 7 days")]:
                result = fetch_market_summary(
                    normalized, risk_scores, label, summary_template, summary_client,
                    verbose=args.verbose,
                )
                summaries[key] = result

            svc.save_market_summaries(as_of, summaries, verbose=args.verbose)
        except Exception as e:
            logger.warning("Market summary generation failed (non-fatal): %s", e)

    if args.verbose:
        logger.info("Done. Saved %d market shifts for %s", len(normalized), as_of)


if __name__ == "__main__":
    main()
    sys.exit(0)
