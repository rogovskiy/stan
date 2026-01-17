#!/usr/bin/env python3
"""
IR Website Scanner

Scans IR websites for earnings releases and presentations, downloads and stores them in Firebase.
Use a separate script for KPI extraction.
"""

import os
import json
import argparse
import sys
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple
from urllib.parse import urljoin, urlparse
from bs4 import BeautifulSoup
from dotenv import load_dotenv

from services.ir_url_service import IRURLService
from services.ir_document_service import IRDocumentService
from extraction_utils import (
    load_prompt_template,
    load_json_schema,
    get_gemini_model,
    initialize_gemini_model,
    extract_json_from_llm_response,
    clean_schema_for_gemini
)
from browser_pool_manager import BrowserPoolManager
import yfinance as yf

# Load environment variables from .env.local
load_dotenv('.env.local')

# Load IR URLs configuration
# The ir_urls.json file uses arrays of URLs per ticker:
#   "AAPL": ["https://investor.apple.com/...", "https://another-url.com/..."]
IR_URLS_FILE = os.path.join(os.path.dirname(__file__), 'ir_urls.json')

# Batch size for processing links with Gemini (to avoid token limits)
BATCH_SIZE = 25

browser_pool_manager = BrowserPoolManager()

def load_ir_urls() -> Dict[str, List[str]]:
    """Load IR URLs from configuration file.
    
    Returns a dictionary where each ticker maps to a list of URL strings.
    """
    try:
        with open(IR_URLS_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f'Warning: {IR_URLS_FILE} not found. Create it with IR URLs per ticker.')
        return {}
    except json.JSONDecodeError as e:
        print(f'Error parsing {IR_URLS_FILE}: {e}')
        return {}

def get_ir_urls_for_ticker(ticker: str) -> List[str]:
    """Get list of IR URLs for a ticker. Checks Firebase first, then falls back to JSON config.
    
    Args:
        ticker: Stock ticker symbol
        ir_urls: Dictionary of ticker -> list of URLs mapping from JSON (fallback)
        firebase: Optional IRURLService instance to read from Firebase (priority)
        
    Returns:
        List of URLs for the ticker (from Firebase if available, otherwise from JSON)
    """
    ir_urls = load_ir_urls()
    
    # Initialize Firebase service to get URLs from Firebase
    ir_url_service = IRURLService()

    ticker_upper = ticker.upper()
    
    # First, try to get URLs from Firebase (priority)
    try:
        firebase_urls = ir_url_service.get_ir_urls(ticker)
        if firebase_urls:
            urls = []
            for url_data in firebase_urls:
                url = url_data.get('url')
                if url:
                    urls.append(url)
            if urls:
                return urls
    except Exception as e:
        print(f'Warning: Could not get IR URLs from Firebase for {ticker}: {e}')
    
    # Fallback to JSON config if Firebase has no URLs
    if ticker_upper in ir_urls:
        urls = ir_urls[ticker_upper]
        if isinstance(urls, list):
            return urls
        else:
            print(f'Warning: Invalid URL format for {ticker_upper} in JSON, expected list. Got: {type(urls).__name__}')
    
    return []

def get_fiscal_year_end_month(ticker: str) -> int:
    """Get fiscal year-end month for a ticker"""
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

