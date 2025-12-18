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
from typing import Dict, List, Optional, Any, Tuple
from urllib.parse import urljoin, urlparse
import requests
import feedparser
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

from services.ir_url_service import IRURLService
from services.ir_document_service import IRDocumentService
import yfinance as yf
import google.generativeai as genai  # Only needed for HTML parsing with LLM

# Load environment variables from .env.local
load_dotenv('.env.local')

# Load IR URLs configuration
# The ir_urls.json file uses arrays of URLs per ticker:
#   "AAPL": ["https://investor.apple.com/...", "https://another-url.com/..."]
IR_URLS_FILE = os.path.join(os.path.dirname(__file__), 'ir_urls.json')

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

def get_ir_urls_for_ticker(ticker: str, ir_urls: Dict[str, List[str]], firebase: Optional[IRURLService] = None) -> List[str]:
    """Get list of IR URLs for a ticker from both JSON config and Firebase.
    
    Args:
        ticker: Stock ticker symbol
        ir_urls: Dictionary of ticker -> list of URLs mapping from JSON
        firebase: Optional IRURLService instance to read from Firebase
        
    Returns:
        List of unique URLs for the ticker (combines JSON and Firebase sources)
    """
    ticker_upper = ticker.upper()
    url_set = set()
    
    # Get URLs from JSON config
    if ticker_upper in ir_urls:
        urls = ir_urls[ticker_upper]
        if isinstance(urls, list):
            url_set.update(urls)
        else:
            print(f'Warning: Invalid URL format for {ticker_upper} in JSON, expected list. Got: {type(urls).__name__}')
    
    # Get URLs from Firebase
    if firebase:
        try:
            firebase_urls = firebase.get_ir_urls(ticker)
            for url_data in firebase_urls:
                url = url_data.get('url')
                if url:
                    url_set.add(url)
        except Exception as e:
            print(f'Warning: Could not get IR URLs from Firebase for {ticker}: {e}')
    
    return list(url_set)

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

def parse_rss_feed(url: str) -> List[Dict[str, Any]]:
    """Parse RSS feed and extract earnings releases"""
    try:
        feed = feedparser.parse(url)
        releases = []
        
        for entry in feed.entries:
            # Try to extract date
            release_date = None
            if hasattr(entry, 'published_parsed') and entry.published_parsed:
                release_date = datetime(*entry.published_parsed[:6])
            elif hasattr(entry, 'published'):
                try:
                    release_date = datetime.strptime(entry.published, '%a, %d %b %Y %H:%M:%S %Z')
                except:
                    pass
            
            # Find PDF or document links
            links = []
            if hasattr(entry, 'links'):
                links = [link.get('href') for link in entry.links if link.get('type') == 'application/pdf']
            
            # Also check summary/content for links
            content = ''
            if hasattr(entry, 'summary'):
                content = entry.summary
            elif hasattr(entry, 'content'):
                content = entry.content[0].value if entry.content else ''
            
            # Extract PDF links from HTML content
            soup = BeautifulSoup(content, 'html.parser')
            for link in soup.find_all('a', href=True):
                href = link['href']
                if href.endswith('.pdf') or 'pdf' in href.lower():
                    full_url = urljoin(entry.link, href)
                    links.append(full_url)
            
            # Use entry link if no PDF found
            if not links and entry.link:
                links = [entry.link]
            
            for link_url in links:
                releases.append({
                    'title': entry.title,
                    'url': link_url,
                    'release_date': release_date,
                    'description': getattr(entry, 'summary', ''),
                    'document_type': None  # Will be determined later
                })
        
        return releases
    except Exception as e:
        print(f'Error parsing RSS feed {url}: {e}')
        return []

