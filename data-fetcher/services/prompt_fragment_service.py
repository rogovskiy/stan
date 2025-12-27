#!/usr/bin/env python3
"""
Prompt Fragment Service

Service for managing prompt fragments in Firebase Firestore.
Prompt fragments are stored at: /tickers/{ticker}/prompt_fragments/*
"""

from typing import Dict, List, Any
from services.firebase_base_service import FirebaseBaseService


class PromptFragmentService(FirebaseBaseService):
    """Service for managing prompt fragments in Firebase"""
    
    def get_prompt_fragments(self, ticker: str) -> List[Dict[str, Any]]:
        """Get all prompt fragments for a ticker
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of prompt fragment dictionaries with id, title, content, created_at, updated_at
        """
        try:
            upper_ticker = ticker.upper()
            
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('prompt_fragments'))
            
            fragments = []
            for doc in docs_ref.stream():
                fragment_data = doc.to_dict()
                fragment_data['id'] = doc.id
                fragments.append(fragment_data)
            
            # Sort by order if available, then by created_at
            fragments.sort(key=lambda x: (
                x.get('order', float('inf')),
                x.get('created_at', '') if x.get('created_at') else ''
            ))
            
            return fragments
            
        except Exception as error:
            print(f'Error getting prompt fragments for {ticker}: {error}')
            return []





