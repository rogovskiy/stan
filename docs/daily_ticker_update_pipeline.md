# Daily Ticker Data Update Pipeline

This document describes the complete system architecture and pipeline for keeping ticker data updated daily.

## Overview

The daily update pipeline refreshes all data sources for tickers, processes new documents, extracts KPIs, and generates quarterly analyses. The pipeline is designed to run automatically via Cloud Scheduler and scales efficiently using Cloud Run.

All major scripts are deployed as Cloud Run services that can be triggered via HTTP or Pub/Sub, enabling serverless execution with automatic scaling.

## Pipeline Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│              Cloud Scheduler (Triggers at scheduled times)       │
└────────────┬─────────────────────────────────────────────────────┘
             │
             │ Publishes to trigger topic
             ▼
┌──────────────────────────────────────────────────────────────────┐
│         Cloud Function: Orchestrator (Fan-out coordinator)       │
│  • Reads all tickers from Firebase                               │
│  • Publishes N messages to appropriate Pub/Sub topics           │
│  • Handles conditional logic                                     │
└────────────┬─────────────────────────────────────────────────────┘
             │
             │ Fan out to multiple topics
             │
             ├─► Pub/Sub: data-fetch-requests (50+ messages)
             │        │
             │        ▼
             │   Cloud Run: data-fetcher (1 instance per ticker)
             │        └─► Firebase (price, analyst, financials)
             │
             ├─► Pub/Sub: ir-scan-requests (50+ messages, one per ticker)
             │        │
             │        ▼
             │   Cloud Run: ir-scanner (parallel instances, up to 20)
             │        └─► Firebase (documents)
             │
             ├─► Pub/Sub: kpi-extract-requests (conditional, only if new docs)
             │        │
             │        ▼
             │   Cloud Run: kpi-extractor (parallel instances)
             │        └─► Firebase (KPIs)
             │
             ├─► Pub/Sub: quarterly-analysis-requests (conditional)
             │        │
             │        ▼
             │   Cloud Run: quarterly-analyzer (parallel instances)
             │        └─► Firebase (summaries, theses)
             │
             └─► Pub/Sub: company-summary-requests (weekly, 50+ messages)
                      │
                      ▼
                 Cloud Run: company-summary (parallel instances)
                      └─► Firebase (company info)

Key: Cloud Scheduler → Orchestrator → Fan out → Cloud Run (parallel)
     All Cloud Run services: Auto-scale 0→N, Pay-per-use, No idle costs
```

---

## Technical Architecture (Cloud Run Deployment)

### Overview

All pipeline scripts are deployed as **Cloud Run services** that can be invoked via:
- **Pub/Sub push subscriptions** (event-driven)
- **HTTP endpoints** (direct invocation)
- **Cloud Scheduler** (scheduled triggers)

This provides a fully serverless, auto-scaling architecture with no idle costs.

### Cloud Run Services

#### 1. **IR Scanner Service** (`ir-scanner`)

**Purpose:** Scan investor relations websites and download documents

**Deployment:**
```bash
cd data-fetcher
gcloud run deploy ir-scanner \
  --source . \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 600 \
  --max-instances 20 \
  --concurrency 1 \
  --no-allow-unauthenticated \
  --service-account ir-scanner@PROJECT_ID.iam.gserviceaccount.com
```

**Endpoints:**
- `POST /scan` - Scan IR website for a ticker
- `GET /health` - Health check
- `GET /` - Service info

**Invocation:**
```bash
# Via Pub/Sub (preferred)
gcloud pubsub topics publish ir-scan-requests \
  --message '{"ticker":"AAPL","verbose":true}'

# Via HTTP (direct)
SERVICE_URL=$(gcloud run services describe ir-scanner --region us-central1 --format 'value(status.url)')
curl -X POST $SERVICE_URL/scan \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"message":{"data":"eyJ0aWNrZXIiOiJBQVBMIn0="}}'
```

**Source:** `pubsub_handler.py`, `scan_ir_website.py`

---

#### 2. **Data Fetcher Service** (`data-fetcher`)

**Purpose:** Fetch Yahoo Finance data (price, analyst data, quarterly financials)

**Deployment:**
```bash
cd data-fetcher
gcloud run deploy data-fetcher \
  --source . \
  --region us-central1 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 10 \
  --no-allow-unauthenticated \
  --service-account data-fetcher@PROJECT_ID.iam.gserviceaccount.com
```

**Endpoints:**
- `POST /fetch-analyst-data` - Fetch analyst data for ticker(s)
- `POST /fetch-price-data` - Fetch historical price data
- `POST /fetch-all` - Fetch all data types
- `GET /health` - Health check

**Invocation:**
```bash
# Via HTTP
SERVICE_URL=$(gcloud run services describe data-fetcher --region us-central1 --format 'value(status.url)')
curl -X POST $SERVICE_URL/fetch-all \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"tickers":["AAPL","MSFT","GOOGL"]}'
```

**Required Script:** Create `data_fetcher_handler.py` (Flask/FastAPI handler)

---

#### 3. **KPI Extractor Service** (`kpi-extractor`)

**Purpose:** Extract KPIs from IR documents and unify with definitions

**Deployment:**
```bash
cd data-fetcher
gcloud run deploy kpi-extractor \
  --source . \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 900 \
  --max-instances 5 \
  --no-allow-unauthenticated \
  --service-account kpi-extractor@PROJECT_ID.iam.gserviceaccount.com
```

**Endpoints:**
- `POST /extract` - Extract KPIs for a ticker/quarter
- `POST /extract-batch` - Extract KPIs for multiple quarters
- `GET /health` - Health check

**Invocation:**
```bash
# Via Pub/Sub
gcloud pubsub topics publish kpi-extract-requests \
  --message '{"ticker":"AAPL","quarter":"2025Q1"}'

# Via HTTP
SERVICE_URL=$(gcloud run services describe kpi-extractor --region us-central1 --format 'value(status.url)')
curl -X POST $SERVICE_URL/extract \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"ticker":"AAPL","quarter":"2025Q1"}'
```

**Required Script:** Create `kpi_extractor_handler.py`

---

#### 4. **Quarterly Analysis Service** (`quarterly-analyzer`)

**Purpose:** Generate quarterly summaries and growth theses

**Deployment:**
```bash
cd data-fetcher
gcloud run deploy quarterly-analyzer \
  --source . \
  --region us-central1 \
  --memory 2Gi \
  --cpu 2 \
  --timeout 900 \
  --max-instances 5 \
  --no-allow-unauthenticated \
  --service-account quarterly-analyzer@PROJECT_ID.iam.gserviceaccount.com
```

**Endpoints:**
- `POST /analyze` - Generate analysis for a ticker/quarter
- `POST /analyze-batch` - Analyze multiple quarters
- `GET /health` - Health check

**Invocation:**
```bash
# Via Pub/Sub
gcloud pubsub topics publish quarterly-analysis-requests \
  --message '{"ticker":"AAPL","quarter":"2025Q1"}'
```

**Required Script:** Create `quarterly_analyzer_handler.py`

---

#### 5. **Company Summary Service** (`company-summary`)

**Purpose:** Generate company summaries (business model, competitive moat)

**Deployment:**
```bash
cd data-fetcher
gcloud run deploy company-summary \
  --source . \
  --region us-central1 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 5 \
  --no-allow-unauthenticated \
  --service-account company-summary@PROJECT_ID.iam.gserviceaccount.com
```

**Endpoints:**
- `POST /generate` - Generate company summary for ticker
- `POST /generate-batch` - Generate for multiple tickers
- `GET /health` - Health check

**Invocation:**
```bash
# Via HTTP
SERVICE_URL=$(gcloud run services describe company-summary --region us-central1 --format 'value(status.url)')
curl -X POST $SERVICE_URL/generate-batch \
  -H "Authorization: Bearer $(gcloud auth print-identity-token)" \
  -H "Content-Type: application/json" \
  -d '{"tickers":["AAPL","MSFT","GOOGL"]}'
```

**Required Script:** Create `company_summary_handler.py`

---

### Pub/Sub Topics and Subscriptions

#### Topic 1: `ir-scan-requests`

**Purpose:** Trigger IR website scans

**Subscription:**
```bash
gcloud pubsub topics create ir-scan-requests

gcloud pubsub subscriptions create ir-scanner-sub \
  --topic ir-scan-requests \
  --push-endpoint="https://ir-scanner-XXXXX.run.app/scan" \
  --push-auth-service-account=ir-scanner@PROJECT_ID.iam.gserviceaccount.com \
  --ack-deadline 600 \
  --max-retry-delay 600s \
  --min-retry-delay 10s
