#!/usr/bin/env python3
"""
Market Shift Merge

Deterministic clustering and LLM-based merge of duplicate market shifts.
Uses shared vendor: extraction_utils. Prompts from functions_macro/prompts.
"""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List

from google import genai
from google.genai import types

from extraction_utils import get_gemini_model
from market_shifts.market_shift_service import MarketShiftService, get_shift_channels

logger = logging.getLogger(__name__)


def _normalize_channels_for_cluster(channel_ids: List[str] | None) -> str:
    if not channel_ids:
        return ""
    return "|".join(sorted(str(c).strip() for c in channel_ids if c))


def cluster_shifts(shifts: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    clusters = {}
    for shift in shifts:
        typ = (shift.get("type") or "RISK").strip().upper()
        category = (shift.get("category") or "OTHER").strip().upper()
        channels_key = _normalize_channels_for_cluster(get_shift_channels(shift))
        key = f"{typ}|{category}|{channels_key}"
        clusters.setdefault(key, []).append(shift)
    return clusters


def _extract_json_from_response(response_text: str) -> str:
    if not response_text:
        return ""
    text = response_text.strip()
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()
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
        if depth > 0:
            repaired = text[start:].rstrip()
            if in_string:
                repaired += quote
            repaired += "}" * depth
            return repaired
    return ""


def load_merge_prompt_template() -> str:
    """Load the market shift merge prompt template. Prompts live in functions_macro/prompts."""
    base = Path(__file__).resolve().parent.parent
    prompt_path = base / "prompts" / "market_shift_merge_prompt.txt"
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8")


def build_merge_prompt(cluster: List[Dict[str, Any]], template: str) -> str:
    compact = [
        {
            "id": s.get("id"),
            "type": s.get("type"),
            "category": s.get("category"),
            "headline": s.get("headline"),
            "summary": s.get("summary"),
            "momentumScore": s.get("momentumScore"),
            "firstSeenAt": s.get("firstSeenAt"),
            "primaryChannel": s.get("primaryChannel"),
            "secondaryChannels": s.get("secondaryChannels") or [],
            "articleRefs": (s.get("articleRefs") or [])[:3],
        }
        for s in cluster
    ]
    return template.replace("{shifts_json}", json.dumps(compact, indent=2))


def _usage_from_response(response) -> Dict[str, int]:
    u = getattr(response, "usage_metadata", None)
    if u is None:
        return {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    return {
        "prompt_tokens": getattr(u, "prompt_token_count", 0) or 0,
        "response_tokens": getattr(u, "candidates_token_count", 0) or 0,
        "total_tokens": getattr(u, "total_token_count", 0) or 0,
    }


def merge_cluster_via_llm(
    cluster: List[Dict[str, Any]],
    client: genai.Client,
    prompt_template: str,
    verbose: bool = False,
) -> tuple[Dict[str, Any] | None, Dict[str, int]]:
    prompt = build_merge_prompt(cluster, prompt_template)
    model = os.getenv("GEMINI_MERGE_MODEL", get_gemini_model())
    temperature = float(os.getenv("GEMINI_TEMPERATURE", "0.1"))
    max_output_tokens = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "4096"))
    config = types.GenerateContentConfig(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )
    zero_usage = {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    if verbose:
        logger.info("  Merge LLM for cluster of %d shifts", len(cluster))
    for attempt in range(2):
        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=config,
            )
            usage = _usage_from_response(response)
            if not response.text:
                if attempt == 0 and verbose:
                    logger.info("  Merge LLM empty response, retrying once")
                    continue
                logger.warning("Merge LLM returned empty response")
                return None, usage
            json_str = _extract_json_from_response(response.text)
            data = json.loads(json_str)
            if data.get("noMerge") is True:
                if verbose:
                    logger.info("  LLM chose noMerge for this cluster")
                return None, usage
            if not data.get("canonicalId") or not isinstance(data.get("mergeIntoCanonical"), list):
                logger.warning("Merge LLM response missing canonicalId or mergeIntoCanonical")
                return None, usage
            return data, usage
        except (json.JSONDecodeError, KeyError, TypeError) as e:
            logger.warning("Merge LLM parse error: %s", e)
            if attempt == 0 and verbose:
                logger.info("  Retrying merge LLM once")
                continue
            return None, zero_usage
    return None, zero_usage


