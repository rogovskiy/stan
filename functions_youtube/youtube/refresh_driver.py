"""
YouTube refresh driver: resolve URL to channel (YouTube Data API), fetch latest videos via Data API, upsert to Firestore.
Uses channels.list (contentDetails.relatedPlaylists.uploads) + playlistItems.list for recent uploads (stable, low quota).
Requires YOUTUBE_API_KEY env.
"""

import logging
import os
import re
from datetime import datetime, timezone
from typing import Optional

import requests

from youtube.youtube_subscription_service import YouTubeSubscriptionService

logger = logging.getLogger(__name__)

DEFAULT_MAX_VIDEOS_PER_FEED = 5


def resolve_handle_to_channel_id(handle: str, api_key: str) -> str:
    """Resolve @handle (or handle without @) to channel ID via YouTube Data API v3."""
    handle = (handle or "").strip()
    if not handle.startswith("@"):
        handle = f"@{handle}"
    url = "https://www.googleapis.com/youtube/v3/search"
    params = {
        "part": "snippet",
        "q": handle,
        "type": "channel",
        "maxResults": 1,
        "key": api_key,
    }
    r = requests.get(url, params=params, timeout=20)
    r.raise_for_status()
    data = r.json()
    if not data.get("items"):
        raise ValueError(f"Channel not found for handle: {handle}")
    return data["items"][0]["snippet"]["channelId"]


def _uploads_playlist_id(channel_id: str, api_key: str, timeout_seconds: int = 20) -> Optional[str]:
    """Get the channel's uploads playlist ID via channels.list (part=contentDetails). Cost: 1 unit."""
    url = "https://www.googleapis.com/youtube/v3/channels"
    params = {
        "part": "contentDetails",
        "id": channel_id,
        "key": api_key,
    }
    r = requests.get(url, params=params, timeout=timeout_seconds)
    r.raise_for_status()
    data = r.json()
    for item in data.get("items") or []:
        uploads = (item.get("contentDetails") or {}).get("relatedPlaylists", {}).get("uploads")
        if uploads:
            return uploads
    return None


def _latest_videos_from_playlist(
    playlist_id: str,
    api_key: str,
    max_results: int = 5,
    timeout_seconds: int = 20,
) -> list[dict]:
    """
    Fetch recent videos from an uploads playlist via playlistItems.list (part=snippet). Cost: 1 unit.
    Returns list of {id, title, url, publishedAt} in same shape as fetch_feed_entries_via_api.
    """
    url = "https://www.googleapis.com/youtube/v3/playlistItems"
    params = {
        "part": "snippet",
        "playlistId": playlist_id,
        "maxResults": max_results,
        "key": api_key,
    }
    r = requests.get(url, params=params, timeout=timeout_seconds)
    r.raise_for_status()
    data = r.json()
    entries = []
    for item in data.get("items") or []:
        snip = item.get("snippet") or {}
        vid = (snip.get("resourceId") or {}).get("videoId")
        if not vid:
            continue
        published = (snip.get("publishedAt") or "").strip()
        if not published:
            published = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        entries.append({
            "id": vid,
            "title": (snip.get("title") or "").strip() or "(No title)",
            "url": f"https://www.youtube.com/watch?v={vid}",
            "publishedAt": published,
        })
    return entries


def _live_stream_video_ids(video_ids: list[str], api_key: str, timeout_seconds: int = 20) -> set[str]:
    """Return set of video IDs that are live streams (current, upcoming, or past). Uses videos.list with part=liveStreamingDetails."""
    if not video_ids or not api_key:
        return set()
    live_ids: set[str] = set()
    for i in range(0, len(video_ids), 50):  # API allows max 50 IDs per request
        batch = video_ids[i : i + 50]
        url = "https://www.googleapis.com/youtube/v3/videos"
        params = {
            "part": "liveStreamingDetails",
            "id": ",".join(batch),
            "key": api_key,
        }
        r = requests.get(url, params=params, timeout=timeout_seconds)
        r.raise_for_status()
        data = r.json()
        for item in data.get("items", []):
            if "liveStreamingDetails" in item:
                live_ids.add(item["id"])
    return live_ids


