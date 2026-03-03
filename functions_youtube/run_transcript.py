#!/usr/bin/env python3
"""
Local transcript script: fetch transcripts via youtube-transcript-api, upload to Storage,
update Firestore, and publish to youtube-transcript-analysis-requests so the Cloud Function runs the summary.

Usage:
  python run_transcript.py              # process all videos missing transcript
  python run_transcript.py --video-id VIDEO_ID
  python run_transcript.py --dry-run

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
else:
    print("Optional: ../data-fetcher/.env.local for Firebase. Using env vars if set.", file=sys.stderr)

if not os.getenv("FIREBASE_PRIVATE_KEY") and not os.getenv("GOOGLE_APPLICATION_CREDENTIALS"):
    print("Set FIREBASE_* in .env.local or GOOGLE_APPLICATION_CREDENTIALS for Firebase and Storage.", file=sys.stderr)
    sys.exit(1)

from firebase_admin import storage

from youtube.youtube_subscription_service import YouTubeSubscriptionService

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger(__name__)

STORAGE_PREFIX = "youtube_transcripts"
TOPIC_ID = "youtube-transcript-analysis-requests"


def fetch_transcript_text(video_id: str, lang: str | None = None) -> str:
    """Fetch transcript for video_id and return concatenated plain text. Raises on failure."""
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api import TranscriptsDisabled, NoTranscriptFound, VideoUnavailable

    api = YouTubeTranscriptApi()
    if lang:
        fetched = api.fetch(video_id, languages=(lang,))
    else:
        transcript_list = api.list(video_id)
        transcript = transcript_list.find_transcript([t.language_code for t in transcript_list])
        fetched = transcript.fetch()
    return " ".join(snippet.text for snippet in fetched).strip() if fetched else ""


def process_one(
    video_id: str,
    service: YouTubeSubscriptionService,
    bucket,
    publisher,
    project_id: str,
    dry_run: bool = False,
) -> bool:
    """Fetch transcript, upload to Storage, update Firestore, publish to Pub/Sub. Returns True if done (or dry_run)."""
    try:
        text = fetch_transcript_text(video_id, 'en')
    except Exception as e:
        logger.warning("Skip %s: could not fetch transcript: %s", video_id, e)
        return False
    if not text.strip():
        logger.warning("Skip %s: empty transcript", video_id)
        return False
    storage_ref = f"{STORAGE_PREFIX}/{video_id}.txt"
    if dry_run:
        logger.info("[dry-run] Would process %s -> %s (%d chars)", video_id, storage_ref, len(text))
        return True
    blob = bucket.blob(storage_ref)
    blob.upload_from_string(text, content_type="text/plain")
    service.update_video_transcript(video_id, storage_ref)
    topic_path = f"projects/{project_id}/topics/{TOPIC_ID}"
    message_json = json.dumps({"videoId": video_id}).encode("utf-8")
    publisher.publish(topic_path, message_json).result()
    logger.info("Processed %s: uploaded %s, updated Firestore, published to %s", video_id, storage_ref, TOPIC_ID)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch YouTube transcripts locally, upload to Storage, trigger analysis")
    parser.add_argument("--video-id", metavar="ID", help="Process only this video ID")
    parser.add_argument("--dry-run", action="store_true", help="Only list videos that would be processed")
    args = parser.parse_args()

    project_id = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("FIREBASE_PROJECT_ID")
    if not project_id:
        logger.error("Set GOOGLE_CLOUD_PROJECT or FIREBASE_PROJECT_ID")
        sys.exit(1)

    service = YouTubeSubscriptionService()
    bucket = storage.bucket()
    try:
        from google.cloud import pubsub_v1
        from google.oauth2 import service_account as sa
    except ImportError:
        logger.error("Install google-cloud-pubsub: pip install google-cloud-pubsub")
        sys.exit(1)

    # Use FIREBASE_* credentials (from dotenv) for Pub/Sub when ADC is not set
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

    if args.video_id:
        video_id = args.video_id.strip()
        doc = service.get_video(video_id)
        if not doc:
            logger.error("Video %s not found in youtube_videos", video_id)
            sys.exit(1)
        if doc.get("transcriptStorageRef"):
            logger.info("Video %s already has transcript (transcriptStorageRef=%s). Skipping.", video_id, doc.get("transcriptStorageRef"))
            sys.exit(0)
        process_one(video_id, service, bucket, publisher, project_id, dry_run=args.dry_run)
        return

    videos = service.list_videos(userId=None, limit=500)
    missing = [v for v in videos if not (v.get("transcriptStorageRef") or "").strip()]
    if not missing:
        logger.info("No videos missing transcript. Done.")
        return
    logger.info("Found %d videos without transcript (of %d total). Processing...", len(missing), len(videos))
    ok = 0
    for v in missing:
        vid = v.get("id") or v.get("videoId")
        if not vid:
            continue
        if process_one(vid, service, bucket, publisher, project_id, dry_run=args.dry_run):
            ok += 1
    logger.info("Done. Processed %d videos.", ok)


if __name__ == "__main__":
    main()
    sys.exit(0)
