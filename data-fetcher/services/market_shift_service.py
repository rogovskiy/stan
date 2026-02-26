#!/usr/bin/env python3
"""
Market Shift Service

Saves market shifts (risks and tailwinds from financial news) to Firestore
at macro/us_market/market_shifts as a collection of shift documents.
"""

import re
from datetime import datetime
from typing import Any, Dict, List

from services.firebase_base_service import FirebaseBaseService


def _slug_from_headline(headline: str) -> str:
    """Generate a URL-safe slug from a headline."""
    s = headline.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[-\s]+", "-", s)
    return s[:80] if s else "shift"


class MarketShiftService(FirebaseBaseService):
    """Service for saving market shifts to Firestore."""

    MARKET_SHIFTS_PATH = ("macro", "us_market", "market_shifts")
    META_PATH = ("macro", "us_market", "market_shifts_meta")

    def _shifts_ref(self):
        return (
            self.db.collection(self.MARKET_SHIFTS_PATH[0])
            .document(self.MARKET_SHIFTS_PATH[1])
            .collection(self.MARKET_SHIFTS_PATH[2])
        )

    def _meta_ref(self):
        return (
            self.db.collection(self.META_PATH[0])
            .document(self.META_PATH[1])
            .collection(self.META_PATH[2])
        )

    def save_market_shifts(
        self,
        as_of: str,
        market_shifts: List[Dict[str, Any]],
        verbose: bool = True,
    ) -> None:
        """
        Replace all market shifts with a new snapshot for the given date.

        - Deletes all existing documents in macro/us_market/market_shifts
        - Writes each shift as a separate document with shiftId (slug from headline)
        - Writes metadata to macro/us_market/market_shifts_meta/latest

        Args:
            as_of: Date string YYYY-MM-DD
            market_shifts: List of shift dicts with type, category, headline, summary,
                          channelIds, status, articleRefs
            verbose: Log success message.
        """
        shifts_ref = self._shifts_ref()
        meta_ref = self._meta_ref()

        fetched_at = datetime.utcnow().isoformat() + "Z"

        # Delete all existing shift documents (batch delete in chunks of 500)
        deleted = 0
        while True:
            docs = shifts_ref.limit(500).stream()
            batch = self.db.batch()
            count = 0
            for doc in docs:
                batch.delete(doc.reference)
                count += 1
            if count == 0:
                break
            batch.commit()
            deleted += count

        if verbose and deleted > 0:
            print(f"  Deleted {deleted} existing market shift documents")

        # Generate unique shiftIds; on collision append suffix
        used_ids: set[str] = set()

        for shift in market_shifts:
            base_slug = _slug_from_headline(shift.get("headline", "unknown"))
            shift_id = base_slug
            suffix = 0
            while shift_id in used_ids:
                suffix += 1
                shift_id = f"{base_slug}-{suffix}"
            used_ids.add(shift_id)

            doc_data = {
                "type": shift.get("type", "RISK"),
                "category": shift.get("category", "OTHER"),
                "headline": shift.get("headline", ""),
                "summary": shift.get("summary", ""),
                "channelIds": shift.get("channelIds", []),
                "status": shift.get("status", "EMERGING"),
                "articleRefs": shift.get("articleRefs", []),
                "asOf": as_of,
                "fetchedAt": fetched_at,
            }

            shifts_ref.document(shift_id).set(doc_data)

        # Write metadata
        meta_doc = {
            "asOf": as_of,
            "fetchedAt": fetched_at,
            "count": len(market_shifts),
        }
        meta_ref.document("latest").set(meta_doc)

        if verbose:
            print(
                f"Saved {len(market_shifts)} market shifts for {as_of} to macro/us_market/market_shifts"
            )
