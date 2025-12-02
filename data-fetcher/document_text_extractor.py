#!/usr/bin/env python3
"""
Document Text Extractor

Utility module to extract text from PDF and HTML documents stored in Firebase.
"""

from typing import Optional, Dict
from pypdf import PdfReader
from io import BytesIO
from bs4 import BeautifulSoup

from firebase_cache import FirebaseCache


def extract_text_from_pdf(content: bytes) -> str:
    """Extract text from PDF content
    
    Args:
        content: PDF file content as bytes
        
    Returns:
        Extracted text as string
    """
    try:
        pdf_file = BytesIO(content)
        reader = PdfReader(pdf_file)
        text_parts = []
        
        for page in reader.pages:
            text = page.extract_text()
            if text:
                text_parts.append(text)
        
        return '\n\n'.join(text_parts)
    except Exception as e:
        print(f'Error extracting text from PDF: {e}')
        return ''


def extract_text_from_html(content: bytes) -> str:
    """Extract text from HTML content
    
    Args:
        content: HTML file content as bytes
        
    Returns:
        Extracted text as string
    """
    try:
        soup = BeautifulSoup(content, 'html.parser')
        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()
        return soup.get_text(separator='\n', strip=True)
    except Exception as e:
        print(f'Error extracting text from HTML: {e}')
        return ''


def get_document_text(ticker: str, document_id: str) -> Optional[str]:
    """Get text content from a document stored in Firebase
    
    Args:
        ticker: Stock ticker symbol
        document_id: Document identifier
        
    Returns:
        Extracted text, or None if document not found or extraction failed
    """
    try:
        firebase = FirebaseCache()
        
        # Get document metadata to determine file type
        doc_ref = (firebase.db.collection('tickers')
                  .document(ticker.upper())
                  .collection('ir_documents')
                  .document(document_id))
        
        doc = doc_ref.get()
        if not doc.exists:
            return None
        
        doc_data = doc.to_dict()
        storage_ref = doc_data.get('document_storage_ref', '')
        
        # Determine file type from storage reference
        if storage_ref.endswith('.pdf'):
            file_type = 'pdf'
        elif storage_ref.endswith('.html') or storage_ref.endswith('.htm'):
            file_type = 'html'
        else:
            file_type = None  # Will determine from content
        
        # Get document content
        content = firebase.get_ir_document_content(ticker, document_id)
        if not content:
            return None
        
        # Determine file type from content if not determined from storage_ref
        if file_type is None:
            if content.startswith(b'%PDF'):
                file_type = 'pdf'
            else:
                file_type = 'html'
        
        # Extract text based on file type
        if file_type == 'pdf':
            return extract_text_from_pdf(content)
        else:
            return extract_text_from_html(content)
            
    except Exception as e:
        print(f'Error getting document text for {ticker} {document_id}: {e}')
        return None


def get_quarter_documents_text(ticker: str, quarter_key: str, max_chars_per_doc: int = 50000) -> Dict[str, str]:
    """Get text content from all documents for a quarter
    
    Args:
        ticker: Stock ticker symbol
        quarter_key: Quarter key in format YYYYQN (e.g., "2025Q1")
        max_chars_per_doc: Maximum characters to extract per document (to avoid token limits)
        
    Returns:
        Dictionary mapping document_id to extracted text
    """
    try:
        firebase = FirebaseCache()
        documents = firebase.get_ir_documents_for_quarter(ticker, quarter_key)
        
        doc_texts = {}
        for doc in documents:
            document_id = doc.get('document_id')
            if not document_id:
                continue
            
            text = get_document_text(ticker, document_id)
            if text:
                # Truncate if too long
                if len(text) > max_chars_per_doc:
                    text = text[:max_chars_per_doc] + '\n\n[Document truncated due to length]'
                doc_texts[document_id] = text
        
        return doc_texts
        
    except Exception as e:
        print(f'Error getting quarter documents text for {ticker} {quarter_key}: {e}')
        return {}

