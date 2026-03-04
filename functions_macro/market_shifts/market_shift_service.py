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


def get_shift_channels(shift: Dict[str, Any]) -> List[str]:
    """Return ordered list of channels: primaryChannel + secondaryChannels, or channelIds for legacy."""
    primary = shift.get("primaryChannel")
    secondary = shift.get("secondaryChannels") or []
    if primary is not None or secondary:
        return ([primary] if primary else []) + list(secondary)
    return list(shift.get("channelIds") or [])


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

    def clear_market_shifts(self, verbose: bool = True) -> int:
        """Delete all shift documents and meta. Returns number of shift docs deleted."""
        shifts_ref = self._shifts_ref()
        deleted = 0
        for doc in shifts_ref.stream():
            doc.reference.delete()
            deleted += 1
            if verbose:
                print(f"  Deleted shift: {doc.id}")
        self._meta_ref().document("latest").delete()
        if verbose:
            print(f"Cleared {deleted} shift(s) and meta.")
        return deleted

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
                "primaryChannel": shift.get("primaryChannel"),
                "secondaryChannels": shift.get("secondaryChannels") or [],
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

    def migrate_shifts_to_primary_secondary(self, verbose: bool = True) -> int:
        """
        One-time migration: for each shift doc that has channelIds but no primaryChannel,
        set primaryChannel = channelIds[0], secondaryChannels = channelIds[1:], and update.
        Preserves existing data; makes schema uniform for clustering and UI.
        Returns number of docs updated.
        """
        shifts_ref = self._shifts_ref()
        updated = 0
        for doc in shifts_ref.stream():
            data = doc.to_dict() or {}
            if data.get("primaryChannel") is not None:
                continue
            channel_ids = data.get("channelIds")
            if not isinstance(channel_ids, list) or not channel_ids:
                continue
            channel_ids = [str(c).strip() for c in channel_ids if c]
            primary = channel_ids[0] if channel_ids else None
            secondary = channel_ids[1:] if len(channel_ids) > 1 else []
            shifts_ref.document(doc.id).set(
                {"primaryChannel": primary, "secondaryChannels": secondary},
                merge=True,
            )
            updated += 1
            if verbose:
                print(f"  Migrated {doc.id}: primaryChannel={primary}, secondaryChannels={secondary}")
        return updated
