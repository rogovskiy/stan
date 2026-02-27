#!/usr/bin/env python3
"""
Market Shift Service

Saves market shifts (risks and tailwinds from financial news) to Firestore
at macro/us_market/market_shifts as a collection of shift documents.
"""

import re
from datetime import datetime, timezone
from typing import Any, Dict, List

from services.firebase_base_service import FirebaseBaseService

HALF_LIFE_DAYS = 7

# Boost applied to the momentum score each time a shift is detected.
# Status (from the LLM) acts only as a multiplier — not shown to users.
MOMENTUM_BOOST: Dict[str, float] = {
    "EMERGING": 5.0,
    "BUILDING": 8.0,
    "BREAKING": 12.0,
}


def slug_from_headline(headline: str) -> str:
    """Generate a URL-safe slug from a headline. Public for use by scanner."""
    s = headline.lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[-\s]+", "-", s)
    return s[:80] if s else "shift"


class MarketShiftService(FirebaseBaseService):
    """Service for saving market shifts to Firestore."""

    MARKET_SHIFTS_PATH = ("macro", "us_market", "market_shifts")
    META_PATH = ("macro", "us_market", "market_shifts_meta")
    RISK_SCORES_PATH = ("macro", "us_market", "risk_scores")
    SUMMARIES_PATH = ("macro", "us_market", "market_summaries")

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

    def get_existing_shift_ids_with_timeline(self) -> set[str]:
        """
        Return set of shift document IDs that already have a timeline.
        Used to skip deep analysis for shifts we already researched.
        """
        out: set[str] = set()
        for doc in self._shifts_ref().stream():
            data = doc.to_dict()
            if data and data.get("timeline") is not None:
                out.add(doc.id)
        return out

    def get_all_shifts(self) -> List[Dict[str, Any]]:
        """
        Return all market shift documents with full data.
        Each item is a dict with "id" (document id) plus all stored fields.
        Used by the merge step and tests.
        """
        out: List[Dict[str, Any]] = []
        for doc in self._shifts_ref().stream():
            data = doc.to_dict() or {}
            data["id"] = doc.id
            out.append(data)
        return out

    def save_market_shifts(
        self,
        as_of: str,
        market_shifts: List[Dict[str, Any]],
        verbose: bool = True,
    ) -> None:
        """
        Upsert market shifts by shiftId (slug from headline). Does not delete
        existing documents; merges so timeline from previous runs is preserved.
        Updates the decaying momentum score on each detection.

        - Writes each shift as a document with shiftId (slug from headline)
        - Writes metadata to macro/us_market/market_shifts_meta/latest
        - Shift dicts may include optional "timeline" and "analyzedAt" from deep analysis.

        Args:
            as_of: Date string YYYY-MM-DD
            market_shifts: List of shift dicts with type, category, headline, summary,
                          channelIds, status, articleRefs; optionally timeline, analyzedAt
            verbose: Log success message.
        """
        shifts_ref = self._shifts_ref()
        meta_ref = self._meta_ref()

        now = datetime.now(timezone.utc)
        fetched_at = now.isoformat().replace("+00:00", "Z")

        # Generate unique shiftIds; on collision append suffix
        used_ids: set[str] = set()

        for shift in market_shifts:
            base_slug = slug_from_headline(shift.get("headline", "unknown"))
            shift_id = base_slug
            suffix = 0
            while shift_id in used_ids:
                suffix += 1
                shift_id = f"{base_slug}-{suffix}"
            used_ids.add(shift_id)

            # Compute momentum score: decay existing score then apply boost
            status = shift.get("status", "EMERGING")
            boost = MOMENTUM_BOOST.get(status, MOMENTUM_BOOST["EMERGING"])

            existing_doc = shifts_ref.document(shift_id).get()
            if existing_doc.exists:
                existing = existing_doc.to_dict() or {}
                stored_score = float(existing.get("momentumScore", 0.0))
                updated_at_str = existing.get("momentumUpdatedAt")
                first_seen_at = existing.get("firstSeenAt", as_of)

                if updated_at_str:
                    try:
                        updated_at = datetime.fromisoformat(updated_at_str.replace("Z", "+00:00"))
                        days_elapsed = (now - updated_at).total_seconds() / 86400.0
                    except ValueError:
                        days_elapsed = 0.0
                else:
                    days_elapsed = 0.0

                decayed = stored_score * (0.5 ** (days_elapsed / HALF_LIFE_DAYS))
                momentum_score_prev = round(decayed, 4)
                momentum_score = round(decayed + boost, 4)
            else:
                first_seen_at = as_of
                momentum_score_prev = 0.0
                momentum_score = round(boost, 4)

            doc_data: Dict[str, Any] = {
                "type": shift.get("type", "RISK"),
                "category": shift.get("category", "OTHER"),
                "headline": shift.get("headline", ""),
                "summary": shift.get("summary", ""),
                "channelIds": shift.get("channelIds", []),
                "status": status,
                "articleRefs": shift.get("articleRefs", []),
                "asOf": as_of,
                "fetchedAt": fetched_at,
                "momentumScore": momentum_score,
                "momentumScorePrev": momentum_score_prev,
                "momentumUpdatedAt": fetched_at,
                "firstSeenAt": first_seen_at,
            }
            if shift.get("timeline") is not None:
                doc_data["timeline"] = shift["timeline"]
            if shift.get("analyzedAt") is not None:
                doc_data["analyzedAt"] = shift["analyzedAt"]

            shifts_ref.document(shift_id).set(doc_data, merge=True)

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

    def get_risk_scores_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Return the most recent dated risk score documents, sorted by date."""
        date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
        scores_ref = (
            self.db.collection(self.RISK_SCORES_PATH[0])
            .document(self.RISK_SCORES_PATH[1])
            .collection(self.RISK_SCORES_PATH[2])
        )
        rows: List[Dict[str, Any]] = []
        for doc in scores_ref.stream():
            if not date_pattern.match(doc.id):
                continue
            data = doc.to_dict() or {}
            rows.append({
                "asOf": data.get("asOf", doc.id),
                "globalScore": data.get("globalScore"),
                "channelScores": data.get("channelScores"),
            })
        rows.sort(key=lambda r: r["asOf"])
        return rows[-limit:]

    def save_market_summaries(
        self,
        as_of: str,
        summaries: Dict[str, Any],
        verbose: bool = True,
    ) -> None:
        """
        Save AI-generated market state summaries to Firestore.

        Writes to macro/us_market/market_summaries/latest.
        Each summary value is a dict with mood, moodDetail, drivers[].

        Args:
            as_of: Date string YYYY-MM-DD
            summaries: Dict with keys "yesterdayToday" and "lastWeek"
            verbose: Log success message.
        """
        summaries_ref = (
            self.db.collection(self.SUMMARIES_PATH[0])
            .document(self.SUMMARIES_PATH[1])
            .collection(self.SUMMARIES_PATH[2])
        )
        now = datetime.now(timezone.utc)
        doc_data = {
            "asOf": as_of,
            "fetchedAt": now.isoformat().replace("+00:00", "Z"),
            "yesterdayToday": summaries.get("yesterdayToday"),
            "lastWeek": summaries.get("lastWeek"),
        }
        summaries_ref.document("latest").set(doc_data)
        if verbose:
            print(f"Saved market summaries for {as_of} to macro/us_market/market_summaries")
