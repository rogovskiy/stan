#!/usr/bin/env python3
"""
IR KPI Service

Service for managing IR KPIs in Firebase Firestore.
IR KPIs are stored at: /tickers/{ticker}/ir_kpis/*
"""

from datetime import datetime
from typing import Dict, List, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class IRKPIService(FirebaseBaseService):
    """Service for managing IR KPIs in Firebase"""
    
    def store_ir_kpis(self, ticker: str, quarter_key: str, kpis: Dict[str, Any], 
                     source_documents: List[str], llm_metadata: Dict[str, Any], 
                     verbose: bool = True) -> None:
        """Store consolidated KPIs for a quarter
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2024Q3")
            kpis: Dictionary of extracted KPIs
            source_documents: List of document IDs used for extraction
            llm_metadata: Metadata about LLM extraction (model, etc.)
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
                      .collection('ir_kpis')
                      .document(quarter_key))
            
            kpi_data = {
                'ticker': upper_ticker,
                'quarter_key': quarter_key,
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'extracted_kpis': kpis,
                'source_documents': source_documents,
                'extraction_timestamp': datetime.now().isoformat(),
                'llm_metadata': llm_metadata
            }
            
            doc_ref.set(kpi_data)
            
            if verbose:
                print(f'✅ Stored IR KPIs for {ticker} {quarter_key}')
                
        except Exception as error:
            print(f'Error storing IR KPIs for {ticker} {quarter_key}: {error}')
            raise error
    
    def get_ir_kpis(self, ticker: str, quarter_key: str) -> Optional[Dict[str, Any]]:
        """Get consolidated KPIs for a quarter
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2024Q3")
            
        Returns:
            KPI data dictionary or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('ir_kpis')
                      .document(quarter_key))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting IR KPIs for {ticker} {quarter_key}: {error}')
            return None
    
    def get_existing_quarter_kpis(self, ticker: str, quarter_key: str) -> Optional[Dict[str, Any]]:
        """Get existing KPIs from quarters collection for context
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2024Q3")
            
        Returns:
            Financial data dictionary from quarters collection or None
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('quarters')
                      .document(quarter_key))
            
            doc = doc_ref.get()
            if doc.exists:
                return doc.to_dict()
            
            return None
            
        except Exception as error:
            print(f'Error getting existing quarter KPIs for {ticker} {quarter_key}: {error}')
            return None

