#!/usr/bin/env python3
"""
Channels Config Service

Reads and writes macro risk channel configuration from Firestore
at macro/us_market/channels.
"""

from typing import Dict, Any, List
from services.firebase_base_service import FirebaseBaseService


class ChannelsConfigService(FirebaseBaseService):
    """Service for reading/writing channel config from Firestore."""

    CHANNELS_PATH = ("macro", "us_market", "channels")

    def _channels_ref(self):
        return (
            self.db.collection(self.CHANNELS_PATH[0])
            .document(self.CHANNELS_PATH[1])
            .collection(self.CHANNELS_PATH[2])
        )

    def get_all_channels(self) -> Dict[str, Dict[str, Any]]:
        """
        Read all channel documents from macro/us_market/channels.

        Returns:
            Dict mapping channel key (e.g. "EQUITIES_US") to its config:
            {
                "weight": float,
                "tickers": list[str],
                "reasonLabels": dict[str, str | None],
                "scoringType": str,
                "params": dict[str, Any],
            }
        """
        channels = {}
        for doc in self._channels_ref().stream():
            data = doc.to_dict()
            if data:
                channels[doc.id] = data
        return channels

    def save_channel(self, key: str, config: Dict[str, Any]) -> None:
        """Write a single channel document to macro/us_market/channels/{key}."""
        self._channels_ref().document(key).set(config)

    @staticmethod
    def derive_macro_tickers(channels: Dict[str, Dict[str, Any]]) -> List[str]:
        """Flatten all tickers fields into a deduplicated list."""
        seen = set()
        result = []
        for cfg in channels.values():
            for t in cfg.get("tickers", []):
                if t not in seen:
                    seen.add(t)
                    result.append(t)
        return result

    @staticmethod
    def extract_weights(channels: Dict[str, Dict[str, Any]]) -> Dict[str, float]:
        """Extract {channel_key: weight} from channel configs."""
        return {key: cfg["weight"] for key, cfg in channels.items() if "weight" in cfg}

    @staticmethod
    def extract_reason_labels(
        channels: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Dict[float, str]]:
        """
        Extract reason labels, converting string keys back to floats.

        Returns:
            {channel_key: {score_float: label_or_None}}
        """
        result = {}
        for key, cfg in channels.items():
            raw = cfg.get("reasonLabels", {})
            result[key] = {float(k): v for k, v in raw.items()}
        return result

    @staticmethod
    def extract_channel_configs(
        channels: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Dict[str, Any]]:
        """
        Extract per-channel scoring configs for the scoring engine.

        Returns:
            {channel_key: {"scoringType": str, "tickers": list, "params": dict}}
        """
        result = {}
        for key, cfg in channels.items():
            result[key] = {
                "scoringType": cfg.get("scoringType"),
                "tickers": cfg.get("tickers", []),
                "params": cfg.get("params", {}),
            }
        return result