def get_fiscal_quarter_from_date(date: datetime, fiscal_year_end_month: int) -> Tuple[int, int]:
    """Calculate fiscal year and quarter from date
    
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


class HTMLLinkExtractor:
    """Extracts links from HTML content with context information for LLM analysis."""
    
    def __init__(self, base_url: str, verbose: bool = False):
        """Initialize the link extractor.
    
    Args:
            base_url: Base URL for resolving relative links
            verbose: Whether to print verbose output
        """
        self.base_url = base_url
        self.verbose = verbose
    
    def _is_downloadable_link(self, link_element, url: str, html_attributes: Dict[str, Any]) -> bool:
        """Determine if a link is downloadable based on its attributes and URL.
    
    Args:
            link_element: BeautifulSoup link element
            url: The resolved URL
            html_attributes: Dictionary of HTML attributes
        
    Returns:
            True if the link appears to be downloadable, False otherwise
        """
        # Check for explicit download attribute
        if 'download' in html_attributes:
            return True
        
        # Check MIME type in 'type' attribute
        mime_type = html_attributes.get('type', '').lower()
        downloadable_mime_types = [
            'application/pdf',
            'application/octet-stream',
            'application/zip',
            'application/x-zip-compressed',
            'application/msword',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats',
            'application/vnd.ms-powerpoint',
            'text/csv'
        ]
        if any(mime in mime_type for mime in downloadable_mime_types):
            return True
        
        # Check URL file extension
        url_lower = url.lower()
        downloadable_extensions = [
            '.pdf', '.zip', '.doc', '.docx', '.xls', '.xlsx', 
            '.ppt', '.pptx', '.csv', '.txt', '.json', '.xml',
            '.gz', '.tar', '.rar', '.7z'
        ]
        if any(url_lower.endswith(ext) for ext in downloadable_extensions):
            return True
        
        # Check for data URLs or blob URLs
        if url.startswith('data:') or url.startswith('blob:'):
            return True
        
        # Check class names for download indicators
        class_attr = html_attributes.get('class', '').lower()
        if any(indicator in class_attr for indicator in ['download', 'file', 'attachment', 'document']):
            return True
        
        # Check aria-label for download indicators
        aria_label = html_attributes.get('aria-label', '').lower()
        if any(indicator in aria_label for indicator in ['download', 'file', 'pdf', 'document']):
            return True
        
        # Check title attribute for download indicators
        title = html_attributes.get('title', '').lower()
        if any(indicator in title for indicator in ['download', '.pdf', '.doc', '.xls']):
            return True
        
        return False
    
    def extract_links(self, html_content: str) -> List[Dict[str, Any]]:
        """Extract all links from HTML content with context information.
    
    Args:
            html_content: HTML content as string
    
    Returns:
            List of link dictionaries, each containing:
            - url: Full URL (resolved from base_url)
            - text: Link text
            - parent_text: Text from parent element (up to 200 chars)
            - date_context: Date information found nearby (up to 100 chars)
            - html_attributes: Dictionary of HTML attributes
            - is_downloadable: Boolean indicating if link appears to be downloadable
        """
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Extract all links with context (text, nearby elements, parent structure)
        links_data = []
        for link in soup.find_all('a', href=True):
            href = link.get('href', '')
            if not href or href.startswith('#') or href.startswith('javascript:'):
                continue
            
            full_url = urljoin(self.base_url, href)
            link_text = link.get_text(strip=True)
            
            if not link_text:  # Skip empty links
                continue
            
            # Get context: parent element, siblings, nearby text
            parent = link.parent if link.parent else None
            parent_text = parent.get_text(strip=True)[:200] if parent else ''
            
            # Get nearby date information
            date_context = ''
            for elem in [parent, link.find_next_sibling(), link.find_previous_sibling()]:
                if elem:
                    elem_text = elem.get_text(strip=True)
                    # Look for date patterns
                    if re.search(r'\d{1,2}[/-]\d{1,2}[/-]\d{4}|\w+\s+\d{1,2},?\s+\d{4}', elem_text):
                        date_context = elem_text[:100]
                        break
            
            # Extract HTML attributes from the <a> tag that might provide context
            html_attributes = {}
            # Common attributes that might be useful
            useful_attrs = ['class', 'id', 'title', 'aria-label', 'data-*', 'role', 'download', 'type', 'rel']
            
            # Get all attributes from the link element
            for attr_name, attr_value in link.attrs.items():
                # Include all attributes, but format data-* attributes specially
                if attr_name.startswith('data-'):
                    html_attributes[attr_name] = attr_value
                elif attr_name in ['class', 'id', 'title', 'aria-label', 'role', 'download', 'type', 'rel']:
                    html_attributes[attr_name] = attr_value
            
            # Format class as string if it's a list (BeautifulSoup returns class as list)
            if 'class' in html_attributes and isinstance(html_attributes['class'], list):
                html_attributes['class'] = ' '.join(html_attributes['class'])
            
            # Determine if link is downloadable
            is_downloadable = self._is_downloadable_link(link, full_url, html_attributes)
            
            links_data.append({
                'url': full_url,
                'text': link_text,
                'parent_text': parent_text,
                'date_context': date_context,
                'html_attributes': html_attributes,
                'is_downloadable': is_downloadable
            })
        
        if self.verbose:
            print(f'Found {len(links_data)} total links to analyze')
        
        return links_data


def _format_link_for_llm(index: int, link: Dict[str, Any]) -> str:
    """Format a link dictionary for LLM prompt
    
    Args:
        index: Link index (1-based)
        link: Link dictionary with url, text, parent_text, date_context, html_attributes
        
    Returns:
        Formatted string for LLM prompt
    """
    parts = [
        f"{index}. Text: '{link['text']}'",
        f"URL: {link['url']}",
        f"Context: {link['parent_text']}",
        f"Date: {link['date_context']}"
    ]
    
    # Add HTML attributes if present
    html_attrs = link.get('html_attributes', {})
    if html_attrs:
        # Format attributes as key=value pairs
        attr_parts = []
        for attr_name, attr_value in html_attrs.items():
            if isinstance(attr_value, (list, tuple)):
                attr_value = ' '.join(str(v) for v in attr_value)
            attr_parts.append(f"{attr_name}={attr_value}")
        
        if attr_parts:
            parts.append(f"Attributes: {', '.join(attr_parts)}")
    
    return ' | '.join(parts)

def filter_consolidated_financial_statements(all_releases: List[Dict[str, Any]], verbose: bool = False) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Filter out Consolidated Financial Statements from releases.
    
    Consolidated Financial Statements are excluded because they are obtained
    from a different data source.
    
    Args:
        all_releases: List of all classified releases
        verbose: Whether to print verbose output about filtered items
    
    Returns:
        Tuple of (filtered_releases, filtered_out_releases) where:
        - filtered_releases: Releases with Consolidated Financial Statements removed
        - filtered_out_releases: The Consolidated Financial Statements that were removed
    """
    filtered_out = [
        r for r in all_releases 
        if (
            'consolidated financial' in r.get('title', '').lower() or
            'consolidated financial' in r.get('url', '').lower() or
            (r.get('document_type') == 'financial_statements' and 'consolidated' in r.get('title', '').lower())
        )
    ]
    
    releases = [
        r for r in all_releases 
        if not (
            'consolidated financial' in r.get('title', '').lower() or
            'consolidated financial' in r.get('url', '').lower() or
            (r.get('document_type') == 'financial_statements' and 'consolidated' in r.get('title', '').lower())
        )
    ]
    
    if verbose and filtered_out:
        print(f'\n⚠️  Filtered out {len(filtered_out)} Consolidated Financial Statement(s) (using different data source):')
        for r in filtered_out:
            print(f'  - {r.get("title", "N/A")} ({r.get("url", "N/A")[:60]}...)')
        print(f'  Continuing with {len(releases)} remaining documents\n')
    
    return releases, filtered_out

