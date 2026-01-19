#!/usr/bin/env python3
"""
Ticker Metadata Service

Service for managing ticker metadata in Firebase Firestore.
Metadata is stored at: /tickers/{ticker}
"""

from datetime import datetime, timedelta
from typing import Dict, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class TickerMetadataService(FirebaseBaseService):
    """Service for managing ticker metadata in Firebase"""
    
    def cache_ticker_metadata(self, ticker: str, metadata: Dict[str, Any]) -> None:
        """Cache ticker metadata to Firestore"""
        try:
            doc_ref = self.db.collection('tickers').document(ticker.upper())
            metadata_with_timestamp = {
                **metadata,
                'last_updated': datetime.now().isoformat()
            }
            doc_ref.set(metadata_with_timestamp)
            print(f'Cached metadata for {ticker}')
        except Exception as error:
            print(f'Error caching metadata for {ticker}: {error}')
            raise error
    
    def get_ticker_metadata(self, ticker: str) -> Optional[Dict[str, Any]]:
        """Get ticker metadata from Firestore"""
        try:
            doc_ref = self.db.collection('tickers').document(ticker.upper())
            doc = doc_ref.get()
            
            if doc.exists:
                data = doc.to_dict()
                
                # Check if metadata is stale (older than 7 days)
                last_updated = data.get('last_updated')
                if last_updated:
                    cache_age = datetime.now() - datetime.fromisoformat(last_updated)
                    max_age = timedelta(days=7)
                    
                    if cache_age < max_age:
                        print(f'Metadata cache hit for {ticker}')
                        return data
                
                print(f'Metadata cache expired for {ticker}')
                return None
            
            return None
        except Exception as error:
            print(f'Error getting metadata for {ticker}: {error}')
            return None






