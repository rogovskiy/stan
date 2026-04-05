#!/usr/bin/env python3
"""
Job Run Service

Records data-refresh job executions to Firestore for the Jobs UI.
Only writes when running in Cloud Run (K_SERVICE is set); local runs are skipped.

Integration (when ready):
- pubsub_handler.py: after each handler (success and error), call record_job_run(
    job_type=JOB_TYPE_IR_SCAN|JOB_TYPE_PRICE_REFRESH|JOB_TYPE_MACRO|JOB_TYPE_YOUTUBE,
    execution_id=message_id, status='success'|'error', entity=ticker|subscription_id|None,
    error_message=..., started_at=..., finished_at=..., payload=...
  )
- functions_macro: after macro_refresh, write one run (e.g. with uuid as execution_id).
- functions_portfolio: portfolio_weekly_publish and portfolio_channel_exposure_refresh call record_job_run.
- functions_yahoo: yahoo_refresh records `quarterly_timeseries` when the quarterly aggregate step runs (after earnings or splits update).
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

# Job types used by the UI and backend
JOB_TYPE_PRICE_REFRESH = "price_refresh"
JOB_TYPE_MACRO = "macro"
JOB_TYPE_IR_SCAN = "ir_scan"
JOB_TYPE_YOUTUBE = "youtube"
JOB_TYPE_YOUTUBE_TRANSCRIPT = "youtube_transcript"
JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE = "portfolio_channel_exposure"
JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE_PUBLISH = "portfolio_channel_exposure_publish"
JOB_TYPE_PORTFOLIO_STRESS_DRAWDOWN = "portfolio_stress_drawdown"
JOB_TYPE_POSITION_THESIS_EVALUATION = "position_thesis_evaluation"
JOB_TYPE_QUARTERLY_TIMESERIES = "quarterly_timeseries"


def _is_cloud_run() -> bool:
    """True when running in Cloud Run (job runs should be recorded)."""
    return os.environ.get("K_SERVICE") is not None


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
    Write one job run to Firestore. No-op when not running in Cloud Run (K_SERVICE unset).

    execution_id: stored on the document, used as Firestore document id, and for
        Cloud Logging correlation (must match labels.execution_id on the invocation).
    """
    if not _is_cloud_run():
        logger.debug("Skipping job run record (not in Cloud Run): job_type=%s execution_id=%s", job_type, execution_id)
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
        doc_key = execution_id

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
            "Recorded job run: job_type=%s execution_id=%s doc_id=%s status=%s",
            job_type,
            execution_id,
            doc_key,
            status,
        )
    except Exception as e:
        logger.warning("Failed to record job run (non-fatal): job_type=%s execution_id=%s error=%s", job_type, execution_id, e)
