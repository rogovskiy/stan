"""
Cloud Logging Setup Module

This module provides centralized Cloud Logging configuration for the IR scanner.
It uses Google Cloud Logging's setup_logging() to automatically capture all Python
logging output and send it to Cloud Logging with structured fields.

Usage:
    from cloud_logging_setup import setup_cloud_logging, get_logger
    
    # Initialize once at application startup
    setup_cloud_logging()
    
    # Get a logger with context
    logger = get_logger(__name__, execution_id='exec-123', ticker='AAPL', scan_type='new')
    logger.info('Processing started')
    
    # Or use standard logging with extra fields
    import logging
    logging.info('Message', extra={'execution_id': 'exec-123', 'ticker': 'AAPL'})
"""

import os
import sys
import logging
from contextvars import ContextVar

# Global flag to track if Cloud Logging is initialized
_cloud_logging_initialized = False


mdc_execution_id = ContextVar("execution_id", default=None)
mdc_ticker = ContextVar("message_id", default=None)
mdc_operation_type = ContextVar("operation_type", default=None)

def setup_cloud_logging() -> bool:
    """
    Initialize logging for the application.
    
    - In Cloud Run: Uses StructuredLogHandler to write JSON logs to stdout
    - Local development: Configures standard Python logging with console output
    
    Returns:
        bool: True if logging was successfully initialized, False otherwise
    """
    global _cloud_logging_initialized
    
    if _cloud_logging_initialized:
        return True
    
    # Check if running in Cloud Run
    is_cloud_run = bool(os.environ.get('K_SERVICE'))
    
    if is_cloud_run:
        # Cloud Run: Use StructuredLogHandler for JSON logs
        try:
            from google.cloud.logging.handlers import StructuredLogHandler
            
            # Structured JSON logs to stdout (Cloud Run ingests these as jsonPayload)
            handler = StructuredLogHandler(stream=sys.stdout)
            
            root = logging.getLogger()
            root.handlers = [handler]
            root.setLevel(logging.INFO)
            
            _cloud_logging_initialized = True
            logging.info("Cloud Logging initialized with StructuredLogHandler")

            _setup_mdc_context()
            return True
            
        except ImportError:
            logging.warning("google-cloud-logging not installed, falling back to standard logging")
            # Fall through to standard logging setup
        except Exception as e:
            logging.error(f"Failed to initialize Cloud Logging: {e}")
            # Fall through to standard logging setup
    
    # Local dev or fallback: Configure standard logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(message)s',
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True  # Override any existing configuration
    )
    _setup_mdc_context()

    
    _cloud_logging_initialized = True
    logging.info('Standard logging configured for local development' if not is_cloud_run else 'Standard logging configured (Cloud Logging unavailable)')
    return True

class MDCFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        # Base json_fields (may come from extra={"json_fields": {...}})
        base = getattr(record, "json_fields", None)
        if not isinstance(base, dict):
            base = {}

        # Merge metric_fields (comes from extra={"metric_fields": {...}})
        metric_fields = getattr(record, "metric_fields", None)
        if isinstance(metric_fields, dict):
            base = {**base, **metric_fields}

        # Merge MDC/contextvars
        execution_id = mdc_execution_id.get(None)
        operation_type = mdc_operation_type.get(None)
        ticker = mdc_ticker.get(None)

        if execution_id is not None:
            base["execution_id"] = str(execution_id)
        if operation_type is not None:
            base["operation_type"] = str(operation_type)
        if ticker is not None:
            base["ticker"] = str(ticker)

        record.json_fields = base
        return True

def _setup_mdc_context():
    root = logging.getLogger()
    root.addFilter(MDCFilter())

def emit_metric(metric_name: str, **metric_fields):
    logging.info(
        f"Metric: {metric_name}",
        extra={
            "metric_fields": {
                "event_type": "metric",
                "metric_name": metric_name,
                **metric_fields,
            }
        },
    )