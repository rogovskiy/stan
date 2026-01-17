# IR Scanner Metrics Setup Guide

This guide explains how to set up log-based metrics and dashboards for the IR scanner in Google Cloud Monitoring.

## Overview

The IR scanner logs structured metrics to Google Cloud Logging, which can be queried and visualized using:
- **Cloud Logging**: Store and query structured logs
- **Log-based Metrics**: Aggregate logs into time-series metrics
- **Cloud Monitoring**: Create dashboards and alerts

## Architecture

```
IR Scanner → Cloud Logging → Log-based Metrics → Cloud Monitoring Dashboards
                ↓
         Cloud Run Logs (trace correlation)
```

## Metrics Collected

### Per-Execution Metrics
- **scan_start**: Scan initialization
- **scan_complete**: Scan completion with totals
- **gemini_api_call**: Per-call token usage and duration
- **document_download**: Document download metrics
- **document_storage**: Document storage events
- **page_navigation**: Page visit metrics

### Fields Logged
- `execution_id`: Unique ID per scan (trace ID in Cloud Run, UUID locally)
- `operation_type`: Type of operation
- `ticker`: Stock ticker being scanned
- `timestamp`: ISO 8601 timestamp
- `total_tokens`, `prompt_tokens`, `response_tokens`: Token counts
- `duration_seconds`, `duration_ms`: Timing metrics
- `estimated_cost_usd`: Cost estimates

## Setup Instructions

### 1. Prerequisites

Ensure you have:
- Google Cloud project with Cloud Logging enabled
- `FIREBASE_PROJECT_ID` environment variable set
- `google-cloud-logging` Python package installed

