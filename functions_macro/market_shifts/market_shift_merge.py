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

# Valid macro channels only (categories like SECTOR_STRUCTURAL must not split clusters)
VALID_CHANNELS = frozenset({
    "EQUITIES_US", "CREDIT", "VOL", "RATES_SHORT", "RATES_LONG",
    "USD", "OIL", "GOLD", "INFLATION", "GLOBAL_RISK",
})


def _primary_channel_for_cluster(shift: Dict[str, Any]) -> str:
    """
    Primary channel for clustering; invalid/category values (e.g. SECTOR_STRUCTURAL) are ignored.
    If primary is invalid, use first valid channel from secondaries so similar shifts still cluster.
    """
    primary = (shift.get("primaryChannel") or "").strip().upper()
    if primary in VALID_CHANNELS:
        return primary
    for c in (shift.get("secondaryChannels") or []) + list(shift.get("channelIds") or []):
        ch = (c or "").strip().upper()
        if ch in VALID_CHANNELS:
            return ch
    return ""


def _normalize_channels_for_cluster(channel_ids: List[str] | None) -> str:
    if not channel_ids:
        return ""
    return "|".join(sorted(str(c).strip() for c in channel_ids if c))


def cluster_shifts(shifts: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    """
    Cluster by type, category, and primary channel only.
    Using only primary (and ignoring secondaries) avoids splitting similar shifts when the model
    assigns slightly different secondary channels or leaks category names (e.g. SECTOR_STRUCTURAL)
    into channels. The merge LLM still sees full channel info and can set mergedPrimaryChannel
    and mergedSecondaryChannels.
    """
    clusters = {}
    for shift in shifts:
        typ = (shift.get("type") or "RISK").strip().upper()
        category = (shift.get("category") or "OTHER").strip().upper()
        primary_key = _primary_channel_for_cluster(shift)
        key = f"{typ}|{category}|{primary_key}"
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


def _compact_shift_for_prompt(shift: Dict[str, Any], include_timeline: bool = False) -> Dict[str, Any]:
    """Build a compact dict for one shift for the merge prompt."""
    out = {
        "id": shift.get("id"),
        "type": shift.get("type"),
        "category": shift.get("category"),
        "headline": shift.get("headline"),
        "summary": shift.get("summary"),
        "momentumScore": shift.get("momentumScore"),
        "firstSeenAt": shift.get("firstSeenAt"),
        "primaryChannel": shift.get("primaryChannel"),
        "secondaryChannels": shift.get("secondaryChannels") or [],
        "articleRefs": (shift.get("articleRefs") or [])[:5],
    }
    if include_timeline:
        timeline = shift.get("timeline")
        if timeline:
            out["timeline"] = {
                "canonicalDriver": timeline.get("canonicalDriver"),
                "canonicalDriverRationale": timeline.get("canonicalDriverRationale"),
                "firstSurfacedAt": timeline.get("firstSurfacedAt"),
                "majorDevelopments": (timeline.get("majorDevelopments") or [])[-10:],
            }
        canonical_driver = shift.get("canonicalDriver")
        if canonical_driver:
            out["canonicalDriver"] = canonical_driver
    return out


def build_merge_prompt(existing_shift: Dict[str, Any], incoming_shift: Dict[str, Any], template: str) -> str:
    """Build the merge prompt for one pairwise comparison (existing canonical vs incoming candidate)."""
    existing_compact = _compact_shift_for_prompt(existing_shift, include_timeline=True)
    incoming_compact = _compact_shift_for_prompt(incoming_shift, include_timeline=False)
    return template.replace(
        "{existing_market_shift_json}", json.dumps(existing_compact, indent=2)
    ).replace(
        "{incoming_market_shift_json}", json.dumps(incoming_compact, indent=2)
    )


def _usage_from_response(response) -> Dict[str, int]:
    u = getattr(response, "usage_metadata", None)
    if u is None:
        return {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    return {
        "prompt_tokens": getattr(u, "prompt_token_count", 0) or 0,
        "response_tokens": getattr(u, "candidates_token_count", 0) or 0,
        "total_tokens": getattr(u, "total_token_count", 0) or 0,
    }


def _apply_timeline_additions(
    timeline: Dict[str, Any],
    additions: Dict[str, Any] | None,
    canonical_driver: str | None,
) -> None:
    """Apply timelineAdditions from LLM response into the mutable timeline. Updates in place."""
    if not additions:
        return
    revised_first = additions.get("revisedFirstSurfacedAt")
    if revised_first:
        current = (timeline.get("firstSurfacedAt") or "").strip()
        if not current or (revised_first < current):
            timeline["firstSurfacedAt"] = revised_first
    revised_rationale = additions.get("revisedCanonicalDriverRationale")
    if revised_rationale:
        timeline["canonicalDriverRationale"] = revised_rationale
    new_devs = additions.get("newMajorDevelopments")
    if isinstance(new_devs, list) and new_devs:
        existing = timeline.get("majorDevelopments") or []
        merged = existing + [d for d in new_devs if isinstance(d, dict) and d.get("date") and d.get("description")]
        merged.sort(key=lambda x: (x.get("date") or ""))
        timeline["majorDevelopments"] = merged
    if canonical_driver:
        timeline["canonicalDriver"] = canonical_driver


def merge_cluster_via_llm(
    cluster: List[Dict[str, Any]],
    client: genai.Client,
    prompt_template: str,
    verbose: bool = False,
) -> tuple[Dict[str, Any] | None, Dict[str, int]]:
    if len(cluster) < 2:
        return None, {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    sorted_cluster = sorted(
        cluster,
        key=lambda s: (s.get("firstSeenAt") or "z", s.get("id") or ""),
    )
    canonical_src = sorted_cluster[0]
    candidates = sorted_cluster[1:]
    # Mutable copy of canonical with timeline we can update
    timeline = (canonical_src.get("timeline") or {}).copy()
    if not isinstance(timeline, dict):
        timeline = {}
    timeline = {
        "canonicalDriver": timeline.get("canonicalDriver") or canonical_src.get("headline") or "",
        "canonicalDriverRationale": timeline.get("canonicalDriverRationale") or "",
        "firstSurfacedAt": timeline.get("firstSurfacedAt") or (canonical_src.get("firstSeenAt") or "")[:10] or "",
        "majorDevelopments": list(timeline.get("majorDevelopments") or []),
    }
    canonical_shift = dict(canonical_src)
    canonical_shift["timeline"] = timeline
    canonical_shift["canonicalDriver"] = timeline["canonicalDriver"]
    duplicate_ids: List[str] = []
    model = os.getenv("GEMINI_MERGE_MODEL", get_gemini_model())
    temperature = float(os.getenv("GEMINI_TEMPERATURE", "0.1"))
    max_output_tokens = int(os.getenv("GEMINI_MAX_OUTPUT_TOKENS", "4096"))
    config = types.GenerateContentConfig(
        temperature=temperature,
        max_output_tokens=max_output_tokens,
    )
    total_usage = {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    if verbose:
        logger.info("  Merge LLM for cluster of %d shifts (pairwise)", len(cluster))
    for candidate in candidates:
        prompt = build_merge_prompt(canonical_shift, candidate, prompt_template)
        for attempt in range(2):
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=config,
                )
                usage = _usage_from_response(response)
                total_usage["prompt_tokens"] += usage.get("prompt_tokens", 0)
                total_usage["response_tokens"] += usage.get("response_tokens", 0)
                total_usage["total_tokens"] += usage.get("total_tokens", 0)
                if not response.text:
                    if attempt == 0 and verbose:
                        logger.info("  Merge LLM empty response, retrying once")
                        continue
                    logger.warning("Merge LLM returned empty response")
                    return None, total_usage
                json_str = _extract_json_from_response(response.text)
                data = json.loads(json_str)
                merge = data.get("merge") is True
                if not merge:
                    if verbose:
                        logger.info("  LLM chose not to merge candidate %s", candidate.get("id"))
                    return None, total_usage
                duplicate_ids.append(candidate["id"])
                if data.get("updateSummary") and data.get("revisedSummary"):
                    canonical_shift["summary"] = data["revisedSummary"]
                if data.get("updateCanonicalDriver") and data.get("revisedCanonicalDriver"):
                    revised = data["revisedCanonicalDriver"]
                    canonical_shift["canonicalDriver"] = revised
                    timeline["canonicalDriver"] = revised
                additions = data.get("timelineAdditions") if isinstance(data.get("timelineAdditions"), dict) else None
                _apply_timeline_additions(timeline, additions, canonical_shift.get("canonicalDriver"))
                break
            except (json.JSONDecodeError, KeyError, TypeError) as e:
                logger.warning("Merge LLM parse error: %s", e)
                if attempt == 0 and verbose:
                    logger.info("  Retrying merge LLM once")
                    continue
                return None, total_usage
        else:
            return None, total_usage
    # Build merge result for apply_merge
    all_article_refs = list(canonical_src.get("articleRefs") or [])
    for s in candidates:
        for ref in (s.get("articleRefs") or []):
            if ref and ref not in all_article_refs:
                all_article_refs.append(ref)
    merge_result = {
        "canonicalId": canonical_src["id"],
        "mergeIntoCanonical": duplicate_ids,
        "canonicalHeadline": canonical_shift.get("headline") or canonical_src.get("headline", ""),
        "canonicalSummary": canonical_shift.get("summary") or canonical_src.get("summary", ""),
        "mergedArticleRefs": all_article_refs,
        "timeline": timeline,
    }
    return merge_result, total_usage


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
    # Use accumulated timeline from pairwise merge when present; else keep existing behavior
    timeline = merge_result.get("timeline")
    if isinstance(timeline, dict) and (timeline.get("canonicalDriver") is not None or timeline.get("majorDevelopments")):
        # Ensure required timeline fields per schema
        timeline = {
            "canonicalDriver": timeline.get("canonicalDriver") or canonical_shift.get("headline") or "",
            "canonicalDriverRationale": timeline.get("canonicalDriverRationale") or "",
            "firstSurfacedAt": timeline.get("firstSurfacedAt") or "",
            "majorDevelopments": list(timeline.get("majorDevelopments") or []),
        }
    else:
        keep_timeline_id = merge_result.get("keepTimelineFrom") or canonical_id
        timeline_shift = id_to_shift.get(keep_timeline_id)
        timeline = (timeline_shift.get("timeline") if timeline_shift else None) or canonical_shift.get("timeline")
        if timeline and merge_result.get("revisedCanonicalDriver"):
            timeline = dict(timeline)
            timeline["canonicalDriver"] = merge_result["revisedCanonicalDriver"]
    keep_timeline_id = merge_result.get("keepTimelineFrom") or canonical_id
    timeline_shift = id_to_shift.get(keep_timeline_id)
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


def run_merge_step_in_memory(
    shifts: List[Dict[str, Any]],
    client: genai.Client,
    prompt_template: str,
    verbose: bool = False,
) -> tuple[List[tuple[str, List[Dict[str, Any]], Dict[str, Any]]], Dict[str, int]]:
    """
    Run merge clustering and LLM on a list of shifts in memory; no Firestore writes.
    Returns (list of (cluster_key, cluster, decision) for each cluster that merged, total_usage).
    """
    zero_usage = {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    if not shifts:
        return [], zero_usage
    clusters = cluster_shifts(shifts)
    multi_clusters = {k: v for k, v in clusters.items() if len(v) > 1}
    if verbose:
        logger.info(
            "Merge (in-memory): %d shifts -> %d clusters, %d with duplicates",
            len(shifts), len(clusters), len(multi_clusters),
        )
    decisions: List[tuple[str, List[Dict[str, Any]], Dict[str, Any]]] = []
    merge_usage = {"prompt_tokens": 0, "response_tokens": 0, "total_tokens": 0}
    for cluster_key, cluster in sorted(multi_clusters.items()):
        decision, u = merge_cluster_via_llm(cluster, client, prompt_template, verbose=verbose)
        merge_usage["prompt_tokens"] += u.get("prompt_tokens", 0)
        merge_usage["response_tokens"] += u.get("response_tokens", 0)
        merge_usage["total_tokens"] += u.get("total_tokens", 0)
        if decision is not None:
            decisions.append((cluster_key, cluster, decision))
    return decisions, merge_usage


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
