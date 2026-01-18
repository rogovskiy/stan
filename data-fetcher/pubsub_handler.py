#!/usr/bin/env python3
"""
Pub/Sub Handler for Cloud Run

Receives Pub/Sub push messages with ticker symbols and triggers IR website scans.
"""

import os
import sys
import json
import base64
import logging
import uuid
from flask import Flask, request, jsonify
from scan_ir_website import scan_ir_website
from cloud_logging_setup import setup_cloud_logging, get_logger

# Initialize Cloud Logging when running in Cloud Run
if os.environ.get('K_SERVICE'):
    setup_cloud_logging()
    logging.info('Cloud Logging initialized for Cloud Run')
else:
    # Local dev - configure standard logging
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    logging.info('Standard logging configured for local development')

logger = logging.getLogger(__name__)

app = Flask(__name__)


@app.route('/scan', methods=['POST'])
def handle_pubsub():
    """Handle Pub/Sub push messages"""
    # Generate execution ID for this request
    execution_id = str(uuid.uuid4())
    
    envelope = request.get_json()
    
    if not envelope:
        msg = 'No Pub/Sub message received'
        logger.error(msg, extra={
            "labels": {
                "execution_id": execution_id
            }
        })
        return jsonify({'error': msg}), 400
    
    # Log the raw incoming message
    logger.info('Received Pub/Sub message', extra={
        "labels": {
            "execution_id": execution_id,
            "operation": "pubsub_receive"
        }
    })
    
    # Pub/Sub sends message in 'message' field
    pubsub_message = envelope.get('message', {})
    
    # Decode base64 data
    if 'data' in pubsub_message:
        try:
            data = base64.b64decode(pubsub_message['data']).decode('utf-8')
            logger.info(f'Decoded message data: {data}', extra={
                "labels": {
                    "execution_id": execution_id
                }
            })
            try:
                message_data = json.loads(data)
            except json.JSONDecodeError:
                # If not JSON, treat as plain string ticker
                message_data = {'ticker': data}
        except Exception as e:
            msg = f'Failed to decode message data: {e}'
            logger.error(msg, extra={
                "labels": {
                    "execution_id": execution_id
                }
            })
            return jsonify({'error': msg}), 400
    else:
        msg = 'No data in Pub/Sub message'
        logger.error(msg, extra={
            "labels": {
                "execution_id": execution_id
            }
        })
        return jsonify({'error': msg}), 400
    
    ticker = message_data.get('ticker')
    if not ticker:
        msg = 'No ticker in message'
        logger.error(msg, extra={
            "labels": {
                "execution_id": execution_id
            }
        })
        return jsonify({'error': msg}), 400
    
    quarter = message_data.get('quarter')
    verbose = message_data.get('verbose', False)
    
    # Create context logger with execution_id and ticker
    context_logger = get_logger(
        __name__,
        execution_id=execution_id,
        ticker=ticker,
        scan_type=None  # Will be set per URL in scan_ir_website
    )
    
    context_logger.info('scan_start', quarter=quarter, operation='scan_start')
    
    try:        
        # Run the scan with context logger
        scan_ir_website(ticker, quarter, verbose, context_logger)
        
        context_logger.info('scan_complete', operation='scan_complete')
        return jsonify({
            'status': 'success',
            'ticker': ticker,
            'quarter': quarter,
            'execution_id': execution_id
        }), 200
        
    except Exception as e:
        context_logger.error(f'Error scanning {ticker}: {e}', operation='scan_error', error=str(e), exc_info=True)
        # Return 500 so Pub/Sub retries
        return jsonify({
            'status': 'error',
            'ticker': ticker,
            'error': str(e),
            'execution_id': execution_id
        }), 500


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({'status': 'healthy'}), 200


@app.route('/', methods=['GET'])
def root():
    """Root endpoint with service info"""
    return jsonify({
        'service': 'IR Scanner',
        'version': '1.0',
        'endpoints': {
            '/scan': 'POST - Handle Pub/Sub scan requests',
            '/health': 'GET - Health check'
        }
    }), 200


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    logger.info(f'Starting Pub/Sub handler on port {port}')
    app.run(host='0.0.0.0', port=port)

