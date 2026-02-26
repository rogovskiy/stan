#!/usr/bin/env python3
"""
Scan Market Shifts

Fetches market shifts (systematic risks and tailwinds) from recent financial news
via Gemini API with Google Search grounding, and saves to Firestore at
macro/us_market/market_shifts.

Uses the google-genai package (google.genai). Requires GEMINI_API_KEY or GOOGLE_AI_API_KEY.

Invocation:
- CLI: python scan_market_shifts.py [--dry-run] [--verbose]
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

from services.market_shift_service import MarketShiftService

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

    config = types.GenerateContentConfig(
        tools=[types.Tool(google_search=types.GoogleSearch())],
        temperature=0.2,
        max_output_tokens=8192,
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch market shifts via Gemini and save to Firestore")
    parser.add_argument("--dry-run", action="store_true", help="Call Gemini, print JSON, do not write to Firestore")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.INFO, format="%(message)s")

    prompt = load_prompt()
    market_shifts = fetch_market_shifts(prompt, verbose=args.verbose)

    normalized = [normalize_shift(s) for s in market_shifts]

    if args.dry_run:
        print(json.dumps({"marketShifts": normalized}, indent=2))
        print(f"\n[DRY RUN] Would save {len(normalized)} market shifts to Firestore")
        return

    as_of = datetime.utcnow().strftime("%Y-%m-%d")
    svc = MarketShiftService()
    svc.save_market_shifts(as_of, normalized, verbose=args.verbose)

    if args.verbose:
        logger.info("Done. Saved %d market shifts for %s", len(normalized), as_of)


if __name__ == "__main__":
    main()
    sys.exit(0)
