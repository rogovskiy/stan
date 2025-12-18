#!/usr/bin/env python3
"""
IR URL Service

Service for managing IR URLs in Firebase Firestore.
IR URLs are stored at: /tickers/{ticker}/ir_urls/*
"""

import hashlib
from datetime import datetime
from typing import Dict, List, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class IRURLService(FirebaseBaseService):
    """Service for managing IR URLs in Firebase"""
    
    def get_ir_urls(self, ticker: str) -> List[Dict[str, Any]]:
        """Get all IR URLs for a ticker from Firebase
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of IR URL dictionaries with url, last_scanned, created_at, updated_at
        """
        try:
            upper_ticker = ticker.upper()
            
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('ir_urls'))
            
            urls = []
            for doc in docs_ref.stream():
                url_data = doc.to_dict()
                url_data['id'] = doc.id
                urls.append(url_data)
            
            return urls
            
        except Exception as error:
            print(f'Error getting IR URLs for {ticker}: {error}')
            return []
    
    def add_ir_url(self, ticker: str, url: str) -> str:
        """Add an IR URL for a ticker
        
        Args:
            ticker: Stock ticker symbol
            url: IR website URL
            
        Returns:
            Document ID of the created URL
        """
        try:
            upper_ticker = ticker.upper()
            now = datetime.now()
            
            # Create a document ID from URL hash to avoid duplicates
            url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
            
            doc_data = {
                'url': url,
                'created_at': now.isoformat(),
                'updated_at': now.isoformat(),
                'last_scanned': None
            }
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('ir_urls')
                      .document(url_hash))
            
            # Check if URL already exists
            existing = doc_ref.get()
            if existing.exists:
                # Update existing URL
                doc_ref.update({
                    'updated_at': now.isoformat(),
                    'url': url  # Update URL in case it changed
                })
                return url_hash
            else:
                # Create new URL
                doc_ref.set(doc_data)
                return url_hash
            
        except Exception as error:
            print(f'Error adding IR URL for {ticker}: {error}')
            raise error
    
    def update_ir_url_last_scanned(self, ticker: str, url: str, scanned_time: Optional[datetime] = None) -> None:
        """Update the last_scanned timestamp for an IR URL
        
        Args:
            ticker: Stock ticker symbol
            url: IR website URL
            scanned_time: Optional timestamp (defaults to current time)
        """
        try:
            upper_ticker = ticker.upper()
            
            if scanned_time is None:
                scanned_time = datetime.now()
            
            # Find the document by URL
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('ir_urls'))
            
            # Query by URL
            query = docs_ref.where('url', '==', url).limit(1)
            docs = list(query.stream())
            
            if docs:
                doc_ref = docs[0].reference
                doc_ref.update({
                    'last_scanned': scanned_time.isoformat(),
                    'updated_at': scanned_time.isoformat()
                })
            else:
                # If URL doesn't exist, create it
                self.add_ir_url(ticker, url)
                # Try again to update last_scanned
                query = docs_ref.where('url', '==', url).limit(1)
                docs = list(query.stream())
                if docs:
                    docs[0].reference.update({
                        'last_scanned': scanned_time.isoformat(),
                        'updated_at': scanned_time.isoformat()
                    })
            
        except Exception as error:
            print(f'Error updating last_scanned for IR URL {url} for {ticker}: {error}')
    
    def delete_ir_url(self, ticker: str, url_id: str) -> None:
        """Delete an IR URL for a ticker
        
        Args:
            ticker: Stock ticker symbol
            url_id: Document ID of the IR URL to delete
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('ir_urls')
                      .document(url_id))
            
            doc_ref.delete()
            
        except Exception as error:
            print(f'Error deleting IR URL {url_id} for {ticker}: {error}')
            raise error