```

**Message Format:**
```json
{
  "ticker": "AAPL",
  "quarter": "2025Q1",  // Optional filter
  "verbose": true       // Optional
}
```

---

#### Topic 2: `data-fetch-requests`

**Purpose:** Trigger Yahoo Finance data fetching

**Subscription:**
```bash
gcloud pubsub topics create data-fetch-requests

gcloud pubsub subscriptions create data-fetcher-sub \
  --topic data-fetch-requests \
  --push-endpoint="https://data-fetcher-XXXXX.run.app/fetch-all" \
  --push-auth-service-account=data-fetcher@PROJECT_ID.iam.gserviceaccount.com \
  --ack-deadline 300
```

**Message Format:**
```json
{
  "tickers": ["AAPL", "MSFT"],
  "data_types": ["analyst", "price", "financials"]  // Optional
}
```

---

#### Topic 3: `kpi-extract-requests`

**Purpose:** Trigger KPI extraction

**Subscription:**
```bash
gcloud pubsub topics create kpi-extract-requests

gcloud pubsub subscriptions create kpi-extractor-sub \
  --topic kpi-extract-requests \
  --push-endpoint="https://kpi-extractor-XXXXX.run.app/extract" \
  --push-auth-service-account=kpi-extractor@PROJECT_ID.iam.gserviceaccount.com \
  --ack-deadline 900
```

**Message Format:**
```json
{
  "ticker": "AAPL",
  "quarter": "2025Q1",
  "skip_unification": false
}
```

---

#### Topic 4: `quarterly-analysis-requests`

**Purpose:** Trigger quarterly analysis generation

**Subscription:**
```bash
gcloud pubsub topics create quarterly-analysis-requests

gcloud pubsub subscriptions create quarterly-analyzer-sub \
  --topic quarterly-analysis-requests \
  --push-endpoint="https://quarterly-analyzer-XXXXX.run.app/analyze" \
  --push-auth-service-account=quarterly-analyzer@PROJECT_ID.iam.gserviceaccount.com \
  --ack-deadline 900
```

**Message Format:**
```json
{
  "ticker": "AAPL",
  "quarter": "2025Q1"
}
```

---

#### Topic 5: `company-summary-requests`

**Purpose:** Trigger company summary generation

**Subscription:**
```bash
gcloud pubsub topics create company-summary-requests

gcloud pubsub subscriptions create company-summary-sub \
  --topic company-summary-requests \
  --push-endpoint="https://company-summary-XXXXX.run.app/generate" \
  --push-auth-service-account=company-summary@PROJECT_ID.iam.gserviceaccount.com \
  --ack-deadline 300
```

**Message Format:**
```json
{
  "ticker": "AAPL"
}
```

---

### Cloud Scheduler Jobs

**Important:** Cloud Scheduler publishes to the **orchestrator trigger topic** (not directly to service topics). The orchestrator function then fans out to individual ticker messages.

#### Job 1: Daily Data Fetch (6:00 AM ET)

```bash
gcloud scheduler jobs create pubsub daily-data-fetch \
  --location us-central1 \
  --schedule "0 6 * * *" \
  --topic pipeline-orchestrator-trigger \
  --message-body '{"action":"fetch_all_tickers"}' \
  --time-zone "America/New_York" \
  --description "Daily Yahoo Finance data fetch - triggers orchestrator"
```

**Flow:**
```
Scheduler → orchestrator-trigger topic (1 message)
            ↓
         Orchestrator Function (reads all tickers)
            ↓
         data-fetch-requests topic (50+ messages, one per ticker)
            ↓
         Cloud Run: data-fetcher (parallel instances)
```

---

#### Job 2: Daily IR Scans (6:30 AM ET)

```bash
gcloud scheduler jobs create pubsub daily-ir-scans \
  --location us-central1 \
  --schedule "30 6 * * *" \
  --topic pipeline-orchestrator-trigger \
  --message-body '{"action":"scan_all_tickers"}' \
  --time-zone "America/New_York" \
  --description "Daily IR website scans - triggers orchestrator"
```

**Flow:**
```
Scheduler → orchestrator-trigger topic (1 message)
            ↓
         Orchestrator Function (reads all tickers)
            ↓
         ir-scan-requests topic (50+ messages, one per ticker)
            ↓
         Cloud Run: ir-scanner (up to 20 parallel instances)
```

---

#### Job 3: Check for New Documents (10:00 AM ET)

```bash
gcloud scheduler jobs create pubsub check-new-documents \
  --location us-central1 \
  --schedule "0 10 * * *" \
  --topic pipeline-orchestrator-trigger \
  --message-body '{"action":"check_new_documents"}' \
  --time-zone "America/New_York" \
  --description "Check for new documents and trigger processing"
```

**Flow:**
```
Scheduler → orchestrator-trigger topic (1 message)
            ↓
         Orchestrator Function (checks for new docs in last 6 hours)
            ↓
         Conditionally publishes to:
         ├─► kpi-extract-requests (only quarters with new docs)
         └─► quarterly-analysis-requests (only quarters with new docs)
            ↓
         Cloud Run: kpi-extractor & quarterly-analyzer (parallel)
```

---

#### Job 4: Weekly Company Summary Refresh (Sunday 3:00 AM ET)

```bash
gcloud scheduler jobs create pubsub weekly-company-summary \
  --location us-central1 \
  --schedule "0 3 * * 0" \
  --topic pipeline-orchestrator-trigger \
  --message-body '{"action":"refresh_all_company_summaries"}' \
  --time-zone "America/New_York" \
  --description "Weekly company summary refresh - triggers orchestrator"
```

**Flow:**
```
Scheduler → orchestrator-trigger topic (1 message)
            ↓
         Orchestrator Function (reads all tickers)
            ↓
         company-summary-requests topic (50+ messages, one per ticker)
            ↓
         Cloud Run: company-summary (parallel instances)
```

**Note:** All scheduler jobs publish to the **same orchestrator trigger topic** but with different actions. The orchestrator function routes to appropriate service topics.

---

### Fan-Out Pattern Visualization

**Example: Daily IR Scan at 6:30 AM ET**

```
┌────────────────────────────────────────────────────────────┐
│  Step 1: Cloud Scheduler Job "daily-ir-scans"             │
│  Triggers once per day at 6:30 AM ET                       │
└────────────┬───────────────────────────────────────────────┘
             │
             │ Publishes 1 message
             ▼
┌────────────────────────────────────────────────────────────┐
│  Pub/Sub Topic: "pipeline-orchestrator-trigger"           │
│  Message: {"action": "scan_all_tickers"}                   │
└────────────┬───────────────────────────────────────────────┘
             │
             │ Triggers (1 invocation)
             ▼
┌────────────────────────────────────────────────────────────┐
│  Step 2: Cloud Function "pipeline-orchestrator"           │
│                                                            │
│  def orchestrate():                                        │
│    tickers = get_all_tickers()  # [AAPL, MSFT, ...]       │
│    for ticker in tickers:                                  │
│      publish_to_topic('ir-scan-requests', ticker)         │
│                                                            │
│  Executes once, publishes N messages                       │
└────────────┬───────────────────────────────────────────────┘
             │
             │ Publishes 50+ messages (fan-out)
             ▼
┌────────────────────────────────────────────────────────────┐
│  Pub/Sub Topic: "ir-scan-requests"                        │
│                                                            │
│  Message 1: {"ticker": "AAPL"}                             │
│  Message 2: {"ticker": "MSFT"}                             │
│  Message 3: {"ticker": "GOOGL"}                            │
│  ...                                                       │
│  Message 50: {"ticker": "ZM"}                              │
└────────────┬───────────────────────────────────────────────┘
             │
             │ Push subscription triggers Cloud Run for each message
             ▼
┌────────────────────────────────────────────────────────────┐
│  Step 3: Cloud Run Service "ir-scanner"                   │
│  (Parallel execution - up to max-instances)                │
│                                                            │
│  Instance 1 ──► Processing AAPL  ──► Firebase             │
│  Instance 2 ──► Processing MSFT  ──► Firebase             │
│  Instance 3 ──► Processing GOOGL ──► Firebase             │
│  ...                                                       │
│  Instance 20 ─► Processing ZM    ──► Firebase             │
│                                                            │
│  Auto-scales: 0 → 20 instances (or fewer if < 20 tickers) │
└────────────────────────────────────────────────────────────┘

