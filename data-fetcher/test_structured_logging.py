#!/usr/bin/env python3
"""
Test script for structured logging to Google Cloud Logging.
Uses the simple setup_logging() approach.

Usage:
    python test_structured_logging.py
"""

import os
import logging
from dotenv import load_dotenv
from google.oauth2 import service_account

# Load environment variables
env_path = os.path.join(os.path.dirname(__file__), '.env.local')
if os.path.exists(env_path):
    load_dotenv(env_path)
    print(f"✅ Loaded environment from {env_path}\n")

# Import Google Cloud Logging
import google.cloud.logging

# Get project ID from environment
project_id = os.getenv('FIREBASE_PROJECT_ID')
if not project_id:
    print("❌ Error: FIREBASE_PROJECT_ID not set in .env.local")
    exit(1)

# Create credentials from environment variables
private_key = os.getenv("FIREBASE_PRIVATE_KEY")
if not private_key:
    print("❌ Error: FIREBASE_PRIVATE_KEY not set in .env.local")
    exit(1)

private_key = private_key.replace('\\n', '\n')

credentials_info = {
    "type": "service_account",
    "project_id": project_id,
    "private_key_id": os.getenv("FIREBASE_PRIVATE_KEY_ID"),
    "private_key": private_key,
    "client_email": os.getenv("FIREBASE_CLIENT_EMAIL"),
    "client_id": os.getenv("FIREBASE_CLIENT_ID"),
    "auth_uri": os.getenv("FIREBASE_AUTH_URI", "https://accounts.google.com/o/oauth2/auth"),
    "token_uri": os.getenv("FIREBASE_TOKEN_URI", "https://oauth2.googleapis.com/token"),
}

credentials = service_account.Credentials.from_service_account_info(credentials_info)

# Instantiate a client with explicit credentials
client = google.cloud.logging.Client(project=project_id, credentials=credentials)

# Set up Cloud Logging handler with the Python root logger
# This captures all logs at INFO level and higher
client.setup_logging()

print("="*80)
print("🧪 TESTING STRUCTURED LOGGING TO GOOGLE CLOUD")
print("="*80)
print(f"\nProject: {client.project}")
print(f"Logs will appear at: https://console.cloud.google.com/logs/query?project={client.project}\n")

# Test 1: Simple log messages
logging.info("Simple INFO message")
logging.warning("Simple WARNING message")
logging.error("Simple ERROR message")

# Test 2: Logs with structured data (using extra parameter)
logging.info("Log with execution context", extra={
    'execution_id': 'exec-12345',
    'ticker': 'AAPL',
    'scan_type': 'update',
})

# Test 3: Logs with multiple custom fields
logging.info("Scan completed successfully", extra={
    'execution_id': 'exec-12345',
    'ticker': 'AAPL',
    'scan_type': 'new',
    'documents_found': 42,
    'processing_time_ms': 2500,
    'url': 'https://example.com/ir',
})

# Test 4: Warning with context
logging.warning("Slow response detected", extra={
    'execution_id': 'exec-12345',
    'ticker': 'GOOGL',
    'response_time_ms': 5000,
    'threshold_ms': 3000,
})

# Test 5: Error with context
logging.error("Browser navigation failed", extra={
    'execution_id': 'exec-12345',
    'ticker': 'TSLA',
    'scan_type': 'update',
    'error_type': 'NAVIGATION_TIMEOUT',
    'url': 'https://example.com/ir',
})

# Test 6: Error with exception
try:
    result = 1 / 0
except ZeroDivisionError:
    logging.error("Division by zero error", exc_info=True, extra={
        'execution_id': 'exec-12345',
        'ticker': 'MSFT',
    })

print("\n" + "="*80)
print("✅ Test complete! Flushing logs...")
print("="*80)

# Flush logs before exit
import time
logging.shutdown()
time.sleep(2)  # Give time for background threads to finish

print(f"""
View your logs in Cloud Console:
https://console.cloud.google.com/logs/query?project={client.project}

Filter by severity:
  severity>=WARNING

Filter by custom fields:
  jsonPayload.execution_id="exec-12345"
  jsonPayload.ticker="AAPL"
  jsonPayload.scan_type="new"

Note: It may take a few seconds for logs to appear in the console.

⚠️  If you see permission errors, the service account needs 'roles/logging.logWriter':
  gcloud projects add-iam-policy-binding {client.project} \\
    --member="serviceAccount:{credentials_info['client_email']}" \\
    --role="roles/logging.logWriter"
""")