def get_page_html_with_playwright(url: str, wait_time: int = 10, verbose: bool = False) -> Optional[str]:
    """Get fully rendered HTML from a dynamic page using Playwright"""
    try:
        if verbose:
            print(f'Launching headless browser (Playwright) to load: {url}')
        
        with sync_playwright() as p:
            # Launch browser
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={'width': 1920, 'height': 1080},
                user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            )
            page = context.new_page()
            
            # Navigate to URL
            page.goto(url, wait_until='domcontentloaded', timeout=wait_time * 1000)
            
            # Wait for page to be fully loaded (wait for network to be idle)
            try:
                page.wait_for_load_state('networkidle', timeout=wait_time * 1000)
            except PlaywrightTimeoutError:
                if verbose:
                    print('Warning: Network idle timeout, proceeding with available content')
                # Still wait a bit for dynamic content
                page.wait_for_timeout(2000)  # Wait 2 seconds for JS to execute
            
            # Get the fully rendered HTML
            html = page.content()
            
            if verbose:
                print(f'Page loaded, HTML length: {len(html)} characters')
            
            browser.close()
            return html
        
    except Exception as e:
        if verbose:
            print(f'Error using Playwright: {e}')
            print('Falling back to simple HTTP request...')
        return None

def parse_html_page(url: str, ticker: str, verbose: bool = False) -> List[Dict[str, Any]]:
    """Parse HTML page and use Gemini to identify earnings releases/presentations"""
    try:
        # Try to get HTML using Playwright first (for dynamic pages)
        html_content = get_page_html_with_playwright(url, wait_time=10, verbose=verbose)
        
        # Fallback to simple HTTP request if Selenium fails
        if not html_content:
            if verbose:
                print('Using simple HTTP request (page may not be fully rendered)')
            headers = {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate',
                'Connection': 'keep-alive',
            }
            response = requests.get(url, timeout=30, headers=headers)
            response.raise_for_status()
            html_content = response.text
        
        if verbose:
            # Save HTML to file
            html_filename = f'ir_html_{ticker}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.html'
            html_filepath = os.path.join(os.path.dirname(__file__), html_filename)
            with open(html_filepath, 'w', encoding='utf-8') as f:
                f.write(html_content)
            print(f'\nHTML content saved to: {html_filepath}\n')
        
        soup = BeautifulSoup(html_content, 'html.parser')
        
        # Extract all links with context (text, nearby elements, parent structure)
        links_data = []
        for link in soup.find_all('a', href=True):
            href = link.get('href', '')
            if not href or href.startswith('#') or href.startswith('javascript:'):
                continue
            
            full_url = urljoin(url, href)
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
            
            links_data.append({
                'url': full_url,
                'text': link_text,
                'parent_text': parent_text,
                'date_context': date_context,
                'is_pdf': href.lower().endswith('.pdf') or 'pdf' in href.lower()
            })
        
        if not links_data:
            if verbose:
                print('No links found on page')
            return []
        
        # Pre-filter links to only include financial documents before sending to Gemini
        # This reduces token usage significantly
        financial_keywords = [
            'earnings', 'quarterly', 'results', 'financial', 'statement', 'filing',
            '10-k', '10-q', '8-k', 'annual', 'report', 'proxy', 'sec',
            'q1', 'q2', 'q3', 'q4', 'fy', 'fiscal', 'investor', 'ir'
        ]
        
        # Filter: include PDFs or links with financial keywords in text/URL/context
        filtered_links = []
        for link in links_data:
            text_lower = link['text'].lower()
            url_lower = link['url'].lower()
            context_lower = (link['parent_text'] + ' ' + link['date_context']).lower()
            
            # Include if:
            # 1. It's a PDF, OR
            # 2. Contains financial keywords in text/URL/context, OR
            # 3. URL contains financial patterns (earnings, filing, etc.)
            if (link['is_pdf'] or 
                any(kw in text_lower or kw in url_lower or kw in context_lower for kw in financial_keywords) or
                any(pattern in url_lower for pattern in ['/earnings/', '/filing/', '/financial', '/investor', '/ir/'])):
                filtered_links.append(link)
        
        # Sort by relevance (PDFs first, then by keyword matches)
        filtered_links = sorted(filtered_links, key=lambda x: (
            x['is_pdf'],
            sum(1 for kw in financial_keywords if kw in (x['text'].lower() + ' ' + x['url'].lower()))
        ), reverse=True)
        
        if verbose:
            print(f'Found {len(links_data)} total links, filtered to {len(filtered_links)} financial-related links')
            print(f'Filtered links include: {sum(1 for l in filtered_links if l["is_pdf"])} PDFs, {sum(1 for l in filtered_links if not l["is_pdf"])} HTML/other')
        
        links_data = filtered_links
        
        if not links_data:
            if verbose:
                print('No financial links found after filtering')
            return []
        
        if verbose:
            print(f'Sending {len(links_data)} candidate links to Gemini for analysis...')
        
        # Prepare prompt for Gemini
        links_summary = '\n'.join([
            f"{i+1}. Text: '{link['text']}' | URL: {link['url']} | Context: {link['parent_text']} | Date: {link['date_context']} | PDF: {link['is_pdf']}"
            for i, link in enumerate(links_data)
        ])
        
        prompt = f"""You are analyzing the investor relations page for {ticker}. 

Below are links found on the page. Identify which links are relevant financial documents:

1. Earnings releases (quarterly or annual financial results)
2. Earnings presentations or slides
3. SEC filings (10-K, 10-Q, 8-K, etc.)
4. Annual reports
5. Proxy statements
6. Other regulatory or financial documents

For each relevant link, extract:
- The link URL: Return the EXACT URL as provided below - DO NOT modify, reconstruct, or guess the URL. Copy it exactly as shown.
- The document title: Extract a descriptive title from the link text and context. Include quarter/year information if available (e.g., "Apple Reports Q3 2024 Results" not just "Press Release")
- The fiscal year: Extract from URL, title, or context (e.g., FY25, 2025, 2024)
- The fiscal quarter: Extract from URL, title, or context (1, 2, 3, or 4). If it's an annual report or 10-K, use 4. If not clear, use null.
- The release/presentation date: If available in context, format as YYYY-MM-DD. Otherwise use null.
- The document type: earnings_release, presentation, sec_filing_10k, sec_filing_10q, annual_report, proxy_statement, or other

Return a JSON array with this structure:
[
  {{
    "link_index": 1,
    "url": "full_url_here",
    "title": "descriptive_document_title_with_quarter_and_year_if_available",
    "fiscal_year": 2025 or null,
    "fiscal_quarter": 1, 2, 3, 4, or null,
    "release_date": "YYYY-MM-DD or null if not found",
    "document_type": "earnings_release|presentation|sec_filing_10k|sec_filing_10q|annual_report|proxy_statement|other"
  }},
  ...
]

Note: link_index should be the number from the link list above (1, 2, 3, etc.). This ensures we can match back to the original URL.

Links found on page:
{links_summary}

IMPORTANT: 
- CRITICAL: Return URLs EXACTLY as shown in the links below - DO NOT modify, reconstruct, or guess URLs. Copy them character-for-character as provided.
- Include ALL financial documents: earnings releases, presentations, SEC filings (10-K, 10-Q, 8-K), annual reports, proxy statements, and any other regulatory or financial documents
- EXCLUDE Consolidated Financial Statements - these are obtained from a different data source and should not be downloaded here
- Be INCLUSIVE - when in doubt, include the link. It's better to include too many than miss important documents.
- Extract descriptive titles that include quarter/year information when available (e.g., "Q3 2024 Earnings Release", "10-Q Q3 2025")
- For SEC filings, use the filing type in the title (e.g., "10-K Annual Report 2024", "10-Q Q3 2025")
- Extract titles from URLs when link text is generic (e.g., if URL contains "FY22_Q2", use "FY22 Q2 Earnings Release")
- Include ALL PDF links that appear to be financial documents, even if the link text is generic like "10-K"
- Include historical documents (past quarters/years) - don't filter by date
- Exclude ONLY: general news articles, press releases about products/features (not financial), marketing materials, Consolidated Financial Statements, or clearly non-financial content
- If a link points to a PDF and the URL or context suggests it's financial (contains terms like: earnings, filing, 10-k, 10-q, quarterly, annual, report), INCLUDE IT (but still exclude Consolidated Financial Statements)
- If no date is found, use null for release_date
- Return ALL relevant links found, not just a subset
"""
        
        # Call Gemini
        if verbose:
            print('Calling Gemini to identify relevant filings...')
            print('\n' + '='*80)
            print('PROMPT SENT TO GEMINI:')
            print('='*80)
            print(prompt)
            print('='*80 + '\n')
        
        # Use model from env var or default to gemini-2.0-flash
        model_name = get_gemini_model()
        
        # Combine system instruction with user prompt for Gemini
        system_instruction = "You are a financial analyst identifying ALL financial documents from investor relations pages. Return only valid JSON arrays. Include ALL relevant financial documents - be inclusive, not restrictive. IMPORTANT: Exclude Consolidated Financial Statements as these are obtained from a different data source."
        full_prompt = f"{system_instruction}\n\n{prompt}"
        
        # Configure and call Gemini
        generation_config = genai.types.GenerationConfig(
            temperature=0.2,
            max_output_tokens=8000,
        )
        
        try:
            model = genai.GenerativeModel(model_name)
            response = model.generate_content(
                full_prompt,
                generation_config=generation_config
            )
            
            # Extract text from response
            try:
                result_text = response.text.strip()
            except (ValueError, AttributeError) as text_error:
                # Response might be blocked or have no text
                if verbose:
                    print(f'Warning: Could not extract text from Gemini response: {text_error}')
                    if hasattr(response, 'prompt_feedback') and response.prompt_feedback:
                        print(f'Prompt feedback: {response.prompt_feedback}')
                return []
            
            if not result_text:
                if verbose:
                    print('Warning: Gemini response was empty')
                return []
                
        except Exception as e:
            print(f'Error calling Gemini API: {e}')
            if verbose:
                import traceback
                traceback.print_exc()
            return []
        
        if verbose:
            print('='*80)
            print('LLM RESPONSE:')
            print('='*80)
            print(result_text)
            print('='*80 + '\n')
        
        # Create mappings for URL preservation
        url_to_original_link = {link['url']: link for link in links_data}
        index_to_original_link = {i+1: link for i, link in enumerate(links_data)}  # 1-indexed as shown in prompt
        
        # Extract JSON from response
        result_text = extract_json_from_llm_response(result_text)
        releases = json.loads(result_text)
        
        # Filter out Consolidated Financial Statements
        original_count = len(releases)
        filtered_out = [
            r for r in releases 
            if (
                'consolidated financial' in r.get('title', '').lower() or
                'consolidated financial' in r.get('url', '').lower() or
                (r.get('document_type') == 'financial_statements' and 'consolidated' in r.get('title', '').lower())
            )
        ]
        
        releases = [
            r for r in releases 
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
        
        # Parse dates and convert to datetime objects, matching back to original URLs
        parsed_releases = []
        for release in releases:
            original_url = None
            original_link = None
            
            # Try to match by link_index first (most reliable)
            link_index = release.get('link_index')
            if link_index and link_index in index_to_original_link:
                original_link = index_to_original_link[link_index]
                original_url = original_link['url']
                if verbose:
                    llm_url = release.get('url', 'N/A')
                    if llm_url != original_url:
                        print(f'  Using original URL from index {link_index}: {original_url[:60]}... (LLM had: {llm_url[:60]}...)')
            else:
                # Fall back to URL matching
                llm_url = release.get('url', '')
                
                # Normalize URL for comparison (remove trailing slash, lowercase, etc.)
                def normalize_url_for_match(u):
                    u = u.rstrip('/')
                    u_lower = u.lower()
                    # Extract just the filename for matching
                    parsed = urlparse(u_lower)
                    filename = parsed.path.split('/')[-1] if parsed.path else ''
                    return (u_lower, parsed.netloc, filename)
                
                llm_normalized = normalize_url_for_match(llm_url)
                
                # Try exact match first
                if llm_url in url_to_original_link:
                    original_link = url_to_original_link[llm_url]
                    original_url = original_link['url']
                else:
                    # Try normalized match - match by filename and domain
                    for orig_url, orig_link in url_to_original_link.items():
                        orig_normalized = normalize_url_for_match(orig_url)
                        # Match if same domain and same filename
                        if (llm_normalized[1] == orig_normalized[1] and 
                            llm_normalized[2] and orig_normalized[2] and
                            llm_normalized[2] == orig_normalized[2]):
                            original_link = orig_link
                            original_url = orig_url
                            if verbose:
                                print(f'  Matched LLM URL (by filename) {llm_url[:60]}... to original {orig_url[:60]}...')
                            break
                    
                    # If still no match, try case-insensitive URL match
                    if not original_link:
                        llm_url_lower = llm_url.lower().rstrip('/')
                        for orig_url, orig_link in url_to_original_link.items():
                            if orig_url.lower().rstrip('/') == llm_url_lower:
                                original_link = orig_link
                                original_url = orig_url
                                if verbose:
                                    print(f'  Matched LLM URL (case-insensitive) {llm_url[:60]}... to original {orig_url[:60]}...')
                                break
                
                # If no match found, use LLM URL but warn
                if not original_link:
                    original_url = llm_url
                    if verbose:
                        print(f'  ⚠️  Warning: Could not match LLM URL {llm_url[:60]}... to original links, using LLM URL')
            
            release_date = None
            if release.get('release_date') and release['release_date'] != 'null' and release['release_date']:
                try:
                    date_str = str(release['release_date'])
                    # Try to parse various date formats
                    for fmt in ['%Y-%m-%d', '%m/%d/%Y', '%B %d, %Y', '%b %d, %Y', '%Y/%m/%d']:
                        try:
                            release_date = datetime.strptime(date_str, fmt)
                            break
                        except:
                            continue
                except:
                    pass
            
            # Get fiscal year and quarter from LLM response if available
            fiscal_year = release.get('fiscal_year')
            fiscal_quarter = release.get('fiscal_quarter')
            
            # Ensure we have a valid URL (fallback to LLM URL if no match found)
            final_url = original_url if original_url else release.get('url', '')
            if not final_url:
                if verbose:
                    print(f'  ⚠️  Warning: No URL found for release, skipping: {release.get("title", "N/A")}')
                continue
            
            # Use original URL, not LLM URL
            parsed_releases.append({
                'title': release.get('title', ''),
                'url': final_url,  # Use original URL from links_data
                'release_date': release_date,
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'description': '',
                'document_type': release.get('document_type', 'other')
            })
        
        if verbose:
            print(f'\nGemini identified {len(parsed_releases)} relevant filings out of {len(links_data)} candidate links')
            if len(parsed_releases) < len(links_data) * 0.3:  # If less than 30% of links were selected
                print(f'⚠️  Warning: Only {len(parsed_releases)}/{len(links_data)} links were selected. This might be too restrictive.')
        
        return parsed_releases
        
    except json.JSONDecodeError as e:
        print(f'Error parsing Gemini response: {e}')
        if verbose:
            response_preview = result_text[:500] if 'result_text' in locals() else "N/A"
            print(f'Response: {response_preview}')
        return []
    except Exception as e:
        print(f'Error parsing HTML page with LLM {url}: {e}')
        if verbose:
            import traceback
            traceback.print_exc()
        return []

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

def extract_json_from_llm_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks)"""
    if '```json' in response_text:
        return response_text.split('```json')[1].split('```')[0].strip()
    elif '```' in response_text:
        return response_text.split('```')[1].split('```')[0].strip()
    return response_text.strip()

def get_gemini_model() -> str:
    """Get Gemini model from env var or return default"""
    return os.getenv('GEMINI_MODEL', 'gemini-2.0-flash')

def download_document(url: str) -> Optional[bytes]:
    """Download document from URL"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/pdf,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        }
        response = requests.get(url, timeout=60, allow_redirects=True, headers=headers)
        response.raise_for_status()
        return response.content
    except Exception as e:
        print(f'Error downloading document from {url}: {e}')
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

