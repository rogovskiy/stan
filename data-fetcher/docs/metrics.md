# Metrics Implementation Guide

## Overview

The IR scanner uses log-based metrics for monitoring and observability. Metrics are emitted as structured log entries that can be aggregated into time-series metrics in Google Cloud Monitoring.

## Architecture

```
Application Code → emit_metric() → Cloud Logging → Log-based Metrics → Cloud Monitoring Dashboards
```

All metrics are logged as structured JSON entries with the format:
```
Metric: {metric_name}
jsonPayload: {
  metric_name: "...",
  ...metric_fields...
}
```

## Metrics API

### `emit_metric()` Function

The primary way to emit metrics:

```python
from cloud_logging_setup import emit_metric

emit_metric('metric_name',
    field1=value1,
    field2=value2,
    ...
)
```

**Parameters:**
- `metric_name` (str): Name of the metric (required)
- `**metric_fields`: Additional fields to include in the metric log entry

**Example:**
```python
emit_metric('scan_complete',
    duration_seconds=120.5,
    total_documents=15,
    documents_processed=12,
    documents_skipped=3,
    total_tokens=45000,
    target_quarter='2024Q1'
)
```

### How It Works

The `emit_metric()` function:
1. Creates a log entry with message `f'Metric: {metric_name}'`
2. Includes all metric fields in the log entry's `extra` dictionary
3. Logs at INFO level using standard Python logging
4. Cloud Logging automatically captures and structures the log
5. Log-based metrics can extract values from `jsonPayload` fields

## Available Metrics

### 1. `scan_start`

Emitted when a scan begins.

**Fields:**
- `target_quarter` (str, optional): Target quarter filter
- `max_pages` (int): Maximum pages to crawl
- `num_urls` (int): Number of IR URLs to scan

**Example:**
```python
emit_metric('scan_start',
    target_quarter='2024Q1',
    max_pages=50,
    num_urls=2
)
```

**Usage:** Track scan initiation, filter usage

---

### 2. `scan_complete`

Emitted when a scan finishes successfully.

**Fields:**
- `duration_seconds` (float): Total scan duration
- `total_documents` (int): Total documents found
- `documents_processed` (int): Documents successfully processed
- `documents_skipped` (int): Documents skipped (e.g., duplicates)
- `total_tokens` (int): Total Gemini API tokens used
- `prompt_tokens` (int): Prompt tokens
- `response_tokens` (int): Response tokens
- `target_quarter` (str, optional): Target quarter filter
- `estimated_cost_usd` (float): Estimated API cost

**Example:**
```python
emit_metric('scan_complete',
    duration_seconds=120.5,
    total_documents=15,
    documents_processed=12,
    documents_skipped=3,
    total_tokens=45000,
    prompt_tokens=30000,
    response_tokens=15000,
    target_quarter='2024Q1',
    estimated_cost_usd=0.15
)
```

**Usage:** Track scan performance, token usage, costs

---

### 3. `gemini_api_call`

Emitted for each Gemini API call during document extraction.

**Fields:**
- `operation` (str): Operation type ('listing_page_extraction', 'detail_page_extraction')
- `url` (str): URL being processed (truncated to 200 chars)
- `prompt_tokens` (int): Prompt tokens for this call
- `response_tokens` (int): Response tokens for this call
- `total_tokens` (int): Total tokens for this call
- `duration_ms` (float): API call duration in milliseconds

**Example:**
```python
emit_metric('gemini_api_call',
    operation='detail_page_extraction',
    url='https://investor.company.com/earnings/...',
    prompt_tokens=15000,
    response_tokens=5000,
    total_tokens=20000,
    duration_ms=2500.5
)
```

**Usage:** Track API usage patterns, identify expensive operations

---

### 4. `html_reduction`

Emitted when HTML is reduced before sending to Gemini.

