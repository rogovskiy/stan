#!/usr/bin/env python3
"""
Company Summary Service

Service for managing company information in Firebase Firestore.
Company information is stored at: /tickers/{ticker} (main document)
"""

from typing import Dict, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class CompanySummaryService(FirebaseBaseService):
    """Service for managing company information in Firebase"""
    
    def store_company_summary(self, ticker: str, company_info: Dict[str, Any]) -> None:
        """Store company information in Firestore at main ticker document
        
        This merges with existing ticker metadata, preserving existing fields.
        
        Args:
            ticker: Stock ticker symbol
            company_info: Dictionary containing company information fields
        """
        try:
            upper_ticker = ticker.upper()
            
            # Store at main ticker document (merge with existing data)
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker))
            
            # Use set with merge=True to preserve existing fields
            doc_ref.set(company_info, merge=True)
            
            print(f'✅ Stored company information for {ticker}')
                
        except Exception as error:
            print(f'Error storing company information for {ticker}: {error}')
            raise error
    
    def get_company_summary(self, ticker: str) -> Optional[Dict[str, Any]]:
        """Get company information from Firestore main ticker document
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            Dictionary with company information data, or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting company information for {ticker}: {error}')
            return None
