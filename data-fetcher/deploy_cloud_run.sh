#!/bin/bash
set -e

# Deploy IR Scanner to Cloud Run
# This script reads configuration from .env.local and deploys the service

echo "🚀 Deploying IR Scanner to Cloud Run"
echo "======================================"

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ Error: .env.local not found"
    echo "Please create .env.local with required environment variables:"
    echo "  - FIREBASE_PROJECT_ID"
    echo "  - GEMINI_API_KEY"
    exit 1
fi

# Load environment variables from .env.local
echo "📋 Loading configuration from .env.local..."
export $(grep -v '^#' .env.local | grep FIREBASE_PROJECT_ID | xargs)
export $(grep -v '^#' .env.local | grep GEMINI_API_KEY | xargs)

# Validate required variables
if [ -z "$FIREBASE_PROJECT_ID" ]; then
    echo "❌ Error: FIREBASE_PROJECT_ID not found in .env.local"
    exit 1
fi

if [ -z "$GEMINI_API_KEY" ]; then
    echo "❌ Error: GEMINI_API_KEY not found in .env.local"
    exit 1
fi

# Configuration
PROJECT_ID="$FIREBASE_PROJECT_ID"
REGION="us-central1"
SERVICE_NAME="ir-scanner"
SERVICE_ACCOUNT="ir-scanner@${PROJECT_ID}.iam.gserviceaccount.com"

echo ""
echo "Configuration:"
echo "  Project ID: $PROJECT_ID"
echo "  Region: $REGION"
echo "  Service Name: $SERVICE_NAME"
echo "  Service Account: $SERVICE_ACCOUNT"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ Error: gcloud CLI not found"
    echo "Please install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Set the project
echo "🔧 Setting gcloud project to $PROJECT_ID..."
gcloud config set project $PROJECT_ID

# Deploy to Cloud Run
echo ""
echo "🚢 Deploying to Cloud Run..."
echo ""

gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --platform managed \
  --memory 2Gi \
  --cpu 2 \
  --timeout 600 \
  --max-instances 3 \
  --concurrency 1 \
  --no-allow-unauthenticated \
  --service-account $SERVICE_ACCOUNT \
  --set-env-vars FIREBASE_PROJECT_ID=$PROJECT_ID \
  --set-secrets GEMINI_API_KEY=ir_scanner_gemini_api_key:latest

# Get the service URL
SERVICE_URL=$(gcloud run services describe $SERVICE_NAME --region $REGION --format 'value(status.url)')

echo ""
echo "✅ Deployment complete!"
echo "======================================"
echo ""
echo "Service URL: $SERVICE_URL"
echo ""
echo "Next steps:"
echo "1. Set up Pub/Sub topic: gcloud pubsub topics create ir-scan-requests"
echo "2. Create push subscription (see docs/cloud_run_deployment.md)"
echo "3. Test with: gcloud pubsub topics publish ir-scan-requests --message '{\"ticker\":\"AAPL\"}'"
echo ""

