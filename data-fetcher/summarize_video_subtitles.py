#!/usr/bin/env python3
"""
Summarize Video Subtitles (economic findings)

Downloads auto-generated subtitles for a video URL via yt-dlp, extracts plain text
from the json3 file, and uses Gemini to produce a bulleted summary of economic
findings believed or argued by the author.

Requires: yt-dlp on PATH or --yt-dlp-path. GEMINI_API_KEY or GOOGLE_AI_API_KEY.

Invocation:
  python summarize_video_subtitles.py <video_url> [--sub-langs en] [--yt-dlp-path PATH] [--output FILE] [--verbose]
"""

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

load_dotenv(".env.local")

from google import genai
from google.genai import types

from extraction_utils import get_gemini_model

logger = logging.getLogger(__name__)

for _logger_name in ("urllib3", "urllib3.connectionpool", "httpcore", "httpx", "google.genai"):
    logging.getLogger(_logger_name).setLevel(logging.WARNING)


def load_prompt_template() -> str:
    """Load the video economic summary prompt (expects {transcript})."""
    prompts_dir = Path(__file__).resolve().parent / "prompts"
    prompt_path = prompts_dir / "video_economic_summary_prompt.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def extract_text_from_json3(path: Path) -> str:
    """Extract plain text from a YouTube json3 subtitle file."""
    data = json.loads(path.read_text(encoding="utf-8"))
    parts = []
    for event in data.get("events", []):
        for seg in event.get("segs", []):
            t = (seg.get("utf8") or "").strip()
            if t and t != "\n":
                parts.append(t)
    return " ".join(parts)


def download_subtitles(
    video_url: str,
    yt_dlp_path: str,
    sub_langs: str,
    work_dir: Path,
    verbose: bool = False,
) -> Path | None:
    """Run yt-dlp to download auto subs in json3. Returns path to the json3 file or None."""
    # -o with %(id)s.%(ext)s in work_dir yields e.g. <id>.en.json3
    output_tpl = str(work_dir / "%(id)s.%(ext)s")
    cmd = [
        yt_dlp_path,
        "--skip-download",
        "--write-auto-sub",
        "--sub-langs", sub_langs,
        "--sub-format", "json3",
        "-o", output_tpl,
        video_url,
    ]
    if verbose:
        logger.info("Running: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True, cwd=work_dir)
    if result.returncode != 0:
        logger.error("yt-dlp failed (exit %s): %s", result.returncode, result.stderr or result.stdout)
        return None
    # Find the downloaded json3 (e.g. <id>.en.json3)
    json3_files = list(work_dir.glob("*.json3"))
    if not json3_files:
        logger.error("yt-dlp produced no json3 file in %s", work_dir)
        return None
    return json3_files[0]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download video subtitles and summarize economic findings via Gemini",
    )
    parser.add_argument("video_url", help="Video URL (e.g. YouTube)")
    parser.add_argument("--sub-langs", default="en", help="Subtitle language code (default: en)")
    parser.add_argument("--yt-dlp-path", default="yt-dlp", help="Path to yt-dlp binary (default: yt-dlp on PATH)")
    parser.add_argument("--output", "-o", metavar="FILE", help="Write summary to FILE as well as stdout")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.INFO, format="%(message)s")

    yt_dlp_path = os.path.expanduser(args.yt_dlp_path)

    api_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_API_KEY")
    if not api_key:
        logger.error("GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable is not set")
        sys.exit(1)

    work_dir = Path(tempfile.mkdtemp(prefix="yt_subs_"))
    try:
        json3_path = download_subtitles(
            args.video_url,
            yt_dlp_path,
            args.sub_langs,
            work_dir,
            verbose=args.verbose,
        )
        if not json3_path:
            sys.exit(2)

        transcript = extract_text_from_json3(json3_path)
        if not transcript.strip():
            logger.error("No transcript text extracted from %s", json3_path)
            sys.exit(3)

        if args.verbose:
            logger.info("Transcript length: %d characters", len(transcript))

        template = load_prompt_template()
        prompt = template.replace("{transcript}", transcript)

        client = genai.Client(api_key=api_key)
        model = get_gemini_model()
        config = types.GenerateContentConfig(
            temperature=0.1,
            max_output_tokens=8192,
        )
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=config,
        )
        if not response.text:
            logger.error("Gemini returned empty response")
            sys.exit(4)

        summary = response.text.strip()
        print(summary)

        if args.output:
            Path(args.output).write_text(summary, encoding="utf-8")
            print(f"\nSummary written to {args.output}", file=sys.stderr)
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
    sys.exit(0)
