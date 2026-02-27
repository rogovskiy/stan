#!/usr/bin/env python3
"""
Refresh YouTube Feeds

Loads youtube_subscriptions from Firestore, uses yt-dlp to fetch recent videos
from each channel/playlist URL, and upserts them into youtube_videos.

Run periodically (e.g. cron or Cloud Scheduler + Cloud Run). Requires yt-dlp on PATH.

Usage:
  python refresh_youtube_feeds.py [--max-videos-per-feed N] [--timeout SECONDS] [--yt-dlp-path PATH] [--verbose]
"""

import argparse
import json
import logging
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv

load_dotenv(".env.local")

from services.youtube_subscription_service import YouTubeSubscriptionService

logger = logging.getLogger(__name__)

DEFAULT_MAX_VIDEOS_PER_FEED = 5


def _parse_upload_date(upload_date: str | None) -> str:
    """Turn YYYYMMDD into ISO datetime string."""
    if not upload_date or len(upload_date) != 8:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        y, m, d = int(upload_date[:4]), int(upload_date[4:6]), int(upload_date[6:8])
        dt = datetime(y, m, d, tzinfo=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    except (ValueError, TypeError):
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch_feed_entries(
    url: str,
    yt_dlp_path: str,
    max_entries: int,
    timeout_seconds: int = 300,
    verbose: bool = False,
) -> list[dict]:
    """
    Run yt-dlp -j (full metadata, no --flat-playlist) to get video list with
    real upload_date. Returns list of {id, title, url, publishedAt}.
    Uses --playlist-end to limit work and avoid timeout on large channels.
    """
    cmd = [
        yt_dlp_path,
        "-j",
        "--no-download",
        "--no-warnings",
        "--playlist-end",
        str(max_entries),
        url,
    ]
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            cwd=os.getcwd(),
        )
    except subprocess.TimeoutExpired:
        logger.warning("yt-dlp timed out for %s (timeout=%ds)", url, timeout_seconds)
        return []
    except FileNotFoundError:
        logger.error("yt-dlp not found at %s", yt_dlp_path)
        return []

    if result.returncode != 0:
        logger.warning("yt-dlp failed for %s: %s", url, result.stderr or result.stdout)
        return []

    entries: list[dict] = []
    for line in result.stdout.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        vid = obj.get("id")
        if not vid or obj.get("_type") == "playlist":
            continue
        title = (obj.get("title") or "").strip() or "(No title)"
        video_url = obj.get("url") or f"https://www.youtube.com/watch?v={vid}"
        upload_date = obj.get("upload_date")
        if not upload_date and obj.get("timestamp") is not None:
            try:
                ts = int(obj["timestamp"])
                dt = datetime.fromtimestamp(ts, tz=timezone.utc)
                upload_date = dt.strftime("%Y%m%d")
            except (TypeError, ValueError, KeyError):
                pass
        published_at = _parse_upload_date(upload_date)
        entries.append({
            "id": vid,
            "title": title,
            "url": video_url,
            "publishedAt": published_at,
        })
        if len(entries) >= max_entries:
            break

    if verbose and entries:
        logger.info("Fetched %d entries from %s", len(entries), url)
    return entries


def refresh_one_subscription(
    subscription_id: str,
    *,
    max_videos_per_feed: int = DEFAULT_MAX_VIDEOS_PER_FEED,
    timeout_seconds: int = 300,
    yt_dlp_path: str = "yt-dlp",
    verbose: bool = False,
) -> dict:
    """
    Refresh a single subscription by ID: fetch recent videos via yt-dlp and upsert to Firestore.
    Returns {"ok": True, "subscriptionId": id, "upserted": N} or {"ok": False, "reason": "..."}.
    """
    service = YouTubeSubscriptionService()
    sub = service.get_subscription(subscription_id)
    if not sub:
        logger.warning("Subscription %s not found.", subscription_id)
        return {"ok": False, "reason": "not_found"}
    url = (sub.get("url") or "").strip()
    if not url:
        logger.warning("Subscription %s has no URL; skipping.", subscription_id)
        return {"ok": False, "reason": "no_url"}
    user_id = sub.get("userId")
    entries = fetch_feed_entries(
        url,
        yt_dlp_path,
        max_videos_per_feed,
        timeout_seconds=timeout_seconds,
        verbose=verbose,
    )
    upserted = 0
    for ent in entries:
        service.upsert_video(
            video_id=ent["id"],
            url=ent["url"],
            title=ent["title"],
            published_at=ent["publishedAt"],
            subscription_id=subscription_id,
            userId=user_id,
        )
        upserted += 1
    if verbose or upserted:
        logger.info("Refreshed subscription %s: %d video upserts.", subscription_id, upserted)
    return {"ok": True, "subscriptionId": subscription_id, "upserted": upserted}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Refresh YouTube feeds from subscriptions and write new videos to Firestore",
    )
    parser.add_argument(
        "--max-videos-per-feed",
        type=int,
        default=DEFAULT_MAX_VIDEOS_PER_FEED,
        help="Max videos to fetch per subscription (default: %(default)s)",
    )
    parser.add_argument(
        "--yt-dlp-path",
        default="yt-dlp",
        help="Path to yt-dlp binary (default: yt-dlp on PATH)",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=300,
        metavar="SECONDS",
        help="Timeout per subscription in seconds (default: 300)",
    )
    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Verbose logging",
    )
    args = parser.parse_args()

    if args.verbose:
        logging.basicConfig(level=logging.INFO, format="%(message)s")

    service = YouTubeSubscriptionService()
    subscriptions = service.list_subscriptions(userId=None)
    if not subscriptions:
        logger.info("No subscriptions found; nothing to refresh.")
        return

    total_upserted = 0
    for sub in subscriptions:
        sub_id = sub.get("id")
        url = (sub.get("url") or "").strip()
        user_id = sub.get("userId")
        if not url:
            logger.warning("Subscription %s has no URL; skipping.", sub_id)
            continue
        entries = fetch_feed_entries(
            url,
            args.yt_dlp_path,
            args.max_videos_per_feed,
            timeout_seconds=args.timeout,
            verbose=args.verbose,
        )
        for ent in entries:
            service.upsert_video(
                video_id=ent["id"],
                url=ent["url"],
                title=ent["title"],
                published_at=ent["publishedAt"],
                subscription_id=sub_id,
                userId=user_id,
            )
            total_upserted += 1

    if args.verbose or total_upserted:
        logger.info("Refresh complete: %d video upserts across %d subscriptions.", total_upserted, len(subscriptions))


if __name__ == "__main__":
    main()