def create_document_id(quarter_key: str, document_type: str, release_date: Optional[datetime], url: str) -> str:
    """Create unique document ID"""
    import hashlib
    date_str = release_date.strftime('%Y%m%d') if release_date else datetime.now().strftime('%Y%m%d')
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
    
    ir_urls = load_ir_urls()
    
    # Initialize Firebase
    ir_url_service = IRURLService()
    ir_doc_service = IRDocumentService()
    
    # Get all URLs for this ticker (from both JSON and Firebase)
    ticker_urls = get_ir_urls_for_ticker(ticker, ir_urls, ir_url_service)
    
    if not ticker_urls:
        print(f'Error: No IR URL configured for {ticker}')
        print(f'Add it to {IR_URLS_FILE}')
        return
    
    if len(ticker_urls) == 1:
        print(f'Scanning IR website for {ticker}: {ticker_urls[0]}')
    else:
        print(f'Scanning {len(ticker_urls)} IR websites for {ticker}:')
        for i, url in enumerate(ticker_urls, 1):
            print(f'  {i}. {url}')
    
    # Initialize Gemini API for HTML parsing
    gemini_api_key = os.getenv('GEMINI_API_KEY')
    if gemini_api_key:
        genai.configure(api_key=gemini_api_key)
    else:
        print('Warning: GEMINI_API_KEY not set. HTML page parsing will be limited.')
    
    # Collect releases from all URLs
    all_releases = []
    for ir_url in ticker_urls:
        if verbose:
            print(f'\nProcessing URL: {ir_url}')
        
        # Determine if URL is RSS feed or HTML page
        if 'rss' in ir_url.lower() or ir_url.endswith('.xml') or ir_url.endswith('.rss'):
            releases = parse_rss_feed(ir_url)
        else:
            if gemini_api_key:
                releases = parse_html_page(ir_url, ticker, verbose)
            else:
                print(f'Error: Cannot parse HTML page {ir_url} without GEMINI_API_KEY')
                continue
        
        # Update last_scanned timestamp in Firebase
        try:
            ir_url_service.update_ir_url_last_scanned(ticker, ir_url)
        except Exception as e:
            if verbose:
                print(f'Warning: Could not update last_scanned for {ir_url}: {e}')
        
        if releases:
            if verbose:
                print(f'Found {len(releases)} releases from {ir_url}')
            all_releases.extend(releases)
        elif verbose:
            print(f'No releases found from {ir_url}')
    
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
    
    processed_count = 0
    skipped_count = 0
    
    for release in releases:
        try:
            # Download document
            if verbose:
                print(f'Downloading: {release["title"]}')
            
            content = download_document(release['url'])
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
            
            # Use fiscal year/quarter and release date directly from LLM response (no date math needed)
            fiscal_year = release.get('fiscal_year')
            fiscal_quarter = release.get('fiscal_quarter')
            release_date = release.get('release_date')  # Already parsed as datetime object from earlier step
            
            # Validate that we have required fiscal info from LLM
            if not fiscal_year or not fiscal_quarter:
                if verbose:
                    print(f'  Skipped: Missing fiscal year or quarter from LLM response')
                skipped_count += 1
                continue
            
            if verbose:
                print(f'  Using LLM-provided fiscal info: {fiscal_year}Q{fiscal_quarter}')
                if release_date:
                    print(f'  Release date: {release_date.strftime("%Y-%m-%d")}')
                else:
                    print(f'  Release date: not provided by LLM')
            
            quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
            
            # Filter by target quarter if specified
            if target_quarter and quarter_key != target_quarter:
                if verbose:
                    print(f'  Skipped: Quarter {quarter_key} does not match target {target_quarter}')
                skipped_count += 1
                continue
            
            # Determine document type (use from Gemini if available, otherwise infer)
            doc_type = release.get('document_type')
            if not doc_type or doc_type == 'other':
                doc_type = determine_document_type(release['title'], release['url'])
            
            # Create document ID (include URL hash for uniqueness)
            document_id = create_document_id(quarter_key, doc_type, release_date, release['url'])
            
            # Check if document already exists (by URL, which is the most reliable check)
            existing_docs = ir_doc_service.get_ir_documents_for_quarter(ticker, quarter_key)
            existing_urls = {doc.get('url') for doc in existing_docs if doc.get('url')}
            
            if release['url'] in existing_urls:
                if verbose:
                    existing_doc = next((d for d in existing_docs if d.get('url') == release['url']), None)
                    existing_title = existing_doc.get('title', 'unknown') if existing_doc else 'unknown'
                    print(f'  Skipped: Document already exists (URL: {release["url"][:60]}..., Title: {existing_title})')
                skipped_count += 1
                continue
            
            # Store document
            document_data = {
                'ticker': ticker.upper(),
                'document_id': document_id,
                'title': release['title'],
                'release_date': release_date.isoformat() if release_date else None,
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'quarter_key': quarter_key,
                'url': release['url'],
                'document_type': doc_type
            }
            
            ir_doc_service.store_ir_document(ticker, document_id, document_data, content, file_ext, verbose)
            processed_count += 1
            
            if verbose:
                print(f'  ✅ Stored: {document_id} ({quarter_key})')
            
            # If this release has PDF links, download them as separate documents
            if release.get('pdf_links'):
                for pdf_url in release['pdf_links']:
                    try:
                        if verbose:
                            print(f'  Downloading associated PDF: {pdf_url[:60]}...')
                        
                        pdf_content = download_document(pdf_url)
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
                            'release_date': pdf_release_date.isoformat() if pdf_release_date else None,
                            'fiscal_year': fiscal_year,
                            'fiscal_quarter': fiscal_quarter,
                            'quarter_key': quarter_key,
                            'url': pdf_url,
                            'document_type': pdf_doc_type,
                            'parent_release_url': release['url']  # Link back to main release
                        }
                        
                        firebase.store_ir_document(ticker, pdf_document_id, pdf_document_data, pdf_content, 'pdf', verbose)
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

