# Welcome to Cloud Functions for Firebase for Python!
# To get started, simply uncomment the below code or create your own.
# Deploy with `firebase deploy`

from firebase_functions import https_fn, scheduler_fn, pubsub_fn
from firebase_functions.options import set_global_options
from firebase_admin import initialize_app, firestore
from google.cloud import pubsub_v1
import logging
import os
import json

# Configure logging level (can be set via environment variable)
log_level = os.getenv('LOG_LEVEL', 'INFO').upper()
logging.basicConfig(level=getattr(logging, log_level, logging.INFO))

# Note: Firebase Functions automatically sends logs to Cloud Logging,
# so explicit Cloud Logging setup is not needed and can cause deployment timeouts

# For cost control, you can set the maximum number of containers that can be
# running at the same time. This helps mitigate the impact of unexpected
# traffic spikes by instead downgrading performance. This limit is a per-function
# limit. You can override the limit for each function using the max_instances
# parameter in the decorator, e.g. @https_fn.on_request(max_instances=5).
set_global_options(max_instances=10)

benchmarks = [ 'SPY', 'XLF', 'XLE', 'XLK', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLC', "GLD", 'QQQ' ]
initialize_app()

# Scheduled function that runs daily at midnight UTC
# Cron expression: 0 0 * * * (daily at 00:00 UTC)
@scheduler_fn.on_schedule(schedule="0 0 * * *")
def scheduled_daily_refresh(event: scheduler_fn.ScheduledEvent) -> None:
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
        
        # Extract all tickers and filter by refresh_enabled
        all_tickers = []
        enabled_tickers = []
        
        for doc in docs:
            ticker_id = doc.id
            doc_data = doc.to_dict()
            all_tickers.append(ticker_id)
            
            # Check if refresh_enabled is True
            if doc_data.get('refresh_enabled') == True:
                enabled_tickers.append(ticker_id)
        
        # Sort for consistent logging
        all_tickers = sorted(all_tickers)
        enabled_tickers = sorted(enabled_tickers)
        
        # Log all tickers on the same line
        tickers_str = ", ".join(all_tickers)
        logging.info(f"Tickers ({len(all_tickers)}): {tickers_str}")
        logging.info(f"Enabled tickers ({len(enabled_tickers)}): {', '.join(enabled_tickers) if enabled_tickers else 'none'}")
        
        # Initialize Pub/Sub publisher
        publisher = pubsub_v1.PublisherClient()
        
        # Topic paths for the two topics
        ir_topic_path = 'projects/stan-1464e/topics/ir-scan-requests'
        yf_topic_path = 'projects/stan-1464e/topics/yf-refresh-requests'
        
        ir_published_count = 0
        yf_published_count = 0
        
        # Publish messages to both topics for each enabled ticker
        for ticker in enabled_tickers:
            message_data = {'ticker': ticker}
            message_json = json.dumps(message_data).encode('utf-8')
            
            # Publish to ir-scan-requests topic
            future_ir = publisher.publish(ir_topic_path, message_json)
            message_id_ir = future_ir.result()
            ir_published_count += 1
            logging.info(f"Published refresh message for ticker {ticker} to {ir_topic_path} with message ID: {message_id_ir}")
            
            # Publish to yf-refresh-requests topic
            future_yf = publisher.publish(yf_topic_path, message_json)
            message_id_yf = future_yf.result()
            yf_published_count += 1
            logging.info(f"Published refresh message for ticker {ticker} to {yf_topic_path} with message ID: {message_id_yf}")
        
        logging.info(f"Published {ir_published_count} messages to {ir_topic_path} and {yf_published_count} messages to {yf_topic_path}")
        
        for ticker in benchmarks:
            message_data = {'ticker': ticker}
            message_json = json.dumps(message_data).encode('utf-8')
            future_yf = publisher.publish(yf_topic_path, message_json)
            message_id_yf = future_yf.result()
            yf_published_count += 1
            logging.info(f"Published refresh message for ticker {ticker} to {yf_topic_path} with message ID: {message_id_yf}")
        
    except Exception as e:
        error_msg = f"Error fetching tickers or publishing message: {e}"
        logging.error(error_msg)

