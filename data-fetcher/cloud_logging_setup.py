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
import logging
from typing import Optional
from dotenv import load_dotenv

# Global flag to track if Cloud Logging is initialized
_cloud_logging_initialized = False


def setup_cloud_logging() -> bool:
    """
    Initialize Google Cloud Logging for the application.
    
    This should be called once at application startup. It configures the Python
    logging system to send all logs to Google Cloud Logging with structured fields.
    
    Returns:
        bool: True if Cloud Logging was successfully initialized, False otherwise
    """
    global _cloud_logging_initialized
    
    if _cloud_logging_initialized:
        return True
    
    try:
        import google.cloud.logging
        from google.oauth2 import service_account
        
        # Determine if we're in Cloud Run or local development
        is_cloud_run = bool(os.environ.get('K_SERVICE'))
        
        if is_cloud_run:
            # Cloud Run: Use Application Default Credentials
            project_id = os.environ.get('FIREBASE_PROJECT_ID')
            if not project_id:
                logging.warning("FIREBASE_PROJECT_ID not set, Cloud Logging may not work")
                return False
            
            client = google.cloud.logging.Client(project=project_id)
            logging.info(f"Cloud Logging initialized with ADC for project: {project_id}")
        else:
            # Local development: Use credentials from .env.local
            env_path = os.path.join(os.path.dirname(__file__), '.env.local')
            if os.path.exists(env_path):
                load_dotenv(env_path)
            
            project_id = os.getenv('FIREBASE_PROJECT_ID')
            private_key = os.getenv("FIREBASE_PRIVATE_KEY")
            
            if not project_id or not private_key:
                logging.warning("Firebase credentials not found, falling back to local logging")
                return False
            
            private_key = private_key.replace('\\n', '\n')
            
            credentials_info = {
                "type": "service_account",
                "project_id": project_id,
                "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
                "private_key": private_key,
                "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
                "client_id": os.getenv("FIREBASE_CLIENT_ID"),
                "auth_uri": os.getenv("FIREBASE_AUTH_URI", "https://accounts.google.com/o/oauth2/auth"),
                "token_uri": os.getenv("FIREBASE_TOKEN_URI", "https://oauth2.googleapis.com/token"),
            }
            
            credentials = service_account.Credentials.from_service_account_info(credentials_info)
            client = google.cloud.logging.Client(project=project_id, credentials=credentials)
            logging.info(f"Cloud Logging initialized with explicit credentials for project: {project_id}")
        
        # Set up Cloud Logging handler - this captures all logging output
        client.setup_logging()
        
        _cloud_logging_initialized = True
        return True
        
    except ImportError:
        logging.warning("google-cloud-logging not installed, using standard logging")
        return False
    except Exception as e:
        logging.error(f"Failed to initialize Cloud Logging: {e}")
        return False


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
        self.execution_id = execution_id or os.environ.get('EXECUTION_ID')
        self.ticker = ticker or os.environ.get('TICKER')
        self.scan_type = scan_type or os.environ.get('SCAN_TYPE')
    
    def _get_extra(self, **additional_fields):
        """Build the extra fields dict with context."""
        extra = {}
        if self.execution_id:
            extra['execution_id'] = self.execution_id
        if self.ticker:
            extra['ticker'] = self.ticker
        if self.scan_type:
            extra['scan_type'] = self.scan_type
        
        # Add any additional fields
        extra.update(additional_fields)
        
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

