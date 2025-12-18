#!/usr/bin/env python3
"""
IR Document Service

Service for managing IR documents in Firebase Firestore and Storage.
IR documents are stored at: /tickers/{ticker}/ir_documents/* and Storage ir_documents/
"""

from datetime import datetime
from typing import Dict, List, Optional, Any
from services.firebase_base_service import FirebaseBaseService


class IRDocumentService(FirebaseBaseService):
    """Service for managing IR documents in Firebase"""
    
    def store_ir_document(self, ticker: str, document_id: str, document_data: Dict[str, Any], 
                         file_content: bytes, file_extension: str = 'pdf', verbose: bool = True) -> None:
        """Store IR document in Firebase Storage and metadata in Firestore
        
        Args:
            ticker: Stock ticker symbol
            document_id: Unique document identifier
            document_data: Document metadata dictionary
            file_content: Binary content of the document
            file_extension: File extension (default: 'pdf')
            verbose: Enable verbose output
        """
        try:
            upper_ticker = ticker.upper()
            
            # 1. Upload document to Firebase Storage
            storage_path = f'ir_documents/{upper_ticker}/{document_id}.{file_extension}'
            
            if verbose:
                print(f'Uploading IR document {document_id} for {ticker} to Storage...')
            
            blob = self.bucket.blob(storage_path)
            blob.upload_from_string(file_content, content_type=f'application/{file_extension}')
            
            # Make blob publicly readable
            blob.make_public()
            download_url = blob.public_url
            
            # 2. Store metadata in Firestore
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('ir_documents')
                      .document(document_id))
            
            metadata = {
                **document_data,
                'document_storage_ref': storage_path,
                'document_download_url': download_url,
                'scanned_at': datetime.now().isoformat()
            }
            
            doc_ref.set(metadata)
            
            if verbose:
                print(f'✅ Stored IR document {document_id} for {ticker}')
                
        except Exception as error:
            print(f'Error storing IR document {document_id} for {ticker}: {error}')
            raise error
    
    def get_ir_documents_for_quarter(self, ticker: str, quarter_key: str) -> List[Dict[str, Any]]:
        """Get all IR documents for a specific quarter
        
        Args:
            ticker: Stock ticker symbol
            quarter_key: Quarter key in format YYYYQN (e.g., "2024Q3")
            
        Returns:
            List of document metadata dictionaries
        """
        try:
            upper_ticker = ticker.upper()
            
            # Query documents by quarter_key
            docs_ref = (self.db.collection('tickers')
                       .document(upper_ticker)
                       .collection('ir_documents'))
            
            query = docs_ref.where('quarter_key', '==', quarter_key)
            docs = query.stream()
            
            documents = []
            for doc in docs:
                doc_data = doc.to_dict()
                doc_data['document_id'] = doc.id
                documents.append(doc_data)
            
            return documents
            
        except Exception as error:
            print(f'Error getting IR documents for {ticker} {quarter_key}: {error}')
            return []
    
    def get_ir_document_content(self, ticker: str, document_id: str) -> Optional[bytes]:
        """Download document content from Firebase Storage
        
        Args:
            ticker: Stock ticker symbol
            document_id: Document identifier
            
        Returns:
            Document content as bytes, or None if not found
        """
        try:
            upper_ticker = ticker.upper()
            
            # Get document metadata to find storage path
            doc_ref = (self.db.collection('tickers')
                      .document(upper_ticker)
                      .collection('ir_documents')
                      .document(document_id))
            
            doc = doc_ref.get()
            if not doc.exists:
                return None
            
            doc_data = doc.to_dict()
            storage_ref = doc_data.get('document_storage_ref')
            
            if not storage_ref:
                return None
            
            # Download from Storage
            blob = self.bucket.blob(storage_ref)
            if not blob.exists():
                return None
            
            return blob.download_as_bytes()
            
        except Exception as error:
            print(f'Error getting document content for {ticker} {document_id}: {error}')
            return None




