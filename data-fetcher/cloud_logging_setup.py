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
from typing import Optional
from dotenv import load_dotenv

# Global flag to track if Cloud Logging is initialized
_cloud_logging_initialized = False


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
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)],
        force=True  # Override any existing configuration
    )
    
    _cloud_logging_initialized = True
    logging.info('Standard logging configured for local development' if not is_cloud_run else 'Standard logging configured (Cloud Logging unavailable)')
    return True


class ContextLogger:
    """
    Logger wrapper that automatically adds context fields to all log messages.
    
    This provides a convenient way to add execution_id, ticker, and scan_type
    to all logs without manually passing them in extra={} each time.
    """
    
    def __init__(
        self, 
        name: str,
        execution_id: Optional[str] = None,
        ticker: Optional[str] = None,
        scan_type: Optional[str] = None
    ):
        """
        Initialize a context logger.
        
        Args:
            name: Logger name (typically __name__)
            execution_id: Execution/correlation ID
            ticker: Stock ticker symbol
            scan_type: Type of scan ('new' or 'update')
        """
        self.logger = logging.getLogger(name)
        
        # Try to get context from environment if not provided
        self.execution_id = execution_id
        self.ticker = ticker
        self.scan_type = scan_type

    def set_scan_type(self, scan_type: str):
        """Set the scan type."""
        self.scan_type = scan_type
    

    def dump_handlers(self,label):
        root = logging.getLogger()
        print(label,root)
        for h in root.handlers:
            print("  ", h, getattr(h, "formatter", None))

    def _get_extra(self, **additional_fields):
        """Build the extra fields dict with context labels and additional json_fields."""
        extra = {}
        
        # Core context fields go in labels
        labels = {}
        if self.execution_id:
            labels['execution_id'] = self.execution_id
        if self.ticker:
            labels['ticker'] = self.ticker
        if self.scan_type:
            labels['scan_type'] = self.scan_type
        
        if labels:
            extra["labels"] = labels
        
        # Additional fields go in json_fields
        if additional_fields:
            extra["json_fields"] = additional_fields
        
        return extra
    
    def debug(self, message: str, **extra_fields):
        """Log a debug message with context."""
        self.logger.debug(message, extra=self._get_extra(**extra_fields))
    
    def info(self, message: str, **extra_fields):
        """Log an info message with context."""
        self.logger.info(message, extra=self._get_extra(**extra_fields))
    
    def warning(self, message: str, **extra_fields):
        """Log a warning message with context."""
        self.logger.warning(message, extra=self._get_extra(**extra_fields))
    
    def error(self, message: str, exc_info: bool = False, **extra_fields):
        """Log an error message with context."""
        self.logger.error(message, exc_info=exc_info, extra=self._get_extra(**extra_fields))
    
    def critical(self, message: str, exc_info: bool = False, **extra_fields):
        """Log a critical message with context."""
        self.logger.critical(message, exc_info=exc_info, extra=self._get_extra(**extra_fields))
    
    def metric(self, operation_type: str, severity: str = 'INFO', **metric_fields):
        """Log a metric with unified format.
        
        Args:
            operation_type: Type of metric operation (e.g., 'scan_start', 'gemini_api_call')
            severity: Log severity level ('INFO', 'WARNING', 'ERROR') - defaults to 'INFO'
            **metric_fields: Additional metric fields to include in json_fields
        
        Example:
            logger.metric('scan_start', target_quarter='2024Q3', max_pages=50)
            logger.metric('document_download', success=False, error='Download failed', severity='WARNING')
        """
        message = f'Metric: {operation_type}'
        
        # Include operation_type in metric_fields
        metric_data = {
            'operation_type': operation_type,
            **metric_fields
        }
        
        # Call appropriate log method based on severity
        if severity == 'INFO':
            self.logger.info(message, extra=self._get_extra(**metric_data))
        elif severity == 'WARNING':
            self.logger.warning(message, extra=self._get_extra(**metric_data))
        elif severity == 'ERROR':
            self.logger.error(message, extra=self._get_extra(**metric_data))
        else:
            # Default to INFO for unknown severity
            self.logger.info(message, extra=self._get_extra(**metric_data))


def get_logger(
    name: str,
    execution_id: Optional[str] = None,
    ticker: Optional[str] = None,
    scan_type: Optional[str] = None
) -> ContextLogger:
    """
    Get a logger with automatic context fields.
    
    Args:
        name: Logger name (typically __name__)
        execution_id: Execution/correlation ID
        ticker: Stock ticker symbol
        scan_type: Type of scan ('new' or 'update')
    
    Returns:
        ContextLogger instance with context fields
    
    Example:
        logger = get_logger(__name__, execution_id='exec-123', ticker='AAPL')
        logger.info('Processing started')
    """
    return ContextLogger(name, execution_id=execution_id, ticker=ticker, scan_type=scan_type)

