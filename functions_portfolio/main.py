# Portfolio jobs: weekly scheduler publishes one Pub/Sub message per portfolio;
# consumer runs channel exposure per message (same as post-import).
# portfolio_channel_exposure.py lives in this package; vendor/ = data-fetcher services only.
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
    def emit(self, record: logging.LogRecord) -> None:
        try:
            severity = _LEVEL_MAP.get(
                record.levelname, firebase_logger.LogSeverity.INFO
            )
            entry = {"severity": severity, "message": record.getMessage()}
            execution_id = getattr(record, "execution_id", None)
            if execution_id is not None:
                entry["execution_id"] = execution_id
            firebase_logger.write(entry)
        except Exception:
            self.handleError(record)


logging.basicConfig(level=getattr(logging, log_level, logging.INFO))
_root_log = logging.getLogger()
_root_log.handlers = [FirebaseLoggerHandler()]
_root_log.setLevel(getattr(logging, log_level, logging.INFO))

_root = os.path.dirname(os.path.abspath(__file__))
_vendor = os.path.join(_root, "vendor")
for _p in (_vendor, _root):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from firebase_admin import initialize_app

initialize_app()

from google.cloud.pubsub_v1 import PublisherClient

from firebase_functions import pubsub_fn, scheduler_fn

from portfolio_channel_exposure import (
    EXIT_OK,
    EXIT_SKIPPED,
    run_channel_exposure,
)
from portfolio_stress_drawdown import (
    EXIT_OK as STRESS_EXIT_OK,
    EXIT_SKIPPED as STRESS_EXIT_SKIPPED,
    run_stress_drawdown,
)
from services.job_run_service import (
    record_job_run,
    JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE,
    JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE_PUBLISH,
    JOB_TYPE_PORTFOLIO_STRESS_DRAWDOWN,
)
from services.portfolio_service import PortfolioService

logger = logging.getLogger(__name__)

PORTFOLIO_CHANNEL_EXPOSURE_TOPIC = "portfolio-channel-exposure-requests"


def _resolve_invocation_execution_id() -> str:
    """
    Match scheduled functions and Pub/Sub handlers (e.g. functions_youtube):
    Function-Execution-Id header only, then uuid.

    Do not use Pub/Sub message_id — Cloud Logging labels.execution_id follows the
    invocation id, not the message id, so job_runs.execution_id must match.
    """
    execution_id = None
    if flask and flask.has_request_context():
        execution_id = flask.request.headers.get("Function-Execution-Id")
    if execution_id:
        return execution_id
    return str(uuid.uuid4())


def _gcp_project_id() -> str:
    pid = os.environ.get("GOOGLE_CLOUD_PROJECT") or os.environ.get("GCLOUD_PROJECT")
    if not pid:
        raise RuntimeError("GOOGLE_CLOUD_PROJECT (or GCLOUD_PROJECT) is not set")
    return pid


def _decode_pubsub_json(message) -> dict:
    try:
        payload = message.json
        if isinstance(payload, dict):
            return payload
        return {}
    except ValueError:
        pass
    if message.data:
        raw = base64.b64decode(message.data).decode("utf-8")
        try:
            out = json.loads(raw)
            return out if isinstance(out, dict) else {}
        except json.JSONDecodeError:
            logger.error("Invalid JSON in Pub/Sub body")
            raise ValueError("Invalid JSON in Pub/Sub message") from None
    logger.error("No message data")
    raise ValueError("No message data")


@scheduler_fn.on_schedule(
    schedule="0 6 * * 1",
    memory=512,
    timeout_sec=300,
    concurrency=1,
)
def portfolio_weekly_publish(event: scheduler_fn.ScheduledEvent) -> None:
    """Monday 06:00 UTC: list portfolios and publish one channel-exposure message per id."""
    execution_id = _resolve_invocation_execution_id()
    started_at = datetime.utcnow()
    logger.info("portfolio_weekly_publish schedule_time=%s", event.schedule_time)
    errors: list[str] = []
    published = 0
    portfolio_ids: list[str] = []
    try:
        project = _gcp_project_id()
        portfolio_ids = PortfolioService().list_portfolio_ids()
        logger.info("Publishing %d portfolio refresh message(s)", len(portfolio_ids))

        client = PublisherClient()
        topic_path = client.topic_path(project, PORTFOLIO_CHANNEL_EXPOSURE_TOPIC)
        for pid in portfolio_ids:
            try:
                data = json.dumps({"portfolioId": pid}).encode("utf-8")
                client.publish(topic_path, data).result(timeout=30)
                published += 1
            except Exception as ex:
                logger.warning("Publish failed for portfolio %s: %s", pid, ex)
                errors.append(f"{pid}: {ex}")

        finished_at = datetime.utcnow()
        if errors:
            record_job_run(
                JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE_PUBLISH,
                execution_id,
                "error",
                error_message="; ".join(errors[:25])
                + (f" … (+{len(errors) - 25} more)" if len(errors) > 25 else ""),
                started_at=started_at,
                finished_at=finished_at,
                payload={
                    "published": published,
                    "failed": len(errors),
                    "portfolio_count": len(portfolio_ids),
                },
            )
            raise RuntimeError(
                f"{len(errors)} publish failure(s), {published} succeeded"
            )

        record_job_run(
            JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE_PUBLISH,
            execution_id,
            "success",
            started_at=started_at,
            finished_at=finished_at,
            payload={
                "published": published,
                "portfolio_count": len(portfolio_ids),
            },
        )
    except Exception as e:
        if errors:
            raise
        logger.exception("portfolio_weekly_publish failed: %s", e)
        record_job_run(
            JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE_PUBLISH,
            execution_id,
            "error",
            error_message=str(e),
            started_at=started_at,
            finished_at=datetime.utcnow(),
        )
        raise