```bash
cd data-fetcher
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Verify Logs are Being Written

Run a test scan:

```bash
python scan_ir_website.py AAPL --verbose
```

Check logs in Cloud Console:
```
https://console.cloud.google.com/logs/query
```

Query for metrics:
```
resource.type="global"
logName="projects/YOUR_PROJECT_ID/logs/ir-scanner-metrics"
jsonPayload.execution_id!=""
```

### 3. Create Log-based Metrics

Navigate to **Cloud Logging → Log-based Metrics** or use this URL:
```
https://console.cloud.google.com/logs/metrics
```

#### Metric 1: Total Tokens per Scan

**Name**: `ir_scanner_tokens_total`

**Metric Type**: Counter

**Filter**:
```
resource.type="global"
logName="projects/YOUR_PROJECT_ID/logs/ir-scanner-metrics"
jsonPayload.operation_type="scan_complete"
```

**Field**: `jsonPayload.total_tokens` (SUM)

**Labels**:
- `ticker`: `jsonPayload.ticker`
- `execution_id`: `jsonPayload.execution_id`
- `target_quarter`: `jsonPayload.target_quarter`

#### Metric 2: Scan Duration

**Name**: `ir_scanner_duration_seconds`

**Metric Type**: Counter

**Filter**:
```
resource.type="global"
logName="projects/YOUR_PROJECT_ID/logs/ir-scanner-metrics"
jsonPayload.operation_type="scan_complete"
```

**Field**: `jsonPayload.duration_seconds` (SUM)

**Labels**:
- `ticker`: `jsonPayload.ticker`
- `execution_id`: `jsonPayload.execution_id`

#### Metric 3: Gemini API Call Tokens

**Name**: `ir_scanner_api_call_tokens`

**Metric Type**: Counter

**Filter**:
```
resource.type="global"
logName="projects/YOUR_PROJECT_ID/logs/ir-scanner-metrics"
jsonPayload.operation_type="gemini_api_call"
```

**Field**: `jsonPayload.total_tokens` (SUM)

**Labels**:
- `ticker`: `jsonPayload.ticker`
- `operation`: `jsonPayload.operation`
- `execution_id`: `jsonPayload.execution_id`

#### Metric 4: Scan Cost Estimate

**Name**: `ir_scanner_cost_usd`

**Metric Type**: Counter

**Filter**:
```
resource.type="global"
logName="projects/YOUR_PROJECT_ID/logs/ir-scanner-metrics"
jsonPayload.operation_type="scan_complete"
```

**Field**: `jsonPayload.estimated_cost_usd` (SUM)

**Labels**:
- `ticker`: `jsonPayload.ticker`
- `execution_id`: `jsonPayload.execution_id`

#### Metric 5: Documents Processed

**Name**: `ir_scanner_documents_processed`

**Metric Type**: Counter

**Filter**:
```
resource.type="global"
logName="projects/YOUR_PROJECT_ID/logs/ir-scanner-metrics"
jsonPayload.operation_type="scan_complete"
```

**Field**: `jsonPayload.documents_processed` (SUM)

**Labels**:
- `ticker`: `jsonPayload.ticker`
- `execution_id`: `jsonPayload.execution_id`

#### Metric 6: API Call Count

**Name**: `ir_scanner_api_calls`

**Metric Type**: Counter

**Filter**:
```
resource.type="global"
logName="projects/YOUR_PROJECT_ID/logs/ir-scanner-metrics"
jsonPayload.operation_type="gemini_api_call"
```

**Field**: COUNT

**Labels**:
- `ticker`: `jsonPayload.ticker`
- `operation`: `jsonPayload.operation`

### 4. Create Dashboard

Navigate to **Cloud Monitoring → Dashboards** or use:
```
https://console.cloud.google.com/monitoring/dashboards
```

Click **Create Dashboard** and name it "IR Scanner Metrics".

#### Widget 1: Token Usage Over Time

**Chart Type**: Line Chart

**Metric**: `ir_scanner_tokens_total`

**Aggregation**: SUM

**Group By**: `ticker`

**Time Period**: Last 7 days

#### Widget 2: Scan Duration by Ticker

**Chart Type**: Bar Chart

**Metric**: `ir_scanner_duration_seconds`

**Aggregation**: AVG

**Group By**: `ticker`

**Time Period**: Last 7 days

#### Widget 3: Cost Estimate Over Time

**Chart Type**: Stacked Area Chart

**Metric**: `ir_scanner_cost_usd`

**Aggregation**: SUM

**Group By**: `ticker`

**Time Period**: Last 30 days

#### Widget 4: API Calls by Operation

**Chart Type**: Pie Chart

**Metric**: `ir_scanner_api_calls`

**Aggregation**: SUM

**Group By**: `operation`

**Time Period**: Last 24 hours

#### Widget 5: Documents Processed

**Chart Type**: Scorecard

**Metric**: `ir_scanner_documents_processed`

**Aggregation**: SUM

**Time Period**: Last 7 days

#### Widget 6: Average Tokens per API Call

**Chart Type**: Line Chart

**Metric**: `ir_scanner_api_call_tokens`

**Aggregation**: AVG

**Group By**: `operation`

**Time Period**: Last 7 days

### 5. Query Logs for Analysis

Use **Logs Explorer** or **Log Analytics** for deeper analysis.

#### Find Expensive Scans

```sql
SELECT
  jsonPayload.execution_id,
  jsonPayload.ticker,
  jsonPayload.total_tokens,
  jsonPayload.duration_seconds,
  jsonPayload.estimated_cost_usd,
  timestamp
FROM `YOUR_PROJECT_ID.global._Default_._Default_`
WHERE jsonPayload.operation_type = 'scan_complete'
ORDER BY jsonPayload.total_tokens DESC
LIMIT 10
```

#### Analyze Token Usage by Operation

```sql
SELECT
  jsonPayload.operation,
  AVG(jsonPayload.total_tokens) as avg_tokens,
  MAX(jsonPayload.total_tokens) as max_tokens,
  COUNT(*) as call_count
FROM `YOUR_PROJECT_ID.global._Default_._Default_`
WHERE jsonPayload.operation_type = 'gemini_api_call'
GROUP BY jsonPayload.operation
ORDER BY avg_tokens DESC
```

#### Find Slow API Calls

```sql
SELECT
  jsonPayload.operation,
  jsonPayload.url,
  jsonPayload.duration_ms,
  jsonPayload.total_tokens,
  timestamp
FROM `YOUR_PROJECT_ID.global._Default_._Default_`
WHERE jsonPayload.operation_type = 'gemini_api_call'
  AND jsonPayload.duration_ms > 10000
ORDER BY jsonPayload.duration_ms DESC
LIMIT 20
```

#### Monthly Cost Summary

```sql
SELECT
  FORMAT_TIMESTAMP('%Y-%m', timestamp) as month,
  jsonPayload.ticker,
  SUM(jsonPayload.total_tokens) as total_tokens,
  SUM(jsonPayload.estimated_cost_usd) as total_cost
