#!/usr/bin/env python3
"""
Metrics Service for IR Scanning Operations

Provides structured logging to Google Cloud Logging with log-based metrics support.
Tracks token usage, duration, and operation metrics with execution ID correlation.
"""

import os
import json
import time
import uuid
from typing import Optional, Dict, Any
from datetime import datetime


class MetricsService:
    """Service for logging structured metrics using the shared logger."""
    
    def __init__(self, execution_id: Optional[str] = None, logger=None):
        """Initialize metrics service.
        
        Args:
            execution_id: Optional execution ID. If not provided, generates one.
                         In Cloud Run, uses trace ID from request context.
            logger: ContextLogger instance for structured logging (optional, can be set later)
        """
        self.execution_id = execution_id or self._generate_execution_id()
        self.logger = logger
    
    def _generate_execution_id(self) -> str:
        """Generate execution ID based on environment.
        
        Returns:
            Execution ID string (trace ID for Cloud Run, UUID for local)
        """
        # Check if running in Cloud Run
        if os.getenv('K_SERVICE'):
            # Try to get trace ID from Cloud Run environment
            trace_header = os.getenv('X_CLOUD_TRACE_CONTEXT')
            if trace_header:
                # Extract trace ID from header (format: TRACE_ID/SPAN_ID;o=TRACE_TRUE)
                trace_id = trace_header.split('/')[0] if '/' in trace_header else trace_header
                return trace_id
        
        # Generate UUID for local execution
        return str(uuid.uuid4())
    
    def _log_structured(self, operation_type: str, data: Dict[str, Any], severity: str = 'INFO'):
        """Log structured data using the shared logger.
        
        Args:
            operation_type: Type of operation (e.g., 'scan_start', 'gemini_api_call')
            data: Dictionary of metric data
            severity: Log severity level ('INFO', 'WARNING', 'ERROR')
        """
        if not self.logger:
            # If no logger provided, silently skip (metrics are optional)
            return
        
        # Build message and data for logger
        message = f"Metric: {operation_type}"
        metric_data = {
            'operation_type': operation_type,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            **data
        }
        
        # Use logger's methods based on severity
        if severity == 'INFO':
            self.logger.info(message, **metric_data)
        elif severity == 'WARNING':
            self.logger.warning(message, **metric_data)
        elif severity == 'ERROR':
            self.logger.error(message, **metric_data)
        else:
            self.logger.info(message, **metric_data)
    
    def log_scan_start(self, ticker: str, target_quarter: Optional[str] = None, 
                       max_pages: int = 50, num_urls: int = 1):
        """Log scan start event.
        
        Args:
            ticker: Stock ticker being scanned
            target_quarter: Optional target quarter filter
            max_pages: Maximum pages to scan
            num_urls: Number of URLs to scan
        """
        self._log_structured('scan_start', {
            'ticker': ticker,
            'target_quarter': target_quarter,
            'max_pages': max_pages,
            'num_urls': num_urls
        })
    
    def log_scan_complete(self, ticker: str, duration_seconds: float, 
                         total_documents: int, documents_processed: int,
                         documents_skipped: int, total_tokens: int,
                         prompt_tokens: int = 0, response_tokens: int = 0,
                         target_quarter: Optional[str] = None):
        """Log scan completion event.
        
        Args:
            ticker: Stock ticker scanned
            duration_seconds: Total scan duration in seconds
            total_documents: Total documents discovered
            documents_processed: Documents successfully processed
            documents_skipped: Documents skipped
            total_tokens: Total Gemini tokens used
            prompt_tokens: Total prompt tokens
            response_tokens: Total response tokens
            target_quarter: Optional target quarter filter
        """
        self._log_structured('scan_complete', {
            'ticker': ticker,
            'duration_seconds': duration_seconds,
            'total_documents': total_documents,
            'documents_processed': documents_processed,
            'documents_skipped': documents_skipped,
            'total_tokens': total_tokens,
            'prompt_tokens': prompt_tokens,
            'response_tokens': response_tokens,
            'target_quarter': target_quarter,
            # Cost estimation (using Gemini 2.0 Flash pricing as example)
            'estimated_cost_usd': (prompt_tokens * 0.075 + response_tokens * 0.30) / 1_000_000
        })
    
    def log_gemini_api_call(self, operation: str, url: str, 
                           prompt_tokens: int, response_tokens: int,
                           total_tokens: int, duration_ms: float,
                           ticker: Optional[str] = None):
        """Log individual Gemini API call.
        
        Args:
            operation: Operation type (e.g., 'listing_page_extraction', 'detail_page_extraction')
            url: URL being processed
            prompt_tokens: Prompt token count
            response_tokens: Response token count
            total_tokens: Total token count
            duration_ms: API call duration in milliseconds
            ticker: Optional stock ticker
        """
        self._log_structured('gemini_api_call', {
            'operation': operation,
            'url': url[:200] if url else None,  # Truncate long URLs
            'prompt_tokens': prompt_tokens,
            'response_tokens': response_tokens,
            'total_tokens': total_tokens,
            'duration_ms': duration_ms,
            'ticker': ticker,
        })
    
    def log_document_download(self, url: str, file_size_bytes: int, 
                             duration_ms: float, success: bool,
                             ticker: Optional[str] = None, error: Optional[str] = None):
        """Log document download event.
        
        Args:
            url: Document URL
            file_size_bytes: Downloaded file size in bytes
            duration_ms: Download duration in milliseconds
            success: Whether download succeeded
            ticker: Optional stock ticker
            error: Optional error message if failed
        """
        self._log_structured('document_download', {
            'url': url[:200] if url else None,
            'file_size_bytes': file_size_bytes,
            'duration_ms': duration_ms,
            'success': success,
            'ticker': ticker,
            'error': error
        }, severity='INFO' if success else 'WARNING')
    
    def log_document_storage(self, document_id: str, quarter_key: str,
                            document_type: str, ticker: str):
        """Log document storage event.
        
        Args:
            document_id: Unique document ID
            quarter_key: Quarter key (e.g., '2024Q3')
            document_type: Document type
            ticker: Stock ticker
        """
        self._log_structured('document_storage', {
            'document_id': document_id,
            'quarter_key': quarter_key,
            'document_type': document_type,
            'ticker': ticker
        })
    
    def log_page_navigation(self, url: str, page_type: str, duration_ms: float,
                           ticker: Optional[str] = None):
        """Log page navigation event.
        
        Args:
            url: Page URL
            page_type: Page type ('listing' or 'detail')
            duration_ms: Navigation duration in milliseconds
            ticker: Optional stock ticker
        """
        self._log_structured('page_navigation', {
            'url': url[:200] if url else None,
            'page_type': page_type,
            'duration_ms': duration_ms,
            'ticker': ticker
        })
    
    def get_execution_id(self) -> str:
        """Get the current execution ID.
        
        Returns:
            Execution ID string
        """
        return self.execution_id


class MetricsTimer:
    """Context manager for timing operations with metrics logging."""
    
    def __init__(self, metrics_service: MetricsService, log_func: callable):
        """Initialize timer.
        
        Args:
            metrics_service: MetricsService instance
            log_func: Function to call with duration_ms
        """
        self.metrics_service = metrics_service
        self.log_func = log_func
        self.start_time = None
    
    def __enter__(self):
        """Start timer."""
        self.start_time = time.time()
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Stop timer and log metrics."""
        duration_ms = (time.time() - self.start_time) * 1000
        self.log_func(duration_ms=duration_ms, success=(exc_type is None))
        return False

