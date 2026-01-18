# Structured Logging Test Results

## Summary

The test program `test_structured_logging.py` demonstrates **Google Cloud Logging API** usage with `setup_logging()`. This is different from how we log in Cloud Run.

## Two Approaches to Logging

### Approach 1: Cloud Run Stdout (What We Use) ✅

**How it works:**
- Write JSON to stdout using Python's `logging` module with `JSONFormatter`
- Cloud Run automatically ingests stdout and sends to Cloud Logging
- No special permissions needed - Cloud Run service handles it

**Code example (from `pubsub_handler.py`):**
```python
class JSONFormatter(logging.Formatter):
    def format(self, record):
        return json.dumps({
            'severity': record.levelname,
            'message': record.getMessage(),
            'execution_id': getattr(record, 'execution_id', None),
            'ticker': getattr(record, 'ticker', None),
            'scan_type': getattr(record, 'scan_type', None),
        })

handler = logging.StreamHandler(sys.stdout)
handler.setFormatter(JSONFormatter())
logging.root.addHandler(handler)
```

**Advantages:**
- Simple - just write JSON to stdout
- Works automatically in Cloud Run
- No IAM permissions needed
- Low latency

### Approach 2: Cloud Logging API (What test_structured_logging.py Shows)

**How it works:**
- Use `google.cloud.logging.Client()` with `setup_logging()`
- Makes API calls directly to Cloud Logging
- Requires `roles/logging.logWriter` IAM permission

**Code example:**
```python
import google.cloud.logging

client = google.cloud.logging.Client(project=project_id, credentials=creds)
client.setup_logging()

# Now standard logging.info() sends to Cloud Logging API
logging.info("message", extra={'execution_id': '123'})
```

**Advantages:**
- Can write logs from anywhere (not just Cloud Run)
- More control over log entries
- Can use advanced features (resource descriptors, etc.)

**Disadvantages:**
- Requires IAM permission: `roles/logging.logWriter`
- Additional API calls and latency
- More complex setup

## Test Results

When running `test_structured_logging.py` locally:

✅ **Success:** The script runs and attempts to send logs
❌ **Permission Error:** `403 Permission 'logging.logEntries.create' denied`

This is expected! The Firebase service account doesn't have `logging.logWriter` role by default.

## How to Fix (If You Want to Use Cloud Logging API)

Grant the logging.logWriter role to your service account:

```bash
gcloud projects add-iam-policy-binding stan-1464e \
  --member="serviceAccount:firebase-adminsdk-xxxxx@stan-1464e.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter"
```

## Recommendation for Cloud Run

**Continue using Approach 1 (stdout with JSONFormatter)** because:
1. It's already working in your Cloud Run deployment
2. No additional IAM permissions needed
3. Simpler and more performant
4. Cloud Run automatically handles log ingestion

The test program demonstrates Approach 2 mainly for educational purposes and local testing scenarios where you might want to send logs directly to Cloud Logging without using Cloud Run's stdout ingestion.

