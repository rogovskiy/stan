# Cloud Logging Integration Summary

## Overview

We've integrated Google Cloud Logging into the IR scanner application using the `setup_logging()` approach. This ensures all logs are properly structured with correlation IDs and sent to Cloud Logging when running in Cloud Run.

## Key Changes

### 1. New Module: `cloud_logging_setup.py`

Created a centralized logging configuration module that provides:

- **`setup_cloud_logging()`**: Initializes Google Cloud Logging client and calls `setup_logging()`
  - In Cloud Run: Uses Application Default Credentials (ADC)
  - Locally: Uses explicit credentials from `.env.local`
  - Automatically called when `K_SERVICE` environment variable is set

- **`ContextLogger` class**: Wrapper that automatically adds context fields to all logs
  - `execution_id`: Unique ID for each scan request
  - `ticker`: Stock symbol being processed
  - `scan_type`: "new" or "update"
  
- **`get_logger()` function**: Factory function for creating loggers with context

### 2. Updated `pubsub_handler.py`

**Before:**
- Used custom `JSONFormatter` to write JSON to stdout
- Manual stdout redirection with `StructuredStdout`

**After:**
- Calls `setup_cloud_logging()` when running in Cloud Run
- Uses standard Python `logging` with `extra={}` for structured fields
- Cloud Logging automatically captures and structures all logs

```python
# Initialize Cloud Logging when running in Cloud Run
if os.environ.get('K_SERVICE'):
    setup_cloud_logging()
    logging.info('Cloud Logging initialized for Cloud Run')
```

### 3. Updated `scan_ir_website.py`

**Replaced all 45 `print()` statements with logging calls:**

- `print(f'Error: ...')` → `log.error('...')`
- `print(f'Warning: ...')` → `log.warning('...')`
- `print(f'Info')` → `log.info('...')`

**Benefits:**
- All logs now include `execution_id`, `ticker`, `scan_type`
- Structured JSON in Cloud Logging
- Better filtering and querying capabilities

### 4. Updated `ir_crawler.py`

**Removed custom `StructuredLogger` class** and replaced with:
- `from cloud_logging_setup import get_logger`
- `self.log = get_logger(__name__, execution_id=..., ticker=..., scan_type=...)`

This ensures consistency across all modules and leverages the centralized Cloud Logging configuration.

## How It Works

### In Cloud Run

1. **Initialization**: `pubsub_handler.py` detects `K_SERVICE` env var and calls `setup_cloud_logging()`
2. **Client Setup**: Creates Google Cloud Logging client with ADC
3. **Handler Configuration**: Calls `client.setup_logging()` which:
   - Attaches Cloud Logging handler to Python root logger
   - Captures all `logging.info()`, `logging.warning()`, etc. calls
   - Sends them directly to Cloud Logging API with structured fields
4. **Automatic Correlation**: All logs include `execution_id`, `ticker`, `scan_type` from `extra={}` parameter

### Locally

1. **Fallback**: If Cloud Logging initialization fails, uses standard console logging
2. **Explicit Credentials**: Loads Firebase service account credentials from `.env.local`
3. **Same API**: Code uses same `logging.info()` calls, making it environment-agnostic

## Log Structure in Cloud Logging

```json
{
  "severity": "INFO",
  "message": "Crawler found 15 documents from https://...",
  "execution_id": "uuid-here",
  "ticker": "AAPL",
  "scan_type": "update",
  "timestamp": "2026-01-18T...",
  "logger": "scan_ir_website",
  "labels": {
    "instanceId": "..."
  },
  "resource": {
    "type": "cloud_run_revision",
    "labels": {
      "service_name": "ir-scanner",
      "...": "..."
    }
  }
}
```

## Querying Logs in Cloud Console

### Filter by execution ID
```
jsonPayload.execution_id="uuid-here"
```

### Filter by ticker
```
jsonPayload.ticker="AAPL"
```

### Filter by scan type
```
jsonPayload.scan_type="new"
```

### Combine filters
```
jsonPayload.ticker="AAPL" AND jsonPayload.scan_type="update" AND severity>=WARNING
```

## Benefits

1. **Correlation**: All logs for a single scan share the same `execution_id`
2. **Structured**: JSON format enables powerful querying and filtering
3. **Automatic**: No manual JSON formatting - Cloud Logging handles it
4. **Consistent**: Same logging code works locally and in Cloud Run
5. **Standards-based**: Uses Python's standard `logging` module
6. **Traceable**: Can trace entire execution flow across services

## Testing

### Local Test
```bash
cd data-fetcher
source venv/bin/activate
python test_structured_logging.py
```

This demonstrates:
- How to use `client.setup_logging()`
- How to add structured fields with `extra={}`
- How logs appear in Cloud Logging (requires `roles/logging.logWriter` permission)

### Cloud Run Test
Deploy and trigger a scan:
```bash
curl -X POST $SERVICE_URL/scan \
  -H "Content-Type: application/json" \
  -d '{"message": {"data": "'"$(echo -n '{"ticker":"AAPL"}' | base64)"'"}}'
```

Then view logs in Cloud Console with filters like `jsonPayload.execution_id`.

## Migration Notes

- **No stdout interception needed**: Cloud Logging API handles everything
- **Removed `StructuredStdout` class**: No longer needed
- **Removed `JSONFormatter` class**: Cloud Logging formats automatically
- **All `print()` replaced**: Using `logging` module throughout
- **Environment-aware**: Automatically detects Cloud Run vs local

## IAM Requirements

The Cloud Run service account needs:
- `roles/logging.logWriter` - Already granted in deployment setup
- This allows the Cloud Logging client to write log entries

## Future Enhancements

1. **Custom Resources**: Can add custom resource descriptors for better organization
2. **Trace Integration**: Can integrate with Cloud Trace for distributed tracing
3. **Error Reporting**: Can integrate with Cloud Error Reporting for automatic error grouping
4. **Log-based Metrics**: Can create metrics from log entries for monitoring