Result: 
- 1 scheduler trigger
- 1 orchestrator invocation  
- 50 Pub/Sub messages
- Up to 20 parallel Cloud Run instances (concurrency=1, max-instances=20)
- All tickers processed in ~3 minutes total (vs 150 min sequential)
```

**Cost Example (50 tickers):**
- Cloud Scheduler: $0.10/month for 1 job
- Orchestrator Function: 1 invocation × 5 sec × $0.0000004/GB-sec = ~$0.000002
- Pub/Sub: 50 messages (well within free tier of 10GB/month)
- Cloud Run: 50 tickers × 3 min × 2 vCPU = 18,000 vCPU-sec = $0.43/day
- **Total: ~$0.43/day** (orchestrator cost is negligible)

---

### Orchestrator Function (Cloud Function)

**Purpose:** Coordinate complex workflows and fan out requests to multiple tickers

**Why We Need This:**
- Cloud Scheduler can only publish to **one topic** per job
- We need to fan out to **many tickers** (e.g., 50+ tickers for IR scans)
- We need **conditional logic** (only process if new docs found)
- We need to **batch operations** efficiently

**Pattern:**
```
Cloud Scheduler → Orchestrator Function → Fan out to Pub/Sub Topics (per ticker)
```

**Deployment:**
```bash
cd functions
gcloud functions deploy pipeline-orchestrator \
  --gen2 \
  --runtime python311 \
  --region us-central1 \
  --source . \
  --entry-point orchestrate \
  --trigger-topic pipeline-orchestrator-trigger \
  --service-account pipeline-orchestrator@PROJECT_ID.iam.gserviceaccount.com \
  --timeout 540s \
  --memory 512MB
```

**Capabilities:**
1. **Fan-out patterns** - Publish messages to multiple topics
2. **Conditional logic** - Trigger KPI extraction only if new docs found
3. **Error handling** - Retry failed operations
4. **Monitoring** - Track pipeline progress

**Example Function (`functions/orchestrator.py`):**

```python
import functions_framework
from google.cloud import pubsub_v1, firestore
import json
import os

@functions_framework.cloud_event
def orchestrate(cloud_event):
    """Orchestrate the daily update pipeline - Fan out to individual tickers"""
    
    # Parse the incoming message
    data = cloud_event.data
    action = data.get('action')
    
    # Initialize clients
    project_id = os.environ.get('FIREBASE_PROJECT_ID')
    publisher = pubsub_v1.PublisherClient()
    db = firestore.Client()
    
    print(f'Orchestrator triggered with action: {action}')
    
    if action == 'fetch_all_tickers':
        # Get all tickers from Firebase
        tickers = get_all_tickers(db)
        print(f'Fetching data for {len(tickers)} tickers')
        
        # Fan out: Publish one message per ticker to data-fetch topic
        topic_path = publisher.topic_path(project_id, 'data-fetch-requests')
        for ticker in tickers:
            message = json.dumps({'ticker': ticker}).encode('utf-8')
            publisher.publish(topic_path, message)
            print(f'  Published data-fetch request for {ticker}')
        
        return {
            'status': 'success',
            'action': 'fetch_all_tickers',
            'tickers_count': len(tickers)
        }
    
    elif action == 'scan_all_tickers':
        # Get all tickers
        tickers = get_all_tickers(db)
        print(f'Scanning IR websites for {len(tickers)} tickers')
        
        # Fan out: Publish one message per ticker to IR scan topic
        topic_path = publisher.topic_path(project_id, 'ir-scan-requests')
        for ticker in tickers:
            message = json.dumps({'ticker': ticker}).encode('utf-8')
            publisher.publish(topic_path, message)
            print(f'  Published IR scan request for {ticker}')
        
        return {
            'status': 'success',
            'action': 'scan_all_tickers',
            'tickers_count': len(tickers)
        }
    
    elif action == 'check_new_documents':
        # Check which quarters have new documents (added in last 6 hours)
        new_quarters = check_for_new_documents(db, hours=6)
        print(f'Found {len(new_quarters)} quarters with new documents')
        
        # Conditionally trigger KPI extraction and analysis
        kpi_topic = publisher.topic_path(project_id, 'kpi-extract-requests')
        analysis_topic = publisher.topic_path(project_id, 'quarterly-analysis-requests')
        
        for ticker, quarter in new_quarters:
            # Only process if not already processed
            if not already_has_kpis(db, ticker, quarter):
                # Trigger KPI extraction
                message = json.dumps({'ticker': ticker, 'quarter': quarter}).encode('utf-8')
                publisher.publish(kpi_topic, message)
                print(f'  Published KPI extraction for {ticker} {quarter}')
                
                # Trigger quarterly analysis
                publisher.publish(analysis_topic, message)
                print(f'  Published quarterly analysis for {ticker} {quarter}')
        
        return {
            'status': 'success',
            'action': 'check_new_documents',
            'quarters_processed': len(new_quarters)
        }
    
    elif action == 'refresh_all_company_summaries':
        # Get all tickers
        tickers = get_all_tickers(db)
        print(f'Refreshing company summaries for {len(tickers)} tickers')
        
        # Fan out to company summary topic
        topic_path = publisher.topic_path(project_id, 'company-summary-requests')
        for ticker in tickers:
            message = json.dumps({'ticker': ticker}).encode('utf-8')
            publisher.publish(topic_path, message)
            print(f'  Published company summary request for {ticker}')
        
        return {
            'status': 'success',
            'action': 'refresh_all_company_summaries',
            'tickers_count': len(tickers)
        }
    
    else:
        print(f'Unknown action: {action}')
        return {'status': 'error', 'error': f'Unknown action: {action}'}


def get_all_tickers(db):
    """Get all ticker symbols from Firestore"""
    tickers_ref = db.collection('tickers')
    docs = tickers_ref.stream()
    return sorted([doc.id for doc in docs])


def check_for_new_documents(db, hours=6):
    """Check for documents added in last N hours
    
    Returns:
        List of (ticker, quarter) tuples that have new documents
    """
    from datetime import datetime, timedelta
    
    cutoff = datetime.now() - timedelta(hours=hours)
    quarters_with_new_docs = set()
    
    # Query all tickers
    tickers = get_all_tickers(db)
    
    for ticker in tickers:
        # Get IR documents for this ticker added recently
        docs_ref = (db.collection('tickers')
                     .document(ticker)
                     .collection('ir_documents')
                     .where('created_at', '>', cutoff.isoformat())
                     .stream())
        
        for doc in docs_ref:
            doc_data = doc.to_dict()
            quarter = doc_data.get('quarter_key')
            if quarter:
                quarters_with_new_docs.add((ticker, quarter))
    
    return sorted(quarters_with_new_docs)


def already_has_kpis(db, ticker, quarter):
    """Check if quarter already has extracted KPIs"""
    doc_ref = (db.collection('tickers')
                .document(ticker)
                .collection('quarterly_analysis')
                .document(quarter))
    
    doc = doc_ref.get()
    if doc.exists:
        data = doc.to_dict()
        return 'custom_kpis' in data and len(data.get('custom_kpis', [])) > 0
    
    return False
```

**Key Points:**

1. **One Scheduler Job → One Function Call**
   ```
   Cloud Scheduler job "daily-ir-scans"
       ↓
   Publishes {"action":"scan_all_tickers"} to "orchestrator-trigger" topic
       ↓
   Triggers orchestrator function ONCE
   ```

2. **One Function Call → Many Pub/Sub Messages (Fan-out)**
   ```
   Orchestrator function receives {"action":"scan_all_tickers"}
       ↓
   Gets tickers: [AAPL, MSFT, GOOGL, ... 50 total]
       ↓
   Publishes 50 messages to "ir-scan-requests":
       - {"ticker":"AAPL"}
       - {"ticker":"MSFT"}
       - {"ticker":"GOOGL"}
       - ... (50 messages total)
   ```

3. **Many Messages → Many Cloud Run Instances (Parallel Execution)**
   ```
   50 messages in "ir-scan-requests" queue
       ↓
   Pub/Sub push subscription triggers Cloud Run
       ↓
   Spawns up to 20 parallel Cloud Run instances (max-instances setting)
       - Instance 1: Processing AAPL
       - Instance 2: Processing MSFT
       - Instance 3: Processing GOOGL
       - ... (up to 20 concurrent)
   ```

**Benefits of This Pattern:**
- ✅ **Parallel execution** - Multiple tickers processed simultaneously
- ✅ **Automatic retry** - Pub/Sub handles retries if Cloud Run instance fails
- ✅ **Rate limiting** - Control max-instances to avoid overwhelming APIs
- ✅ **Conditional logic** - Orchestrator decides what to trigger
- ✅ **Monitoring** - Track progress at orchestrator and per-ticker level
- ✅ **Cost efficient** - Only pay for actual processing time

---

### Complete Invocation Flow

```
┌────────────────────────────────────────────────────────────────┐
│                    CLOUD SCHEDULER                             │
│  Daily 6:00 AM ET                                              │
└────────────┬───────────────────────────────────────────────────┘
             │
             ├─► Pub/Sub: pipeline-orchestrator-trigger
             │       │
             │       ▼
             │   Cloud Function: pipeline-orchestrator
             │       │
             │       ├─► Pub/Sub: data-fetch-requests
             │       │       │
             │       │       ▼
             │       │   Cloud Run: data-fetcher
             │       │       │
             │       │       └─► Firebase (store data)
             │       │
             │       └─► Pub/Sub: ir-scan-requests (per ticker)
             │               │
             │               ▼
             │           Cloud Run: ir-scanner (parallel instances)
             │               │
             │               └─► Firebase (store documents)
             │
             └─► (4 hours later - 10:00 AM ET)
                     │
                     Pub/Sub: pipeline-orchestrator-trigger
                         │
                         ▼
                     Cloud Function: pipeline-orchestrator
                         │
                         ├─► Check for new documents
                         │
                         ├─► If new docs found:
                         │   │
                         │   ├─► Pub/Sub: kpi-extract-requests
                         │   │       │
                         │   │       ▼
                         │   │   Cloud Run: kpi-extractor
                         │   │       │
                         │   │       └─► Firebase (store KPIs)
                         │   │
                         │   └─► Pub/Sub: quarterly-analysis-requests
                         │           │
                         │           ▼
                         │       Cloud Run: quarterly-analyzer
                         │           │
                         │           └─► Firebase (store analysis)
                         │
                         └─► Pipeline Complete

