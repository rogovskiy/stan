#!/usr/bin/env python3
"""
Grounded position thesis evaluation.

Runs a two-step prompt pipeline:
1. grounded markdown report
2. markdown -> structured JSON

Persists the latest evaluation to:
  position_theses/{thesisDocId}/evaluations/latest
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

_pkg = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_pkg, "vendor")
for _p in (_vendor, _pkg):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from dynamic_prompt_runner import run_llm_with_prompt_name
from services.firebase_base_service import FirebaseBaseService
from services.prompt_config_service import PromptConfigService

logger = logging.getLogger(__name__)

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_SKIPPED = 2

PROMPT_POSITION_THESIS_EVALUATION_REPORT = "position_thesis_evaluation_report"
PROMPT_POSITION_THESIS_EVALUATION_STRUCTURIZE = "position_thesis_evaluation_structurize"


def _field_filled(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def _assumption_filled(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    text = value.strip()
    if not text:
        return False
    parts = (
        text.replace("%", "")
        .replace("to", "–")
        .replace("-", "–")
        .split("–")
    )
    return any(part.strip() for part in parts)


def _parse_thesis_payload(data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    payload = data.get("payload")
    if not isinstance(payload, dict):
        return None
    return payload


def _completeness_block_reason(payload: Dict[str, Any]) -> Optional[str]:
    required_sections = []
    basics_ok = (
        (3 if _field_filled(payload.get("ticker")) else 0)
        + (2 if _field_filled(payload.get("positionRole")) else 0)
        + (1 if _field_filled(payload.get("holdingHorizon")) else 0)
    ) / 6.0
    if not _field_filled(payload.get("ticker")) or basics_ok < 0.38:
        required_sections.append("Position & horizon")
    thesis_ok = (
        (4 if _field_filled(payload.get("thesisStatement")) else 0)
        + (2 if _field_filled(payload.get("portfolioRole")) else 0)
        + (2 if _field_filled(payload.get("regimeDesignedFor")) else 0)
        + (1 if _field_filled(payload.get("riskPosture")) else 0)
    ) / 9.0
    if not _field_filled(payload.get("thesisStatement")) or thesis_ok < 0.38:
        required_sections.append("Thesis statement")
    returns_ok = (
        (1 if _field_filled(payload.get("entryPrice")) else 0)
        + (2 if _assumption_filled(payload.get("baseDividendAssumption")) else 0)
        + (2 if _assumption_filled(payload.get("baseGrowthAssumption")) else 0)
        + (2 if _assumption_filled(payload.get("baseMultipleAssumption")) else 0)
        + (1 if _field_filled(payload.get("upsideScenario")) else 0)
        + (2 if _field_filled(payload.get("baseScenario")) else 0)
        + (1 if _field_filled(payload.get("downsideScenario")) else 0)
    ) / 11.0
    if returns_ok < 0.38:
        required_sections.append("Return expectation")
    drivers = payload.get("drivers")
    if not isinstance(drivers, list) or len(drivers) == 0:
        required_sections.append("Drivers and dependencies")
    failures = payload.get("failures")
    if not isinstance(failures, list) or len(failures) == 0:
        required_sections.append("Downside and failure map")
    if not required_sections:
        return None
    return "Complete these sections first (at least in progress): " + ", ".join(required_sections) + "."


def _thesis_context_block(payload: Dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def _display_name(ticker: str) -> str:
    return ticker.strip().upper() or "UNKNOWN"


def _current_date_utc() -> str:
    return datetime.utcnow().strftime("%Y-%m-%d")


def _parse_json_object(text: str) -> Dict[str, Any]:
    raw = text.strip()
    if raw.startswith("```"):
        parts = raw.split("```")
        if len(parts) >= 2:
          raw = parts[1]
          if raw.startswith("json"):
              raw = raw[4:]
        raw = raw.strip()
    obj = json.loads(raw)
    if not isinstance(obj, dict):
        raise ValueError("Structured thesis evaluation must be a JSON object")
    return obj


def _normalize_evidence(raw: Any) -> List[Dict[str, str]]:
    if not isinstance(raw, list):
        return []
    out: List[Dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        source = item.get("source")
        detail = item.get("detail")
        if isinstance(source, str) and isinstance(detail, str):
            out.append({"source": source.strip(), "detail": detail.strip()})
    return out


def _normalize_driver_assessment(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    score = raw.get("score")
    if score not in {"working", "mixed", "failing"}:
        return None
    driver = raw.get("driver")
    why = raw.get("whyItMatters")
    importance = raw.get("importance")
    rationale = raw.get("rationale")
    if not all(isinstance(x, str) for x in (driver, why, importance, rationale)):
        return None
    return {
        "driver": driver.strip(),
        "whyItMatters": why.strip(),
        "importance": importance.strip(),
        "score": score,
        "rationale": rationale.strip(),
        "evidence": _normalize_evidence(raw.get("evidence")),
    }


def _normalize_failure_assessment(raw: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict):
        return None
    score = raw.get("score")
    if score not in {"inactive", "emerging", "active"}:
        return None
    values = [
        raw.get("failurePath"),
        raw.get("trigger"),
        raw.get("estimatedImpact"),
        raw.get("timeframe"),
        raw.get("rationale"),
    ]
    if not all(isinstance(x, str) for x in values):
        return None
    return {
        "failurePath": values[0].strip(),
        "trigger": values[1].strip(),
        "estimatedImpact": values[2].strip(),
        "timeframe": values[3].strip(),
        "score": score,
        "rationale": values[4].strip(),
        "evidence": _normalize_evidence(raw.get("evidence")),
    }


def validate_structured_result(raw: Dict[str, Any]) -> Dict[str, Any]:
    summary = raw.get("summary")
    system_recommendation = raw.get("systemRecommendation")
    if not isinstance(summary, str) or not summary.strip():
        raise ValueError("Structured thesis evaluation is missing summary")
    if not isinstance(system_recommendation, str) or not system_recommendation.strip():
        raise ValueError("Structured thesis evaluation is missing systemRecommendation")
    driver_raw = raw.get("driverAssessments")
    failure_raw = raw.get("failureAssessments")
    if not isinstance(driver_raw, list) or not isinstance(failure_raw, list):
        raise ValueError("Structured thesis evaluation must include driverAssessments and failureAssessments")
    drivers = [item for item in (_normalize_driver_assessment(x) for x in driver_raw) if item]
    failures = [item for item in (_normalize_failure_assessment(x) for x in failure_raw) if item]
    if len(drivers) == 0 or len(failures) == 0:
        raise ValueError("Structured thesis evaluation must include at least one driver and one failure assessment")
    rule_raw = raw.get("ruleSignals")
    rule_signals: Dict[str, Any] = {
        "trimTriggered": False,
        "exitTriggered": False,
        "addTriggered": False,
        "rationale": "",
    }
    if isinstance(rule_raw, dict):
        rule_signals = {
            "trimTriggered": rule_raw.get("trimTriggered") is True,
            "exitTriggered": rule_raw.get("exitTriggered") is True,
            "addTriggered": rule_raw.get("addTriggered") is True,
            "rationale": rule_raw.get("rationale").strip()
            if isinstance(rule_raw.get("rationale"), str)
            else "",
        }
    return {
        "summary": summary.strip(),
        "systemRecommendation": system_recommendation.strip(),
        "driverAssessments": drivers,
        "failureAssessments": failures,
        "ruleSignals": rule_signals,
    }


def _avg(values: List[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def derive_result(structured: Dict[str, Any]) -> Dict[str, Any]:
    driver_map = {"working": 1.0, "mixed": 0.5, "failing": 0.0}
    failure_map = {"inactive": 0.0, "emerging": 0.5, "active": 1.0}
    driver_health = _avg([driver_map[item["score"]] for item in structured["driverAssessments"]])
    failure_pressure = _avg([failure_map[item["score"]] for item in structured["failureAssessments"]])
    confidence = max(0.0, min(1.0, driver_health * (1.0 - failure_pressure)))
    rule_signals = structured.get("ruleSignals") or {}
    if rule_signals.get("exitTriggered"):
        status = "exit"
        rule_regime = "exit"
        rationale = rule_signals.get("rationale") or "Exit rule appears triggered."
    elif rule_signals.get("trimTriggered"):
        status = "trim"
        rule_regime = "trim"
        rationale = rule_signals.get("rationale") or "Trim rule appears triggered."
    elif rule_signals.get("addTriggered") and driver_health >= 0.7 and failure_pressure <= 0.35:
        status = "possible_add"
        rule_regime = "add"
        rationale = rule_signals.get("rationale") or "Thesis looks healthy and add conditions appear to be met."
    elif driver_health >= 0.75 and failure_pressure <= 0.3:
        status = "healthy"
        rule_regime = "monitor"
        rationale = "Core thesis drivers look intact and failure signals remain contained."
    elif driver_health <= 0.35 or failure_pressure >= 0.7:
        status = "problematic"
        rule_regime = "monitor"
        rationale = "Multiple drivers are deteriorating or failure signals appear materially active."
    else:
        status = "unsure"
        rule_regime = "monitor"
        rationale = "Signals are mixed and the thesis likely needs closer re-underwriting."

    recommendation_label = {
        "healthy": "Hold and monitor.",
        "possible_add": "Possible add if the pullback does not reflect thesis damage.",
        "trim": "Consider trimming and re-underwriting forward return.",
        "exit": "Consider exiting because the thesis or exit rule appears broken.",
        "problematic": "Reduce risk and re-underwrite the thesis.",
        "unsure": "Watch closely and re-underwrite before adding.",
    }[status]

    return {
        "status": status,
        "statusRationale": rationale,
        "recommendationLabel": recommendation_label,
        "ruleRegime": rule_regime,
        "driverHealthScore": round(driver_health, 4),
        "failurePressureScore": round(failure_pressure, 4),
        "thesisConfidenceScore": round(confidence, 4),
    }


def _write_evaluation_doc(
    service: FirebaseBaseService,
    thesis_doc_id: str,
    payload: Dict[str, Any],
) -> None:
    service.db.collection("position_theses").document(thesis_doc_id).collection("evaluations").document("latest").set(payload, merge=True)


def write_blocked_evaluation(
    service: FirebaseBaseService,
    thesis_doc_id: str,
    user_id: str,
    ticker: str,
    blocked_reason: str,
) -> None:
    now = datetime.utcnow()
    _write_evaluation_doc(
        service,
        thesis_doc_id,
        {
            "thesisDocId": thesis_doc_id,
            "userId": user_id,
            "ticker": ticker.upper(),
            "state": "blocked",
            "blockedReason": blocked_reason,
            "updatedAt": now,
            "evaluatedAt": now,
        },
    )


def run_position_thesis_evaluation(thesis_doc_id: str, *, quiet: bool = False) -> int:
    service = FirebaseBaseService()
    thesis_ref = service.db.collection("position_theses").document(thesis_doc_id)
    thesis_doc = thesis_ref.get()
    if not thesis_doc.exists:
        logger.warning("Thesis %s not found", thesis_doc_id)
        return EXIT_SKIPPED
    thesis_data = thesis_doc.to_dict() or {}
    user_id = str(thesis_data.get("userId") or "").strip()
    ticker = str(thesis_data.get("ticker") or "").strip().upper()
    payload = _parse_thesis_payload(thesis_data)
    if not user_id or not ticker or payload is None:
        logger.warning("Thesis %s missing user/ticker/payload", thesis_doc_id)
        return EXIT_SKIPPED

    blocked_reason = _completeness_block_reason(payload)
    if blocked_reason:
        write_blocked_evaluation(service, thesis_doc_id, user_id, ticker, blocked_reason)
        if not quiet:
            logger.info("Thesis %s evaluation blocked: %s", thesis_doc_id, blocked_reason)
        return EXIT_SKIPPED

    report_cfg = PromptConfigService().get_prompt_config(PROMPT_POSITION_THESIS_EVALUATION_REPORT)
    struct_cfg = PromptConfigService().get_prompt_config(PROMPT_POSITION_THESIS_EVALUATION_STRUCTURIZE)
    thesis_context = _thesis_context_block(payload)
    name = _display_name(ticker)

    report_text, report_execution_id = run_llm_with_prompt_name(
        PROMPT_POSITION_THESIS_EVALUATION_REPORT,
        {
            "name": name,
            "current_date": _current_date_utc(),
            "thesisContextBlock": thesis_context,
        },
    )
    if not isinstance(report_text, str) or not report_text.strip():
        raise ValueError("Grounded thesis evaluation report was empty")

    structured_text, structuring_execution_id = run_llm_with_prompt_name(
        PROMPT_POSITION_THESIS_EVALUATION_STRUCTURIZE,
        {
            "name": name,
            "thesisContextBlock": thesis_context,
            "evaluationReportBlock": report_text,
        },
    )
    if not isinstance(structured_text, (str, dict)):
        raise ValueError("Structured thesis evaluation returned unsupported output")
    structured_raw = structured_text if isinstance(structured_text, dict) else _parse_json_object(structured_text)
    structured = validate_structured_result(structured_raw)
    derived = derive_result(structured)
    now = datetime.utcnow()

    _write_evaluation_doc(
        service,
        thesis_doc_id,
        {
            "thesisDocId": thesis_doc_id,
            "userId": user_id,
            "ticker": ticker,
            "state": "ready",
            "reportMarkdown": report_text,
            "structuredResult": structured,
            "derivedResult": derived,
            "promptMetadata": {
                "reportPromptId": PROMPT_POSITION_THESIS_EVALUATION_REPORT,
                "reportPromptVersion": report_cfg.version,
                "reportExecutionId": report_execution_id,
                "structuringPromptId": PROMPT_POSITION_THESIS_EVALUATION_STRUCTURIZE,
                "structuringPromptVersion": struct_cfg.version,
                "structuringExecutionId": structuring_execution_id,
                "model": report_cfg.model or struct_cfg.model,
                "groundingUsed": bool(report_cfg.grounding_enabled),
            },
            "updatedAt": now,
            "evaluatedAt": now,
            "createdAt": now,
        },
    )
    if not quiet:
        logger.info("Thesis %s evaluation persisted", thesis_doc_id)
    return EXIT_OK
