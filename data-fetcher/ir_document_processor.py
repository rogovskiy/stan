#!/usr/bin/env python3
"""
IR Document Processor

Downloads and stores IR documents discovered by the crawler.
Handles fiscal date calculations, document type classification, and Firebase storage.
"""

import os
import re
import time
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple, Set
import yfinance as yf

from services.ir_document_service import IRDocumentService
from services.metrics_service import MetricsService
from browser_pool_manager import BrowserPoolManager


class IRDocumentProcessor:
    """Processes and stores IR documents discovered by crawler."""
    
    def __init__(self, browser_pool_manager: BrowserPoolManager = None, 
                 metrics_service: MetricsService = None):
        """Initialize document processor.
        
        Args:
            browser_pool_manager: Optional browser pool manager (creates new one if not provided)
            metrics_service: Optional metrics service for logging
        """
        self.browser_pool_manager = browser_pool_manager or BrowserPoolManager()
        self.ir_document_service = IRDocumentService()
        self.metrics_service = metrics_service
    
    def get_fiscal_year_end_month(self, ticker: str) -> int:
        """Get fiscal year-end month for a ticker.
        
        Args:
            ticker: Stock ticker symbol
            
        Returns:
            Month number (1-12), defaults to 12 (December) if not found
        """
        try:
            stock = yf.Ticker(ticker)
            info = stock.info
            fiscal_year_end_timestamp = info.get('lastFiscalYearEnd')
            
            if fiscal_year_end_timestamp:
                fye_date = datetime.fromtimestamp(fiscal_year_end_timestamp)
                return fye_date.month
            
            # Default to December
            return 12
        except Exception as e:
            print(f'Warning: Could not get fiscal year-end for {ticker}, defaulting to December: {e}')
            return 12
    
    def get_fiscal_quarter_from_date(self, date: datetime, fiscal_year_end_month: int) -> Tuple[int, int]:
        """Calculate fiscal year and quarter from date.
        
        For Apple (FY ends September):
        - Q1: Oct, Nov, Dec (months 10, 11, 12) -> FY starts in Oct
        - Q2: Jan, Feb, Mar (months 1, 2, 3)
        - Q3: Apr, May, Jun (months 4, 5, 6)
        - Q4: Jul, Aug, Sep (months 7, 8, 9)
        
        Args:
            date: Date object (period END date)
            fiscal_year_end_month: Month when fiscal year ends (1-12)
            
        Returns:
            Tuple of (fiscal_year, fiscal_quarter)
        """
        try:
            # Fiscal year starts the month AFTER fiscal year end
            fiscal_year_start_month = (fiscal_year_end_month % 12) + 1
            
            # Determine fiscal year
            # If month is after fiscal year end, we're in the NEXT calendar year's fiscal year
            # If month is before fiscal year start, we're still in the CURRENT calendar year's fiscal year (which started in previous calendar year)
            if date.month > fiscal_year_end_month:
                # After FY end (e.g., Oct, Nov, Dec for Sep-end FY)
                fiscal_year = date.year + 1
                months_into_fy = date.month - fiscal_year_end_month
            elif date.month >= fiscal_year_start_month:
                # Between FY start and end (e.g., Oct-Dec for Sep-end FY)
                fiscal_year = date.year
                months_into_fy = date.month - fiscal_year_start_month + 1
            else:
                # Before FY start month (e.g., Jan-Sep for Oct-start FY)
                # Still in current calendar year's fiscal year (which started in previous calendar year)
                fiscal_year = date.year
                months_into_fy = (12 - fiscal_year_end_month) + date.month
            
            # Determine quarter (1-4) based on months into fiscal year
            fiscal_quarter = ((months_into_fy - 1) // 3) + 1
            fiscal_quarter = max(1, min(4, fiscal_quarter))
            
            return fiscal_year, fiscal_quarter
        except Exception as e:
            return None, None
    
    
    def format_release_date_for_storage(self, release_date: Optional[Any]) -> Optional[str]:
        """Format release date for storage (handles both string and datetime objects).
        
        Args:
            release_date: Release date as string, datetime, or None
            
        Returns:
            ISO format string or None
        """
        if not release_date:
            return None
        
        if isinstance(release_date, str):
            # Try to parse and convert to ISO format
            try:
                date_obj = datetime.fromisoformat(release_date.replace('Z', '+00:00'))
                return date_obj.isoformat()
            except (ValueError, AttributeError):
                # If parsing fails, return the string as-is
                return release_date
        elif isinstance(release_date, datetime):
            return release_date.isoformat()
        else:
            return str(release_date)
    
    def create_document_id(self, quarter_key: str, document_type: str, release_date: Optional[Any], url: str) -> str:
        """Create unique document ID.
        
        Args:
            quarter_key: Quarter key (e.g., '2024Q3')
            document_type: Document type string
            release_date: Release date (string, datetime, or None)
            url: Document URL
            
        Returns:
            Unique document ID string
        """
        import hashlib
        # Handle both string and datetime objects
        if release_date:
            if isinstance(release_date, str):
                try:
                    date_obj = datetime.fromisoformat(release_date.replace('Z', '+00:00'))
                    date_str = date_obj.strftime('%Y%m%d')
                except (ValueError, AttributeError):
                    # If parsing fails, use current date
                    date_str = datetime.now().strftime('%Y%m%d')
            elif isinstance(release_date, datetime):
                date_str = release_date.strftime('%Y%m%d')
            else:
                date_str = datetime.now().strftime('%Y%m%d')
        else:
            date_str = datetime.now().strftime('%Y%m%d')
        doc_type_clean = document_type.replace(' ', '-').lower()
        # Include URL hash to ensure uniqueness even if same quarter/type/date
        url_hash = hashlib.md5(url.encode()).hexdigest()[:8]
        return f"{quarter_key}-{doc_type_clean}-{date_str}-{url_hash}"
    
    def determine_document_type(self, title: str, url: str) -> str:
        """Determine document type from title and URL.
        
        Args:
            title: Document title
            url: Document URL
            
        Returns:
            Document type string
        """
        title_lower = title.lower()
        url_lower = url.lower()
        
        # Check for SEC filings first
        if '10-k' in title_lower or '10-k' in url_lower or '/10k' in url_lower:
            return 'sec_filing_10k'
        elif '10-q' in title_lower or '10-q' in url_lower or '/10q' in url_lower:
            return 'sec_filing_10q'
        elif '8-k' in title_lower or '8-k' in url_lower:
            return 'sec_filing_8k'
        # Check for financial statements (exclude Consolidated Financial Statements - they use a different data source)
        elif 'financial statement' in title_lower and 'consolidated financial' not in title_lower:
            return 'financial_statements'
        # Check for presentations
        elif 'presentation' in title_lower or 'presentation' in url_lower:
            return 'presentation'
        # Check for earnings releases
        elif 'earnings' in title_lower or 'earnings' in url_lower:
            return 'earnings_release'
        elif 'quarterly' in title_lower or 'quarterly' in url_lower:
            return 'earnings_release'
        # Check for annual reports
        elif 'annual report' in title_lower or 'annual-report' in url_lower:
            return 'annual_report'
        # Check for proxy statements
        elif 'proxy' in title_lower or 'proxy' in url_lower:
            return 'proxy_statement'
        else:
            return 'other'
    
    async def process_documents(
        self,
        ticker: str,
        documents: List[Dict[str, Any]],
        existing_urls: Set[str] = None,
        target_quarter: Optional[str] = None,
        verbose: bool = False
    ) -> Tuple[int, int]:
        """Process and store discovered documents.
        
        Args:
            ticker: Stock ticker symbol
            documents: List of documents from crawler (with fiscal_year, fiscal_quarter, etc.)
            existing_urls: Set of URLs already in database (to skip duplicates)
            target_quarter: Optional quarter filter (e.g., '2024Q3')
            verbose: Print verbose output
            
        Returns:
            Tuple of (processed_count, skipped_count)
        """
        if existing_urls is None:
            existing_urls = set()
        
        processed_count = 0
        skipped_count = 0
        
        # Get all existing documents if not provided
        if not existing_urls:
            all_existing_docs = self.ir_document_service.get_all_ir_documents(ticker)
            existing_urls = {doc.get('url') for doc in all_existing_docs if doc.get('url')}
            if existing_urls and verbose:
                print(f'Found {len(existing_urls)} already-downloaded documents in database')
        
        for release in documents:
            try:
                # Validate that we have required fiscal info from LLM BEFORE downloading
                # This avoids downloading documents we can't process
                fiscal_year = release.get('fiscal_year')
                fiscal_quarter = release.get('fiscal_quarter')
                release_date = release.get('release_date')  # Already parsed as datetime object from crawler
                
                if not fiscal_year or not fiscal_quarter:
                    skipped_count += 1
                    continue
                
                quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
                
                # Filter by target quarter if specified (before downloading)
                if target_quarter and quarter_key != target_quarter:
                    skipped_count += 1
                    continue
                
                # Check if link is downloadable (skip HTML pages and navigation links)
                is_downloadable = release.get('is_downloadable', True)  # Default to True for backward compatibility
                if not is_downloadable:
                    if verbose:
                        print(f'Skipping {release["title"]}: Not a downloadable link (likely HTML page or navigation)')
                    skipped_count += 1
                    continue
                
                # Check if document already exists (by URL, which is the most reliable check)
                if release['url'] in existing_urls:
                    if verbose:
                        print(f'  Skipped: Document already exists (URL: {release["url"][:60]}...)')
                    skipped_count += 1
                    continue
                
                # Download document only if we have required fiscal info and match target quarter
                if verbose:
                    print(f'Downloading: {release["title"]}')
                
                download_start = time.time()
                # Use async download to stay in same event loop as crawler
                content = await self.browser_pool_manager.download_file(release['url'], verbose=verbose)
                download_duration_ms = (time.time() - download_start) * 1000
                
                if not content:
                    if verbose:
                        print(f'  Skipped: Could not download')
                    # Log failed download
                    if self.metrics_service:
                        self.metrics_service.log_document_download(
                            url=release['url'],
                            file_size_bytes=0,
                            duration_ms=download_duration_ms,
                            success=False,
                            ticker=ticker,
                            error='Download failed'
                        )
                    continue
                
                # Log successful download
                if self.metrics_service:
                    self.metrics_service.log_document_download(
                        url=release['url'],
                        file_size_bytes=len(content),
                        duration_ms=download_duration_ms,
                        success=True,
                        ticker=ticker
                    )
                
                # Determine file type
                url_lower = release['url'].lower()
                if url_lower.endswith('.pdf') or content.startswith(b'%PDF'):
                    file_ext = 'pdf'
                elif url_lower.endswith('.html') or url_lower.endswith('.htm'):
                    file_ext = 'html'
                else:
                    # Try to detect from content
                    if content.startswith(b'%PDF'):
                        file_ext = 'pdf'
                    else:
                        file_ext = 'html'

                
                if verbose:
                    print(f'  Using LLM-provided fiscal info: {fiscal_year}Q{fiscal_quarter}')
                    if release_date:
                        # Handle both string and datetime objects
                        if isinstance(release_date, str):
                            # Try to parse string date
                            try:
                                date_obj = datetime.fromisoformat(release_date.replace('Z', '+00:00'))
                                date_str = date_obj.strftime("%Y-%m-%d")
                            except (ValueError, AttributeError):
                                date_str = release_date
                        elif isinstance(release_date, datetime):
                            date_str = release_date.strftime("%Y-%m-%d")
                        else:
                            date_str = str(release_date)
                        print(f'  Release date: {date_str}')
                    else:
                        print(f'  Release date: not provided by LLM')
                
                # Determine document type (use from Gemini if available, otherwise infer)
                doc_type = release.get('document_type')
                if not doc_type or doc_type == 'other':
                    doc_type = self.determine_document_type(release['title'], release['url'])
                
                # Create document ID (include URL hash for uniqueness)
                document_id = self.create_document_id(quarter_key, doc_type, release_date, release['url'])
                
                # Store document using the service
                document_data = {
                    'title': release['title'],
                    'url': release['url'],
                    'quarter_key': quarter_key,
                    'fiscal_year': fiscal_year,
                    'fiscal_quarter': fiscal_quarter,
                    'release_date': self.format_release_date_for_storage(release_date),
                    'document_type': doc_type,
                    'description': release.get('description', '')
                }
                
                self.ir_document_service.store_ir_document(ticker, document_id, document_data, content, file_ext, verbose)
                processed_count += 1
                existing_urls.add(release['url'])  # Add to set to avoid re-processing
                
                # Log document storage
                if self.metrics_service:
                    self.metrics_service.log_document_storage(
                        document_id=document_id,
                        quarter_key=quarter_key,
                        document_type=doc_type,
                        ticker=ticker
                    )
                
                if verbose:
                    print(f'  ✅ Stored: {document_id} ({quarter_key})')
            
            except Exception as e:
                print(f'Error processing release {release.get("title", "unknown")}: {e}')
                if verbose:
                    import traceback
                    traceback.print_exc()
                continue
        
        return processed_count, skipped_count