FROM `YOUR_PROJECT_ID.global._Default_._Default_`
WHERE jsonPayload.operation_type = 'scan_complete'
GROUP BY month, jsonPayload.ticker
ORDER BY month DESC, total_cost DESC
```

### 6. Create Alerts (Optional)

Navigate to **Cloud Monitoring → Alerting**.

#### Alert 1: High Token Usage

**Condition**: `ir_scanner_tokens_total` > 500,000 in 1 hour

**Notification**: Email/Slack

**Purpose**: Detect unusually expensive scans

#### Alert 2: Scan Failures

**Filter**:
```
resource.type="global"
logName="projects/YOUR_PROJECT_ID/logs/ir-scanner-metrics"
severity="ERROR"
```

**Condition**: Count > 5 in 10 minutes

**Notification**: Email/Slack

#### Alert 3: Monthly Budget Alert

**Condition**: `ir_scanner_cost_usd` > $50 in 30 days

**Notification**: Email

**Purpose**: Stay within budget

## Cloud Run Integration

When running in Cloud Run, the scanner automatically uses the request trace ID as the execution ID.

### View Correlated Logs

In Cloud Logging, query:
```
resource.type="cloud_run_revision"
resource.labels.service_name="YOUR_SERVICE_NAME"
trace="projects/YOUR_PROJECT_ID/traces/TRACE_ID"
```

This shows both application logs and metrics logs for the same request.

### Export to BigQuery (Optional)

For long-term analysis, export logs to BigQuery:

1. Go to **Cloud Logging → Log Router**
2. Create sink with filter:
   ```
   logName="projects/YOUR_PROJECT_ID/logs/ir-scanner-metrics"
   ```
3. Destination: BigQuery dataset
4. Wait 24 hours for data to populate

Then query in BigQuery:
```sql
SELECT * FROM `your-project.your_dataset._AllLogs`
WHERE jsonPayload.operation_type IS NOT NULL
```

## Cost Estimates

### Free Tier (per month)
- **Cloud Logging**: First 50 GB free
- **Log-based Metrics**: First 150 MB free
- **Cloud Monitoring API calls**: First 1M calls free

### Expected Costs for IR Scanner

**Typical scan**: ~100 API calls, ~5 KB logs

**1000 scans/month**:
- Logs: ~5 MB (well within free tier)
- Log-based metrics: ~1 MB (within free tier)
- **Total cost: $0/month**

**10,000 scans/month**:
- Logs: ~50 MB (within free tier)
- Log-based metrics: ~10 MB (within free tier)
- **Total cost: $0/month**

## Troubleshooting

### Logs not appearing in Cloud Console

1. Check `FIREBASE_PROJECT_ID` environment variable is set
2. Verify service account has `roles/logging.logWriter` permission
3. Check for errors in console output: `Warning: Could not initialize Cloud Logging client`
4. Logs fall back to stdout if Cloud Logging unavailable

### Metrics not showing data

1. Wait 2-3 minutes for metric data to populate
2. Verify log-based metric filter matches your logs
3. Check metric has correct field name (e.g., `jsonPayload.total_tokens`)
4. Ensure metric labels are correctly defined

### Cost higher than expected

1. Check for multiple log sinks writing the same data
2. Review retention settings in Log Router
3. Query for high-volume log sources
4. Consider sampling high-frequency logs

## Best Practices

1. **Use execution IDs**: Always correlate related logs using execution_id
2. **Set retention**: Configure log retention to 30-90 days for cost control
3. **Monitor costs**: Set up budget alerts in Cloud Billing
4. **Use Log Analytics**: For complex queries, use SQL interface
5. **Export to BigQuery**: For long-term analysis (6+ months)
6. **Create custom views**: Save frequently used log queries
7. **Dashboard templates**: Export dashboard JSON for reuse across projects

## Resources

- [Cloud Logging Documentation](https://cloud.google.com/logging/docs)
- [Log-based Metrics](https://cloud.google.com/logging/docs/logs-based-metrics)
- [Cloud Monitoring Dashboards](https://cloud.google.com/monitoring/dashboards)
- [Pricing Calculator](https://cloud.google.com/products/calculator)

