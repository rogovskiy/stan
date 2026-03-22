"""
Normalize LLM transcript summary output: markdown for display + structured theses for UI.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Tuple, Union

_TICKER_RE = re.compile(r"^[A-Z][A-Z0-9.\-]{0,14}$")


def _normalize_ticker(raw: Any) -> str | None:
    if raw is None:
        return None
    s = str(raw).strip().upper()
    if not s or s == "NULL":
        return None
    if _TICKER_RE.match(s):
        return s
    return None


def normalize_transcript_summary_result(
    result: Union[str, Dict[str, Any]],
) -> Tuple[str, List[Dict[str, Any]]]:
    """
    Returns (markdown_summary, theses_for_firestore).
    theses entries: {title, summary} plus optional ticker when present.
    """
    if isinstance(result, str):
        return result.strip(), []

    if not isinstance(result, dict):
        return json.dumps(result, indent=2), []

    theses_in = result.get("theses")
    if not isinstance(theses_in, list):
        return json.dumps(result, indent=2), []

    theses_out: List[Dict[str, Any]] = []
    md_lines: List[str] = []

    for item in theses_in:
        if not isinstance(item, dict):
            continue
        title = str(item.get("title") or "").strip()
        summary = str(item.get("summary") or "").strip()
        ticker = _normalize_ticker(item.get("ticker"))
        row: Dict[str, Any] = {"title": title, "summary": summary}
        if ticker:
            row["ticker"] = ticker
        theses_out.append(row)

        parts: List[str] = []
        if title:
            parts.append(f"**{title}**")
        if summary:
            parts.append(summary)
        if ticker:
            parts.append(f"*(Ticker: {ticker})*")
        if parts:
            md_lines.append("- " + " — ".join(parts))

    if not md_lines and not theses_out:
        return json.dumps(result, indent=2), []

    if not md_lines:
        return json.dumps(result, indent=2), theses_out

    return "\n".join(md_lines), theses_out