┌────────────────────────────────────────────────────────────────┐
│                    CLOUD SCHEDULER                             │
│  Weekly Sunday 3:00 AM ET                                      │
└────────────┬───────────────────────────────────────────────────┘
             │
             └─► Pub/Sub: company-summary-requests
                     │
                     ▼
                 Cloud Run: company-summary (batch mode)
                     │
                     └─► Firebase (store summaries)
```

---

### Service Account Permissions

Each Cloud Run service needs a service account with specific permissions:

```bash
# Create service accounts
for service in ir-scanner data-fetcher kpi-extractor quarterly-analyzer company-summary; do
  gcloud iam service-accounts create $service \
    --display-name="$service Service Account"
done

# Grant Firebase permissions to all services
for service in ir-scanner data-fetcher kpi-extractor quarterly-analyzer company-summary; do
  SA_EMAIL="${service}@PROJECT_ID.iam.gserviceaccount.com"
  
  gcloud projects add-iam-policy-binding PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/datastore.user"
  
  gcloud projects add-iam-policy-binding PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/storage.objectAdmin"
  
  gcloud projects add-iam-policy-binding PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/logging.logWriter"
done

# Grant Pub/Sub publishing permission to orchestrator
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:pipeline-orchestrator@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

---

### Monitoring and Logs

**View Service Logs:**
```bash
# IR Scanner
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ir-scanner" --limit 50

# Data Fetcher
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=data-fetcher" --limit 50

# KPI Extractor
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=kpi-extractor" --limit 50
```

**View Orchestrator Logs:**
```bash
gcloud logging read "resource.type=cloud_function AND resource.labels.function_name=pipeline-orchestrator" --limit 50
```

**View Pub/Sub Metrics:**
```bash
# Check message backlogs
gcloud pubsub subscriptions list
gcloud pubsub subscriptions describe ir-scanner-sub
```

---

### Cost Optimization

**Cloud Run Pricing (per service):**
- vCPU: $0.000024 per vCPU-second
- Memory: $0.000003 per GiB-second
- Requests: $0.40 per million

**Example Daily Cost (50 tickers):**
- IR Scanner: 50 tickers × 3 min × 2 vCPU = 18K vCPU-sec = **$0.43**
- Data Fetcher: 50 tickers × 1 min × 1 vCPU = 3K vCPU-sec = **$0.07**
- KPI Extractor: 5 quarters × 10 min × 2 vCPU = 6K vCPU-sec = **$0.14**
- Quarterly Analyzer: 5 quarters × 5 min × 2 vCPU = 3K vCPU-sec = **$0.07**
- Company Summary: 50 tickers × 30 sec × 1 vCPU = 1.5K vCPU-sec = **$0.04**

**Total Daily Compute: ~$0.75**
**Plus Gemini API: ~$0.50**
**Total: ~$1.25/day or $38/month**

Within free tier for initial testing:
- 180,000 vCPU-seconds/month (free)
- 360,000 GiB-seconds/month (free)
- 2 million requests/month (free)

---

## Components

### 1. Yahoo Finance Data Retrieval

**Frequency:** Daily at 6 AM ET (after market close data is available)

**Data Retrieved:**
- **Price Data** - Historical and current day prices
- **Quarterly Financial Data** - Income statement, balance sheet, cash flow
- **Analyst Data:**
  - Price targets (high, low, mean, median)
  - Recommendations (buy/sell/hold ratings)
  - Growth estimates (quarterly and annual)
  - Earnings trend (historical vs. estimates)
- **Stock Split History**
- **Company Metadata:**
  - Company name (longName, shortName)
  - Exchange (NYSE, NASDAQ, etc.)
  - Basic info (sector, industry)

**Scripts:**
- `yfinance_service.py` - Core data fetching service
- `fetch_analyst_data.py` - Dedicated analyst data collection
- Services via `TickerMetadataService` class

**Storage:**
- Price data: Cloud Storage `price_data/{TICKER}/{YEAR}.json`
- Analyst data: Firestore `tickers/{TICKER}/analyst_data/{TIMESTAMP}`
- Quarterly financials: Firestore `tickers/{TICKER}/quarters/{YEAR}Q{QUARTER}`
- Company metadata: Firestore `tickers/{TICKER}` (root document)

**Cache Policy:**
- Current year price data: 24 hours
- Historical price data: 30 days
- Analyst data: 24 hours
- Quarterly financials: 12 hours
- Company metadata: 7 days

**Implementation:**

```bash
# Fetch analyst data (includes automatic metadata refresh)
python fetch_analyst_data.py AAPL --verbose

# All tickers in Firebase
python fetch_analyst_data.py --all-tickers

# Quarterly financial data is fetched via:
python yfinance_service.py AAPL 2025Q1
```

**Note:** Company metadata (name, exchange) is automatically fetched and cached when price data is retrieved. Cache expires after 7 days.

---

### 2. Company Summary Refresh

**Frequency:** Weekly or when new ticker is added

**Purpose:** Generate comprehensive company overview using AI based on public knowledge

**Data Generated:**
- **Summary**: 2-3 sentence company overview
- **Business Model**: 2-3 paragraphs describing revenue streams and business segments
- **Competitive Moat**: 2-3 paragraphs analyzing competitive advantages

**Process:**
1. Fetch company name from Yahoo Finance
2. Use Gemini AI to generate structured analysis based on public knowledge
3. Store in Firestore with timestamp

**Scripts:**
- `generate_company_summary.py` - Main generation script
- `services/company_summary_service.py` - Service layer

**Storage:**
- Company summary: Firestore `tickers/{TICKER}` (merged with metadata)

**Cache Policy:**
- Company summary: No expiration (updated manually or weekly)
- Typically stable over time unless major business changes

**Example:**

```bash
# Generate company summary for single ticker
python generate_company_summary.py AAPL --verbose

# Generate without storing (testing)
python generate_company_summary.py AAPL --no-store

# Batch process for all tickers (add to weekly cron)
for ticker in $(python -c "from services.ticker_metadata_service import TickerMetadataService; s = TickerMetadataService(); print(' '.join([d.id for d in s.db.collection('tickers').stream()]))"); do
  python generate_company_summary.py $ticker
done
```

**When to Refresh:**
- **New ticker added**: Generate immediately
- **Weekly refresh**: Update all tickers to capture business changes
- **Manual trigger**: When company undergoes major changes (mergers, pivots, etc.)

---

### 3. IR Document Refresh

**Frequency:** Daily at 6 AM ET

**Purpose:** Discover and download new investor relations documents from company IR websites

**Process:**
1. Scan configured IR URLs for each ticker
2. Use LangGraph-based crawler with Gemini AI to:
   - Navigate through listing and detail pages
   - Classify documents by type
   - Extract metadata (title, date, quarter, document type)
3. Download new documents (PDFs, HTML)
4. Store in Firebase Cloud Storage and metadata in Firestore
5. Skip already-downloaded documents (URL-based deduplication)

**Document Types:**
- Earnings releases
- Earnings presentations
- Shareholder letters
- Annual reports
- Proxy statements
- SEC filings (10-K, 10-Q, 8-K)

**Scripts:**
- `scan_ir_website.py` - Main orchestrator
- `ir_crawler.py` - LangGraph-based crawler
- `ir_document_processor.py` - Document download and storage

**Storage:**
- Document content: Cloud Storage `ir_documents/{TICKER}/{DOCUMENT_ID}.{pdf|html}`
- Document metadata: Firestore `tickers/{TICKER}/ir_documents/{DOCUMENT_ID}`

