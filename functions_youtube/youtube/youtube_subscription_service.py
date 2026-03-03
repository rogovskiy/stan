#!/usr/bin/env python3
"""
YouTube Subscription Service

Manages YouTube subscriptions and discovered videos in Firestore.
Collections: youtube_subscriptions, youtube_videos.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from firebase_admin import firestore

from services.firebase_base_service import FirebaseBaseService


class YouTubeSubscriptionService(FirebaseBaseService):
    """Service for YouTube subscriptions and videos in Firestore."""

    SUBS_COLLECTION = "youtube_subscriptions"
    VIDEOS_COLLECTION = "youtube_videos"

    def _subs_ref(self):
        return self.db.collection(self.SUBS_COLLECTION)

    def _videos_ref(self):
        return self.db.collection(self.VIDEOS_COLLECTION)

    def list_subscriptions(self, userId: Optional[str] = None) -> List[Dict[str, Any]]:
        """List all subscriptions, optionally filtered by userId."""
        ref = self._subs_ref()
        if userId is not None:
            query = ref.where("userId", "==", userId).order_by("createdAt", direction=firestore.Query.DESCENDING)
        else:
            query = ref.order_by("createdAt", direction=firestore.Query.DESCENDING)
        out: List[Dict[str, Any]] = []
        for doc in query.stream():
            data = doc.to_dict() or {}
            data["id"] = doc.id
            out.append(data)
        return out

    def add_subscription(
        self,
        url: str,
        label: Optional[str] = None,
        userId: Optional[str] = None,
    ) -> str:
        """Add a subscription. Returns the new document ID."""
        now = datetime.now(timezone.utc)
        created_at = now.isoformat().replace("+00:00", "Z")
        doc_data: Dict[str, Any] = {
            "url": url.strip(),
            "label": label or None,
            "userId": userId,
            "createdAt": created_at,
        }
        ref = self._subs_ref().document()
        ref.set(doc_data)
        return ref.id

    def delete_subscription(self, subscription_id: str) -> None:
        """Remove a subscription by ID."""
        self._subs_ref().document(subscription_id).delete()

    def get_subscription(self, subscription_id: str) -> Optional[Dict[str, Any]]:
        """Get a single subscription by ID. Returns dict with id, url, userId if exists, else None."""
        doc_ref = self._subs_ref().document(subscription_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        data["id"] = doc.id
        return data

    def get_video(self, video_id: str) -> Optional[Dict[str, Any]]:
        """Return the video document if it exists, else None. Document ID is video_id."""
        ref = self._videos_ref().document(video_id)
        doc = ref.get()
        if not doc.exists:
            return None
        data = doc.to_dict() or {}
        data["id"] = doc.id
        return data

    def list_videos(
        self,
        userId: Optional[str] = None,
        limit: int = 500,
    ) -> List[Dict[str, Any]]:
        """
        List videos ordered by publishedAt desc.
        When userId is None, no userId filter is applied (all videos).
        """
        ref = self._videos_ref()
        if userId is not None:
            query = (
                ref.where("userId", "==", userId)
                .order_by("publishedAt", direction=firestore.Query.DESCENDING)
                .limit(limit)
            )
        else:
            query = ref.order_by("publishedAt", direction=firestore.Query.DESCENDING).limit(limit)
        out: List[Dict[str, Any]] = []
        for doc in query.stream():
            data = doc.to_dict() or {}
            data["id"] = doc.id
            out.append(data)
        return out

    def upsert_video(
        self,
        video_id: str,
        url: str,
        title: str,
        published_at: str,
        subscription_id: str,
        userId: Optional[str] = None,
    ) -> None:
        """
        Insert or overwrite a video document by videoId.
        createdAt is set only on first write.
        Transcript fields (transcriptStorageRef, transcriptUpdatedAt, transcriptSummary) are
        preserved on update and not overwritten.
        """
        ref = self._videos_ref().document(video_id)
        existing = ref.get()
        now = datetime.now(timezone.utc)
        created_at = now.isoformat().replace("+00:00", "Z")
        doc_data: Dict[str, Any] = {
            "videoId": video_id,
            "url": url,
            "title": title,
            "publishedAt": published_at,
            "subscriptionId": subscription_id,
            "userId": userId,
        }
        if existing.exists:
            existing_data = existing.to_dict() or {}
            doc_data["createdAt"] = existing_data.get("createdAt") or created_at
            # Preserve transcript fields on update
            for key in ("transcriptStorageRef", "transcriptUpdatedAt", "transcriptSummary", "transcriptSummaryUpdatedAt"):
                if key in existing_data and existing_data[key] is not None:
                    doc_data[key] = existing_data[key]
        else:
            doc_data["createdAt"] = created_at
        ref.set(doc_data)

    def update_video_transcript(self, video_id: str, storage_ref: str) -> None:
        """
        Update a video document with transcript storage ref and timestamp.
        Used by the local transcript script after uploading to Storage.
        """
        ref = self._videos_ref().document(video_id)
        now = datetime.now(timezone.utc)
        transcript_updated_at = now.isoformat().replace("+00:00", "Z")
        ref.update({
            "transcriptStorageRef": storage_ref,
            "transcriptUpdatedAt": transcript_updated_at,
        })