def classify_links_with_gemini(links_data: List[Dict[str, Any]], ticker: str, verbose: bool = False) -> List[Dict[str, Any]]:
    """Classify links using Gemini API in batches.
    
    Args:
        links_data: List of link dictionaries to classify
        ticker: Stock ticker symbol
        verbose: Whether to print verbose output
    
    Returns:
        List of classified release dictionaries. Each dictionary contains:
        - link_index (int): Original index of the link in the provided list (1-based)
        - title (str): Title or name of the document
        - url (str): URL of the document
        - release_date (str or None): Release date in format YYYY-MM-DD, MM/DD/YYYY, or null
        - fiscal_year (int or None): Fiscal year of the document (e.g., 2024), or null
        - fiscal_quarter (int or None): Fiscal quarter (1-4), or null
        - document_type (str): Type of document (earnings_release, presentation, financial_statements, 
          sec_filing_10k, sec_filing_10q, sec_filing_8k, annual_report, proxy_statement, other)
        - description (str, optional): Description of the document
        - _global_index (int or None): Global index in the original links_data list (0-based), added by this function
    """
    # Initialize Gemini API once for all batches
    model = initialize_gemini_model()

    all_releases = []
    num_batches = ((len(links_data) - 1) // BATCH_SIZE) + 1
    
    for batch_num in range(num_batches):
        batch_start = batch_num * BATCH_SIZE
        batch_end = min(batch_start + BATCH_SIZE, len(links_data))
        batch = links_data[batch_start:batch_end]
        
        if verbose:
            print(f'\nProcessing batch {batch_num + 1}/{num_batches} (links {batch_start + 1}-{batch_end} of {len(links_data)})...')
        
        # Prepare prompt for this batch
        links_summary = '\n'.join([
            _format_link_for_llm(j+1, link) for j, link in enumerate(batch)
        ])
        
        # Load and render prompt template
        prompt = load_prompt_template(
            'ir_link_classification_prompt.txt',
            ticker=ticker,
            links_summary=links_summary
        )
        
        # Call Gemini for this batch
        if verbose:
            print(f'\nCalling Gemini for batch {batch_num + 1}...')
        
        # Load schema for structured output
        schema = load_json_schema('ir_link_classification_schema.json')
        cleaned_schema = clean_schema_for_gemini(schema)
        
        # Combine system instruction with user prompt for Gemini
        system_instruction = "You are a financial analyst identifying ALL financial documents from investor relations pages. Include ALL relevant financial documents - be inclusive, not restrictive. IMPORTANT: Exclude Consolidated Financial Statements as these are obtained from a different data source."
        full_prompt = f"{system_instruction}\n\n{prompt}"
        
        try:
            # Generate with structured output (same pattern as generate_quarterly_text_analysis.py)
            response = model.generate_content(
                full_prompt,
                generation_config={
                    'temperature': 0.2,
                    'max_output_tokens': 8000,
                    'response_mime_type': 'application/json',
                    'response_schema': cleaned_schema
                }
            )
            
            # Parse JSON response
            try:
                batch_releases = json.loads(response.text)
            except json.JSONDecodeError:
                # Fallback: try extracting JSON from markdown blocks if needed
                if verbose:
                    print(f'Warning: Direct JSON parse failed, trying to extract from response text')
                result_text = extract_json_from_llm_response(response.text)
                batch_releases = json.loads(result_text)
            
            if verbose:
                print(f'Batch {batch_num + 1} response received ({len(batch_releases)} releases)')
            
            # Map batch-local link_index (1-indexed within batch) to global index (0-indexed in links_data)
            # and update the link_index in each release to the global index
            # Also copy over the is_downloadable flag from the original link
            for release in batch_releases:
                batch_local_index = release.get('link_index')  # 1-indexed within batch
                if batch_local_index and 1 <= batch_local_index <= len(batch):
                    global_index = batch_start + (batch_local_index - 1)  # Convert to 0-indexed global
                    release['_global_index'] = global_index  # Store global index for matching
                    
                    # Copy is_downloadable flag from original link data
                    if global_index < len(links_data):
                        original_link = links_data[global_index]
                        release['is_downloadable'] = original_link.get('is_downloadable', True)
                else:
                    release['_global_index'] = None
                    release['is_downloadable'] = True  # Default for safety
                
            # Print detailed input/output mapping for this batch in verbose mode
            if verbose:
                print(f'\nBatch {batch_num + 1} - Input/Output Mapping:')
                print('=' * 120)
                
                # Create a mapping of link_index to release for quick lookup
                release_by_index = {r.get('link_index'): r for r in batch_releases if r.get('link_index')}
                
                for j, link in enumerate(batch, 1):
                    print(f"\n[Link {j}] INPUT:")
                    print(f"  Text: {link.get('text', 'N/A')}")
                    print(f"  URL: {link.get('url', 'N/A')}")
                    if link.get('parent_text'):
                        print(f"  Context: {link.get('parent_text', '')[:150]}...")
                    if link.get('date_context'):
                        print(f"  Date context: {link.get('date_context', '')}")
                    html_attrs = link.get('html_attributes', {})
                    if html_attrs:
                        attrs_str = ', '.join([f"{k}={v}" for k, v in html_attrs.items()])
                        print(f"  HTML attributes: {attrs_str}")
                    is_downloadable = link.get('is_downloadable', False)
                    print(f"  Is downloadable: {'Yes' if is_downloadable else 'No'}")
                    
                    # Print Gemini output for this link
                    print(f"\n[Link {j}] GEMINI OUTPUT:")
                    if j in release_by_index:
                        release = release_by_index[j]
                        print(f"  ✓ Identified as financial document")
                        print(f"  Title: {release.get('title', 'N/A')}")
                        print(f"  Document Type: {release.get('document_type', 'N/A')}")
                        fiscal_year = release.get('fiscal_year')
                        fiscal_quarter = release.get('fiscal_quarter')
                        if fiscal_year and fiscal_quarter:
                            print(f"  Fiscal Period: {fiscal_year}Q{fiscal_quarter}")
                        elif fiscal_year:
                            print(f"  Fiscal Year: {fiscal_year} (quarter: missing)")
                        elif fiscal_quarter:
                            print(f"  Fiscal Quarter: Q{fiscal_quarter} (year: missing)")
                        else:
                            print(f"  Fiscal Period: Not identified")
                        release_date = release.get('release_date')
                        if release_date:
                            print(f"  Release Date: {release_date}")
                        if release.get('description'):
                            print(f"  Description: {release.get('description', '')[:100]}...")
                    else:
                        print(f"  ✗ Not identified as financial document (no output from Gemini)")
                    
                    print('-' * 120)
                
                print('=' * 120)
            
            all_releases.extend(batch_releases)
                
        except (ValueError, AttributeError) as text_error:
            # Response might be blocked or have no text
            if verbose:
                print(f'Warning: Could not extract text from Gemini response for batch {batch_num + 1}: {text_error}')
                if 'response' in locals() and hasattr(response, 'prompt_feedback') and response.prompt_feedback:
                    print(f'Prompt feedback: {response.prompt_feedback}')
            continue  # Skip this batch and continue with next
        except json.JSONDecodeError as e:
            print(f'Error parsing Gemini response JSON for batch {batch_num + 1}: {e}')
            if verbose:
                response_preview = response.text[:500] if 'response' in locals() and hasattr(response, 'text') else "N/A"
                print(f'Response preview: {response_preview}')
            continue  # Skip this batch and continue with next
        except Exception as e:
            print(f'Error calling Gemini API for batch {batch_num + 1}: {e}')
            if verbose:
                import traceback
                traceback.print_exc()
            continue  # Skip this batch and continue with next
        
    return all_releases

def parse_releases_listing_page(url: str, ticker: str, verbose: bool = False, existing_urls: Optional[set] = None) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Parse HTML page and use Gemini to identify earnings releases/presentations
    
    Args:
        url: URL of the HTML page to parse
        ticker: Stock ticker symbol
        verbose: Whether to print verbose output
        existing_urls: Set of URLs that already exist in the database (will be filtered out before Gemini)
    
    Returns:
        Tuple of (releases_list, skipped_links_list) where skipped_links_list contains links that were
        filtered out before Gemini because they already exist or were cached
    """
    # Get HTML using Playwright (includes automatic retry logic)
    html_content = browser_pool_manager.get_page_html(url, verbose=verbose)
    
    # Check if we successfully got HTML content
    if not html_content:
        return [], []
    
    # Extract links using the link extractor
    link_extractor = HTMLLinkExtractor(url, verbose=verbose)
    all_extracted_links = link_extractor.extract_links(html_content)
    
    if not all_extracted_links:
        if verbose:
            print('No links found on page')
        return [], []
    
    # Store all extracted links for cache update (before filtering)
    links_data = all_extracted_links.copy()
    
    # Get cached links for this IR URL
    ir_url_service = IRURLService()
    cached_links = ir_url_service.get_cached_links(ticker, url)
    cached_urls = {link['url'] for link in cached_links}
    
    # Build skipped_links list (links that won't be sent to Gemini)
    # We need to track which original links were skipped for the summary table
    skipped_links = []
    for link in all_extracted_links:
        link_url = link['url']
        if link_url in cached_urls:
            # Mark as cached
            skipped_link = link.copy()
            skipped_link['_cached'] = True
            skipped_links.append(skipped_link)
        elif link_url in existing_urls:
            # Mark as already existing
            skipped_link = link.copy()
            skipped_link['_existing'] = True
            skipped_links.append(skipped_link)
    
    # Create set of URLs to skip for filtering
    skip_urls = cached_urls | existing_urls
    links_data = [link for link in links_data if link['url'] not in skip_urls]
    
    if not links_data:
        if verbose:
            print('No links found after filtering (or all were already downloaded/cached/skipped)')
        # Return empty releases but include skipped links for summary table
        return [], skipped_links
    
    if verbose:
        print(f'Sending {len(links_data)} candidate links to Gemini for analysis in {((len(links_data) - 1) // BATCH_SIZE) + 1} batch(es)...')
    
    # Process links in batches using Gemini
    all_releases = classify_links_with_gemini(links_data, ticker, verbose=verbose)
    
    if verbose:
        print(f'\nTotal releases found across all batches: {len(all_releases)}')
    
    # Filter out Consolidated Financial Statements
    releases, filtered_out = filter_consolidated_financial_statements(all_releases, verbose=verbose)
    
    # Only keep releases that have both fiscal year and quarter (these are financial documents we'll download)
    financial_releases = [release for release in releases if release.get('fiscal_year') and release.get('fiscal_quarter')]
    financial_urls = {release.get('url') for release in financial_releases}
    
    # Cache all non-financial links (everything except financial documents)
    all_links_minus_releases = [l for l in all_extracted_links if l['url'] not in financial_urls]
    all_links_minus_releases_urls = [link['url'] for link in all_links_minus_releases]
    ir_url_service.update_link_cache(ticker, url, all_links_minus_releases_urls)
    
    if verbose:
        print(f'\nGemini identified {len(releases)} relevant filings out of {len(links_data)} candidate links')
        if all_links_minus_releases:
            print(f'  - {len(financial_releases)} financial documents (have fiscal year and quarter)')
            print(f'  - {len(all_links_minus_releases)} non-financial links (missing fiscal info) - will be skipped in the future')
    
    # Return only financial releases (those with fiscal_year and fiscal_quarter) and skipped links
    # Non-financial releases are cached but not returned for downloading
    return financial_releases, skipped_links
        

def print_link_classification_summary(releases: List[Dict[str, Any]], existing_urls: set, target_quarter: Optional[str] = None, skipped_links: Optional[List[Dict[str, Any]]] = None) -> None:
    """Print a summary table showing each link with its classification and action
    
    Args:
        releases: List of releases identified by Gemini
        existing_urls: Set of URLs that already exist in the database
        target_quarter: Optional target quarter to filter by (format: YYYYQN)
        skipped_links: List of links that were skipped before Gemini (already exist)
    """
    if not releases and not skipped_links:
        print('\nNo releases to display in summary table')
        return
    
    # Add skipped links to the table (they were filtered out before Gemini)
    if skipped_links:
        for link in skipped_links:
            releases.append({
                'title': link.get('text', 'N/A'),
                'url': link.get('url', 'N/A'),
                'release_date': None,
                'fiscal_year': None,
                'fiscal_quarter': None,
                'description': '',
                'document_type': 'unknown',
                '_cached': link.get('_cached', False),
                '_existing': link.get('_existing', False),
                '_skipped_before_gemini': True
            })
    
    # Build table data
    table_data = []
    for release in releases:
        url = release.get('url', 'N/A')
        title = release.get('title', 'N/A')
        fiscal_year = release.get('fiscal_year')
        fiscal_quarter = release.get('fiscal_quarter')
        doc_type = release.get('document_type', 'other')
        release_date = release.get('release_date')
        
        # Format date (needed for all cases)
        # Handle both datetime objects and string dates from JSON
        if release_date:
            if isinstance(release_date, str):
                # Try to parse string date
                try:
                    # Try ISO format first
                    date_obj = datetime.fromisoformat(release_date.replace('Z', '+00:00'))
                    date_str = date_obj.strftime("%Y-%m-%d")
                except (ValueError, AttributeError):
                    # If parsing fails, use the string as-is
                    date_str = release_date
            elif isinstance(release_date, datetime):
                date_str = release_date.strftime("%Y-%m-%d")
            else:
                date_str = str(release_date)
        else:
            date_str = "N/A"
        
        # Determine quarter/year
        if fiscal_year and fiscal_quarter:
            quarter_str = f"{fiscal_year}Q{fiscal_quarter}"
        else:
            quarter_str = "Unknown"
        
        # Determine action
        if release.get('_cached'):
            action = "SKIP (cached - seen before)"
        elif release.get('_existing'):
            action = "SKIP (already exists - filtered before Gemini)"
        elif release.get('_skipped_before_gemini'):
            action = "SKIP (already exists - filtered before Gemini)"
        elif url in existing_urls:
            action = "SKIP (already exists)"
        elif not fiscal_year or not fiscal_quarter:
            # Missing fiscal info - will be skipped during processing
            # Show what's actually present
            missing_parts = []
            if not fiscal_year:
                missing_parts.append("year")
            if not fiscal_quarter:
                missing_parts.append("quarter")
            present_parts = []
            if fiscal_year:
                present_parts.append(f"year={fiscal_year}")
            if fiscal_quarter:
                present_parts.append(f"quarter={fiscal_quarter}")
            
            if present_parts:
                action = f"IGNORE (missing {', '.join(missing_parts)}, has {', '.join(present_parts)})"
            else:
                action = "IGNORE (missing fiscal year and quarter)"
            
            # Store original link data for verbose output
            table_data.append({
                'url': url,
                'title': title[:60] + '...' if len(title) > 60 else title,
                'quarter': quarter_str,
                'date': date_str,
                'type': doc_type,
                'action': action,
                '_original_link_data': release.get('_original_link_data')  # Store for verbose output
            })
            continue  # Skip adding to table_data again below
        elif target_quarter and quarter_str != target_quarter:
            action = f"IGNORE (not {target_quarter})"
        else:
            action = "TO BE DOWNLOADED"
        
        table_data.append({
            'url': url,
            'title': title[:60] + '...' if len(title) > 60 else title,
            'quarter': quarter_str,
            'date': date_str,
            'type': doc_type,
            'action': action,
            '_original_link_data': release.get('_original_link_data')  # Store for verbose output
        })
    
    # Print table
    print('\n' + '='*120)
    print('LINK CLASSIFICATION SUMMARY')
    print('='*120)
    
    # Header
    print(f"{'Title':<60} {'Quarter':<12} {'Date':<12} {'Type':<20} {'Action':<30}")
    print('-'*120)
    
    # Sort by quarter (newest first), then by action
    def sort_key(x):
        quarter = x['quarter']
        if quarter == "Unknown":
            return ("zzz", x['action'])
        return (quarter, x['action'])
    
    table_data.sort(key=sort_key, reverse=True)
    
    # Print rows
    for row in table_data:
        print(f"{row['title']:<60} {row['quarter']:<12} {row['date']:<12} {row['type']:<20} {row['action']:<30}")
        
        # For links missing fiscal info, print full LLM input data
        if 'IGNORE' in row['action'] and 'missing fiscal' in row['action'].lower():
            original_data = row.get('_original_link_data')
            if original_data:
                print(f"  {'':>60} Full LLM input data:")
                print(f"  {'':>60}   Text: '{original_data.get('text', 'N/A')}'")
                print(f"  {'':>60}   URL: {original_data.get('url', 'N/A')}")
                parent_text = original_data.get('parent_text', 'N/A')
                if parent_text and parent_text != 'N/A':
                    print(f"  {'':>60}   Parent context: {parent_text[:150]}")
                date_context = original_data.get('date_context', 'N/A')
                if date_context and date_context != 'N/A':
                    print(f"  {'':>60}   Date context: {date_context}")
                html_attrs = original_data.get('html_attributes', {})
                if html_attrs:
                    attrs_str = ', '.join([f"{k}={v}" for k, v in html_attrs.items()])
                    print(f"  {'':>60}   HTML attributes: {attrs_str}")
    
    # Summary statistics
    skip_count = sum(1 for r in table_data if 'SKIP' in r['action'])
    ignore_count = sum(1 for r in table_data if 'IGNORE' in r['action'])
    download_count = sum(1 for r in table_data if 'TO BE DOWNLOADED' in r['action'])
    
    print('-'*120)
    print(f"Summary: {download_count} to download, {skip_count} already exist, {ignore_count} ignored")
    print('='*120 + '\n')

def extract_text_from_html(content: bytes) -> str:
    """Extract text from HTML content"""
    try:
        soup = BeautifulSoup(content, 'html.parser')
        # Remove script and style elements
        for script in soup(["script", "style"]):
            script.decompose()
        return soup.get_text(separator='\n', strip=True)
    except Exception as e:
        print(f'Error extracting text from HTML: {e}')
        return ''

def extract_date_from_url(url: str, fiscal_year_end_month: int) -> Optional[datetime]:
    """Try to extract date from URL patterns (e.g., 2025/q4, FY25-Q4)
    
    Note: Assumes the year in the URL refers to fiscal year.
    """
    url_date_match = re.search(r'(\d{4})[/-]q([1-4])|fy(\d{2})[/-]q([1-4])', url.lower())
    if url_date_match:
        groups = url_date_match.groups()
        fiscal_year = None
        quarter = None
        
        if groups[0]:  # YYYY-Q format (e.g., 2023/q2)
            fiscal_year = int(groups[0])
            quarter = int(groups[1])
        elif groups[2]:  # FY##-Q format (e.g., fy23-q2)
            fiscal_year = 2000 + int(groups[2])
            quarter = int(groups[3])
        
        if fiscal_year and quarter:
            # Calculate quarter start month based on fiscal year
            fiscal_year_start_month = (fiscal_year_end_month % 12) + 1
            quarter_start_month = fiscal_year_start_month + (quarter - 1) * 3
            
            # Handle month overflow (>12) - normalize to 1-12 range
            # Match the pattern used elsewhere in the code (lines 723-728)
            calendar_year = fiscal_year
            if quarter_start_month > 12:
                quarter_start_month = quarter_start_month - 12
                calendar_year = fiscal_year - 1
            elif quarter_start_month < 1:
                # Handle underflow (shouldn't normally happen)
                quarter_start_month = quarter_start_month + 12
                calendar_year = fiscal_year - 1
            
            # Ensure month is in valid range (1-12)
            quarter_start_month = max(1, min(12, quarter_start_month))
            
            try:
                return datetime(calendar_year, quarter_start_month, 15)
            except ValueError:
                # If we still get a ValueError (e.g., invalid year), return None
                return None
    return None



def find_pdf_links_in_html(html_content: str, base_url: str) -> List[str]:
    """Find all PDF links in an HTML page"""
    pdf_links = []
    try:
        soup = BeautifulSoup(html_content, 'html.parser')
        for link in soup.find_all('a', href=True):
            href = link.get('href', '')
            if href.lower().endswith('.pdf') or 'pdf' in href.lower():
                full_url = urljoin(base_url, href)
                if full_url not in pdf_links:
                    pdf_links.append(full_url)
    except Exception as e:
        print(f'Error finding PDF links: {e}')
    return pdf_links

def _format_release_date_for_storage(release_date: Optional[Any]) -> Optional[str]:
    """Format release date for storage (handles both string and datetime objects)
    
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


def create_document_id(quarter_key: str, document_type: str, release_date: Optional[Any], url: str) -> str:
    """Create unique document ID"""
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

def determine_document_type(title: str, url: str) -> str:
    """Determine document type from title and URL"""
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

def scan_ir_website(ticker: str, target_quarter: Optional[str] = None, verbose: bool = False) -> None:
    """Step 1: Scan IR website and download documents"""
    # Validate quarter format if provided
    if target_quarter and not re.match(r'^\d{4}Q[1-4]$', target_quarter):
        print(f'Error: Invalid quarter format: {target_quarter}. Use YYYYQN (e.g., 2024Q2)')
        return
    
    # Get all URLs for this ticker (from Firebase first, then JSON fallback)
    ticker_urls = get_ir_urls_for_ticker(ticker)
    
    if not ticker_urls:
        print(f'Error: No IR URL configured for {ticker}')
        print(f'Add it to {IR_URLS_FILE} or Firebase (tickers/{ticker}/ir_urls)')
        return
    
    if len(ticker_urls) == 1:
        print(f'Scanning IR website for {ticker}: {ticker_urls[0]}')
    else:
        print(f'Scanning {len(ticker_urls)} IR websites for {ticker}:')
        for i, url in enumerate(ticker_urls, 1):
            print(f'  {i}. {url}')
    
    # Initialize services
    ir_document_service = IRDocumentService()
    
    # Get all existing URLs before processing (to skip them before Gemini)
    all_existing_docs = ir_document_service.get_all_ir_documents(ticker)
    existing_urls = {doc.get('url') for doc in all_existing_docs if doc.get('url')}
    if existing_urls and verbose:
        print(f'Found {len(existing_urls)} already-downloaded documents in database')
    
    # Collect releases from all URLs
    all_releases = []
    all_skipped_links = []  # Links that were skipped before Gemini (already exist)
    for ir_url in ticker_urls:
        if verbose:
            print(f'\nProcessing URL: {ir_url}')
        
            # parse_html_page will handle Gemini API initialization
        releases, skipped_links = parse_releases_listing_page(ir_url, ticker, verbose, existing_urls=existing_urls)
        
        if releases:
            if verbose:
                print(f'Found {len(releases)} releases from {ir_url}')
            all_releases.extend(releases)
        elif verbose:
            print(f'No releases found from {ir_url}')
        
        # Collect skipped links for summary table
        if skipped_links:
            all_skipped_links.extend(skipped_links)
    
    if not all_releases:
        print(f'No releases found for {ticker} from any configured URLs')
        return
    
    # Remove duplicates based on URL (same document might appear on multiple pages)
    seen_urls = set()
    releases = []
    for release in all_releases:
        url = release.get('url', '')
        if url and url not in seen_urls:
            seen_urls.add(url)
            releases.append(release)
    
    if len(all_releases) > len(releases):
        print(f'Removed {len(all_releases) - len(releases)} duplicate release(s)')
    
    print(f'Found {len(releases)} unique potential releases')
    
    # Print summary table in verbose mode after Gemini classification
    if verbose and (releases or all_skipped_links):
        print_link_classification_summary(releases, existing_urls, target_quarter, all_skipped_links)
    
    processed_count = 0
    skipped_count = 0
    
    for release in releases:
        try:
            # Validate that we have required fiscal info from LLM BEFORE downloading
            # This avoids downloading documents we can't process
            fiscal_year = release.get('fiscal_year')
            fiscal_quarter = release.get('fiscal_quarter')
            release_date = release.get('release_date')  # Already parsed as datetime object from earlier step
            
            if not fiscal_year or not fiscal_quarter:
                # Don't print this message if we already showed it in the summary table
                # The summary table already shows these as "IGNORE (missing fiscal info)"
                skipped_count += 1
                continue
            
            quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
            
            # Filter by target quarter if specified (before downloading)
            if target_quarter and quarter_key != target_quarter:
                # Don't print this message - already shown in summary table as "IGNORE (not {target_quarter})"
                skipped_count += 1
                continue
            
            # Check if link is downloadable (skip HTML pages and navigation links)
            is_downloadable = release.get('is_downloadable', True)  # Default to True for backward compatibility
            if not is_downloadable:
                if verbose:
                    print(f'Skipping {release["title"]}: Not a downloadable link (likely HTML page or navigation)')
                skipped_count += 1
                continue
            
            # Download document only if we have required fiscal info and match target quarter
            if verbose:
                print(f'Downloading: {release["title"]}')
            
            content = browser_pool_manager.download_document(release['url'], verbose=verbose)
            if not content:
                if verbose:
                    print(f'  Skipped: Could not download')
                continue
            
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
            
            # Only extract text if needed (for finding PDF links in HTML pages)
            text = None
            if file_ext == 'html':
                text = extract_text_from_html(content)
                # Look for PDF links to download
                if verbose:
                    print(f'  HTML page detected, searching for PDF links...')
                pdf_links = find_pdf_links_in_html(text, release['url'])
                if pdf_links:
                    if verbose:
                        print(f'  Found {len(pdf_links)} PDF link(s) in the page')
                    release['pdf_links'] = pdf_links
            
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
                doc_type = determine_document_type(release['title'], release['url'])
            
            # Create document ID (include URL hash for uniqueness)
            document_id = create_document_id(quarter_key, doc_type, release_date, release['url'])
            
            # Check if document already exists (by URL, which is the most reliable check)
            # Use the existing_urls set we already loaded (more efficient than querying by quarter)
            if release['url'] in existing_urls:
                if verbose:
                    existing_doc = next((d for d in all_existing_docs if d.get('url') == release['url']), None)
                    existing_title = existing_doc.get('title', 'unknown') if existing_doc else 'unknown'
                    print(f'  Skipped: Document already exists (URL: {release["url"][:60]}..., Title: {existing_title})')
                skipped_count += 1
                continue
            
            # Store document using the service
            document_data = {
                'title': release['title'],
                'url': release['url'],
                'quarter_key': quarter_key,
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'release_date': _format_release_date_for_storage(release_date),
                'document_type': doc_type,
                'description': release.get('description', '')
            }
            
            ir_document_service.store_ir_document(ticker, document_id, document_data, content, file_ext, verbose)
            processed_count += 1
            
            if verbose:
                print(f'  ✅ Stored: {document_id} ({quarter_key})')
            
            # If this release has PDF links, download them as separate documents
            if release.get('pdf_links'):
                for pdf_url in release['pdf_links']:
                    try:
                        if verbose:
                            print(f'  Downloading associated PDF: {pdf_url[:60]}...')
                        
                        pdf_content = browser_pool_manager.download_document(pdf_url, verbose=verbose)
                        if not pdf_content:
                            if verbose:
                                print(f'    Skipped: Could not download PDF')
                            continue
                        
                        # Check if PDF already exists
                        if pdf_url in existing_urls:
                            if verbose:
                                print(f'    Skipped: PDF already exists')
                            continue
                        
                        # Use the same release date as the parent document (no date math needed)
                        pdf_release_date = release_date
                        
                        # Determine PDF document type
                        pdf_doc_type = 'earnings_release' if 'earnings' in pdf_url.lower() else 'presentation' if 'presentation' in pdf_url.lower() else 'other'
                        
                        # Create PDF document ID
                        pdf_document_id = create_document_id(quarter_key, pdf_doc_type, pdf_release_date, pdf_url)
                        
                        # Store PDF document
                        pdf_document_data = {
                            'ticker': ticker.upper(),
                            'document_id': pdf_document_id,
                            'title': f"{release['title']} - PDF",
                            'release_date': _format_release_date_for_storage(pdf_release_date),
                            'fiscal_year': fiscal_year,
                            'fiscal_quarter': fiscal_quarter,
                            'quarter_key': quarter_key,
                            'url': pdf_url,
                            'document_type': pdf_doc_type,
                            'parent_release_url': release['url']  # Link back to main release
                        }
                        
                        ir_document_service.store_ir_document(ticker, pdf_document_id, pdf_document_data, pdf_content, 'pdf', verbose)
                        processed_count += 1
                        
                        if verbose:
                            print(f'    ✅ Stored PDF: {pdf_document_id}')
                    
                    except Exception as e:
                        print(f'    Error processing PDF {pdf_url}: {e}')
                        if verbose:
                            import traceback
                            traceback.print_exc()
                        continue
        
        except Exception as e:
            print(f'Error processing release {release.get("title", "unknown")}: {e}')
            if verbose:
                import traceback
                traceback.print_exc()
            continue
    
    print(f'\n✅ Scan complete: {processed_count} documents stored, {skipped_count} skipped')

def main():
    parser = argparse.ArgumentParser(
        description='Scan IR websites and download earnings releases/presentations',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Scan and download documents
  python scan_ir_website.py AAPL
  python scan_ir_website.py AAPL --quarter 2024Q3 --verbose
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('--quarter', metavar='QUARTER', help='Filter scan to specific quarter (format: YYYYQN)')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    
    args = parser.parse_args()
    
    # Validate quarter format if provided
    if args.quarter and not re.match(r'^\d{4}Q[1-4]$', args.quarter):
            parser.error(f'Invalid quarter format: {args.quarter}. Use YYYYQN (e.g., 2024Q2)')
    
    try:
            scan_ir_website(args.ticker.upper(), args.quarter, args.verbose)
    
    except KeyboardInterrupt:
        print('\n\nInterrupted by user')
        sys.exit(1)
    except Exception as e:
        print(f'Error: {e}')
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()