@pubsub_fn.on_message_published(
    topic=PORTFOLIO_CHANNEL_EXPOSURE_TOPIC,
    memory=1024,
    timeout_sec=540,
    concurrency=2,
    max_instances=5,
)
def portfolio_channel_exposure_refresh(
    event: pubsub_fn.CloudEvent[pubsub_fn.MessagePublishedData],
) -> None:
    """Pub/Sub: refresh channel exposure for one portfolio (portfolioId in JSON)."""
    message = event.data.message
    payload = _decode_pubsub_json(message)

    portfolio_id = payload.get("portfolioId") or payload.get("portfolio_id")
    if not portfolio_id:
        logger.error("Missing portfolioId in message")
        raise ValueError("Message must include portfolioId")

    pid = str(portfolio_id)
    execution_id = _resolve_invocation_execution_id()
    stress_execution_id = f"{execution_id}-stress-drawdown"
    p_started = datetime.utcnow()
    try:
        rc = run_channel_exposure(
            pid,
            period="1y",
            verbose=True,
            save_to_firebase=True,
            quiet=True,
        )
        if rc == EXIT_SKIPPED:
            record_job_run(
                JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE,
                execution_id,
                "success",
                entity=pid,
                started_at=p_started,
                finished_at=datetime.utcnow(),
                payload={"skipped": True},
            )
            logger.info("Channel exposure skipped for %s (insufficient data)", pid)
        elif rc != EXIT_OK:
            raise RuntimeError(f"exit code {rc}")
        else:
            record_job_run(
                JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE,
                execution_id,
                "success",
                entity=pid,
                started_at=p_started,
                finished_at=datetime.utcnow(),
            )
            logger.info("Channel exposure done for %s", pid)
    except Exception as e:
        logger.exception("Channel exposure failed for %s: %s", pid, e)
        record_job_run(
            JOB_TYPE_PORTFOLIO_CHANNEL_EXPOSURE,
            execution_id,
            "error",
            entity=pid,
            error_message=str(e),
            started_at=p_started,
            finished_at=datetime.utcnow(),
        )
        raise
    finally:
        s_started = datetime.utcnow()
        try:
            rc_stress = run_stress_drawdown(
                pid,
                verbose=True,
                save_to_firebase=True,
                quiet=True,
            )
            if rc_stress == STRESS_EXIT_SKIPPED:
                record_job_run(
                    JOB_TYPE_PORTFOLIO_STRESS_DRAWDOWN,
                    stress_execution_id,
                    "success",
                    entity=pid,
                    started_at=s_started,
                    finished_at=datetime.utcnow(),
                    payload={"skipped": True},
                )
                logger.info("Stress drawdown skipped for %s (no positions)", pid)
            elif rc_stress != STRESS_EXIT_OK:
                record_job_run(
                    JOB_TYPE_PORTFOLIO_STRESS_DRAWDOWN,
                    stress_execution_id,
                    "error",
                    entity=pid,
                    error_message=f"exit code {rc_stress}",
                    started_at=s_started,
                    finished_at=datetime.utcnow(),
                )
                logger.warning("Stress drawdown non-OK exit for %s: %s", pid, rc_stress)
            else:
                record_job_run(
                    JOB_TYPE_PORTFOLIO_STRESS_DRAWDOWN,
                    stress_execution_id,
                    "success",
                    entity=pid,
                    started_at=s_started,
                    finished_at=datetime.utcnow(),
                )
                logger.info("Stress drawdown done for %s", pid)
        except Exception as es:
            logger.exception("Stress drawdown failed for %s: %s", pid, es)
            record_job_run(
                JOB_TYPE_PORTFOLIO_STRESS_DRAWDOWN,
                stress_execution_id,
                "error",
                entity=pid,
                error_message=str(es),
                started_at=s_started,
                finished_at=datetime.utcnow(),
            )