**IR URL Configuration:**
- Primary: Firestore `tickers/{TICKER}/ir_urls`
- Fallback: JSON file `ir_urls.json`

**Cloud Run Deployment:**

The IR scanner runs on Cloud Run with Pub/Sub trigger:

```bash
# Deploy to Cloud Run
cd data-fetcher
./deploy_cloud_run.sh

# The service exposes:
# POST /scan - Receives Pub/Sub messages with ticker
# GET /health - Health check
# GET / - Service info
```

**Pub/Sub Integration:**

```bash
# Publish scan request
gcloud pubsub topics publish ir-scan-requests \
  --message '{"ticker":"AAPL","verbose":true}'

# For multiple tickers
for ticker in AAPL MSFT GOOGL; do
  gcloud pubsub topics publish ir-scan-requests \
    --message "{\"ticker\":\"$ticker\"}"
done
```

**Metrics:**
- Scan duration
- Pages visited (listing vs detail)
- Documents found
- Documents downloaded
- Errors encountered

Metrics are stored in Firestore `metrics/ir_scans/{SCAN_ID}`

---

### 4. New Document Detection & Processing

**Trigger:** When new documents are found during IR refresh

**Process Flow:**

```
New Document Found
    │
    ├─► Check Quarter Assignment
    │   └─► Extract date/quarter from metadata
    │
    ├─► Determine if KPI Extraction Needed
    │   └─► Check if quarter has existing KPI data
    │
    ├─► KPI Extraction (if new quarter or missing data)
    │   ├─► Extract text from documents (PDF/HTML)
    │   ├─► Use Gemini AI to extract KPIs
    │   ├─► Unify KPIs with existing definitions
    │   └─► Store in Firestore
    │
    └─► Quarterly Analysis Generation
        ├─► Load all documents for quarter
        ├─► Load previous quarter for context
        ├─► Generate summary and growth theses
        └─► Store in Firestore
```

---

### 5. KPI Extraction

**Purpose:** Extract key performance indicators from IR documents

**When to Run:**
- New documents discovered for a quarter
- Missing KPI data for existing documents
- Manual trigger for reprocessing

**Process:**

1. **Document Preparation**
   - Load all IR documents for the quarter
   - Extract text from PDFs/HTML
   - Filter out consolidated financial statements
   - Prepare documents for AI processing

2. **Raw KPI Extraction** (`extract_kpis3.py`)
   - Use Gemini AI with structured output
   - Extract KPIs per document:
     - Name, value, unit
     - Change indicators (YoY, QoQ)
     - Context and notes
   - Store raw KPIs: `tickers/{TICKER}/quarters/{QUARTER}/raw_kpis/{DOC_ID}`

3. **KPI Unification** (`unify_kpis.py`)
   - Match extracted KPIs to canonical definitions
   - Create new definitions for novel KPIs
   - Handle variations in naming/formatting
   - Store unified KPIs: `tickers/{TICKER}/quarters/{QUARTER}/quarterly_analysis`
   - Update global definitions: `kpi_definitions/{TICKER}/{KPI_ID}`

**Scripts:**
- `extract_kpi_driver.py` - Main orchestrator
- `extract_kpis3.py` - Raw extraction
- `unify_kpis.py` - Unification process
- `kpi_extraction_service.py` - Service layer

**KPI Schema:**

```json
{
  "name": "Monthly Active Users",
  "value": 2.5,
  "unit": "billion",
  "frequency": 1,
  "group": "User Metrics",
  "change": "+5%",
  "change_type": "YoY",
  "context": "Reached 2.5B MAU, up 5% YoY"
}
```

**Examples:**

```bash
# Extract KPIs for single quarter
python extract_kpi_driver.py AAPL 2024Q1

# Extract for quarter range
python extract_kpi_driver.py AAPL --start-quarter 2022Q1 --end-quarter 2024Q4

# Process all quarters (iterative, includes unification)
python extract_kpi_driver.py AAPL --all-quarters

# Reset and reprocess all data
python extract_kpi_driver.py AAPL --reset --all-quarters
```

---

### 6. Quarterly Analysis Generation

**Purpose:** Generate comprehensive quarterly summaries and growth theses

**When to Run:**
- After new documents are processed
- After KPI extraction completes
- When previous quarter context becomes available

**Inputs:**
- All IR documents for the quarter
- Extracted KPIs from current quarter
- Previous quarter's analysis (for context)

**Process:**

1. **Document Preparation**
   - Load all IR documents (PDFs and HTML)
   - Filter out financial statements
   - Extract text from HTML documents
   - Prepare PDFs for direct AI processing

2. **AI Generation** (Gemini)
   - Process documents with structured prompt
   - Include previous quarter context for comparison
   - Include extracted KPIs for reference
   - Generate:
     - **Summary:** Comprehensive paragraph with bullet points
     - **Growth Theses:** 3-5 investment themes with evidence

3. **Storage**
   - Store in: `tickers/{TICKER}/quarters/{QUARTER}/quarterly_analysis`
   - Merge with existing KPI data
   - Track source documents and metadata

**Scripts:**
- `generate_quarterly_summary.py` - Main script
- `quarterly_analysis_service.py` - Service layer

**Output Schema:**

```json
{
  "ticker": "AAPL",
  "quarter_key": "2025Q1",
  "summary": "Apple's Q1 2025 results showed strong growth...",
  "growth_theses": [
    {
      "title": "Services Expansion",
      "summary": "Services revenue grew 15% YoY...",
      "evidence": ["App Store growth", "Subscription increases"],
      "strength": "high",
      "theme_type": "growth_driver"
    }
  ],
  "custom_kpis": [...],
  "created_at": "2025-01-17T10:30:00Z",
  "source_documents": ["doc1", "doc2"],
  "num_documents": 3
}
```

**Examples:**

```bash
# Generate for single quarter
python generate_quarterly_summary.py AAPL 2025Q1 --verbose

# Process all quarters (iterative, includes context)
python generate_quarterly_summary.py AAPL --all-quarters

# Start from specific quarter
python generate_quarterly_summary.py AAPL --all-quarters --start-quarter 2024Q1

# Generate without storing (testing)
python generate_quarterly_summary.py AAPL 2025Q1 --no-store
```

---

## Daily Update Implementation

### Recommended Architecture: Cloud Run + Pub/Sub + Cloud Scheduler

This is the production-ready architecture using fully managed services.

**Key Benefits:**
- ✅ Auto-scaling (0 to N instances)
- ✅ No idle costs (pay only for execution time)
- ✅ Parallel processing (multiple tickers simultaneously)
- ✅ Automatic retries and error handling
- ✅ Built-in monitoring and logging
- ✅ No server management required

**Architecture:** See the **Technical Architecture** section above for complete details.

**Quick Setup:**

1. **Deploy Cloud Run Services** (see Technical Architecture section)
2. **Create Pub/Sub Topics and Subscriptions**
3. **Set up Cloud Scheduler Jobs**
4. **Deploy Orchestrator Function** (optional but recommended)

**Daily Flow:**
```
6:00 AM ET: Cloud Scheduler → Orchestrator → Data Fetch (all tickers)
6:30 AM ET: Cloud Scheduler → Orchestrator → IR Scans (all tickers, parallel)
10:00 AM ET: Cloud Scheduler → Orchestrator → Check for new docs → Process
```

**Weekly Flow:**
```
Sunday 3:00 AM ET: Cloud Scheduler → Company Summary Service (all tickers)
```

---

### Alternative: Option 1 - Cloud Scheduler + Cloud Functions (Simplified)

**Architecture:**

```
Cloud Scheduler
    ↓
Pub/Sub Topic: daily-update-trigger
    ↓
Cloud Function: dailyUpdateOrchestrator
    ↓
    ├─► Fetch Yahoo Finance Data (parallel)
    ├─► Trigger IR Scans via Pub/Sub (parallel)
    └─► Monitor and trigger processing (conditional)
```

**Cloud Function (`functions/daily_update.py`):**

```python
import functions_framework
from google.cloud import pubsub_v1
import os

@functions_framework.cloud_event
def daily_update_orchestrator(cloud_event):
    """Orchestrate daily ticker updates."""
    project_id = os.environ.get('FIREBASE_PROJECT_ID')
    publisher = pubsub_v1.PublisherClient()
    
    # Get all tickers from Firestore
    tickers = get_all_tickers()  # Your implementation
    
    # 1. Trigger Yahoo Finance updates (can run locally or as separate job)
    # 2. Trigger IR scans via Pub/Sub (parallel)
    for ticker in tickers:
        topic_path = publisher.topic_path(project_id, 'ir-scan-requests')
        message = json.dumps({'ticker': ticker}).encode('utf-8')
        publisher.publish(topic_path, message)
    
    return {'status': 'success', 'tickers_processed': len(tickers)}
```

