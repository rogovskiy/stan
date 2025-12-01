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

from firebase_cache import FirebaseCache
import yfinance as yf
from openai import OpenAI  # Only needed for HTML parsing with LLM

# Load environment variables from .env.local
load_dotenv('.env.local')

# Load IR URLs configuration
IR_URLS_FILE = os.path.join(os.path.dirname(__file__), 'ir_urls.json')

def load_ir_urls() -> Dict[str, str]:
    """Load IR URLs from configuration file"""
    try:
        with open(IR_URLS_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print(f'Warning: {IR_URLS_FILE} not found. Create it with IR URLs per ticker.')
        return {}
    except json.JSONDecodeError as e:
        print(f'Error parsing {IR_URLS_FILE}: {e}')
        return {}

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

def parse_html_page(url: str, ticker: str, client: OpenAI, verbose: bool = False) -> List[Dict[str, Any]]:
    """Parse HTML page and use OpenAI to identify earnings releases/presentations"""
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
        
        # Pre-filter links to only include financial documents before sending to OpenAI
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
            print(f'Sending {len(links_data)} candidate links to OpenAI for analysis...')
        
        # Prepare prompt for OpenAI
        links_summary = '\n'.join([
            f"{i+1}. Text: '{link['text']}' | URL: {link['url']} | Context: {link['parent_text']} | Date: {link['date_context']} | PDF: {link['is_pdf']}"
            for i, link in enumerate(links_data)
        ])
        
        prompt = f"""You are analyzing the investor relations page for {ticker}. 

Below are links found on the page. Identify which links are relevant financial documents:

1. Earnings releases (quarterly or annual financial results)
2. Earnings presentations or slides
3. SEC filings (10-K, 10-Q, 8-K, etc.)
4. Financial statements (consolidated financial statements, income statements, balance sheets, cash flow statements)
5. Annual reports
6. Proxy statements
7. Other regulatory or financial documents

For each relevant link, extract:
- The link URL
- The document title: Extract a descriptive title from the link text and context. Include quarter/year information if available (e.g., "Apple Reports Q3 2024 Results" not just "Press Release")
- The fiscal year: Extract from URL, title, or context (e.g., FY25, 2025, 2024)
- The fiscal quarter: Extract from URL, title, or context (1, 2, 3, or 4). If it's an annual report or 10-K, use 4. If not clear, use null.
- The release/presentation date: If available in context, format as YYYY-MM-DD. Otherwise use null.
- The document type: earnings_release, presentation, sec_filing_10k, sec_filing_10q, financial_statements, annual_report, proxy_statement, or other

Return a JSON array with this structure:
[
  {{
    "url": "full_url_here",
    "title": "descriptive_document_title_with_quarter_and_year_if_available",
    "fiscal_year": 2025 or null,
    "fiscal_quarter": 1, 2, 3, 4, or null,
    "release_date": "YYYY-MM-DD or null if not found",
    "document_type": "earnings_release|presentation|sec_filing_10k|sec_filing_10q|financial_statements|annual_report|proxy_statement|other"
  }},
  ...
]

Links found on page:
{links_summary}

IMPORTANT: 
- Include ALL financial documents: earnings releases, presentations, SEC filings (10-K, 10-Q, 8-K), financial statements, annual reports, proxy statements, and any other regulatory or financial documents
- Be INCLUSIVE - when in doubt, include the link. It's better to include too many than miss important documents.
- Extract descriptive titles that include quarter/year information when available (e.g., "Q3 2024 Earnings Release", "FY22 Q2 Consolidated Financial Statements", "10-Q Q3 2025")
- For SEC filings, use the filing type in the title (e.g., "10-K Annual Report 2024", "10-Q Q3 2025")
- For financial statements, include the fiscal period (e.g., "FY22 Q2 Consolidated Financial Statements")
- Extract titles from URLs when link text is generic (e.g., if URL contains "FY22_Q2", use "FY22 Q2 Consolidated Financial Statements")
- Include ALL PDF links that appear to be financial documents, even if the link text is generic like "Financial Statements" or "10-K"
- Include historical documents (past quarters/years) - don't filter by date
- Exclude ONLY: general news articles, press releases about products/features (not financial), marketing materials, or clearly non-financial content
- If a link points to a PDF and the URL or context suggests it's financial (contains terms like: earnings, financial, statement, filing, 10-k, 10-q, quarterly, annual, report), INCLUDE IT
- If no date is found, use null for release_date
- Return ALL relevant links found, not just a subset
"""
        
        # Call OpenAI
        if verbose:
            print('Calling OpenAI to identify relevant filings...')
            print('\n' + '='*80)
            print('PROMPT SENT TO OPENAI:')
            print('='*80)
            print(prompt)
            print('='*80 + '\n')
        
        # Use model from env var or default to gpt-4o-mini (newer, larger context, cheaper than gpt-4)
        # Can set OPENAI_MODEL=gpt-4o or gpt-4-turbo in .env.local if you have access
        model = get_openai_model()
        
        response = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": "You are a financial analyst identifying ALL financial documents from investor relations pages. Return only valid JSON arrays. Include ALL relevant financial documents - be inclusive, not restrictive."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=8000  # gpt-4o-mini supports up to 16k tokens
        )
        
        result_text = response.choices[0].message.content.strip()
        
        if verbose:
            print('='*80)
            print('LLM RESPONSE:')
            print('='*80)
            print(result_text)
            print('='*80 + '\n')
        
        # Extract JSON from response
        result_text = extract_json_from_llm_response(result_text)
        releases = json.loads(result_text)
        
        # Parse dates and convert to datetime objects
        parsed_releases = []
        for release in releases:
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
            
            # If LLM provided fiscal info, use it; otherwise we'll calculate later
            parsed_releases.append({
                'title': release.get('title', ''),
                'url': release.get('url', ''),
                'release_date': release_date,
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'description': '',
                'document_type': release.get('document_type', 'other')
            })
        
        if verbose:
            print(f'\nOpenAI identified {len(parsed_releases)} relevant filings out of {len(links_data)} candidate links')
            if len(parsed_releases) < len(links_data) * 0.3:  # If less than 30% of links were selected
                print(f'⚠️  Warning: Only {len(parsed_releases)}/{len(links_data)} links were selected. This might be too restrictive.')
        
        return parsed_releases
        
    except json.JSONDecodeError as e:
        print(f'Error parsing OpenAI response: {e}')
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
    """Try to extract date from URL patterns (e.g., 2025/q4, FY25-Q4)"""
    url_date_match = re.search(r'(\d{4})[/-]q([1-4])|fy(\d{2})[/-]q([1-4])', url.lower())
    if url_date_match:
        groups = url_date_match.groups()
        if groups[0]:  # YYYY-Q format
            year = int(groups[0])
            quarter = int(groups[1])
            # Approximate date to middle of quarter
            fiscal_year_start_month = (fiscal_year_end_month % 12) + 1
            quarter_start_month = fiscal_year_start_month + (quarter - 1) * 3
            return datetime(year, quarter_start_month, 15)
        elif groups[2]:  # FY##-Q format
            year = 2000 + int(groups[2])
            quarter = int(groups[3])
            fiscal_year_start_month = (fiscal_year_end_month % 12) + 1
            quarter_start_month = fiscal_year_start_month + (quarter - 1) * 3
            return datetime(year, quarter_start_month, 15)
    return None