def list_documents(ticker: str, year: Optional[int] = None, quarter_key: Optional[str] = None, verbose: bool = False) -> None:
    """List IR documents for a ticker, optionally filtered by year or quarter"""
    ir_url_service = IRURLService()
    ir_doc_service = IRDocumentService()
    
    ticker_upper = ticker.upper()
    
    if quarter_key:
        # List documents for specific quarter
        if not re.match(r'^\d{4}Q[1-4]$', quarter_key):
            print(f'Error: Invalid quarter format. Use YYYYQN (e.g., 2024Q3)')
            return
        
        documents = ir_doc_service.get_ir_documents_for_quarter(ticker_upper, quarter_key)
        
        if not documents:
            print(f'No documents found for {ticker_upper} {quarter_key}')
            return
        
        # Sort by release_date in reverse order (most recent first)
        documents = sorted(documents, key=lambda x: x.get('release_date') or '', reverse=True)
        
        print(f'\nDocuments for {ticker_upper} {quarter_key}:')
        print('=' * 80)
        for doc in documents:
            print(f"  Title: {doc.get('title', 'N/A')}")
            print(f"  Type: {doc.get('document_type', 'N/A')}")
            print(f"  Release Date: {doc.get('release_date', 'N/A')}")
            print(f"  URL: {doc.get('url', 'N/A')}")
            print(f"  Document ID: {doc.get('document_id', 'N/A')}")
            if verbose:
                print(f"  Storage Ref: {doc.get('document_storage_ref', 'N/A')}")
            print()
    
    elif year:
        # List all documents for a specific year
        # Query all quarters for that year
        quarters = [f"{year}Q{q}" for q in [1, 2, 3, 4]]
        all_docs = []
        
        for qk in quarters:
            docs = ir_doc_service.get_ir_documents_for_quarter(ticker_upper, qk)
            all_docs.extend(docs)
        
        if not all_docs:
            print(f'No documents found for {ticker_upper} year {year}')
            return
        
        print(f'\nDocuments for {ticker_upper} year {year}:')
        print('=' * 80)
        # Sort by release_date in reverse order (most recent first), then by quarter_key
        for doc in sorted(all_docs, key=lambda x: (x.get('release_date') or '', x.get('quarter_key', '')), reverse=True):
            qk = doc.get('quarter_key', 'N/A')
            print(f"  [{qk}] {doc.get('title', 'N/A')}")
            print(f"      Type: {doc.get('document_type', 'N/A')}, Date: {doc.get('release_date', 'N/A')}")
            if verbose:
                print(f"      URL: {doc.get('url', 'N/A')}")
                print(f"      ID: {doc.get('document_id', 'N/A')}")
            print()
    
    else:
        # List all documents for ticker (get all quarters)
        # We need to query Firestore to get all quarters
        try:
            docs_ref = (ir_doc_service.db.collection('tickers')
                       .document(ticker_upper)
                       .collection('ir_documents'))
            
            all_docs = []
            for doc in docs_ref.stream():
                doc_data = doc.to_dict()
                doc_data['document_id'] = doc.id
                all_docs.append(doc_data)
            
            if not all_docs:
                print(f'No documents found for {ticker_upper}')
                return
            
            # Group by quarter
            by_quarter = {}
            for doc in all_docs:
                qk = doc.get('quarter_key', 'Unknown')
                if qk not in by_quarter:
                    by_quarter[qk] = []
                by_quarter[qk].append(doc)
            
            print(f'\nAll documents for {ticker_upper}:')
            print('=' * 80)
            # Sort quarters in reverse order (most recent first)
            for qk in sorted(by_quarter.keys(), reverse=True):
                docs = by_quarter[qk]
                # Sort documents within quarter by release_date in reverse order (most recent first)
                docs = sorted(docs, key=lambda x: x.get('release_date') or '', reverse=True)
                print(f'\n{qk} ({len(docs)} document(s)):')
                for doc in docs:
                    print(f"  - {doc.get('title', 'N/A')}")
                    print(f"    Type: {doc.get('document_type', 'N/A')}, Date: {doc.get('release_date', 'N/A')}")
                    if verbose:
                        print(f"    URL: {doc.get('url', 'N/A')[:80]}...")
                        print(f"    ID: {doc.get('document_id', 'N/A')}")
                    print()
        
        except Exception as e:
            print(f'Error listing documents: {e}')
            if verbose:
                import traceback
                traceback.print_exc()

