#!/usr/bin/env python3
"""
Quarterly Analysis Service

Service for managing quarterly analyses in Firebase Firestore.
Quarterly analyses are stored at: /tickers/{ticker}/quarterly_analysis/*
"""

from datetime import datetime
from typing import Dict, List, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class QuarterlyAnalysisService(FirebaseBaseService):
    """Service for managing quarterly analyses in Firebase"""
    
    def store_quarterly_analysis(self, ticker: str, quarter_key: str, analysis_data: Dict[str, Any], verbose: bool = True) -> None:
        """Store quarterly analysis in Firestore
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            analysis_data: Dictionary containing summary, growth_theses, custom_kpis, etc.
            verbose: Enable verbose output
        """
        try:
            upper_ticker = ticker.upper()
            
            # Parse quarter_key to get fiscal year and quarter
            year_str, quarter_str = quarter_key.split('Q')
            fiscal_year = int(year_str)
            fiscal_quarter = int(quarter_str)
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('quarterly_analysis')
                      .document(quarter_key))
            
            # Add metadata
            analysis_data['ticker'] = upper_ticker
            analysis_data['quarter_key'] = quarter_key
            analysis_data['fiscal_year'] = fiscal_year
            analysis_data['fiscal_quarter'] = fiscal_quarter
            analysis_data['stored_at'] = datetime.now().isoformat()
            
            doc_ref.set(analysis_data)
            
            if verbose:
                print(f'✅ Stored quarterly analysis for {ticker} {quarter_key}')
                
        except Exception as error:
            print(f'Error storing quarterly analysis for {ticker} {quarter_key}: {error}')
            raise error
    
    def get_quarterly_analysis(self, ticker: str, quarter_key: str) -> Optional[Dict[str, Any]]:
        """Get quarterly analysis from Firestore
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            
        Returns:
            Dictionary with quarterly analysis data, or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('quarterly_analysis')
                      .document(quarter_key))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting quarterly analysis for {ticker} {quarter_key}: {error}')
            return None
    
    def get_all_quarterly_analyses(self, ticker: str) -> List[Dict[str, Any]]:
        """Get all quarterly analyses for a ticker
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            List of quarterly analysis dictionaries, sorted by quarter_key
        """
        try:
            upper_ticker = ticker.upper()
            
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('quarterly_analysis'))
            
            docs = docs_ref.stream()
            
            analyses = []
            for doc in docs:
                doc_data = doc.to_dict()
                doc_data['quarter_key'] = doc.id
                analyses.append(doc_data)
            
            # Sort by quarter_key chronologically
            analyses.sort(key=lambda x: (int(x.get('quarter_key', '0000Q0')[:4]), int(x.get('quarter_key', '0000Q0')[5])))
            
            return analyses
            
        except Exception as error:
            print(f'Error getting all quarterly analyses for {ticker}: {error}')
            return []




