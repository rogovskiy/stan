# Cloud Logging Setup Guide

## Overview

The IR scanner uses a centralized logging configuration that automatically adapts to the environment:
- **Cloud Run**: Uses `StructuredLogHandler` to write JSON logs to stdout (which Cloud Run ingests automatically)
- **Local Development**: Uses standard Python logging with console output

All logs include structured context (execution_id, ticker, etc.) via context variables (MDC pattern).

## Architecture

```
Application Code → Python logging module → StructuredLogHandler (Cloud Run) / StreamHandler (local) → Cloud Logging / stdout
                                                      ↓
                                          MDC Context Variables (contextvars)
                                          - execution_id
                                          - ticker
                                          - operation_type
```

## Key Components

### 1. `setup_cloud_logging()`

Centralized function that configures logging based on the environment:

```python
from cloud_logging_setup import setup_cloud_logging

# Call once at application startup
setup_cloud_logging()
```

**What it does:**
- **Cloud Run** (when `K_SERVICE` env var is present):
  - Uses `StructuredLogHandler(stream=sys.stdout)` from `google-cloud-logging`
  - Writes structured JSON logs to stdout
  - Cloud Run automatically ingests these as `jsonPayload` entries
  
- **Local Development**:
  - Uses standard `logging.basicConfig()` with `StreamHandler`
  - Console output for immediate feedback
  - Same logging API, different output destination

**Returns:** `bool` - True if logging was initialized successfully

### 2. Context Variables (MDC Pattern)

Context is propagated using Python's `contextvars`:

```python
from cloud_logging_setup import mdc_execution_id, mdc_ticker, mdc_operation_type

# Set context for current execution
mdc_execution_id.set('exec-123')
mdc_ticker.set('AAPL')
mdc_operation_type.set('scan_start')

# All subsequent log calls will include these fields
logger.info('Processing started')
```

**Available context variables:**
- `mdc_execution_id`: Unique ID for each scan/execution (UUID or trace ID)
- `mdc_ticker`: Stock ticker symbol being processed
- `mdc_operation_type`: Type of operation (e.g., 'scan_start', 'scan_complete')

### 3. Automatic Context Injection

The logging record factory (`_setup_mdc_context()`) automatically includes context variables in all log entries:

```python
# Log entry automatically includes context
logger.info('Processing document', extra={'document_id': 'doc-123'})

# Results in Cloud Logging:
# {
#   "severity": "INFO",
#   "message": "Processing document",
#   "json_fields": {
#     "execution_id": "exec-123",      # from mdc_execution_id
#     "ticker": "AAPL",                # from mdc_ticker
#     "operation_type": "scan_start",  # from mdc_operation_type
#     "document_id": "doc-123"         # from extra parameter
#   }
# }
```

## Usage Patterns

### Pattern 1: Pub/Sub Handler (Entry Point)

```python
from cloud_logging_setup import setup_cloud_logging, mdc_execution_id, mdc_ticker
import logging

# Initialize once at module level
setup_cloud_logging()
logger = logging.getLogger(__name__)

@app.route('/scan', methods=['POST'])
def handle_pubsub():
    execution_id = str(uuid.uuid4())
    ticker = 'AAPL'
    
    # Set context for this request
    mdc_execution_id.set(execution_id)
    mdc_ticker.set(ticker)
    
    # All logs in this request will include execution_id and ticker
    logger.info('Received Pub/Sub message')
    
    # Call other functions - context propagates automatically
    scan_ir_website(ticker, ...)
```

### Pattern 2: Service Classes

```python
from cloud_logging_setup import setup_cloud_logging, emit_metric
import logging

setup_cloud_logging()
logger = logging.getLogger(__name__)

class MyService:
    def process(self):
        # Context from parent function is automatically included
        logger.info('Starting processing')
        
        # Report metrics
        emit_metric('operation_complete',
            duration_seconds=10.5,
            items_processed=42
        )
```

### Pattern 3: Direct Logging with Extra Fields

```python
import logging
from cloud_logging_setup import setup_cloud_logging

setup_cloud_logging()
logger = logging.getLogger(__name__)

# Additional fields go in json_fields automatically
logger.info('Document processed',
    extra={
        'document_id': 'doc-123',
        'file_size_bytes': 1024,
        'duration_ms': 150
    }
)
```

## Log Structure in Cloud Logging

### Cloud Run Logs

```json
{
  "severity": "INFO",
  "message": "Processing document",
  "jsonPayload": {
    "execution_id": "exec-123",
    "ticker": "AAPL",
    "operation_type": "scan_start",
    "document_id": "doc-123",
    "file_size_bytes": 1024
  },
  "resource": {
    "type": "cloud_run_revision",
    "labels": {
      "service_name": "ir-scanner",
      "revision_name": "ir-scanner-00007-xd7"
    }
  },
  "timestamp": "2026-01-18T01:01:14.711119Z"
}
```