def extract_json_from_llm_response(response_text: str) -> str:
    """Extract JSON from LLM response (handles markdown code blocks)"""
    if '```json' in response_text:
        return response_text.split('```json')[1].split('```')[0].strip()
    elif '```' in response_text:
        return response_text.split('```')[1].split('```')[0].strip()
    return response_text.strip()

def get_openai_model() -> str:
    """Get OpenAI model from env var or return default"""
    return os.getenv('OPENAI_MODEL', 'gpt-4o-mini')

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
    # Check for financial statements
    elif 'financial statement' in title_lower or 'consolidated financial' in title_lower:
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
    ir_urls = load_ir_urls()
    
    if ticker.upper() not in ir_urls:
        print(f'Error: No IR URL configured for {ticker}')
        print(f'Add it to {IR_URLS_FILE}')
        return
    
    ir_url = ir_urls[ticker.upper()]
    print(f'Scanning IR website for {ticker}: {ir_url}')
    
    # Initialize OpenAI client for HTML parsing
    openai_api_key = os.getenv('OPENAI_API_KEY')
    client = None
    if openai_api_key:
        client = OpenAI(api_key=openai_api_key)
    else:
        print('Warning: OPENAI_API_KEY not set. HTML page parsing will be limited.')
    
    # Determine if URL is RSS feed or HTML page
    if 'rss' in ir_url.lower() or ir_url.endswith('.xml') or ir_url.endswith('.rss'):
        releases = parse_rss_feed(ir_url)
    else:
        if client:
            releases = parse_html_page(ir_url, ticker, client, verbose)
        else:
            print('Error: Cannot parse HTML page without OpenAI API key')
            return
    
    if not releases:
        print(f'No releases found for {ticker}')
        return
    
    print(f'Found {len(releases)} potential releases')
    
    # Get fiscal year-end month
    fiscal_year_end_month = get_fiscal_year_end_month(ticker)
    
    # Initialize Firebase
    firebase = FirebaseCache()
    
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
            
            # Use fiscal year/quarter from LLM if provided, otherwise calculate from date
            fiscal_year = release.get('fiscal_year')
            fiscal_quarter = release.get('fiscal_quarter')
            
            # Extract or determine release date (LLM should provide this, fallback to URL patterns)
            release_date = release.get('release_date')
            if not release_date:
                release_date = extract_date_from_url(release['url'], fiscal_year_end_month)
            
            # If LLM provided fiscal year/quarter, use it and calculate approximate date if needed
            if fiscal_year and fiscal_quarter:
                if verbose:
                    print(f'  Using LLM-provided fiscal info: {fiscal_year}Q{fiscal_quarter}')
                
                # If no release date but we have fiscal quarter, estimate date
                if not release_date:
                    # Estimate date to middle of the quarter
                    fiscal_year_start_month = (fiscal_year_end_month % 12) + 1
                    quarter_start_month = fiscal_year_start_month + (fiscal_quarter - 1) * 3
                    # Use the fiscal year (which might be different from calendar year)
                    # For Apple (FY ends Sep), FY2025 Q1 = Oct 2024, so we need to adjust
                    if quarter_start_month > 12:
                        quarter_start_month = quarter_start_month - 12
                        calendar_year = fiscal_year - 1
                    else:
                        calendar_year = fiscal_year
                    release_date = datetime(calendar_year, quarter_start_month, 15)
                    if verbose:
                        print(f'  Estimated release date: {release_date.strftime("%Y-%m-%d")} (from fiscal {fiscal_year}Q{fiscal_quarter})')
            else:
                # Calculate fiscal quarter from date
                if not release_date:
                    if verbose:
                        print(f'  Warning: No release date found, using current date')
                    release_date = datetime.now()
                
                if verbose:
                    print(f'  Release date: {release_date.strftime("%Y-%m-%d")}')
                
                # Determine fiscal quarter from date
                calculated_fiscal_year, calculated_fiscal_quarter = get_fiscal_quarter_from_date(release_date, fiscal_year_end_month)
                if calculated_fiscal_year and calculated_fiscal_quarter:
                    fiscal_year = calculated_fiscal_year
                    fiscal_quarter = calculated_fiscal_quarter
                    if verbose:
                        print(f'  Calculated fiscal quarter: {fiscal_year}Q{fiscal_quarter} (FY ends month {fiscal_year_end_month})')
                else:
                    if verbose:
                        print(f'  Skipped: Could not determine fiscal quarter for date {release_date}')
                    skipped_count += 1
                    continue
            
            # Validate fiscal quarter
            if not fiscal_year or not fiscal_quarter:
                if verbose:
                    print(f'  Skipped: Missing fiscal year or quarter')
                skipped_count += 1
                continue
            
            quarter_key = f"{fiscal_year}Q{fiscal_quarter}"
            
            # Filter by target quarter if specified
            if target_quarter and quarter_key != target_quarter:
                if verbose:
                    print(f'  Skipped: Quarter {quarter_key} does not match target {target_quarter}')
                skipped_count += 1
                continue
            
            # Determine document type (use from OpenAI if available, otherwise infer)
            doc_type = release.get('document_type')
            if not doc_type or doc_type == 'other':
                doc_type = determine_document_type(release['title'], release['url'])
            
            # Create document ID (include URL hash for uniqueness)
            document_id = create_document_id(quarter_key, doc_type, release_date, release['url'])
            
            # Check if document already exists (by URL, which is the most reliable check)
            existing_docs = firebase.get_ir_documents_for_quarter(ticker, quarter_key)
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
                'release_date': release_date.isoformat(),
                'fiscal_year': fiscal_year,
                'fiscal_quarter': fiscal_quarter,
                'quarter_key': quarter_key,
                'url': release['url'],
                'document_type': doc_type
            }
            
            firebase.store_ir_document(ticker, document_id, document_data, content, file_ext, verbose)
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
                        
                        # Use the same release date as the parent document
                        pdf_release_date = release_date
                        if not pdf_release_date:
                            # Try to extract from URL as fallback
                            pdf_release_date = extract_date_from_url(pdf_url, fiscal_year_end_month)
                        if not pdf_release_date:
                            pdf_release_date = datetime.now()
                        
                        # Determine PDF document type
                        pdf_doc_type = 'earnings_release' if 'earnings' in pdf_url.lower() else 'presentation' if 'presentation' in pdf_url.lower() else 'other'
                        
                        # Create PDF document ID
                        pdf_document_id = create_document_id(quarter_key, pdf_doc_type, pdf_release_date, pdf_url)
                        
                        # Store PDF document
                        pdf_document_data = {
                            'ticker': ticker.upper(),
                            'document_id': pdf_document_id,
                            'title': f"{release['title']} - PDF",
                            'release_date': pdf_release_date.isoformat(),
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
    firebase = FirebaseCache()
    
    ticker_upper = ticker.upper()
    
    if quarter_key:
        # List documents for specific quarter
        if not re.match(r'^\d{4}Q[1-4]$', quarter_key):
            print(f'Error: Invalid quarter format. Use YYYYQN (e.g., 2024Q3)')
            return
        
        documents = firebase.get_ir_documents_for_quarter(ticker_upper, quarter_key)
        
        if not documents:
            print(f'No documents found for {ticker_upper} {quarter_key}')
            return
        
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
            docs = firebase.get_ir_documents_for_quarter(ticker_upper, qk)
            all_docs.extend(docs)
        
        if not all_docs:
            print(f'No documents found for {ticker_upper} year {year}')
            return
        
        print(f'\nDocuments for {ticker_upper} year {year}:')
        print('=' * 80)
        for doc in sorted(all_docs, key=lambda x: (x.get('quarter_key', ''), x.get('release_date', ''))):
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
            docs_ref = (firebase.db.collection('tickers')
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
            for qk in sorted(by_quarter.keys()):
                docs = by_quarter[qk]
                print(f'\n{qk} ({len(docs)} document(s)):')
                for doc in sorted(docs, key=lambda x: x.get('release_date', '')):
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

