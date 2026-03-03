#!/usr/bin/env python3
"""
Publish to youtube-transcript-analysis-requests for every video that has a transcript
but no analysis (transcriptSummary). The Cloud Function will run Gemini and write the summary.

Usage:
  python trigger_analysis.py                    # trigger analysis for all eligible videos
  python trigger_analysis.py --video-id ID      # trigger analysis for one video
  python trigger_analysis.py --dry-run          # only list how many would be triggered

Requires: Firebase credentials (e.g. ../data-fetcher/.env.local with FIREBASE_*).
"""
import argparse
import json
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

# Firebase is initialized by YouTubeSubscriptionService (via FirebaseBaseService) using FIREBASE_* from env.
from youtube.youtube_subscription_service import YouTubeSubscriptionService

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

TOPIC_ID = "youtube-transcript-analysis-requests"


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Trigger transcript analysis for videos that have transcript but no summary."
    )
    parser.add_argument("--video-id", metavar="ID", help="Trigger analysis for this video only")
    parser.add_argument("--dry-run", action="store_true", help="Only list videos that would be triggered")
    parser.add_argument("--limit", type=int, default=500, help="Max videos to consider (default 500)")
    args = parser.parse_args()

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("FIREBASE_PROJECT_ID")
    if not project_id:
        logger.error("Set GOOGLE_CLOUD_PROJECT or FIREBASE_PROJECT_ID")
        sys.exit(1)

    try:
        from google.cloud import pubsub_v1
        from google.oauth2 import service_account as sa
    except ImportError:
        logger.error("Install google-cloud-pubsub: pip install google-cloud-pubsub")
        sys.exit(1)

    if os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
        publisher = pubsub_v1.PublisherClient()
    else:
        private_key = (os.getenv("FIREBASE_PRIVATE_KEY") or "").replace("\\n", "\n")
        if not private_key:
            logger.error("Set FIREBASE_PRIVATE_KEY or GOOGLE_APPLICATION_CREDENTIALS")
            sys.exit(1)
        cred_dict = {
            "type": "service_account",
            "project_id": os.getenv("FIREBASE_PROJECT_ID"),
            "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
            "private_key": private_key,
            "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
            "client_id": os.getenv("FIREBASE_CLIENT_ID"),
            "auth_uri": os.getenv("FIREBASE_AUTH_URI", "https://accounts.google.com/o/oauth2/auth"),
            "token_uri": os.getenv("FIREBASE_TOKEN_URI", "https://oauth2.googleapis.com/token"),
        }
        creds = sa.Credentials.from_service_account_info(cred_dict)
        publisher = pubsub_v1.PublisherClient(credentials=creds)

    topic_path = f"projects/{project_id}/topics/{TOPIC_ID}"

    if args.video_id:
        video_id = args.video_id.strip()
        service = YouTubeSubscriptionService()
        doc = service.get_video(video_id)
        if not doc:
            logger.error("Video %s not found in youtube_videos", video_id)
            sys.exit(1)
        if not (doc.get("transcriptStorageRef") or "").strip():
            logger.error("Video %s has no transcriptStorageRef; run run_transcript.py first.", video_id)
            sys.exit(1)
        if args.dry_run:
            logger.info("[dry-run] Would trigger analysis for %s", video_id)
            return
        message_json = json.dumps({"videoId": video_id}).encode("utf-8")
        publisher.publish(topic_path, message_json).result()
        logger.info("Triggered analysis for %s", video_id)
        return

    service = YouTubeSubscriptionService()
    videos = service.list_videos(userId=None, limit=args.limit)
    # Has transcript ref but no summary
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

    logger.info("Found %d videos with transcript but no analysis (of %d total).", len(video_ids), len(videos))
    if args.dry_run:
        for vid in video_ids:
            logger.info("  [dry-run] would trigger: %s", vid)
        return

    for video_id in video_ids:
        message_json = json.dumps({"videoId": video_id}).encode("utf-8")
        publisher.publish(topic_path, message_json).result()
        logger.info("Triggered analysis for %s", video_id)
    logger.info("Done. Triggered %d videos.", len(video_ids))


if __name__ == "__main__":
    main()
    sys.exit(0)
