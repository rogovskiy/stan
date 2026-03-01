#!/usr/bin/env python3
"""
Market Shift Service

Saves market shifts (risks and tailwinds from financial news) to Firestore
at macro/us_market/market_shifts as a collection of shift documents.
Uses shared vendor: services.firebase_base_service.
"""

import re
from datetime import datetime, timezone
from typing import Any, Dict, List

from services.firebase_base_service import FirebaseBaseService

HALF_LIFE_DAYS = 7
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

    def get_existing_shift_ids_with_timeline(self) -> set:
        out = set()
        for doc in self._shifts_ref().stream():
            data = doc.to_dict()
            if data and data.get("timeline") is not None:
                out.add(doc.id)
        return out

    def get_all_shifts(self) -> List[Dict[str, Any]]:
        out = []
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
        shifts_ref = self._shifts_ref()
        meta_ref = self._meta_ref()
        now = datetime.now(timezone.utc)
        fetched_at = now.isoformat().replace("+00:00", "Z")
        used_ids = set()
        for shift in market_shifts:
            base_slug = slug_from_headline(shift.get("headline", "unknown"))
            shift_id = base_slug
            suffix = 0
            while shift_id in used_ids:
                suffix += 1
                shift_id = f"{base_slug}-{suffix}"
            used_ids.add(shift_id)
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
                momentum_score = round(decayed + boost, 4)
            else:
                first_seen_at = as_of
                momentum_score = round(boost, 4)
            doc_data = {
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
                "momentumScorePrev": momentum_score,
                "momentumUpdatedAt": fetched_at,
                "firstSeenAt": first_seen_at,
            }
            if shift.get("timeline") is not None:
                doc_data["timeline"] = shift["timeline"]
            if shift.get("analyzedAt") is not None:
                doc_data["analyzedAt"] = shift["analyzedAt"]
            shifts_ref.document(shift_id).set(doc_data, merge=True)
        meta_ref.document("latest").set({
            "asOf": as_of,
            "fetchedAt": fetched_at,
            "count": len(market_shifts),
        })
        if verbose:
            print(f"Saved {len(market_shifts)} market shifts for {as_of} to macro/us_market/market_shifts")

    def get_risk_scores_history(self, limit: int = 10) -> List[Dict[str, Any]]:
        date_pattern = re.compile(r"^\d{4}-\d{2}-\d{2}$")
        scores_ref = (
            self.db.collection(self.RISK_SCORES_PATH[0])
            .document(self.RISK_SCORES_PATH[1])
            .collection(self.RISK_SCORES_PATH[2])
        )
        rows = []
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
