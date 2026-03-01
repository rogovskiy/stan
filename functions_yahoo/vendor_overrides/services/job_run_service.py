#!/usr/bin/env python3
"""
Job Run Service (override for functions_yahoo)

Records data-refresh job executions to Firestore for the Jobs UI.
Writes when running in Cloud Run (K_SERVICE) or Cloud Functions (FUNCTION_TARGET); local runs are skipped.
"""

import os
import logging
from datetime import datetime
from typing import Optional, Any

from google.cloud.firestore_v1.transforms import Increment

from services.firebase_base_service import FirebaseBaseService

logger = logging.getLogger(__name__)

COLLECTION = "job_runs"
DAILY_AGGREGATE_COLLECTION = "job_run_daily"

JOB_TYPE_PRICE_REFRESH = "price_refresh"
JOB_TYPE_MACRO = "macro"
JOB_TYPE_IR_SCAN = "ir_scan"
JOB_TYPE_YOUTUBE = "youtube"


def _should_record() -> bool:
    """True when running in Cloud Run or Cloud Functions (job runs should be recorded)."""
    return (
        os.environ.get("K_SERVICE") is not None
        or os.environ.get("FUNCTION_TARGET") is not None
    )


def _date_utc(dt: datetime) -> str:
    """Return YYYY-MM-DD for the given datetime (UTC)."""
    return dt.strftime("%Y-%m-%d")


def record_job_run(
    job_type: str,
    execution_id: str,
    status: str,
    *,
    entity: Optional[str] = None,
    error_message: Optional[str] = None,
    started_at: Optional[datetime] = None,
    finished_at: Optional[datetime] = None,
    payload: Optional[dict[str, Any]] = None,
) -> None:
    """
    Write one job run to Firestore. No-op when not running in Cloud Run or Cloud Functions.

    Call this from the Yahoo Pub/Sub handler (and macro_refresh) after each run.
    """
    if not _should_record():
        logger.debug(
            "Skipping job run record (not in cloud): job_type=%s execution_id=%s",
            job_type,
            execution_id,
        )
        return

    now = datetime.utcnow()
    started = started_at or now
    finished = finished_at or now

    doc_data = {
        "job_type": job_type,
        "date": _date_utc(started),
        "started_at": started,
        "finished_at": finished,
        "status": status,
        "execution_id": execution_id,
    }
    if entity is not None:
        doc_data["entity"] = entity
    if error_message is not None:
        doc_data["error_message"] = error_message
    if payload:
        doc_data["payload"] = payload

    date_str = _date_utc(started)
    is_error = status == "error"

    try:
        service = FirebaseBaseService()
        doc_ref = service.db.collection(COLLECTION).document(execution_id)
        doc_ref.set(doc_data)

        # Update daily aggregate (success_count / error_count) for Jobs UI
        daily_id = f"{job_type}_{date_str}"
        daily_ref = service.db.collection(DAILY_AGGREGATE_COLLECTION).document(daily_id)
        daily_ref.set(
            {
                "job_type": job_type,
                "date": date_str,
                "success_count": Increment(1) if not is_error else Increment(0),
                "error_count": Increment(1) if is_error else Increment(0),
            },
            merge=True,
        )

        logger.info(
            "Recorded job run: job_type=%s execution_id=%s status=%s",
            job_type,
            execution_id,
            status,
        )
    except Exception as e:
        logger.warning(
            "Failed to record job run (non-fatal): job_type=%s execution_id=%s error=%s",
            job_type,
            execution_id,
            e,
        )