**Cloud Scheduler Setup:**

```bash
# Create scheduler job (runs daily at 6 AM ET)
gcloud scheduler jobs create pubsub daily-ticker-update \
  --location us-central1 \
  --schedule "0 6 * * *" \
  --topic daily-update-trigger \
  --message-body "TRIGGER" \
  --time-zone "America/New_York"
```

---

### Alternative: Option 2 - Simple Cron + Local Scripts (Development/Testing)

**Crontab Setup:**

```bash
# Edit crontab
crontab -e

# Add these lines:
# Daily at 6 AM: Fetch Yahoo Finance data for all tickers
0 6 * * * cd /path/to/data-fetcher && /path/to/venv/bin/python fetch_analyst_data.py --all-tickers >> /var/log/ticker-update.log 2>&1

# Daily at 6:30 AM: Trigger IR scans via Pub/Sub
30 6 * * * cd /path/to/data-fetcher && /path/to/venv/bin/python scripts/trigger_daily_scans.py >> /var/log/ir-scans.log 2>&1

# Daily at 10 AM: Process any new documents (if found)
0 10 * * * cd /path/to/data-fetcher && /path/to/venv/bin/python scripts/process_new_documents.py >> /var/log/process-docs.log 2>&1

# Weekly on Sunday at 3 AM: Refresh company summaries
0 3 * * 0 cd /path/to/data-fetcher && /path/to/venv/bin/python scripts/refresh_company_summaries.py >> /var/log/company-summaries.log 2>&1
```

**Helper Script (`scripts/trigger_daily_scans.py`):**

```python
#!/usr/bin/env python3
"""Trigger IR scans for all tickers via Pub/Sub"""

import os
import json
from google.cloud import pubsub_v1
from services.ticker_metadata_service import TickerMetadataService

def get_all_tickers():
    """Get all tickers from Firebase"""
    service = TickerMetadataService()
    tickers_ref = service.db.collection('tickers')
    docs = tickers_ref.stream()
    return [doc.id for doc in docs]

def trigger_scans():
    """Publish scan requests for all tickers"""
    project_id = os.environ.get('FIREBASE_PROJECT_ID')
    publisher = pubsub_v1.PublisherClient()
    topic_path = publisher.topic_path(project_id, 'ir-scan-requests')
    
    tickers = get_all_tickers()
    print(f'Triggering scans for {len(tickers)} tickers')
    
    for ticker in tickers:
        message = json.dumps({'ticker': ticker}).encode('utf-8')
        publisher.publish(topic_path, message)
        print(f'  ✓ {ticker}')
    
    print(f'\n✅ Triggered {len(tickers)} scans')

if __name__ == '__main__':
    trigger_scans()
```

**Helper Script (`scripts/process_new_documents.py`):**

```python
#!/usr/bin/env python3
"""Process newly discovered documents: extract KPIs and generate analysis"""

import os
from datetime import datetime, timedelta
from services.ir_document_service import IRDocumentService
from services.quarterly_analysis_service import QuarterlyAnalysisService
from kpi_extraction_service import extract_and_unify_kpis
from generate_quarterly_summary import generate_quarterly_summary

def get_new_documents(since_hours=24):
    """Find documents added in last N hours"""
    service = IRDocumentService()
    cutoff = datetime.now() - timedelta(hours=since_hours)
    
    # Query recent documents
    # Implementation depends on your Firestore schema
    # Return list of (ticker, quarter_key, document_ids)
    pass

def process_quarter(ticker, quarter_key):
    """Process KPI extraction and analysis for a quarter"""
    print(f'\nProcessing {ticker} {quarter_key}')
    
    # Check if already processed
    analysis_service = QuarterlyAnalysisService()
    existing = analysis_service.get_quarterly_analysis(ticker, quarter_key)
    
    # If already has KPIs and analysis, skip
    if existing and existing.get('custom_kpis') and existing.get('summary'):
        print(f'  ⏭️  Already processed, skipping')
        return
    
    # Extract KPIs
    if not existing or not existing.get('custom_kpis'):
        print(f'  📊 Extracting KPIs...')
        kpi_result = extract_and_unify_kpis(ticker, quarter_key, verbose=True)
        if not kpi_result['extraction']['success']:
            print(f'  ❌ KPI extraction failed')
            return
    
    # Generate analysis
    if not existing or not existing.get('summary'):
        print(f'  📝 Generating quarterly analysis...')
        summary = generate_quarterly_summary(ticker, quarter_key, verbose=True)
        if not summary:
            print(f'  ❌ Analysis generation failed')
            return
    
    print(f'  ✅ Processed {ticker} {quarter_key}')

def main():
    """Main processing loop"""
    print('Checking for new documents...')
    
    new_docs = get_new_documents(since_hours=24)
    
    if not new_docs:
        print('No new documents to process')
        return
    
    # Group by ticker and quarter
    quarters_to_process = set()
    for ticker, quarter_key, _ in new_docs:
        quarters_to_process.add((ticker, quarter_key))
    
    print(f'Found {len(quarters_to_process)} quarters to process')
    
    for ticker, quarter_key in sorted(quarters_to_process):
        process_quarter(ticker, quarter_key)
    
    print(f'\n✅ Processing complete')

if __name__ == '__main__':
    main()
```

---

### Alternative: Option 3 - Hybrid Approach (Legacy)

**Combines Cloud Run for IR scanning with local scripts for data fetching:**

1. **Cloud Scheduler → Pub/Sub → Cloud Run** for IR document scanning
   - Scales automatically
   - No idle costs
   - Parallel processing of multiple tickers

2. **Local cron jobs** for Yahoo Finance data
   - Simple, reliable
   - No network overhead
   - Direct Firebase access

3. **Cloud Function or local cron** for processing trigger
   - Checks for new documents
   - Triggers KPI extraction
   - Generates quarterly analysis

---

## Monitoring & Alerts

### Key Metrics to Track

1. **Data Freshness**
   - Last update timestamp per ticker
   - Data age alerts (> 36 hours)
   - Company metadata age (> 7 days)
   - Company summary age (> 30 days)

2. **IR Scan Health**
   - Scan success rate
   - Documents discovered per scan
   - Scan duration
   - Error rates

3. **Processing Status**
   - Quarters pending KPI extraction
   - Quarters pending analysis
   - Processing failures

4. **API Usage**
   - Yahoo Finance API calls
   - Gemini API tokens used
   - Rate limit violations

5. **Content Completeness**
   - Tickers missing company summaries
   - Tickers missing recent quarterly data
   - Documents without KPIs extracted

### Alerting Setup

```bash
# Create alert for failed scans
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="IR Scanner High Error Rate" \
  --condition-display-name="Error rate > 10%" \
  --condition-threshold-value=0.1

# Alert for stale data
# (Custom Cloud Function to check timestamps)
```

### Logs

```bash
# View IR scanner logs
gcloud logging read \
  "resource.type=cloud_run_revision AND resource.labels.service_name=ir-scanner" \
  --limit 100

# View daily update logs (if using Cloud Function)
gcloud logging read \
  "resource.type=cloud_function AND resource.labels.function_name=daily-update-orchestrator" \
  --limit 50
```

---

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                     DAILY TICKER UPDATE PIPELINE                 │
└──────────────────────────────────────────────────────────────────┘

 6:00 AM ET - Start Daily Update
    │
    ├─► Yahoo Finance Data Fetch ────────────────────┐
    │   ├─► Price Data                               │
    │   ├─► Quarterly Financials                     │
    │   ├─► Analyst Data                             │
    │   └─► Company Metadata (auto-refresh 7d)       │
    │                                                 ▼
    │                                          Firebase Storage
    │                                          Firestore Database
    │
    ├─► IR Website Scan (via Pub/Sub) ──────────────┐
    │   ├─► Ticker 1 → Cloud Run Instance 1         │
    │   ├─► Ticker 2 → Cloud Run Instance 2         │
    │   └─► Ticker N → Cloud Run Instance N         │
    │                                                 │
    │   Each Instance:                                │
    │   ├─► Crawl IR Website                         │
    │   ├─► Discover New Documents                   │
    │   ├─► Download PDFs/HTML                       │
    │   └─► Store in Firebase                        │
    │                                                 │
    │                                                 ▼
    │                                          Firebase Storage
    │                                          Firestore Database
    │
    └─► Process New Documents (Conditional) ────────┐
        │                                            │
        ├─► If New Documents Found:                 │
        │   │                                        │
        │   ├─► KPI Extraction                      │
        │   │   ├─► Extract text from docs         │
        │   │   ├─► Gemini AI extraction           │
        │   │   └─► Unify with definitions         │
        │   │                                        │
        │   └─► Quarterly Analysis                  │
        │       ├─► Load all quarter docs           │
        │       ├─► Include previous quarter        │
        │       ├─► Gemini AI generation            │
        │       └─► Generate summary + theses       │
        │                                            │
        └───────────────────────────────────────────┘
                                                     │
                                                     ▼
                                              Firebase Storage
                                              Firestore Database
                                              
