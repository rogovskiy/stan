#!/usr/bin/env python3
"""
Company Summary Service

Service for managing company summaries in Firebase Firestore.
Company summaries are stored at: /tickers/{ticker}/company_summary/summary
"""

from typing import Dict, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class CompanySummaryService(FirebaseBaseService):
    """Service for managing company summaries in Firebase"""
    
    def store_company_summary(self, ticker: str, summary_data: Dict[str, Any]) -> None:
        """Store company summary in Firestore
        
        Args:
            ticker: Stock ticker symbol
            summary_data: Dictionary containing summary, business_model, competitive_moat, etc.
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('company_summary')
                      .document('summary'))
            
            doc_ref.set(summary_data)
            
            print(f'✅ Stored company summary for {ticker}')
                
        except Exception as error:
            print(f'Error storing company summary for {ticker}: {error}')
            raise error
    
    def get_company_summary(self, ticker: str) -> Optional[Dict[str, Any]]:
        """Get company summary from Firestore
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            Dictionary with company summary data, or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('company_summary')
                      .document('summary'))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting company summary for {ticker}: {error}')
            return None




