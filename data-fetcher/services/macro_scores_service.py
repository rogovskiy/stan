#!/usr/bin/env python3
"""
Macro Scores Service

Saves macro risk score payload to Firestore at macro/us_market/risk_scores.
"""

from datetime import datetime
from typing import Dict, Any
from services.firebase_base_service import FirebaseBaseService


class MacroScoresService(FirebaseBaseService):
    """Service for saving macro risk scores to Firestore."""

    RISK_SCORES_PATH = ("macro", "us_market", "risk_scores")

    def save_macro_scores(self, payload: Dict[str, Any], verbose: bool = True) -> None:
        """
        Save macro score payload to Firestore.

        Writes:
        - macro/us_market/risk_scores/{asOf} — dated document for history
        - macro/us_market/risk_scores/latest — same payload for portfolio read

        Args:
            payload: Dict with asOf, macroMode, globalScore, confidence,
                     transition, channelScores, reasons (camelCase as in API).
            verbose: Log success message.
        """
        as_of = payload.get("asOf")
        if not as_of:
            raise ValueError("payload must contain 'asOf' (YYYY-MM-DD)")

        doc_data = dict(payload)
        doc_data["last_updated"] = datetime.utcnow().isoformat() + "Z"

        risk_scores_ref = (
            self.db.collection(self.RISK_SCORES_PATH[0])
            .document(self.RISK_SCORES_PATH[1])
            .collection(self.RISK_SCORES_PATH[2])
        )

        risk_scores_ref.document(as_of).set(doc_data)
        risk_scores_ref.document("latest").set(doc_data)

        if verbose:
            print(f"Saved macro scores for {as_of} to macro/us_market/risk_scores")