def apply_merge(
    svc: MarketShiftService,
    merge_result: Dict[str, Any],
    cluster: List[Dict[str, Any]],
    as_of: str,
    verbose: bool = False,
) -> None:
    from datetime import datetime, timezone
    canonical_id = merge_result["canonicalId"]
    duplicate_ids = list(merge_result.get("mergeIntoCanonical") or [])
    id_to_shift = {s["id"]: s for s in cluster}
    canonical_shift = id_to_shift.get(canonical_id)
    if not canonical_shift:
        logger.warning("Canonical id %s not in cluster, skipping apply", canonical_id)
        return
    momentum_score = max(float(s.get("momentumScore", 0) or 0) for s in cluster)
    first_seen_dates = [s.get("firstSeenAt") for s in cluster if s.get("firstSeenAt")]
    first_seen_at = min(first_seen_dates) if first_seen_dates else canonical_shift.get("firstSeenAt", as_of)
    keep_timeline_id = merge_result.get("keepTimelineFrom") or canonical_id
    timeline_shift = id_to_shift.get(keep_timeline_id)
    timeline = (timeline_shift.get("timeline") if timeline_shift else None) or canonical_shift.get("timeline")
    analyzed_at = (timeline_shift.get("analyzedAt") if timeline_shift else None) or canonical_shift.get("analyzedAt")
    merged_article_refs = merge_result.get("mergedArticleRefs")
    if not isinstance(merged_article_refs, list):
        merged_article_refs = canonical_shift.get("articleRefs") or []
    merged_primary = merge_result.get("mergedPrimaryChannel")
    merged_secondary = merge_result.get("mergedSecondaryChannels")
    if not isinstance(merged_secondary, list):
        merged_secondary = canonical_shift.get("secondaryChannels") or []
    if merged_primary is None:
        merged_channels = merge_result.get("mergedChannelIds") or get_shift_channels(canonical_shift)
        merged_primary = merged_channels[0] if merged_channels else None
        merged_secondary = merged_channels[1:] if len(merged_channels) > 1 else []
    now = datetime.now(timezone.utc)
    fetched_at = now.isoformat().replace("+00:00", "Z")
    doc_data = {
        "type": canonical_shift.get("type", "RISK"),
        "category": canonical_shift.get("category", "OTHER"),
        "headline": merge_result.get("canonicalHeadline") or canonical_shift.get("headline", ""),
        "summary": merge_result.get("canonicalSummary") or canonical_shift.get("summary", ""),
        "primaryChannel": merged_primary,
        "secondaryChannels": list(merged_secondary) if merged_secondary else [],
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
) -> tuple[bool, int, Dict[str, int]]:
    zero_usage = {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    shifts = svc.get_all_shifts()
    if not shifts:
        if verbose:
            logger.info("No shifts to merge")
        return False, 0, zero_usage
    template = load_merge_prompt_template()
    clusters = cluster_shifts(shifts)
    multi_clusters = {k: v for k, v in clusters.items() if len(v) > 1}
    if verbose:
        logger.info(
            "Merge step: %d shifts -> %d clusters, %d with duplicates",
            len(shifts), len(clusters), len(multi_clusters),
        )
    if not multi_clusters:
        if verbose:
            logger.info("No clusters with duplicates to merge")
        return False, 0, zero_usage
    merges_applied = 0
    merge_usage = {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    for cluster_key, cluster in multi_clusters.items():
        decision, u = merge_cluster_via_llm(cluster, client, template, verbose=verbose)
        merge_usage["prompt_tokens"] += u.get("prompt_tokens", 0)
        merge_usage["response_tokens"] += u.get("response_tokens", 0)
        merge_usage["total_tokens"] += u.get("total_tokens", 0)
        if decision and not dry_run:
            apply_merge(svc, decision, cluster, as_of, verbose=verbose)
            merges_applied += 1
        elif decision and dry_run and verbose:
            logger.info("[DRY RUN] Would merge cluster (canonical=%s)", decision.get("canonicalId"))
    return merges_applied > 0, merges_applied, merge_usage