### Key Points

- **`jsonPayload`**: All structured fields (from `extra`, context variables, etc.)
- **`labels`**: Cloud Run automatically adds `instanceId`, etc.
- **`resource`**: Cloud Run service metadata
- **`severity`**: Standard Python logging levels (DEBUG, INFO, WARNING, ERROR, CRITICAL)

## Context Propagation

Context variables propagate automatically through:
- Function calls (same thread)
- Async functions (same task)
- Nested calls

**Note:** Context does NOT propagate across:
- Thread boundaries
- Separate processes
- New async tasks (without explicit context copying)

**Best Practice:** Set context at the entry point (e.g., Pub/Sub handler) and let it propagate naturally through the call chain.

## Querying Logs

### Filter by Execution ID

```
jsonPayload.execution_id="exec-123"
```

### Filter by Ticker

```
jsonPayload.ticker="AAPL"
```

### Filter by Operation Type

```
jsonPayload.operation_type="scan_start"
```

### Combine Filters

```
jsonPayload.ticker="AAPL" 
AND jsonPayload.operation_type="scan_complete" 
AND severity>=WARNING
```

### Filter by Resource (Cloud Run)

```
resource.type="cloud_run_revision"
resource.labels.service_name="ir-scanner"
```

## Configuration Details

### Cloud Run Configuration

The `StructuredLogHandler` writes to `sys.stdout` with:
- Automatic JSON serialization of log records
- Support for `json_fields` attribute on log records
- Integration with Cloud Run's log ingestion

### Local Development Configuration

Standard Python logging configured with:
- Level: `INFO`
- Format: `%(message)s` (simple, for readability)
- Handler: `StreamHandler(sys.stdout)`

### Environment Detection

The system detects Cloud Run by checking for `K_SERVICE` environment variable:

```python
is_cloud_run = bool(os.environ.get('K_SERVICE'))
```

This variable is automatically set by Cloud Run for all containers.

## Benefits

1. **Environment-Agnostic**: Same code works in Cloud Run and locally
2. **Automatic Context**: Context variables automatically included in all logs
3. **Structured Logging**: JSON format enables powerful querying in Cloud Logging
4. **Standards-Based**: Uses Python's standard `logging` module
5. **Zero Configuration**: Works out of the box with Application Default Credentials in Cloud Run
6. **Trace Correlation**: Can correlate logs with Cloud Trace using execution_id

## IAM Requirements

### Cloud Run Service Account

The Cloud Run service account needs:
- `roles/logging.logWriter` - To write log entries to Cloud Logging

This is typically already configured during Cloud Run deployment.

### Local Development

For local development, you can either:
- Use Application Default Credentials (ADC) with `gcloud auth application-default login`
- Or rely on standard console output (no IAM needed)

## Troubleshooting

### Logs Not Appearing in Cloud Console

1. **Check IAM permissions**: Service account needs `roles/logging.logWriter`
2. **Verify environment**: Check that `K_SERVICE` is set in Cloud Run
3. **Check stdout**: Cloud Run ingests logs from stdout/stderr
4. **Verify initialization**: Ensure `setup_cloud_logging()` is called before logging

### Context Not Propagating

1. **Check context variables**: Ensure `mdc_execution_id.set()` is called at entry point
2. **Thread boundaries**: Context doesn't propagate across threads
3. **Async tasks**: Context propagates within same async task, but not to new tasks

### Local Logs Not Showing Context

Local logging shows messages but context variables are still set. Check Cloud Logging for structured fields, or use `extra={}` parameters for local visibility.

## Migration Notes

### What Changed

- **Removed**: Custom `JSONFormatter` and `StructuredStdout` classes
- **Removed**: `ContextLogger` class (replaced with contextvars)
- **Removed**: Manual JSON serialization
- **Added**: `StructuredLogHandler` for Cloud Run
- **Added**: Context variables (MDC pattern) for automatic context propagation

### Compatibility

All existing code using `logging.info()`, `logging.error()`, etc. continues to work without changes. The logging infrastructure now handles formatting and context automatically.

## References

- [Google Cloud Logging Python Client](https://cloud.google.com/logging/docs/reference/libraries#client-libraries-usage-python)
- [Structured Logging in Cloud Run](https://cloud.google.com/run/docs/logging)
- [Python Context Variables](https://docs.python.org/3/library/contextvars.html)
- [Python Logging Module](https://docs.python.org/3/library/logging.html)