10:00 AM ET - Daily Update Complete

┌──────────────────────────────────────────────────────────────────┐
│                     WEEKLY TICKER UPDATE PIPELINE                │
└──────────────────────────────────────────────────────────────────┘

 Sunday 3:00 AM ET - Start Weekly Update
    │
    └─► Company Summary Refresh ─────────────────────┐
        │                                             │
        ├─► For Each Ticker:                         │
        │   ├─► Fetch company name (yfinance)        │
        │   ├─► Generate with Gemini AI:             │
        │   │   ├─► Company overview                 │
        │   │   ├─► Business model                   │
        │   │   └─► Competitive moat                 │
        │   └─► Store in Firestore                   │
        │                                             │
        └─────────────────────────────────────────────┘
                                                      │
                                                      ▼
                                               Firestore Database
                                               
 Sunday 5:00 AM ET - Weekly Update Complete
```

---

## Cost Estimation

### Daily Costs (Per 50 Tickers)

**Yahoo Finance:**
- Free API (no cost)

**Cloud Run (IR Scanning):**
- Assume 3 min/scan, 2 vCPU, 2 GiB memory
- 50 tickers × 3 min × 60 sec × 2 vCPU = 18,000 vCPU-seconds
- 50 tickers × 3 min × 60 sec × 2 GiB = 18,000 GiB-seconds
- Within free tier (180,000 vCPU-sec, 360,000 GiB-sec)
- **Cost: $0/day**

**Gemini API:**
- KPI extraction: ~5 documents × 50 tickers × 2,000 tokens = 500K tokens/day
- Analysis generation: ~1 per new quarter × 5,000 tokens = 5K tokens/day
- Total: ~505K tokens/day × $0.000001 = **$0.50/day**

**Firebase:**
- Storage: 100 MB/ticker × 50 = 5 GB
- Reads/Writes: ~10K operations/day
- Within generous free tier
- **Cost: $0-1/day**

**Total: ~$0.50-1.50/day** or **$15-45/month**

---

## Maintenance & Operations

### Weekly Tasks

1. **Review Metrics Dashboard**
   - Check scan success rates
   - Verify data freshness
   - Review error logs
   - Verify company summary updates

2. **Validate Data Quality**
   - Spot-check KPI extraction accuracy
   - Review quarterly analysis quality
   - Check for missing quarters
   - Verify company summaries are up-to-date

3. **Check Company Summaries**
   - Review newly generated summaries
   - Update summaries for companies with major changes
   - Verify business model descriptions are accurate

### Monthly Tasks

1. **Review and Update IR URLs**
   - Check for broken/changed URLs
   - Add new tickers
   - Verify document discovery rates

2. **Optimize Costs**
   - Review API usage
   - Adjust Cloud Run settings if needed
   - Archive old data if needed

3. **Update KPI Definitions**
   - Review newly created definitions
   - Merge similar KPIs
   - Improve unification rules

---

## Troubleshooting

### Problem: No Documents Found

**Possible Causes:**
- IR URL changed or broken
- Website structure changed
- Authentication required
- Rate limiting

**Solutions:**
- Check URL in browser
- Update IR URL configuration
- Review crawler logs
- Adjust rate limiting settings

### Problem: KPI Extraction Fails

**Possible Causes:**
- Document format not supported
- Gemini API quota exceeded
- Document too large
- Invalid JSON schema

**Solutions:**
- Check document format
- Review API quota/usage
- Extract text first for large PDFs
- Validate schema compatibility

### Problem: Stale Data

**Possible Causes:**
- Scheduler not running
- Cloud Run service down
- Pub/Sub delivery failure
- Processing script crash

**Solutions:**
- Check scheduler status
- Verify Cloud Run service health
- Review Pub/Sub metrics
- Check error logs

---

## Future Enhancements

1. **Smart Refresh Logic**
   - Only scan during earnings season
   - Skip weekends/holidays
   - Prioritize by data age

2. **Incremental Processing**
   - Process only changed data
   - Delta updates for timeseries
   - Caching optimization

3. **Enhanced Monitoring**
   - Data quality scores
   - Automated anomaly detection
   - Slack/email notifications

4. **Advanced KPI Features**
   - Trend analysis
   - Anomaly detection
   - Peer comparison
   - Forecasting

---

## Quick Start Deployment Guide

### Prerequisites

1. **GCP Project with Firebase enabled**
2. **gcloud CLI installed and authenticated**
3. **Required APIs enabled:**
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable pubsub.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   gcloud services enable cloudfunctions.googleapis.com
   gcloud services enable cloudscheduler.googleapis.com
   ```

### Step 1: Set Up Environment Variables

```bash
export PROJECT_ID="your-firebase-project-id"
export REGION="us-central1"
gcloud config set project $PROJECT_ID
```

### Step 2: Create Service Accounts

```bash
cd data-fetcher

# Run the service account setup script
cat > setup_service_accounts.sh << 'EOF'
#!/bin/bash
PROJECT_ID=${1:-$(gcloud config get-value project)}

for service in ir-scanner data-fetcher kpi-extractor quarterly-analyzer company-summary pipeline-orchestrator; do
  echo "Creating service account: $service"
  gcloud iam service-accounts create $service \
    --display-name="$service Service Account" \
    --project=$PROJECT_ID
  
  SA_EMAIL="${service}@${PROJECT_ID}.iam.gserviceaccount.com"
  
  # Grant Firebase permissions
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/datastore.user"
  
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/storage.objectAdmin"
  
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="roles/logging.logWriter"
done

# Grant Pub/Sub publisher to orchestrator
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:pipeline-orchestrator@${PROJECT_ID}.iam.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

echo "✅ Service accounts created and configured"
EOF

chmod +x setup_service_accounts.sh
./setup_service_accounts.sh $PROJECT_ID
```

### Step 3: Create Pub/Sub Topics

```bash
cat > setup_pubsub.sh << 'EOF'
#!/bin/bash
PROJECT_ID=${1:-$(gcloud config get-value project)}

# Create topics
for topic in ir-scan-requests data-fetch-requests kpi-extract-requests quarterly-analysis-requests company-summary-requests pipeline-orchestrator-trigger; do
  echo "Creating topic: $topic"
  gcloud pubsub topics create $topic --project=$PROJECT_ID
done

echo "✅ Pub/Sub topics created"
EOF

chmod +x setup_pubsub.sh
./setup_pubsub.sh $PROJECT_ID
```

### Step 4: Deploy Cloud Run Services

```bash
# Deploy IR Scanner (already exists)
cd data-fetcher
./deploy_cloud_run.sh

# Deploy other services (need to create handlers first)
# See "Required Handler Scripts" section below
```

### Step 5: Create Pub/Sub Subscriptions

```bash
cat > setup_subscriptions.sh << 'EOF'
#!/bin/bash
PROJECT_ID=${1:-$(gcloud config get-value project)}
REGION="us-central1"

# Get Cloud Run service URLs
IR_SCANNER_URL=$(gcloud run services describe ir-scanner --region=$REGION --format='value(status.url)')
# Add other service URLs as they're deployed

# Create subscription for IR Scanner
gcloud pubsub subscriptions create ir-scanner-sub \
  --topic=ir-scan-requests \
  --push-endpoint="${IR_SCANNER_URL}/scan" \
  --push-auth-service-account=ir-scanner@${PROJECT_ID}.iam.gserviceaccount.com \
  --ack-deadline=600 \
  --max-retry-delay=600s \
  --min-retry-delay=10s \
  --project=$PROJECT_ID

echo "✅ Pub/Sub subscriptions created"
EOF

chmod +x setup_subscriptions.sh
./setup_subscriptions.sh $PROJECT_ID
```

### Step 6: Deploy Orchestrator Function

```bash
cd ../functions

# Create orchestrator.py (see Technical Architecture section)
# Create requirements.txt
cat > requirements.txt << 'EOF'
functions-framework==3.*
google-cloud-pubsub==2.*
google-cloud-firestore==2.*
EOF

gcloud functions deploy pipeline-orchestrator \
  --gen2 \
  --runtime=python311 \
  --region=$REGION \
  --source=. \
  --entry-point=orchestrate \
  --trigger-topic=pipeline-orchestrator-trigger \
  --service-account=pipeline-orchestrator@${PROJECT_ID}.iam.gserviceaccount.com \
  --timeout=540s \
  --memory=512MB \
  --project=$PROJECT_ID
```