def main():
    parser = argparse.ArgumentParser(
        description='Scan IR websites and download earnings releases/presentations',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Scan and download documents
  python scan_ir_website.py AAPL --scan
  python scan_ir_website.py AAPL --scan --quarter 2024Q3 --verbose
  
  # List documents
  python scan_ir_website.py AAPL --list
  python scan_ir_website.py AAPL --list --year 2024
  python scan_ir_website.py AAPL --list --quarter 2024Q3
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('--scan', action='store_true', help='Scan IR website and download documents')
    parser.add_argument('--list', action='store_true', help='List documents for ticker (use --year or --quarter to filter)')
    parser.add_argument('--quarter', metavar='QUARTER', help='Filter scan/list to specific quarter (format: YYYYQN)')
    parser.add_argument('--year', type=int, metavar='YEAR', help='Filter list to specific year (e.g., 2024)')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    
    args = parser.parse_args()
    
    if not args.scan and not args.list:
        parser.error('Must specify either --scan or --list')
    
    if args.scan and args.list:
        parser.error('Cannot specify both --scan and --list at the same time')
    
    # Validate year and quarter consistency if both are provided
    if args.year and args.quarter:
        # Extract year from quarter (format: YYYYQN)
        quarter_year_match = re.match(r'^(\d{4})Q[1-4]$', args.quarter)
        if quarter_year_match:
            quarter_year = int(quarter_year_match.group(1))
            if quarter_year != args.year:
                parser.error(f'Year mismatch: --year {args.year} does not match year in --quarter {args.quarter} (year {quarter_year})')
        else:
            parser.error(f'Invalid quarter format: {args.quarter}. Use YYYYQN (e.g., 2024Q2)')
    
    # For --scan, year is ignored (quarter already contains the year)
    if args.scan and args.year:
        print(f'Note: --year {args.year} is ignored when using --scan. Using --quarter {args.quarter or "all quarters"} for filtering.')
    
    try:
        if args.scan:
            scan_ir_website(args.ticker.upper(), args.quarter, args.verbose)
        elif args.list:
            list_documents(args.ticker.upper(), args.year, args.quarter, args.verbose)
    
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