**Fields:**
- `original_size_bytes` (int): Original HTML size in bytes
- `reduced_size_bytes` (int): Reduced HTML size in bytes
- `reduction_bytes` (int): Bytes removed
- `reduction_percent` (float): Percentage reduction (0-100)
- `original_tokens_est` (float): Estimated original token count (~4 chars/token)
- `reduced_tokens_est` (float): Estimated reduced token count
- `tokens_saved_est` (float): Estimated tokens saved
- `aggressive` (bool): Whether aggressive reduction was used
- `elements_preserved` (bool): Whether semantic elements were preserved
- `url` (str): URL of the page (informational)

**Example:**
```python
emit_metric('html_reduction',
    original_size_bytes=1024000,
    reduced_size_bytes=512000,
    reduction_bytes=512000,
    reduction_percent=50.0,
    original_tokens_est=256000,
    reduced_tokens_est=128000,
    tokens_saved_est=128000,
    aggressive=False,
    elements_preserved=True,
    url='https://investor.company.com/...'
)
```

**Usage:** Track HTML reduction effectiveness, optimize token usage

---

### 5. `document_download`

Emitted when a document is downloaded from a URL.

**Fields:**
- `url` (str): Document URL (truncated to 200 chars)
- `file_size_bytes` (int): Downloaded file size
- `duration_ms` (float): Download duration in milliseconds
- `success` (bool): Whether download succeeded

**Example:**
```python
emit_metric('document_download',
    url='https://investor.company.com/reports/earnings.pdf',
    file_size_bytes=2048000,
    duration_ms=1500.2,
    success=True
)
```

**Usage:** Track download performance, identify slow/failing downloads

---

### 6. `document_storage`

Emitted when a document is stored in Firebase.

**Fields:**
- `document_id` (str): Unique document ID
- `quarter_key` (str): Quarter identifier (e.g., '2024Q1')
- `document_type` (str): Document type (e.g., 'earnings', 'presentation')

**Example:**
```python
emit_metric('document_storage',
    document_id='doc-123-abc',
    quarter_key='2024Q1',
    document_type='earnings'
)
```

**Usage:** Track document storage events, categorize by type/quarter

---

### 7. `crawler_complete`

Emitted when the crawler finishes processing a website.

**Fields:**
- `listing_pages` (int): Number of listing pages visited
- `detail_pages` (int): Number of detail pages visited
- `documents_found` (int): Total documents discovered
- `direct_pdfs` (int): Direct PDF links found
- `from_details` (int): Documents extracted from detail pages
- `prompt_tokens` (int): Total prompt tokens
- `response_tokens` (int): Total response tokens
- `total_tokens` (int): Total tokens used

**Example:**
```python
emit_metric('crawler_complete',
    listing_pages=5,
    detail_pages=20,
    documents_found=15,
    direct_pdfs=3,
    from_details=12,
    prompt_tokens=30000,
    response_tokens=15000,
    total_tokens=45000
)
```

**Usage:** Track crawler efficiency, page visit patterns

## Context in Metrics

All metrics automatically include context from MDC (context variables):
- `execution_id`: From `mdc_execution_id` (set at request entry point)
- `ticker`: From `mdc_ticker` (set at request entry point)
- `operation_type`: From `mdc_operation_type` (set during processing)

These fields are automatically included in the `jsonPayload` of all metric log entries.

## Creating Log-based Metrics

### Step 1: Create Metric in Cloud Logging

Navigate to **Cloud Logging → Log-based Metrics** or:
```
https://console.cloud.google.com/logs/metrics
```

### Step 2: Define Metric

**Example: Total Tokens per Scan**

- **Name**: `ir_scanner_tokens_total`
- **Type**: Counter
- **Filter**:
  ```
  resource.type="cloud_run_revision"
  resource.labels.service_name="ir-scanner"
  jsonPayload.metric_name="scan_complete"
  ```
- **Field**: `jsonPayload.total_tokens` (SUM)
- **Labels**:
  - `ticker`: `jsonPayload.ticker`
  - `execution_id`: `jsonPayload.execution_id`

### Step 3: Use in Dashboard

Create a chart in Cloud Monitoring Dashboard:
- **Metric**: `ir_scanner_tokens_total`
- **Aggregation**: SUM
- **Group By**: `ticker`
- **Time Period**: Last 7 days