### Step 7: Set Up Cloud Scheduler

```bash
cat > setup_scheduler.sh << 'EOF'
#!/bin/bash
PROJECT_ID=${1:-$(gcloud config get-value project)}
REGION="us-central1"

# Daily data fetch (6:00 AM ET)
gcloud scheduler jobs create pubsub daily-data-fetch \
  --location=$REGION \
  --schedule="0 6 * * *" \
  --topic=pipeline-orchestrator-trigger \
  --message-body='{"action":"fetch_all_tickers"}' \
  --time-zone="America/New_York" \
  --project=$PROJECT_ID

# Daily IR scans (6:30 AM ET)
gcloud scheduler jobs create pubsub daily-ir-scans \
  --location=$REGION \
  --schedule="30 6 * * *" \
  --topic=pipeline-orchestrator-trigger \
  --message-body='{"action":"scan_all_tickers"}' \
  --time-zone="America/New_York" \
  --project=$PROJECT_ID

# Check for new documents (10:00 AM ET)
gcloud scheduler jobs create pubsub check-new-documents \
  --location=$REGION \
  --schedule="0 10 * * *" \
  --topic=pipeline-orchestrator-trigger \
  --message-body='{"action":"check_new_documents"}' \
  --time-zone="America/New_York" \
  --project=$PROJECT_ID

# Weekly company summaries (Sunday 3:00 AM ET)
gcloud scheduler jobs create pubsub weekly-company-summaries \
  --location=$REGION \
  --schedule="0 3 * * 0" \
  --topic=company-summary-requests \
  --message-body='{"action":"refresh_all_tickers"}' \
  --time-zone="America/New_York" \
  --project=$PROJECT_ID

echo "✅ Cloud Scheduler jobs created"
EOF

chmod +x setup_scheduler.sh
./setup_scheduler.sh $PROJECT_ID
```

### Step 8: Test the Pipeline

```bash
# Test data fetching
gcloud pubsub topics publish data-fetch-requests \
  --message='{"ticker":"AAPL"}' \
  --project=$PROJECT_ID

# Test IR scanning
gcloud pubsub topics publish ir-scan-requests \
  --message='{"ticker":"AAPL"}' \
  --project=$PROJECT_ID

# View logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ir-scanner" \
  --limit=50 \
  --project=$PROJECT_ID
```

---

## Required Handler Scripts

To complete the Cloud Run deployment, you need to create Flask/FastAPI handlers for each service. Here are templates:

### Template: `data_fetcher_handler.py`

```python
#!/usr/bin/env python3
"""Data Fetcher Cloud Run Handler"""

from flask import Flask, request, jsonify
import json
import base64
from fetch_analyst_data import AnalystDataFetcher
from yfinance_service import YFinanceService

app = Flask(__name__)

@app.route('/fetch-all', methods=['POST'])
def fetch_all():
    """Handle data fetch requests from Pub/Sub"""
    envelope = request.get_json()
    
    if not envelope:
        return jsonify({'error': 'No data received'}), 400
    
    # Handle Pub/Sub message format
    if 'message' in envelope:
        data = base64.b64decode(envelope['message']['data']).decode('utf-8')
        message_data = json.loads(data)
    else:
        message_data = envelope
    
    action = message_data.get('action')
    ticker = message_data.get('ticker')
    tickers = message_data.get('tickers', [])
    
    try:
        fetcher = AnalystDataFetcher()
        
        if action == 'fetch_all_tickers':
            # Fetch for all tickers
            tickers = fetcher.get_all_tickers_from_firebase()
        elif ticker:
            tickers = [ticker]
        
        if not tickers:
            return jsonify({'error': 'No tickers specified'}), 400
        
        results = fetcher.fetch_for_tickers(tickers, verbose=False)
        
        return jsonify({
            'status': 'success',
            'tickers_processed': len(results),
            'results': results
        }), 200
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
```

### Template: `kpi_extractor_handler.py`

```python
#!/usr/bin/env python3
"""KPI Extractor Cloud Run Handler"""

from flask import Flask, request, jsonify
import json
import base64
from kpi_extraction_service import extract_and_unify_kpis

app = Flask(__name__)

@app.route('/extract', methods=['POST'])
def extract():
    """Handle KPI extraction requests"""
    envelope = request.get_json()
    
    if 'message' in envelope:
        data = base64.b64decode(envelope['message']['data']).decode('utf-8')
        message_data = json.loads(data)
    else:
        message_data = envelope
    
    ticker = message_data.get('ticker')
    quarter = message_data.get('quarter')
    
    if not ticker or not quarter:
        return jsonify({'error': 'Ticker and quarter required'}), 400
    
    try:
        result = extract_and_unify_kpis(
            ticker,
            quarter,
            verbose=False,
            skip_unification=message_data.get('skip_unification', False)
        )
        
        return jsonify({
            'status': 'success',
            'ticker': ticker,
            'quarter': quarter,
            'result': result
        }), 200
        
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
```

### Template: `quarterly_analyzer_handler.py`

```python
#!/usr/bin/env python3
"""Quarterly Analyzer Cloud Run Handler"""

from flask import Flask, request, jsonify
import json
import base64
from generate_quarterly_summary import generate_quarterly_summary
from services.quarterly_analysis_service import QuarterlyAnalysisService

app = Flask(__name__)

@app.route('/analyze', methods=['POST'])
def analyze():
    """Handle quarterly analysis requests"""
    envelope = request.get_json()
    
    if 'message' in envelope:
        data = base64.b64decode(envelope['message']['data']).decode('utf-8')
        message_data = json.loads(data)
    else:
        message_data = envelope
    
    ticker = message_data.get('ticker')
    quarter = message_data.get('quarter')
    
    if not ticker or not quarter:
        return jsonify({'error': 'Ticker and quarter required'}), 400
    
    try:
        # Generate analysis
        analysis = generate_quarterly_summary(ticker, quarter, verbose=False)
        
        if analysis:
            # Store to Firebase
            service = QuarterlyAnalysisService()
            service.store_quarterly_analysis(ticker, quarter, analysis)
            
            return jsonify({
                'status': 'success',
                'ticker': ticker,
                'quarter': quarter
            }), 200
        else:
            return jsonify({
                'status': 'error',
                'error': 'Analysis generation failed'
            }), 500
            
    except Exception as e:
        return jsonify({
            'status': 'error',
            'error': str(e)
        }), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
```

### Template: `company_summary_handler.py`

```python
#!/usr/bin/env python3
"""Company Summary Cloud Run Handler"""

from flask import Flask, request, jsonify
import json
import base64
from generate_company_summary import generate_company_summary
from services.company_summary_service import CompanySummaryService
from services.ticker_metadata_service import TickerMetadataService

app = Flask(__name__)

@app.route('/generate', methods=['POST'])
def generate():
    """Handle company summary generation requests"""
    envelope = request.get_json()
    
    if 'message' in envelope:
        data = base64.b64decode(envelope['message']['data']).decode('utf-8')
        message_data = json.loads(data)
    else:
        message_data = envelope
    
    action = message_data.get('action')
    ticker = message_data.get('ticker')
    
    try:
        service = CompanySummaryService()
        
        if action == 'refresh_all_tickers':
            # Get all tickers
            ticker_service = TickerMetadataService()
            tickers = [doc.id for doc in ticker_service.db.collection('tickers').stream()]
            
            results = []
            for t in tickers:
                summary = generate_company_summary(t, verbose=False)
                if summary:
                    service.store_company_summary(t, summary)
                    results.append({'ticker': t, 'status': 'success'})
                else:
                    results.append({'ticker': t, 'status': 'failed'})
            
            return jsonify({
                'status': 'success',
                'results': results
            }), 200
            
        elif ticker:
            summary = generate_company_summary(ticker, verbose=False)
            if summary:
                service.store_company_summary(ticker, summary)
                return jsonify({'status': 'success', 'ticker': ticker}), 200
            else:
                return jsonify({'status': 'error', 'error': 'Generation failed'}), 500
        else:
            return jsonify({'error': 'No ticker or action specified'}), 400
            
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy'}), 200

if __name__ == '__main__':
    import os
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)
```

---

## References

- [Cloud Run Deployment Guide](./cloud_run_deployment.md)
- [Yahoo Finance Service](../data-fetcher/yfinance_service.py)
- [IR Crawler Implementation](../data-fetcher/ir_crawler.py)
- [KPI Extraction Driver](../data-fetcher/extract_kpi_driver.py)
- [Quarterly Analysis Generator](../data-fetcher/generate_quarterly_summary.py)
- [Firebase Schema](../stocks-web/docs/firebase_schema.md)

