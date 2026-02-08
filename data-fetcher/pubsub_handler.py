#!/usr/bin/env python3
"""
Pub/Sub Handler for Cloud Run

Receives Pub/Sub push messages with ticker symbols and triggers IR website scans.
"""

import os
import json
import base64
import logging
import re
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from scan_ir_website import scan_ir_website
from cloud_logging_setup import setup_cloud_logging, mdc_execution_id, mdc_ticker, emit_metric
from yahoo.refresh_driver import refresh_yahoo_data
from services.pubsub_message_service import PubSubMessageService

# Initialize logging (Cloud Run or local dev)
setup_cloud_logging()

logger = logging.getLogger(__name__)

app = Flask(__name__)


@app.route('/scan', methods=['POST'])
def handle_pubsub():
    """Handle Pub/Sub push messages"""    
    envelope = request.get_json()
    
    logger.info(f'Received Pub/Sub message: with payload: {envelope}')

    if not envelope:
        return render_error('No Pub/Sub message received')

    
    # Pub/Sub sends message in 'message' field
    pubsub_message = envelope.get('message', {})

    message_id = pubsub_message.get('messageId') or str(uuid.uuid4())
    publish_time = pubsub_message.get("publishTime")
    attributes = pubsub_message.get("attributes", {})

    mdc_execution_id.set(message_id)
    logger.info(f'Received Pub/Sub message: {message_id} published at {publish_time} with attributes: {attributes}')

    # Decode base64 data
    if 'data' in pubsub_message:
        try:
            data = base64.b64decode(pubsub_message['data']).decode('utf-8')
            logger.info(f'Decoded message data: {data}')
            try:
                message_data = json.loads(data)
            except json.JSONDecodeError:
                # If not JSON, treat as plain string ticker
                message_data = {'ticker': data}
        except Exception as e:
            return render_error(f'Failed to decode message data: {e}')
    else:
        return render_error('No data in Pub/Sub message')
    
    ticker = message_data.get('ticker')
    if not ticker:
        return render_error('No ticker in message')
    
    quarter = None #message_data.get('quarter')
    verbose = True
    
    mdc_ticker.set(ticker)
    
    # Initialize Pub/Sub message service
    pubsub_service = PubSubMessageService()
    
    # Check if message is already being processed
    if pubsub_service.check_scan_message_exists(ticker, message_id):
        logger.info(f'Scan message {message_id} for {ticker} already exists - returning 200 to prevent duplicate processing')
        return jsonify({
            'status': 'already_processing',
            'ticker': ticker,
            'execution_id': message_id,
            'message': 'Scan is already in progress for this message'
        }), 200
    
    # Store message before processing to prevent duplicates
    try:
        pubsub_service.store_scan_message(ticker, message_id, datetime.now())
        logger.info(f'Stored scan message {message_id} for {ticker} before starting processing')
    except Exception as e:
        logger.warning(f'Failed to store scan message {message_id} for {ticker}: {e}. Continuing with scan anyway.')
    
    try:        
        # Run the scan with context logger (rescan mode: first listing page only)
        scan_ir_website(ticker, quarter, verbose, rescan=True)
        
        return jsonify({
            'status': 'success',
            'ticker': ticker,
            'execution_id': message_id
        }), 200
        
    except Exception as e:
        logger.error(f'Error scanning {ticker}: {e}', operation='scan_error', error=str(e), exc_info=True)
        # Return 500 so Pub/Sub retries
        return jsonify({
            'status': 'error',
            'ticker': ticker,
            'error': str(e),
            'execution_id': message_id
        }), 500


@app.route('/refresh-yahoo', methods=['POST'])
def handle_yahoo_refresh():
    """Handle Pub/Sub push messages for Yahoo Finance refresh"""    
    envelope = request.get_json()
    
    if not envelope:
        return render_error('No Pub/Sub message received')
    
    # Pub/Sub sends message in 'message' field
    pubsub_message = envelope.get('message', {})

    message_id = pubsub_message.get('messageId') or str(uuid.uuid4())
    publish_time = pubsub_message.get("publishTime")
    attributes = pubsub_message.get("attributes", {})

    mdc_execution_id.set(message_id)
    logger.info(f'Received Pub/Sub message for Yahoo refresh: {message_id} published at {publish_time} with attributes: {attributes}')

    # Decode base64 data
    if 'data' in pubsub_message:
        try:
            data = base64.b64decode(pubsub_message['data']).decode('utf-8')
            logger.info(f'Decoded message data: {data}')
            try:
                message_data = json.loads(data)
            except json.JSONDecodeError:
                # If not JSON, treat as plain string ticker
                message_data = {'ticker': data}
        except Exception as e:
            return render_error(f'Failed to decode message data: {e}')
    else:
        return render_error('No data in Pub/Sub message')
    
    ticker = message_data.get('ticker')
    if not ticker:
        return render_error('No ticker in message')
    
    verbose = True
    mdc_ticker.set(ticker)
    
    try:        
        # Run the refresh with context logger
        results = refresh_yahoo_data(ticker, verbose)
        
        return jsonify({
            'status': 'success' if results.get('success') else 'partial_success',
            'ticker': ticker,
            'execution_id': message_id,
            'results': results.get('results', {})
        }), 200
        
    except Exception as e:
        logger.error(f'Error refreshing Yahoo data for {ticker}: {e}', operation='yahoo_refresh_error', error=str(e), exc_info=True)
        # Return 500 so Pub/Sub retries
        return jsonify({
            'status': 'error',
            'ticker': ticker,
            'error': str(e),
            'execution_id': message_id
        }), 500


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'}), 200


@app.route('/', methods=['GET'])
def root():
    """Root endpoint with service info"""
    return jsonify({
        'service': 'IR Scanner & Yahoo Refresh',
        'version': '1.0',
        'endpoints': {
            '/scan': 'POST - Handle Pub/Sub scan requests',
            '/refresh-yahoo': 'POST - Handle Pub/Sub Yahoo Finance refresh requests',
            '/health': 'GET - Health check'
        }
    }), 200

def render_error(msg: str):
    logger.error(msg)
    return jsonify({'error': msg}), 400

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    logger.info(f'Starting Pub/Sub handler on port {port}')
    app.run(host='0.0.0.0', port=port)

