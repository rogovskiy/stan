# Cloud Run Deployment Guide for IR Scanner

This guide covers deploying the `scan_ir_website.py` script to Google Cloud Run with Pub/Sub triggers.

## Overview

The IR Scanner runs as a Cloud Run service that:
- Receives Pub/Sub messages with ticker symbols
- Processes one ticker per container instance
- Scales to zero when not in use (no idle costs)
- Uses service account authentication for Firebase access
- Runs multiple scans in parallel when triggered

## Architecture

```
Pub/Sub Topic (ir-scan-requests)
    ↓
Pub/Sub Push Subscription
    ↓
Cloud Run Service (ir-scanner)
    ↓
Scans IR Website → Stores in Firebase/Firestore
```

## Prerequisites

1. **GCP Project with Firebase**
   - Active Firebase project
   - Firestore and Cloud Storage enabled
   - Billing enabled (required for Cloud Run)

2. **Local Setup**
   - `gcloud` CLI installed ([installation guide](https://cloud.google.com/sdk/docs/install))
   - Authenticated: `gcloud auth login`
   - `.env.local` file with `FIREBASE_PROJECT_ID` and `GEMINI_API_KEY`

3. **Required APIs**
   ```bash
   gcloud services enable run.googleapis.com
   gcloud services enable pubsub.googleapis.com
   gcloud services enable cloudbuild.googleapis.com
   ```

## Step 1: Create Service Account

Create a dedicated service account for the Cloud Run service:

```bash
# Set your project ID (or it will be read from .env.local during deploy)
export PROJECT_ID="your-project-id"

# Create service account
gcloud iam service-accounts create ir-scanner \
  --display-name="IR Scanner Service Account" \
  --description="Service account for IR website scanning Cloud Run service"

# Store the service account email
export SERVICE_ACCOUNT="ir-scanner@${PROJECT_ID}.iam.gserviceaccount.com"
```

## Step 2: Grant IAM Permissions

The service account needs access to Firestore, Cloud Storage, and Cloud Logging:

```bash
# Firestore access (read/write documents)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/datastore.user"

# Cloud Storage access (read/write files)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/storage.objectAdmin"

# Cloud Logging access (write logs)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/logging.logWriter"

# Firebase Admin access (if needed)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/firebase.admin"
```

## Step 3: Deploy to Cloud Run

From the `data-fetcher` directory:

```bash
cd data-fetcher

# Make the deployment script executable
chmod +x deploy_cloud_run.sh

# Run deployment
./deploy_cloud_run.sh
```

The script will:
1. Read configuration from `.env.local`
2. Build the container image using Cloud Build
3. Deploy to Cloud Run with proper settings
4. Display the service URL

**Manual deployment alternative:**

```bash
gcloud run deploy ir-scanner \
  --source . \
  --region us-central1 \
  --platform managed \
  --memory 2Gi \
  --cpu 2 \
  --timeout 600 \
  --max-instances 20 \
  --concurrency 1 \
  --no-allow-unauthenticated \
  --service-account ir-scanner@${PROJECT_ID}.iam.gserviceaccount.com \
  --set-env-vars FIREBASE_PROJECT_ID=${PROJECT_ID} \
  --set-env-vars GEMINI_API_KEY=your-gemini-key
```

## Step 4: Set Up Pub/Sub

### Create Topic

```bash
gcloud pubsub topics create ir-scan-requests
```

### Create Push Subscription

Get your Cloud Run service URL:

```bash
export SERVICE_URL=$(gcloud run services describe ir-scanner \
  --region us-central1 \
  --format 'value(status.url)')

echo "Service URL: $SERVICE_URL"
```

Create push subscription that delivers messages to Cloud Run:

```bash
gcloud pubsub subscriptions create ir-scanner-sub \
  --topic ir-scan-requests \
  --push-endpoint="${SERVICE_URL}/scan" \
  --push-auth-service-account=${SERVICE_ACCOUNT} \
  --ack-deadline 600 \
  --max-retry-delay 600s \
  --min-retry-delay 10s
```

**Configuration details:**
- `--ack-deadline 600`: 10 minutes for scan to complete
- `--max-retry-delay 600s`: Retry failed scans after up to 10 minutes
- `--min-retry-delay 10s`: Start retrying after 10 seconds

**Optional: Add dead-letter topic for failed messages**

If you want to limit retries and capture permanently failed messages:

```bash
# Create dead-letter topic first
gcloud pubsub topics create ir-scan-requests-dead-letter

# Recreate subscription with dead-letter handling
gcloud pubsub subscriptions delete ir-scanner-sub
gcloud pubsub subscriptions create ir-scanner-sub \
  --topic ir-scan-requests \
  --push-endpoint="${SERVICE_URL}/scan" \
  --push-auth-service-account=${SERVICE_ACCOUNT} \
  --ack-deadline 600 \
  --max-retry-delay 600s \
  --min-retry-delay 10s \
  --max-delivery-attempts 5 \
  --dead-letter-topic ir-scan-requests-dead-letter
```

## Step 5: Test the Deployment

### Test with a Single Ticker

```bash
# Publish a test message
gcloud pubsub topics publish ir-scan-requests \
  --message '{"ticker":"AAPL","verbose":true}'
```

### View Logs

```bash
# Stream logs in real-time
gcloud logs tail --project=$PROJECT_ID \
  --resource-names="ir-scanner"

# View recent logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ir-scanner" \
  --limit 50 \
  --format "table(timestamp,textPayload)"

# View only errors
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ir-scanner AND severity>=ERROR" \
  --limit 20
```

### Test Multiple Tickers (Parallel)

```bash
# Publish multiple messages - they'll run in parallel
for ticker in AAPL MSFT GOOGL AMZN META; do
  gcloud pubsub topics publish ir-scan-requests --message "{\"ticker\":\"$ticker\"}"
done
```

## Configuration Details

### Cloud Run Settings

| Setting | Value | Reason |
|---------|-------|--------|
| Memory | 2 GiB | Playwright + Chromium requirement |
| CPU | 2 vCPUs | Parallel processing capability |
| Timeout | 600s (10 min) | Allow time for slow IR websites |
| Concurrency | 1 | One ticker scan per container |
| Max Instances | 20 | Support 20 parallel scans |
| Min Instances | 0 | Scale to zero when idle (no cost) |

### Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `FIREBASE_PROJECT_ID` | `.env.local` | GCP project ID |
| `GEMINI_API_KEY` | `.env.local` | Gemini API key for AI extraction |
| `PORT` | Cloud Run | Automatically set by Cloud Run (8080) |

### Service Account Permissions

| Role | Purpose |
|------|---------|
| `roles/datastore.user` | Read/write Firestore documents |
| `roles/storage.objectAdmin` | Upload PDFs to Cloud Storage |
| `roles/logging.logWriter` | Write logs to Cloud Logging |
| `roles/firebase.admin` | Full Firebase access (optional) |

## Cost Estimation

### Example: 15 tickers/day, 3 min/scan, 30 days/month

**Compute:**
- vCPU-seconds: 15 × 3 × 60 × 2 × 30 = 162,000
- GiB-seconds: 15 × 3 × 60 × 2 × 30 = 162,000

**Free Tier:**
- 180,000 vCPU-seconds/month (✅ covered)
- 360,000 GiB-seconds/month (✅ covered)

**Estimated Monthly Cost: $0-1** (within free tier!)

**Scaling up to 50 scans/day:**
- vCPU-seconds: 540,000 (overage: 360,000)
- Cost: 360,000 × $0.000024 = **~$9/month**

## Scheduling with Cloud Scheduler

To run scans daily, set up Cloud Scheduler:

### Option 1: Single Trigger for All Tickers

Create a Cloud Function or Cloud Run Job that publishes messages for all tickers:

```bash
# Create a scheduler job that triggers the publisher
gcloud scheduler jobs create http daily-ir-scan \
  --location us-central1 \
  --schedule "0 6 * * *" \
  --uri "https://your-publisher-url" \
  --http-method POST \
  --time-zone "America/New_York"
```

### Option 2: Individual Scheduler Jobs per Ticker

```bash
# Create scheduler job for each ticker
for ticker in AAPL MSFT GOOGL; do
  gcloud scheduler jobs create pubsub scan-${ticker,,} \
    --location us-central1 \
    --schedule "0 6 * * *" \
    --topic ir-scan-requests \
    --message-body "{\"ticker\":\"$ticker\"}" \
    --time-zone "America/New_York"
done
```

## Troubleshooting

### Container fails to start

**Check logs:**
```bash
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ir-scanner" \
  --limit 100
```

**Common issues:**
- Missing Playwright dependencies → Check Dockerfile includes all system packages
- Python import errors → Verify all dependencies in requirements.txt

### Authentication errors

**Symptom:** "FIREBASE_PRIVATE_KEY environment variable is not set"

**Solution:** The service account should provide automatic authentication. Check:
```bash
# Verify service account is set
gcloud run services describe ir-scanner --region us-central1 \
  --format "value(spec.template.spec.serviceAccountName)"

# Should show: ir-scanner@PROJECT_ID.iam.gserviceaccount.com
```

### Pub/Sub messages not received

**Check subscription:**
```bash
gcloud pubsub subscriptions describe ir-scanner-sub
```

**Verify push endpoint:**
```bash
# Should match your Cloud Run service URL + /scan
gcloud pubsub subscriptions describe ir-scanner-sub \
  --format "value(pushConfig.pushEndpoint)"
```

**Test endpoint directly:**
```bash
# Get service URL
SERVICE_URL=$(gcloud run services describe ir-scanner --region us-central1 --format 'value(status.url)')

# Test health endpoint (should return 200)
curl ${SERVICE_URL}/health
```

### Scans timing out

If scans take longer than 10 minutes:

1. **Increase timeout:**
   ```bash
   gcloud run services update ir-scanner \
     --region us-central1 \
     --timeout 900  # 15 minutes
   ```

2. **Update Pub/Sub ack deadline:**
   ```bash
   gcloud pubsub subscriptions update ir-scanner-sub \
     --ack-deadline 900
   ```

### High costs

**Check actual usage:**
```bash
# View Cloud Run metrics in console
gcloud monitoring time-series list \
  --filter='resource.type="cloud_run_revision" AND resource.labels.service_name="ir-scanner"'
```

**Optimization tips:**
1. Reduce memory if possible (test with 1.5 GiB)
2. Reduce CPU if scans still work (test with 1 vCPU)
3. Set max-instances lower to limit concurrent scans
4. Ensure containers scale to zero (min-instances=0)

## Updating the Service

To deploy changes:

```bash
cd data-fetcher
./deploy_cloud_run.sh
```

Cloud Run will:
1. Build a new container image
2. Deploy with zero downtime
3. Gradually shift traffic to new version

## Monitoring

### View Metrics in Cloud Console

Navigate to: Cloud Run → ir-scanner → Metrics

Key metrics:
- Request count (Pub/Sub triggers)
- Request latency (scan duration)
- Container instances (scaling behavior)
- Memory utilization

### Set Up Alerts

```bash
# Alert on error rate > 10%
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="IR Scanner High Error Rate" \
  --condition-display-name="Error rate > 10%" \
  --condition-threshold-value=0.1 \
  --condition-threshold-duration=300s
```

## Security Considerations

1. **Service not publicly accessible** - Pub/Sub uses authentication
2. **Service account has minimal permissions** - Only what's needed
3. **Environment variables for secrets** - Never commit credentials
4. **VPC connectors** (optional) - Lock down to private networks

## Next Steps

1. Set up Cloud Scheduler for daily scans
2. Configure monitoring alerts
3. Test with your full ticker list
4. Monitor costs and optimize resources

## Resources

- [Cloud Run Documentation](https://cloud.google.com/run/docs)
- [Pub/Sub Documentation](https://cloud.google.com/pubsub/docs)
- [Cloud Scheduler Documentation](https://cloud.google.com/scheduler/docs)
- [Playwright in Containers](https://playwright.dev/docs/docker)

