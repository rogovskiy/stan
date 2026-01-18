# Logging Best Practices - Quick Reference

## How to Add Logging to Your Code

### 1. Import the logger

```python
from cloud_logging_setup import get_logger

# At module level, get logger with context
log = get_logger(__name__)
```

### 2. Use logging methods

```python
# Info - general information
log.info("Processing started")
log.info(f"Found {count} documents")

# Warning - something unexpected but handled
log.warning("Retry attempt 3 of 5")
log.warning(f"Slow response from {url}")

# Error - something went wrong
log.error("Failed to download document")
log.error(f"Invalid data format: {data}", exc_info=True)  # Include stack trace

# Critical - severe error requiring immediate attention
log.critical("Browser infrastructure failure")
```

### 3. Add structured fields

```python
# Add custom fields for better querying
log.info("Document downloaded", **{
    'document_url': url,
    'document_type': 'pdf',
    'file_size_bytes': 12345,
    'download_time_ms': 1500
})
```

### 4. Context is automatic

The logger automatically includes:
- `execution_id` - From `os.environ.get('EXECUTION_ID')`
- `ticker` - From `os.environ.get('TICKER')` or passed to `get_logger()`
- `scan_type` - From `os.environ.get('SCAN_TYPE')`

## What NOT to Do

### ❌ Don't use print()

```python
# BAD
print(f"Processing {ticker}")
print(f"Error: {e}")
```

### ✅ Use logging instead

```python
# GOOD
log.info(f"Processing {ticker}")
log.error(f"Error: {e}", exc_info=True)
```

## When to Use Each Level

| Level | When to Use | Example |
|-------|-------------|---------|
| `debug()` | Detailed diagnostic info for developers | "Entering function X with params Y" |
| `info()` | General informational messages | "Scan started", "Found 10 documents" |
| `warning()` | Something unexpected but application continues | "Retry attempt", "Slow response" |
| `error()` | Error occurred, operation failed | "Failed to download", "Parse error" |
| `critical()` | Severe error, application may not recover | "Database unreachable", "Out of memory" |

## Exception Logging

### Always include exc_info for errors

```python
try:
    result = risky_operation()
except Exception as e:
    log.error(f"Operation failed: {e}", exc_info=True)  # Include stack trace
    raise  # Re-raise if you want to propagate
```

### For critical errors that stop execution

```python
try:
    browser = launch_browser()
except BrowserError as e:
    log.critical(f"Browser launch failed: {e}", exc_info=True)
    raise RuntimeError("Cannot continue without browser") from e
```

## Structured Fields Best Practices

### Use descriptive field names

```python
# GOOD
log.info("API call completed", **{
    'api_endpoint': '/v1/data',
    'response_code': 200,
    'response_time_ms': 150,
    'tokens_used': 1234
})

# BAD
log.info("API call completed", **{
    'url': '/v1/data',  # Conflicts with common URL field
    'code': 200,  # Too generic
    'time': 150,  # Ambiguous
})
```

### Common field naming conventions

- **Counts**: `document_count`, `page_count`, `error_count`
- **IDs**: `execution_id`, `request_id`, `document_id`
- **URLs**: `page_url`, `api_url`, `download_url`
- **Times**: `processing_time_ms`, `download_time_ms`, `total_duration_seconds`
- **Types**: `document_type`, `error_type`, `scan_type`
- **Status**: `status_code`, `exit_code`, `http_status`

## Environment Context

The logging system uses environment variables for context:

```python
# Set in pubsub_handler.py before calling scan
os.environ['TICKER'] = ticker
os.environ['SCAN_TYPE'] = 'new'  # or 'update'

# Then all logs automatically include these fields
log.info("Starting scan")  # Includes execution_id, ticker, scan_type
```

## Local vs Cloud Run

### The same code works everywhere!

```python
# This works locally AND in Cloud Run
log.info("Processing started", **{'document_count': 10})
```

**Locally**: Logs to console with simple format  
**Cloud Run**: Logs to Cloud Logging with full JSON structure

## Querying Logs in Cloud Console

### Basic queries

```
# Find all logs for a specific execution
jsonPayload.execution_id="abc-123"

# Find all logs for a ticker
jsonPayload.ticker="AAPL"

# Find all errors
severity>=ERROR

# Combine filters
jsonPayload.ticker="AAPL" AND severity>=WARNING
```

### Advanced queries

```
# Find slow operations (custom field)
jsonPayload.processing_time_ms>5000

# Find specific document types
jsonPayload.document_type="pdf"

# Time range with custom field
timestamp>="2026-01-18T00:00:00Z" AND jsonPayload.scan_type="new"
```

## Performance Tips

1. **Don't log in tight loops** - Logs have overhead
   ```python
   # BAD
   for item in items:
       log.info(f"Processing {item}")  # 1000 log entries!
   
   # GOOD
   log.info(f"Processing {len(items)} items")
   # Process items...
   log.info(f"Completed processing {len(items)} items")
   ```

2. **Use lazy evaluation for expensive operations**
   ```python
   # BAD
   log.debug(f"Data: {expensive_format(data)}")  # Always evaluated
   
   # GOOD
   if log.logger.isEnabledFor(logging.DEBUG):
       log.debug(f"Data: {expensive_format(data)}")  # Only when needed
   ```

3. **Batch related information**
   ```python
   # GOOD - One log with all info
   log.info("Scan completed", **{
       'documents_found': 10,
       'documents_processed': 8,
       'documents_skipped': 2,
       'duration_seconds': 45.2
   })
   ```

## Migration Checklist

When adding logging to existing code:

- [ ] Import `get_logger` from `cloud_logging_setup`
- [ ] Replace all `print()` with `log.info()`, `log.warning()`, or `log.error()`
- [ ] Add `exc_info=True` to error logs that catch exceptions
- [ ] Add structured fields for important data (URLs, counts, IDs, etc.)
- [ ] Test locally to ensure logs appear
- [ ] Deploy to Cloud Run and verify structured logs in Cloud Console

## Complete Example

```python
from cloud_logging_setup import get_logger

# Initialize logger
log = get_logger(__name__)

def process_documents(ticker: str, urls: list):
    """Process documents with proper logging."""
    log.info(f"Starting document processing", **{
        'document_count': len(urls)
    })
    
    processed = 0
    failed = 0
    
    for url in urls:
        try:
            result = download_and_process(url)
            processed += 1
            log.debug(f"Processed document", **{
                'url': url,
                'size_bytes': result.size
            })
        except DownloadError as e:
            failed += 1
            log.warning(f"Failed to download: {e}", **{
                'url': url,
                'error_type': 'DOWNLOAD_ERROR'
            })
        except ProcessingError as e:
            failed += 1
            log.error(f"Failed to process: {e}", exc_info=True, **{
                'url': url,
                'error_type': 'PROCESSING_ERROR'
            })
    
    log.info(f"Document processing complete", **{
        'total': len(urls),
        'processed': processed,
        'failed': failed,
        'success_rate': processed / len(urls) if urls else 0
    })
    
    return processed, failed
```

This example shows:
- ✅ Logger initialization
- ✅ Info logs for major steps
- ✅ Warning logs for handled errors
- ✅ Error logs with exc_info for unexpected errors
- ✅ Structured fields for all important data
- ✅ Summary log at the end

## Need Help?

- **Documentation**: See `docs/cloud_logging_integration.md` for full details
- **Testing**: Run `python test_structured_logging.py` to test Cloud Logging
- **Cloud Console**: https://console.cloud.google.com/logs/query

