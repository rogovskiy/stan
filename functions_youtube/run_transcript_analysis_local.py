#!/usr/bin/env python3
"""
Run transcript analysis locally: read transcript from Storage, summarize with Gemini,
write transcriptSummary to Firestore. No Cloud Function deployment needed.

Usage:
  python run_transcript_analysis_local.py --video-id VIDEO_ID   # one video
  python run_transcript_analysis_local.py                       # all videos with transcript, no summary

Requires in ../data-fetcher/.env.local (or env):
  - FIREBASE_* (or GOOGLE_APPLICATION_CREDENTIALS) for Firestore + Storage
  - GEMINI_API_KEY for the Gemini API
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
if os.path.isfile(_env):
    from dotenv import load_dotenv
    load_dotenv(_env)

if not os.getenv("FIREBASE_PRIVATE_KEY") and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
    print("Set FIREBASE_* in .env.local or GOOGLE_APPLICATION_CREDENTIALS.", file=sys.stderr)
    sys.exit(1)
if not (os.getenv("GEMINI_API_KEY") or "").strip():
    print("Set GEMINI_API_KEY in .env.local (or export).", file=sys.stderr)
    sys.exit(1)

# Initialize Firebase (same as trigger_analysis: service init runs FirebaseBaseService._init_firebase)
from youtube.youtube_subscription_service import YouTubeSubscriptionService

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run transcript analysis locally (Storage → Gemini → Firestore)."
    )
    parser.add_argument("--video-id", metavar="ID", help="Run analysis for this video only")
    parser.add_argument("--limit", type=int, default=500, help="Max videos to consider when running for all (default 500)")
    args = parser.parse_args()

    api_key = (os.getenv("GEMINI_API_KEY") or "").strip()
    # Import after Firebase is initialized (YouTubeSubscriptionService() above triggers init on first use)
    from youtube.transcript_analysis import run_transcript_analysis

    service = YouTubeSubscriptionService()

    if args.video_id:
        video_id = args.video_id.strip()
        doc = service.get_video(video_id)
        if not doc:
            logger.error("Video %s not found in youtube_videos", video_id)
            sys.exit(1)
        if not (doc.get("transcriptStorageRef") or "").strip():
            logger.error("Video %s has no transcriptStorageRef; run run_transcript.py first.", video_id)
            sys.exit(1)
        run_transcript_analysis(video_id, api_key)
        logger.info("Done.")
        return

    videos = service.list_videos(userId=None, limit=args.limit)
    pending = [
        v for v in videos
        if (v.get("transcriptStorageRef") or "").strip()
        and not (v.get("transcriptSummary") or "").strip()
    ]
    video_ids = [v.get("id") or v.get("videoId") for v in pending]
    video_ids = [vid for vid in video_ids if vid]

    if not video_ids:
        logger.info("No videos with transcript but without analysis. Done.")
        return

    logger.info("Running transcript analysis locally for %d videos...", len(video_ids))
    ok = 0
    for video_id in video_ids:
        try:
            run_transcript_analysis(video_id, api_key)
            ok += 1
        except Exception as e:
            logger.exception("Skip %s: %s", video_id, e)
    logger.info("Done. %d/%d succeeded.", ok, len(video_ids))


if __name__ == "__main__":
    main()
    sys.exit(0)
