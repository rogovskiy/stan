#!/usr/bin/env python3
"""
Market Shift Merge

Deterministic clustering and LLM-based merge of duplicate market shifts.
Used by the scan_market_shifts pipeline and runnable independently via --merge-only.
"""

import json
import logging
import os
import re
from pathlib import Path
from typing import Any, Dict, List

from google import genai
from google.genai import types

from extraction_utils import get_gemini_model
from services.market_shift_service import MarketShiftService

logger = logging.getLogger(__name__)


def _normalize_channels_for_cluster(channel_ids: List[str] | None) -> str:
    """
    Deterministic key for channelIds (enum list): sorted, pipe-joined.
    Same set of channels in any order yields the same key.
    """
    if not channel_ids:
        return ""
    return "|".join(sorted(str(c).strip() for c in channel_ids if c))


def cluster_shifts(shifts: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Group shifts by enum attributes only: type|category|channels.
    Headline is not part of the key (wording can differ for the same driver).
    The LLM compares headlines within each cluster and merges true duplicates.
    Returns map cluster_key -> [shift, ...]. Clusters of size 1 need no merge.
    """
    clusters: Dict[str, List[Dict[str, Any]]] = {}
    for shift in shifts:
        typ = (shift.get("type") or "RISK").strip().upper()
        category = (shift.get("category") or "OTHER").strip().upper()
        channels_key = _normalize_channels_for_cluster(shift.get("channelIds"))
        key = f"{typ}|{category}|{channels_key}"
        clusters.setdefault(key, []).append(shift)
    return clusters


def _extract_json_from_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks, stray text, truncation)."""
    if not response_text:
        return ""
    text = response_text.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()
    # Isolate a single JSON object; if truncated (no closing brace), try to repair
    start = text.find("{")
    if start >= 0:
        depth = 0
        in_string = False
        escape = False
        quote = '"'
        for i in range(start, len(text)):
            c = text[i]
            if escape:
                escape = False
                continue
            if c == "\\" and in_string:
                escape = True
                continue
            if in_string:
                if c == quote:
                    in_string = False
                continue
            if c == '"' or c == "'":
                in_string = True
                quote = c
                continue
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    return text[start : i + 1]
        # Truncated: close open string (if any) and braces so parser can succeed
        if depth > 0:
            repaired = text[start:].rstrip()
            if in_string:
                repaired += quote
            repaired += "}" * depth
            return repaired
    return text


def load_merge_prompt_template() -> str:
    """Load the market shift merge prompt template (expects {shifts_json})."""
    # Resolve prompts dir relative to data-fetcher (parent of services)
    base = Path(__file__).resolve().parent.parent
    prompt_path = base / "prompts" / "market_shift_merge_prompt.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def build_merge_prompt(cluster: List[Dict[str, Any]], template: str) -> str:
    """Fill the merge prompt template with the cluster's shift data."""
    # Emit id, headline, summary, type, category, momentumScore, firstSeenAt for each
    compact = [
        {
            "id": s.get("id"),
            "type": s.get("type"),
            "category": s.get("category"),
            "headline": s.get("headline"),
            "summary": s.get("summary"),
            "momentumScore": s.get("momentumScore"),
            "firstSeenAt": s.get("firstSeenAt"),
            "channelIds": s.get("channelIds"),
            "articleRefs": (s.get("articleRefs") or [])[:3],
        }
        for s in cluster
    ]
    return template.replace("{shifts_json}", json.dumps(compact, indent=2))


def merge_cluster_via_llm(
    cluster: List[Dict[str, Any]],
    client: genai.Client,
    prompt_template: str,
    verbose: bool = False,
) -> Dict[str, Any] | None:
    """
    Call Gemini to decide how to merge the cluster. Returns parsed merge decision dict
    (with noMerge, canonicalId, etc.) or None on parse/API failure.
    """
    prompt = build_merge_prompt(cluster, prompt_template)
    model = os.getenv("GEMINI_MERGE_MODEL", get_gemini_model())
    temperature = float(os.getenv("GEMINI_TEMPERATURE", "0.1"))
    max_output_tokens = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "4096"))
    config = types.GenerateContentConfig(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )
    if verbose:
        logger.info("  Merge LLM for cluster of %d shifts", len(cluster))
    for attempt in range(2):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            if not response.text:
                if attempt == 0:
                    if verbose:
                        logger.info("  Merge LLM empty response, retrying once")
                    continue
                logger.warning("Merge LLM returned empty response")
                return None
            json_str = _extract_json_from_response(response.text)
            data = json.loads(json_str)
            if data.get("noMerge") is True:
                if verbose:
                    logger.info("  LLM chose noMerge for this cluster")
                return None  # No merge to apply
            if not data.get("canonicalId") or not isinstance(data.get("mergeIntoCanonical"), list):
                logger.warning("Merge LLM response missing canonicalId or mergeIntoCanonical")
                return None
            return data
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            raw_snippet = (response.text or "")[:400] if response.text else ""
            if verbose and raw_snippet:
                logger.warning("Merge LLM parse error: %s. Raw snippet: %s", e, raw_snippet)
            else:
                logger.warning("Merge LLM parse error: %s", e)
            if attempt == 0:
                if verbose:
                    logger.info("  Retrying merge LLM once")
                continue
            return None
    return None


