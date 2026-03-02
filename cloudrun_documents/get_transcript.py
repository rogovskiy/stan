#!/usr/bin/env python3
"""
Fetch transcript for a YouTube video using youtube_transcript_api.

Usage:
  python get_transcript.py <video_id_or_url>
  python get_transcript.py dQw4w9WgXcQ
  python get_transcript.py "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

Output: prints plain text transcript; use --json for timestamps.
"""

import argparse
import re
import sys

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api import (
    TranscriptsDisabled,
    NoTranscriptFound,
    VideoUnavailable,
)


def extract_video_id(value: str) -> str | None:
    """Extract YouTube video ID from URL or return as-is if it looks like an ID."""
    value = value.strip()
    # Standard watch URL
    m = re.search(r"(?:youtube\.com/watch\?v=|youtu\.be/)([a-zA-Z0-9_-]{11})", value)
    if m:
        return m.group(1)
    # Assume it's already a video ID (11 chars)
    if re.match(r"^[a-zA-Z0-9_-]{11}$", value):
        return value
    return None


def get_transcript(video_id: str, lang: str | None = None):
    """Fetch transcript for video_id. Optional lang code (e.g. 'en', 'es')."""
    api = YouTubeTranscriptApi()
    try:
        if lang:
            fetched = api.fetch(video_id, languages=(lang,))
        else:
            # Any language: list available and use the first one
            transcript_list = api.list(video_id)
            transcript = transcript_list.find_transcript(
                [t.language_code for t in transcript_list]
            )
            fetched = transcript.fetch()
    except TranscriptsDisabled:
        raise SystemExit(f"Transcripts are disabled for video: {video_id}")
    except NoTranscriptFound:
        raise SystemExit(f"No transcript found for video: {video_id}")
    except VideoUnavailable:
        raise SystemExit(f"Video unavailable: {video_id}")
    return fetched


def main():
    parser = argparse.ArgumentParser(
        description="Get transcript for a YouTube video",
        epilog="Example: python get_transcript.py dQw4w9WgXcQ",
    )
    parser.add_argument(
        "video",
        help="YouTube video ID or URL (e.g. dQw4w9WgXcQ or https://youtube.com/watch?v=...)",
    )
    parser.add_argument(
        "-l",
        "--lang",
        metavar="CODE",
        help="Preferred language code (e.g. en, es). Default: first available.",
    )
    parser.add_argument(
        "-j",
        "--json",
        action="store_true",
        help="Output as JSON with timestamps (start, duration, text).",
    )
    args = parser.parse_args()

    video_id = extract_video_id(args.video)
    if not video_id:
        print("Invalid video ID or URL.", file=sys.stderr)
        sys.exit(1)

    fetched = get_transcript(video_id, lang=args.lang)

    if args.json:
        import json

        print(json.dumps(fetched.to_raw_data(), indent=2))
    else:
        for snippet in fetched:
            print(snippet.text.strip())


if __name__ == "__main__":
    main()
