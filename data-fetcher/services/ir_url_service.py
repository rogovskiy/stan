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

MAX_LINK_CACHE_SIZE = 500

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
    
    def _get_url_hash(self, url: str) -> str:
        """Generate hash for URL (reuse existing pattern)
        
        Args:
            url: URL to hash
            
        Returns:
            12-character hex hash
        """
        return hashlib.md5(url.encode()).hexdigest()[:12]
    
    def get_cached_links(self, ticker: str, ir_url: str) -> List[Dict[str, Any]]:
        """Get cached links for an IR URL
        
        Args:
            ticker: Stock ticker symbol
            ir_url: IR website URL
            
        Returns:
            List of cached link dictionaries with url and last_seen
            Sorted by last_seen descending (most recent first)
        """
        try:
            upper_ticker = ticker.upper()
            url_hash = self._get_url_hash(ir_url)
            
            # Get the cache document from the link_cache subcollection
            cache_doc_ref = (self.db.collection('tickers')
                            .document(upper_ticker)
                            .collection('ir_urls')
                            .document(url_hash)
                            .collection('link_cache')
                            .document('cache'))
            
            cache_doc = cache_doc_ref.get()
            if not cache_doc.exists:
                return []
            
            # Get links field (it's a list)
            cache_data = cache_doc.to_dict()
            cached_links = cache_data.get('links', [])
            
            # Already sorted by last_seen descending, just apply limit
            return cached_links
            
        except Exception as error:
            print(f'Error getting cached links for {ir_url} for {ticker}: {error}')
            return []
    
    def update_link_cache(self, ticker: str, ir_url: str, links: List[str]) -> None:
        """Update cache by merging existing cached links with new links
        
        Merges existing cached links with the provided list of URLs. New links
        get their `last_seen` initialized to the current time. Existing links
        have their `last_seen` updated. The cache is then capped at 200 entries
        based on most recent `last_seen`.
        
        Args:
            ticker: Stock ticker symbol
            ir_url: IR website URL
            links: List of URL strings to merge into the cache
        """
        upper_ticker = ticker.upper()
        url_hash = self._get_url_hash(ir_url)
        now_iso = datetime.now().isoformat()
        
        # Ensure the IR URL document exists
        ir_url_ref = (self.db.collection('tickers')
                        .document(upper_ticker)
                        .collection('ir_urls')
                        .document(url_hash))
        
        if not ir_url_ref.get().exists:
            raise ValueError(f"IR URL document for {ir_url} does not exist for ticker {ticker}.")
        
        # Start with existing links as a dict for O(1) lookup
        existing_links = self.get_cached_links(ticker, ir_url)
        links_dict = {link['url']: link for link in existing_links}
        
        # Update or add all new links with current timestamp
        for url in links:
            if url:
                links_dict[url] = {'url': url, 'last_seen': now_iso}
        
        # Convert to list, sort by last_seen desc, cap at 200
        merged_links = sorted(links_dict.values(), 
                                key=lambda x: x['last_seen'], 
                                reverse=True)[:MAX_LINK_CACHE_SIZE]
        
        # Write to cache subcollection
        cache_doc_ref = (ir_url_ref.collection('link_cache')
                                    .document('cache'))
        cache_doc_ref.set({
            'links': merged_links,
            'updated_at': now_iso
        })
    
    def get_cached_detail_urls(self, ticker: str, ir_url: str) -> List[str]:
        """Get cached detail page URLs for an IR URL.
        
        Detail pages are pages that have been visited by the crawler to extract documents.
        We cache these to avoid re-visiting them on subsequent crawls.
        
        Args:
            ticker: Stock ticker symbol
            ir_url: IR website URL
            
        Returns:
            List of detail page URL strings that have been previously visited
        """
        try:
            upper_ticker = ticker.upper()
            url_hash = self._get_url_hash(ir_url)
            
            # Get the detail_cache document from the detail_cache subcollection
            cache_doc_ref = (self.db.collection('tickers')
                            .document(upper_ticker)
                            .collection('ir_urls')
                            .document(url_hash)
                            .collection('detail_cache')
                            .document('cache'))
            
            cache_doc = cache_doc_ref.get()
            if not cache_doc.exists:
                return []
            
            # Get detail_urls field (it's a list of strings)
            cache_data = cache_doc.to_dict()
            detail_urls = cache_data.get('detail_urls', [])
            
            return detail_urls
            
        except Exception as error:
            print(f'Error getting cached detail URLs for {ir_url} for {ticker}: {error}')
            return []
    
    def cache_detail_urls(self, ticker: str, ir_url: str, detail_urls: List[str]) -> None:
        """Cache detail page URLs visited during crawling.
        
        This merges new detail URLs with existing cached ones to maintain a complete
        list of all detail pages that have been visited.
        
        Args:
            ticker: Stock ticker symbol
            ir_url: IR website URL
            detail_urls: List of detail page URLs visited during this crawl
        """
        try:
            upper_ticker = ticker.upper()
            url_hash = self._get_url_hash(ir_url)
            now_iso = datetime.now().isoformat()
            
            # Ensure the IR URL document exists
            ir_url_ref = (self.db.collection('tickers')
                            .document(upper_ticker)
                            .collection('ir_urls')
                            .document(url_hash))
            
            if not ir_url_ref.get().exists:
                # If IR URL doesn't exist, create it first
                self.add_ir_url(ticker, ir_url)
                ir_url_ref = (self.db.collection('tickers')
                                .document(upper_ticker)
                                .collection('ir_urls')
                                .document(url_hash))
            
            # Get existing cached detail URLs
            existing_detail_urls = self.get_cached_detail_urls(ticker, ir_url)
            existing_set = set(existing_detail_urls)
            
            # Merge with new detail URLs (no duplicates)
            for url in detail_urls:
                if url:
                    existing_set.add(url)
            
            # Convert back to list
            merged_detail_urls = list(existing_set)
            
            # Write to detail_cache subcollection
            cache_doc_ref = (ir_url_ref.collection('detail_cache')
                                        .document('cache'))
            cache_doc_ref.set({
                'detail_urls': merged_detail_urls,
                'updated_at': now_iso,
                'total_count': len(merged_detail_urls)
            })
            
        except Exception as error:
            print(f'Error caching detail URLs for {ir_url} for {ticker}: {error}')



