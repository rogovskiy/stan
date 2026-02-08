#!/usr/bin/env python3
"""
Pub/Sub Message Service

Service for managing Pub/Sub message tracking in Firebase Firestore.
Messages are stored at: /pubsub_messages/<ticker>/scan/<messageID>
"""

from datetime import datetime, timedelta
from typing import Dict, Optional, Any
from firebase_admin import firestore
from services.firebase_base_service import FirebaseBaseService


class PubSubMessageService(FirebaseBaseService):
    """Service for managing Pub/Sub message tracking in Firebase"""
    
    def check_scan_message_exists(self, ticker: str, message_id: str) -> bool:
        """Check if a scan message document exists in Firebase
        
        Args:
            ticker: Stock ticker symbol
            message_id: Pub/Sub message ID
            
        Returns:
            True if message exists, False otherwise
            
        Raises:
            Exception: If there's an error checking Firebase, the exception will bubble up
        """
        upper_ticker = ticker.upper()
        
        doc_ref = (self.db.collection('pubsub_messages')
                  .document(upper_ticker)
                  .collection('scan')
                  .document(message_id))
        
        doc = doc_ref.get()
        return doc.exists
    
    def store_scan_message(self, ticker: str, message_id: str, start_time: Optional[datetime] = None) -> None:
        """Store a scan message in Firebase with start_time and expiration
        
        Args:
            ticker: Stock ticker symbol
            message_id: Pub/Sub message ID
            start_time: Optional start time (defaults to current time)
        """
        try:
            if start_time is None:
                start_time = datetime.now()
            
            upper_ticker = ticker.upper()
            
            # Calculate expiration time (7 days from start_time)
            expires_at = start_time + timedelta(days=7)
            
            # Firestore client serializes datetime to Timestamp when writing
            doc_data = {
                'ticker': upper_ticker,
                'message_id': message_id,
                'start_time': start_time.isoformat(),
                'expires_at': expires_at  # datetime; Firestore stores as Timestamp for TTL
            }
            
            doc_ref = (self.db.collection('pubsub_messages')
                      .document(upper_ticker)
                      .collection('scan')
                      .document(message_id))
            
            doc_ref.set(doc_data)
            print(f'Stored scan message for {ticker} with message_id {message_id}')
            
        except Exception as error:
            print(f'Error storing scan message for {ticker} {message_id}: {error}')
            raise error

