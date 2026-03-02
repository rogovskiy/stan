# Yahoo refresh: Pub/Sub-triggered function.
# vendor/ = shared code (services, yfinance_service, financial_data_validator).
# yahoo/ = package-owned refresh modules.
import base64
import json
import logging
import os
import sys
import uuid
from contextvars import ContextVar
from datetime import datetime

try:
    import flask
except ImportError:
    flask = None  # type: ignore[assignment]

_root = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_root, "vendor")
for _p in (_vendor, _root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# Bridge standard logging to firebase_functions.logger (same as functions_macro).
from firebase_functions import logger as firebase_logger

log_level = os.getenv("LOG_LEVEL", "INFO").upper()

_LEVEL_MAP = {
    "DEBUG": firebase_logger.LogSeverity.DEBUG,
    "INFO": firebase_logger.LogSeverity.INFO,
    "WARNING": firebase_logger.LogSeverity.WARNING,
    "ERROR": firebase_logger.LogSeverity.ERROR,
    "CRITICAL": firebase_logger.LogSeverity.CRITICAL,
}

class FirebaseLoggerHandler(logging.Handler):
    """Forward every log record to firebase_functions.logger.write() (JSON to stdout/stderr)."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            severity = _LEVEL_MAP.get(
                record.levelname, firebase_logger.LogSeverity.INFO
            )
            entry = {
                "severity": severity,
                "message": record.getMessage(),
            }
            execution_id = getattr(record, "execution_id", None)
            if execution_id is not None:
                entry["execution_id"] = execution_id
            firebase_logger.write(entry)
        except Exception:
            self.handleError(record)


logging.basicConfig(level=getattr(logging, log_level, logging.INFO))
root = logging.getLogger()
handler = FirebaseLoggerHandler()
root.handlers = [handler]
root.setLevel(getattr(logging, log_level, logging.INFO))

from firebase_admin import initialize_app

initialize_app()

from firebase_functions import pubsub_fn

from yahoo.refresh_driver import refresh_yahoo_data
from services.job_run_service import record_job_run, JOB_TYPE_PRICE_REFRESH

logger = logging.getLogger(__name__)


@pubsub_fn.on_message_published(
    topic="yf-refresh-requests",
    memory=512,
    timeout_sec=120,
    concurrency=2,
    max_instances=2,
)
def yahoo_refresh(event: pubsub_fn.CloudEvent[pubsub_fn.MessagePublishedData]) -> None:
    """Handle Pub/Sub message: refresh Yahoo Finance data for one ticker."""
    message = event.data.message
    execution_id = None
    if flask and flask.has_request_context():
        execution_id = flask.request.headers.get("Function-Execution-Id")
    logger.info("Yahoo refresh execution_id=%s", execution_id)

    try:
        payload = message.json
    except ValueError:
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
