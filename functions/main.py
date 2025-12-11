# Welcome to Cloud Functions for Firebase for Python!
# To get started, simply uncomment the below code or create your own.
# Deploy with `firebase deploy`

from firebase_functions import https_fn, scheduler_fn, pubsub_fn
from firebase_functions.options import set_global_options
from firebase_admin import initialize_app, firestore
from google.cloud import pubsub_v1
import google.cloud.logging
import logging
import os
import json
import base64

# Configure logging level (can be set via environment variable)
log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=getattr(logging, log_level, logging.INFO))

# Setup Google Cloud Logging (only if credentials are available)
try:
    client = google.cloud.logging.Client()
    client.setup_logging()
except Exception:
    # If credentials are not available (e.g., during local analysis), skip Cloud Logging setup
    # Standard logging will still work
    pass

# For cost control, you can set the maximum number of containers that can be
# running at the same time. This helps mitigate the impact of unexpected
# traffic spikes by instead downgrading performance. This limit is a per-function
# limit. You can override the limit for each function using the max_instances
# parameter in the decorator, e.g. @https_fn.on_request(max_instances=5).
set_global_options(max_instances=10)

initialize_app()

# Scheduled function that runs daily at midnight UTC
# Cron expression: 0 0 * * * (daily at 00:00 UTC)
@scheduler_fn.on_schedule(schedule="0 0 * * *")
def scheduled_task_minute(event: scheduler_fn.ScheduledEvent) -> None:
    """
    Scheduled function that runs every 1 minute.
    Fetches all tickers from Firebase and prints them.
    """
    logging.info("Scheduled task executed at: %s", event.schedule_time)
    
    try:
        # Get Firestore client
        db = firestore.client()
        
        # Get all ticker documents
        tickers_ref = db.collection('tickers')
        docs = tickers_ref.stream()
        
        # Extract ticker symbols (document IDs)
        tickers = sorted([doc.id for doc in docs])
        
        # Log all tickers on the same line
        tickers_str = ", ".join(tickers)
        logging.info(f"Tickers ({len(tickers)}): {tickers_str}")
        
        # Publish one message per ticker to Pub/Sub topic for refresh
        topic_path = 'projects/stan-1464e/topics/stan-daily-refresh'
        publisher = pubsub_v1.PublisherClient()
        
        timestamp = event.schedule_time.isoformat() if hasattr(event.schedule_time, 'isoformat') else str(event.schedule_time)
        published_count = 0
        
        for ticker in tickers:
            message_data = {
                'ticker': ticker,
                'timestamp': timestamp
            }
            
            message_json = json.dumps(message_data).encode('utf-8')
            future = publisher.publish(topic_path, message_json)
            message_id = future.result()
            published_count += 1
            logging.info(f"Published refresh message for ticker {ticker} to {topic_path} with message ID: {message_id}")
        
        logging.info(f"Published {published_count} refresh messages (one per ticker) to {topic_path}")
        
    except Exception as e:
        error_msg = f"Error fetching tickers or publishing message: {e}"
        logging.error(error_msg)

# Pub/Sub function that listens to refresh messages
@pubsub_fn.on_message_published(topic="stan-daily-refresh")
def handle_daily_refresh(event: pubsub_fn.CloudEvent[pubsub_fn.MessagePublishedData]) -> None:
    """
    Handles messages from the stan-daily-refresh Pub/Sub topic.
    Logs the received message.
    """
    try:
        # Decode the base64-encoded message data
        message_data = event.data.message.data
        if isinstance(message_data, str):
            # Decode base64 string
            decoded_bytes = base64.b64decode(message_data)
        else:
            # Already bytes, use as is
            decoded_bytes = message_data
        
        # Try to decode as JSON
        try:
            decoded_str = decoded_bytes.decode('utf-8')
            data = json.loads(decoded_str)
            
            # Log ticker-specific message if present
            if 'ticker' in data:
                logging.info(f"Received refresh message for ticker: {data['ticker']} at {data.get('timestamp', 'unknown time')}")
            else:
                logging.info(f"Received refresh message: {json.dumps(data, indent=2)}")
        except (UnicodeDecodeError, json.JSONDecodeError) as e:
            # If not JSON, log as string
            logging.info(f"Received refresh message (raw): {decoded_bytes}")
            logging.warning(f"Could not parse as JSON: {e}")
        
        logging.info("Daily refresh message processed successfully")
        
    except Exception as e:
        error_msg = f"Error processing refresh message: {e}"
        logging.error(error_msg)

# initialize_app()
#
#
# @https_fn.on_request()
# def on_request_example(req: https_fn.Request) -> https_fn.Response:
#     return https_fn.Response("Hello world!")