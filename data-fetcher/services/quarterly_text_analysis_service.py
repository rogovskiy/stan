#!/usr/bin/env python3
"""
Quarterly Text Analysis Service

Service for managing quarterly text analyses in Firebase Storage and Firestore.
Text analyses are stored at: Storage: quarterly_analyses/{ticker}/{quarter_key}.txt
Metadata stored at: Firestore: /tickers/{ticker}/quarterly_text_analyses/{quarter_key}
"""

from datetime import datetime
from typing import Optional, Dict, Any
from services.firebase_base_service import FirebaseBaseService


class QuarterlyTextAnalysisService(FirebaseBaseService):
    """Service for managing quarterly text analyses in Firebase"""
    
    def store_text_analysis(
        self,
        ticker: str,
        quarter_key: str,
        analysis_text: str,
        num_documents: int,
        has_previous_analysis: bool,
        verbose: bool = True
    ) -> str:
        """Store quarterly text analysis in Firebase Storage and metadata in Firestore
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            analysis_text: The text analysis content
            num_documents: Number of documents used to generate the analysis
            has_previous_analysis: Whether previous quarter analysis was available
            verbose: Enable verbose output
            
        Returns:
            Download URL for the stored text analysis
        """
        try:
            upper_ticker = ticker.upper()
            
            # 1. Upload text to Firebase Storage
            storage_path = f'quarterly_analyses/{upper_ticker}/{quarter_key}.txt'
            
            if verbose:
                print(f'Uploading text analysis for {ticker} {quarter_key} to Storage...')
            
            blob = self.bucket.blob(storage_path)
            blob.upload_from_string(analysis_text, content_type='text/plain')
            
            # Make blob publicly readable to get download URL
            blob.make_public()
            download_url = blob.public_url
            
            if verbose:
                print(f'✅ Uploaded text analysis ({len(analysis_text)} characters)')
            
            # 2. Store metadata in Firestore
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('quarterly_text_analyses')
                      .document(quarter_key))
            
            metadata = {
                'ticker': upper_ticker,
                'quarter_key': quarter_key,
                'storage_ref': storage_path,
                'created_at': datetime.now().isoformat(),
                'num_documents': num_documents,
                'has_previous_analysis': has_previous_analysis
            }
            
            doc_ref.set(metadata)
            
            if verbose:
                print(f'✅ Stored metadata for {ticker} {quarter_key}')
            
            return download_url
                
        except Exception as error:
            print(f'Error storing text analysis for {ticker} {quarter_key}: {error}')
            raise error
    
    def update_extracted_data(
        self,
        ticker: str,
        quarter_key: str,
        extracted_data: Dict[str, Any],
        verbose: bool = True
    ) -> None:
        """Update Firestore document with extracted structured data
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            extracted_data: Dictionary containing business_model, initiatives, and changes
            verbose: Enable verbose output
        """
        try:
            upper_ticker = ticker.upper()
            
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('quarterly_text_analyses')
                      .document(quarter_key))
            
            # Update the document with extracted data
            doc_ref.update({
                'extracted_data': extracted_data,
                'extracted_at': datetime.now().isoformat()
            })
            
            if verbose:
                print(f'✅ Updated extracted data for {ticker} {quarter_key}')
                
        except Exception as error:
            print(f'Error updating extracted data for {ticker} {quarter_key}: {error}')
            raise error
    
    def get_text_analysis(self, ticker: str, quarter_key: str) -> Optional[str]:
        """Retrieve text analysis from Firebase Storage
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            
        Returns:
            Text analysis content as string, or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            storage_path = f'quarterly_analyses/{upper_ticker}/{quarter_key}.txt'
            
            blob = self.bucket.blob(storage_path)
            if not blob.exists():
                return None
            
            content = blob.download_as_text()
            return content
            
        except Exception as error:
            print(f'Error getting text analysis for {ticker} {quarter_key}: {error}')
            return None
    
    @staticmethod
    def get_previous_quarter_key(quarter_key: str) -> Optional[str]:
        """Calculate previous quarter key
        
        Args:
            quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
            
        Returns:
            Previous quarter key, or None if invalid format
        """
        try:
            year_str, quarter_str = quarter_key.split('Q')
            year = int(year_str)
            quarter = int(quarter_str)
            
            if quarter == 1:
                prev_year = year - 1
                prev_quarter = 4
            else:
                prev_year = year
                prev_quarter = quarter - 1
            
            return f"{prev_year}Q{prev_quarter}"
            
        except (ValueError, IndexError):
            return None