def url_to_channel_id(url: str, api_key: str) -> Optional[str]:
    """
    Convert subscription URL to YouTube channel ID.
    Supports: raw channel ID (UC...), youtube.com/channel/UC..., @handle, youtube.com/@handle.
    """
    url = (url or "").strip()
    if not url:
        return None
    # Already a channel ID (starts with UC and looks like 24 chars)
    if re.match(r"^UC[\w-]{22}$", url):
        return url
    # youtube.com/channel/UCxxxx
    m = re.search(r"youtube\.com/channel/(UC[\w-]{22})", url, re.IGNORECASE)
    if m:
        return m.group(1)
    # @handle or youtube.com/@handle
    handle = None
    if url.startswith("@"):
        handle = url
    else:
        m = re.search(r"youtube\.com/@([\w.-]+)", url, re.IGNORECASE)
        if m:
            handle = f"@{m.group(1)}"
    if handle:
        return resolve_handle_to_channel_id(handle, api_key)
    # Treat whole URL as search query (e.g. channel name); try resolving as handle
    if "youtube.com" in url or "youtu.be" in url:
        return None
    return resolve_handle_to_channel_id(url if url.startswith("@") else f"@{url}", api_key)


def fetch_feed_entries_via_api(
    url: str,
    api_key: str,
    max_entries: int,
    timeout_seconds: int = 60,
    verbose: bool = False,
) -> list[dict]:
    """
    Resolve URL to channel ID (API if handle), fetch latest videos via YouTube Data API.
    Uses channels.list (contentDetails.relatedPlaylists.uploads) + playlistItems.list (low quota).
    Returns list of {id, title, url, publishedAt} compatible with upsert_video.
    """
    channel_id = url_to_channel_id(url, api_key)
    if not channel_id:
        logger.warning("Could not resolve channel ID for URL: %s", url)
        return []
    uploads_playlist_id = _uploads_playlist_id(channel_id, api_key, timeout_seconds=min(timeout_seconds, 25))
    if not uploads_playlist_id:
        logger.warning("No uploads playlist for channel %s", channel_id)
        return []
    entries = _latest_videos_from_playlist(
        uploads_playlist_id,
        api_key,
        max_results=max_entries,
        timeout_seconds=min(timeout_seconds, 25),
    )
    # Skip live streams: they rarely have stable transcripts during/right after broadcast
    if entries and api_key:
        live_ids = _live_stream_video_ids([e["id"] for e in entries], api_key, timeout_seconds=20)
        if live_ids:
            entries = [e for e in entries if e["id"] not in live_ids]
            if verbose:
                logger.info("Filtered out %d live stream(s): %s", len(live_ids), sorted(live_ids))
    if verbose and entries:
        logger.info("Fetched %d entries from %s (channel %s) via Data API", len(entries), url, channel_id)
    return entries


def refresh_one_subscription(
    subscription_id: str,
    *,
    max_videos_per_feed: int = DEFAULT_MAX_VIDEOS_PER_FEED,
    timeout_seconds: int = 60,
    verbose: bool = False,
    api_key: Optional[str] = None,
) -> dict:
    """
    Refresh a single subscription by ID: resolve URL to channel (API), fetch recent videos via Data API (channels.list + playlistItems.list), insert only new ones.
    Returns {"ok": True, "subscriptionId": id, "upserted": N} with N = count of newly inserted videos,
    or {"ok": False, "reason": "..."}.
    api_key: YouTube Data API key (default: YOUTUBE_API_KEY env).
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
    key = (api_key or os.environ.get("YOUTUBE_API_KEY") or "").strip()
    if not key:
        logger.warning("YOUTUBE_API_KEY not set; cannot resolve channel for %s.", url)
        return {"ok": False, "reason": "no_api_key"}
    user_id = sub.get("userId")
    entries = fetch_feed_entries_via_api(
        url,
        key,
        max_videos_per_feed,
        timeout_seconds=timeout_seconds,
        verbose=verbose,
    )
    new_count = 0
    for ent in entries:
        if service.get_video(ent["id"]) is not None:
            continue  # already in DB, skip
        service.upsert_video(
            video_id=ent["id"],
            url=ent["url"],
            title=ent["title"],
            published_at=ent["publishedAt"],
            subscription_id=subscription_id,
            userId=user_id,
        )
        new_count += 1

    logger.info(
        "Subscription %s processing complete: ok=True, upserted=%d, entries_fetched=%d",
        subscription_id, new_count, len(entries),
    )
    return {"ok": True, "subscriptionId": subscription_id, "upserted": new_count}