def apply_merge(
    svc: MarketShiftService,
    merge_result: Dict[str, Any],
    cluster: List[Dict[str, Any]],
    as_of: str,
    verbose: bool = False,
) -> None:
    """
    Apply a merge decision: update the canonical document and delete duplicates.
    merge_result must have canonicalId, canonicalHeadline, canonicalSummary,
    mergeIntoCanonical, mergedArticleRefs, mergedChannelIds, keepTimelineFrom.
    """
    canonical_id = merge_result["canonicalId"]
    duplicate_ids = list(merge_result.get("mergeIntoCanonical") or [])
    id_to_shift = {s["id"]: s for s in cluster}

    canonical_shift = id_to_shift.get(canonical_id)
    if not canonical_shift:
        logger.warning("Canonical id %s not in cluster, skipping apply", canonical_id)
        return

    # Momentum: max of cluster; firstSeenAt: min
    momentum_score = max(float(s.get("momentumScore", 0) or 0) for s in cluster)
    first_seen_dates = [s.get("firstSeenAt") for s in cluster if s.get("firstSeenAt")]
    first_seen_at = min(first_seen_dates) if first_seen_dates else canonical_shift.get("firstSeenAt", as_of)

    # Timeline: from keepTimelineFrom if present
    keep_timeline_id = merge_result.get("keepTimelineFrom") or canonical_id
    timeline_shift = id_to_shift.get(keep_timeline_id)
    timeline = (timeline_shift.get("timeline") if timeline_shift else None) or canonical_shift.get("timeline")
    analyzed_at = (timeline_shift.get("analyzedAt") if timeline_shift else None) or canonical_shift.get("analyzedAt")

    merged_article_refs = merge_result.get("mergedArticleRefs")
    if not isinstance(merged_article_refs, list):
        merged_article_refs = canonical_shift.get("articleRefs") or []
    merged_channel_ids = merge_result.get("mergedChannelIds")
    if not isinstance(merged_channel_ids, list):
        merged_channel_ids = canonical_shift.get("channelIds") or []

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    fetched_at = now.isoformat().replace("+00:00", "Z")

    doc_data: Dict[str, Any] = {
        "type": canonical_shift.get("type", "RISK"),
        "category": canonical_shift.get("category", "OTHER"),
        "headline": merge_result.get("canonicalHeadline") or canonical_shift.get("headline", ""),
        "summary": merge_result.get("canonicalSummary") or canonical_shift.get("summary", ""),
        "channelIds": merged_channel_ids,
        "status": canonical_shift.get("status", "EMERGING"),
        "articleRefs": merged_article_refs,
        "asOf": as_of,
        "fetchedAt": fetched_at,
        "momentumScore": round(momentum_score, 4),
        "momentumScorePrev": round(momentum_score, 4),
        "momentumUpdatedAt": fetched_at,
        "firstSeenAt": first_seen_at,
    }
    if timeline is not None:
        doc_data["timeline"] = timeline
    if analyzed_at is not None:
        doc_data["analyzedAt"] = analyzed_at

    shifts_ref = svc._shifts_ref()
    shifts_ref.document(canonical_id).set(doc_data, merge=True)
    for doc_id in duplicate_ids:
        if doc_id != canonical_id:
            shifts_ref.document(doc_id).delete()
            if verbose:
                logger.info("  Deleted duplicate shift doc: %s", doc_id)


def run_merge_step(
    svc: MarketShiftService,
    as_of: str,
    client: genai.Client,
    verbose: bool = False,
    dry_run: bool = False,
) -> bool:
    """
    Load all shifts from Firestore, cluster them, run merge LLM on each cluster
    with more than one shift, and apply merges. Returns True if at least one
    merge was applied (so caller can regenerate summaries).
    """
    shifts = svc.get_all_shifts()
    if not shifts:
        if verbose:
            logger.info("No shifts to merge")
        return False

    template = load_merge_prompt_template()
    clusters = cluster_shifts(shifts)
    multi_clusters = {k: v for k, v in clusters.items() if len(v) > 1}

    if verbose:
        logger.info(
            "Merge step: %d shifts -> %d clusters, %d with duplicates",
            len(shifts),
            len(clusters),
            len(multi_clusters),
        )
        for key, group in multi_clusters.items():
            logger.info("  Cluster %r: %d shifts (ids: %s)", key[:60], len(group), [s.get("id") for s in group])

    if not multi_clusters:
        if verbose:
            logger.info("No clusters with duplicates to merge")
        return False

    merges_applied = 0
    for cluster_key, cluster in multi_clusters.items():
        decision = merge_cluster_via_llm(cluster, client, template, verbose=verbose)
        if decision and not dry_run:
            apply_merge(svc, decision, cluster, as_of, verbose=verbose)
            merges_applied += 1
        elif decision and dry_run and verbose:
            logger.info("[DRY RUN] Would merge cluster (canonical=%s)", decision.get("canonicalId"))

    return merges_applied > 0
