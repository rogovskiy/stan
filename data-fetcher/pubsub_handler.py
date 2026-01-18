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
from flask import Flask, request, jsonify
from scan_ir_website import scan_ir_website

# Configure logging for Cloud Run
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    stream=sys.stdout
)
logger = logging.getLogger(__name__)

app = Flask(__name__)


@app.route('/scan', methods=['POST'])
def handle_pubsub():
    """Handle Pub/Sub push messages"""
    envelope = request.get_json()
    
    if not envelope:
        msg = 'No Pub/Sub message received'
        logger.error(msg)
        return jsonify({'error': msg}), 400
    
    # Log the raw incoming message
    logger.info(f'Received Pub/Sub message: {json.dumps(envelope, indent=2)}')
    
    # Pub/Sub sends message in 'message' field
    pubsub_message = envelope.get('message', {})
    
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
            msg = f'Failed to decode message data: {e}'
            logger.error(msg)
            return jsonify({'error': msg}), 400
    else:
        msg = 'No data in Pub/Sub message'
        logger.error(msg)
        return jsonify({'error': msg}), 400
    
    ticker = message_data.get('ticker')
    if not ticker:
        msg = 'No ticker in message'
        logger.error(msg)
        return jsonify({'error': msg}), 400
    
    quarter = message_data.get('quarter')
    verbose = message_data.get('verbose', False)
    
    logger.info(f'Processing scan request for {ticker}')
    if quarter:
        logger.info(f'  Quarter filter: {quarter}')
    
    try:
        # Run the scan
        scan_ir_website(ticker, quarter, verbose)
        
        logger.info(f'Successfully completed scan for {ticker}')
        return jsonify({
            'status': 'success',
            'ticker': ticker,
            'quarter': quarter
        }), 200
        
    except Exception as e:
        logger.error(f'Error scanning {ticker}: {e}', exc_info=True)
        # Return 500 so Pub/Sub retries
        return jsonify({
            'status': 'error',
            'ticker': ticker,
            'error': str(e)
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

