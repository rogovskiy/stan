# Yahoo refresh: Pub/Sub-triggered function.
# vendor/ = shared code (services, yfinance_service, financial_data_validator, cloud_logging_setup).
# yahoo/ = package-owned refresh modules.
import base64
import json
import logging
import os
import sys
from datetime import datetime

_root = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_root, "vendor")
for _p in (_vendor, _root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from firebase_admin import initialize_app

initialize_app()

from firebase_functions import pubsub_fn

from yahoo.refresh_driver import refresh_yahoo_data
from services.job_run_service import record_job_run, JOB_TYPE_PRICE_REFRESH

log_level = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(level=getattr(logging, log_level, logging.INFO))
logger = logging.getLogger(__name__)


@pubsub_fn.on_message_published(
    topic="yf-refresh-requests",
    memory=512,
    timeout_sec=120,
)
def yahoo_refresh(event: pubsub_fn.CloudEvent[pubsub_fn.MessagePublishedData]) -> None:
    """Handle Pub/Sub message: refresh Yahoo Finance data for one ticker."""
    message = event.data.message
    execution_id = message.message_id or ""
    logger.info("Yahoo refresh message_id=%s", execution_id)

    try:
        payload = message.json
    except ValueError:
        # Not JSON: try decoding as plain string ticker
        if message.data:
            raw = base64.b64decode(message.data).decode("utf-8")
            try:
                payload = json.loads(raw)
            except json.JSONDecodeError:
                payload = {"ticker": raw}
        else:
            logger.error("No message data")
            raise ValueError("No message data")

    ticker = (payload or {}).get("ticker")
    if not ticker:
        logger.error("Missing ticker in message")
        raise ValueError("Missing ticker in message")

    ticker = str(ticker).upper()
    started_at = datetime.utcnow()

    try:
        result = refresh_yahoo_data(ticker, verbose=True)
        record_job_run(
            JOB_TYPE_PRICE_REFRESH,
            execution_id,
            "success",
            entity=ticker,
            started_at=started_at,
            finished_at=datetime.utcnow(),
            payload={
                "success": result.get("success"),
                "results": result.get("results", {}),
            },
        )
        logger.info("Yahoo refresh done for %s: success=%s", ticker, result.get("success"))
    except Exception as e:
        logger.exception("Yahoo refresh failed for %s: %s", ticker, e)
        record_job_run(
            JOB_TYPE_PRICE_REFRESH,
            execution_id,
            "error",
            entity=ticker,
            error_message=str(e),
            started_at=started_at,
            finished_at=datetime.utcnow(),
        )
        raise
