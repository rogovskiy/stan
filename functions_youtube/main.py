# YouTube refresh: Pub/Sub-triggered function.
# vendor/ = shared services (firebase_base_service, job_run_service).
# youtube/ = refresh driver (API + RSS, upsert to Firestore).
import base64
import json
import logging
import os
import sys
import uuid
from datetime import datetime

try:
    import flask
except ImportError:
    flask = None  # type: ignore[assignment]

# Bridge standard logging to firebase_functions.logger so all log output is JSON to stdout/stderr.
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

_root = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_root, "vendor")
for _p in (_vendor, _root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from firebase_admin import firestore, initialize_app

initialize_app()

from firebase_functions import pubsub_fn
from firebase_functions.params import SecretParam

from services.job_run_service import record_job_run, JOB_TYPE_YOUTUBE, JOB_TYPE_YOUTUBE_TRANSCRIPT
from youtube.refresh_driver import refresh_one_subscription
from youtube.transcript_analysis import run_transcript_analysis

# Secret Manager secrets
YOUTUBE_API_KEY = SecretParam("YOUTUBE_API_KEY")
GEMINI_API_KEY = SecretParam("GEMINI_API_KEY")

logger = logging.getLogger(__name__)


@pubsub_fn.on_message_published(
    topic="youtube-refresh-requests",
    memory=512,
    timeout_sec=120,
    concurrency=2,
    max_instances=2,
    secrets=[YOUTUBE_API_KEY],
)
def youtube_refresh(event: pubsub_fn.CloudEvent[pubsub_fn.MessagePublishedData]) -> None:
    """Handle Pub/Sub message: refresh one YouTube subscription by ID."""
    message = event.data.message
    execution_id = None
    if flask and flask.has_request_context():
        execution_id = flask.request.headers.get("Function-Execution-Id")
    if not execution_id:
        execution_id = str(uuid.uuid4())
    started_at = datetime.utcnow()
    entity_id = None
    try:
        logger.info("YouTube refresh execution_id=%s", execution_id)

        try:
            payload = message.json
        except ValueError:
            if message.data:
                raw = base64.b64decode(message.data).decode("utf-8")
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    payload = {}
            else:
                logger.error("No message data")
                raise ValueError("No message data")

        subscription_id = (payload or {}).get("subscriptionId")
        if not subscription_id:
            logger.error("Missing subscriptionId in message")
            raise ValueError("Missing subscriptionId in message")

        subscription_id = str(subscription_id).strip()
        entity_id = subscription_id
        api_key = (YOUTUBE_API_KEY.value or "").strip() or None

        result = refresh_one_subscription(
            subscription_id,
            max_videos_per_feed=5,
            timeout_seconds=60,
            verbose=False,
            api_key=api_key,
        )
        logger.info(
            "YouTube refresh done for %s: ok=%s, upserted=%s",
            subscription_id,
            result.get("ok"),
            result.get("upserted", 0),
        )
        if result.get("ok"):
            record_job_run(
                JOB_TYPE_YOUTUBE,
                execution_id,
                "success",
                entity=entity_id,
                started_at=started_at,
                finished_at=datetime.utcnow(),
                payload={
                    "ok": True,
                    "upserted": result.get("upserted", 0),
                },
            )
        else:
            record_job_run(
                JOB_TYPE_YOUTUBE,
                execution_id,
                "error",
                entity=entity_id,
                error_message=result.get("error_message", result.get("reason", "unknown")),
                started_at=started_at,
                finished_at=datetime.utcnow(),
                payload=dict(result),
            )
    except Exception as e:
        logger.exception("YouTube refresh failed: %s", e)
        record_job_run(
            JOB_TYPE_YOUTUBE,
            execution_id,
            "error",
            entity=entity_id,
            error_message=str(e),
            started_at=started_at,
            finished_at=datetime.utcnow(),
        )
        raise


@pubsub_fn.on_message_published(
    topic="youtube-transcript-analysis-requests",
    memory=512,
    timeout_sec=300,
    concurrency=2,
    max_instances=4,
    secrets=[GEMINI_API_KEY],
)
def youtube_transcript_analysis(event: pubsub_fn.CloudEvent[pubsub_fn.MessagePublishedData]) -> None:
    """Handle Pub/Sub message: run transcript analysis for one video (read Storage, Gemini summary, write Firestore)."""
    message = event.data.message
    execution_id = None
    if flask and flask.has_request_context():
        execution_id = flask.request.headers.get("Function-Execution-Id")
    if not execution_id:
        execution_id = str(uuid.uuid4())
    started_at = datetime.utcnow()
    entity_id = None
    video_title = ""
    try:
        logger.info("Transcript analysis execution_id=%s", execution_id)
        try:
            payload = message.json
        except ValueError:
            if message.data:
                raw = base64.b64decode(message.data).decode("utf-8")
                try:
                    payload = json.loads(raw)
                except json.JSONDecodeError:
                    payload = {}
            else:
                logger.error("No message data")
                raise ValueError("No message data")
        video_id = (payload or {}).get("videoId")
        if not video_id:
            logger.error("Missing videoId in message")
            raise ValueError("Missing videoId in message")
        video_id = str(video_id).strip()
        entity_id = video_id
        video_title = ""
        video_doc = firestore.client().collection("youtube_videos").document(video_id).get()
        if video_doc.exists:
            video_title = (video_doc.to_dict() or {}).get("title") or ""
        api_key = (GEMINI_API_KEY.value or "").strip()
        if not api_key:
            logger.error("GEMINI_API_KEY not set")
            raise ValueError("GEMINI_API_KEY not set")
        run_transcript_analysis(video_id, api_key)
        logger.info("Transcript analysis completed for video %s", video_id)
        record_job_run(
            JOB_TYPE_YOUTUBE_TRANSCRIPT,
            execution_id,
            "success",
            entity=entity_id,
            started_at=started_at,
            finished_at=datetime.utcnow(),
            payload={"videoId": video_id, "videoTitle": video_title},
        )
    except Exception as e:
        logger.exception("Transcript analysis failed: %s", e)
        record_job_run(
            JOB_TYPE_YOUTUBE_TRANSCRIPT,
            execution_id,
            "error",
            entity=entity_id,
            error_message=str(e),
            started_at=started_at,
            finished_at=datetime.utcnow(),
            payload={"videoId": entity_id, "videoTitle": video_title} if entity_id else None,
        )
        raise
