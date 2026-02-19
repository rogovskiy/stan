#!/usr/bin/env python3
"""
Portfolio Service

Reads portfolio data from Firestore and writes channel exposure results.
Portfolios at: /portfolios/{id}, positions and snapshots as subcollections.
"""

from typing import Dict, Any, List, Optional
from services.firebase_base_service import FirebaseBaseService


class PortfolioService(FirebaseBaseService):
    """Service for reading portfolios and writing channel exposures from Firestore."""

    def get_portfolio(self, portfolio_id: str) -> Optional[Dict[str, Any]]:
        """
        Load portfolio document with positions.

        Returns:
            Dict with id, name, description, cashBalance, bands, positions (list),
            or None if not found.
        """
        port_ref = self.db.collection("portfolios").document(portfolio_id)
        port_doc = port_ref.get()
        if not port_doc.exists:
            return None

        data = port_doc.to_dict()
        positions: List[Dict[str, Any]] = []
        for pos_doc in port_ref.collection("positions").stream():
            pos_data = pos_doc.to_dict()
            positions.append({
                "id": pos_doc.id,
                "ticker": pos_data.get("ticker", "").upper(),
                "quantity": pos_data.get("quantity", 0),
                "purchaseDate": pos_data.get("purchaseDate"),
                "purchasePrice": pos_data.get("purchasePrice"),
            })
        positions.sort(key=lambda p: p["ticker"])

        return {
            "id": port_doc.id,
            "name": data.get("name", ""),
            "description": data.get("description", ""),
            "cashBalance": data.get("cashBalance", 0),
            "bands": data.get("bands", []),
            "positions": positions,
        }

    def get_snapshots_up_to_date(
        self, portfolio_id: str, date_max: str
    ) -> List[Dict[str, Any]]:
        """
        Get snapshots with date <= date_max, sorted by date ascending.

        Returns:
            List of {date, cashBalance, positions: [{ticker, quantity, costBasis}]}
        """
        snap_ref = (
            self.db.collection("portfolios")
            .document(portfolio_id)
            .collection("snapshots")
        )
        query = snap_ref.where("date", "<=", date_max).order_by("date")
        results: List[Dict[str, Any]] = []
        for doc in query.stream():
            d = doc.to_dict()
            positions = [
                {
                    "ticker": p.get("ticker", ""),
                    "quantity": p.get("quantity", 0),
                    "costBasis": p.get("costBasis", 0),
                }
                for p in d.get("positions", [])
            ]
            results.append({
                "date": d.get("date", ""),
                "cashBalance": d.get("cashBalance", 0),
                "positions": positions,
            })
        return results

    def save_channel_exposures(
        self,
        portfolio_id: str,
        exposures: Dict[str, Dict[str, Any]],
        metadata: Dict[str, Any],
    ) -> None:
        """
        Write channelExposures to the portfolio document.

        Args:
            portfolio_id: Portfolio document ID
            exposures: {channel: {proxy, beta, rSquared}}
            metadata: {asOf, periodStart, tradingDays}
        """
        ref = self.db.collection("portfolios").document(portfolio_id)
        payload = {
            "channelExposures": {
                "asOf": metadata.get("asOf"),
                "periodStart": metadata.get("periodStart"),
                "tradingDays": metadata.get("tradingDays"),
                "channels": exposures,
            }
        }
        ref.update(payload)