## Querying Metrics

### In Cloud Logging

Filter for specific metrics:
```
resource.type="cloud_run_revision"
jsonPayload.metric_name="scan_complete"
jsonPayload.ticker="AAPL"
```

### Using Log Analytics (SQL)

```sql
SELECT
  jsonPayload.metric_name,
  jsonPayload.ticker,
  AVG(jsonPayload.duration_seconds) as avg_duration,
  SUM(jsonPayload.total_tokens) as total_tokens,
  COUNT(*) as metric_count
FROM `YOUR_PROJECT_ID.cloud_run_revision._AllLogs`
WHERE jsonPayload.metric_name = 'scan_complete'
  AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY)
GROUP BY jsonPayload.metric_name, jsonPayload.ticker
ORDER BY total_tokens DESC
```

## Best Practices

### 1. Consistent Field Names

Use consistent field names across related metrics:
- `duration_seconds` (not `duration`, `time`, `elapsed`)
- `total_tokens` (not `tokens`, `token_count`)
- `file_size_bytes` (not `size`, `bytes`)

### 2. Include Context

Context (execution_id, ticker) is automatically included. Don't manually add these fields to `emit_metric()` calls.

### 3. Meaningful Metric Names

Use descriptive, hierarchical names:
- ✅ `scan_complete`
- ✅ `document_download`
- ❌ `done`
- ❌ `metric1`

### 4. Use Appropriate Data Types

- Integers for counts (documents, pages, tokens)
- Floats for measurements (duration, percentages, costs)
- Booleans for flags (success, aggressive)
- Strings for identifiers (url, document_id)

### 5. Truncate Long Strings

Truncate URLs and long strings to prevent log bloat:
```python
url_truncated = url[:200] if url else None
emit_metric('document_download', url=url_truncated, ...)
```

### 6. Group Related Fields

Emit related metrics together when possible:
```python
# At scan start
emit_metric('scan_start', max_pages=50, num_urls=2)

# At scan complete
emit_metric('scan_complete', 
    duration_seconds=duration,
    total_documents=len(documents),
    documents_processed=processed_count
)
```

## Cost Considerations

### Log Storage

- Each metric log entry is ~1-2 KB
- Typical scan: ~100 metric entries = ~100-200 KB
- **1000 scans/month**: ~100-200 MB (within free tier)
- **10,000 scans/month**: ~1-2 GB (may incur costs)

### Log-based Metrics

- Free tier: First 150 MB/month
- Typical usage: ~1-10 MB/month
- **Cost: $0/month for most use cases**

### Optimization Tips

1. **Sample low-value metrics**: Don't emit `html_reduction` for every page if not needed
2. **Aggregate locally**: Emit summary metrics instead of per-item metrics when possible
3. **Use appropriate log levels**: DEBUG for detailed metrics, INFO for important ones
4. **Set retention policies**: Configure log retention (30-90 days) to control costs

## Troubleshooting

### Metrics Not Appearing

1. **Check log entries**: Verify `emit_metric()` is being called
2. **Verify IAM**: Service account needs `roles/logging.logWriter`
3. **Check filters**: Ensure log-based metric filter matches actual log format
4. **Wait time**: Log-based metrics can take 2-3 minutes to populate

### Incorrect Metric Values

1. **Check field names**: Ensure log-based metric uses correct `jsonPayload` field name
2. **Verify data types**: SUM works with numbers, not strings
3. **Check filter**: Ensure filter matches metric log entries correctly

### High Costs

1. **Review log volume**: Check how many metric entries are being created
2. **Reduce verbosity**: Only emit metrics that provide value
3. **Set retention**: Configure shorter retention periods
4. **Sample metrics**: Emit metrics less frequently if needed

## References

- [Log-based Metrics Documentation](https://cloud.google.com/logging/docs/logs-based-metrics)
- [Cloud Monitoring Dashboards](https://cloud.google.com/monitoring/dashboards)
- [Cloud Logging Query Language](https://cloud.google.com/logging/docs/view/logging-query-language)

