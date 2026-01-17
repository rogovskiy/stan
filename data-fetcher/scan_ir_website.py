#!/usr/bin/env python3
"""
IR Website Scanner - Orchestrator

Scans IR websites for earnings releases and presentations using the LangGraph crawler,
then downloads and stores them in Firebase using the document processor.

This is the main entry point for the IR document discovery and storage workflow.
"""

import os
import json
import argparse
import sys
import re
import asyncio
import time
from typing import Dict, List, Optional, Set
from dotenv import load_dotenv

from services.ir_url_service import IRURLService
from services.ir_document_service import IRDocumentService
from services.metrics_service import MetricsService
from ir_crawler import IRWebsiteCrawler
from ir_document_processor import IRDocumentProcessor
from browser_pool_manager import BrowserPoolManager

# Load environment variables from .env.local
load_dotenv('.env.local')

# Load IR URLs configuration
# The ir_urls.json file uses arrays of URLs per ticker:
#   "AAPL": ["https://investor.apple.com/...", "https://another-url.com/..."]
IR_URLS_FILE = os.path.join(os.path.dirname(__file__), 'ir_urls.json')

# Browser pool manager will be initialized in main() with headless setting
browser_pool_manager = None


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


async def scan_ir_website_async(ticker: str, target_quarter: Optional[str] = None, verbose: bool = False) -> None:
    """Step 1: Scan IR website using LangGraph crawler and download documents.
    
    Args:
        ticker: Stock ticker symbol
        target_quarter: Optional quarter filter (format: YYYYQN, e.g., '2024Q3')
        verbose: Print verbose output
    """
    # Initialize metrics service and log scan start
    metrics_service = MetricsService()
    scan_start_time = time.time()
    
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
    
    # Log scan start
    metrics_service.log_scan_start(
        ticker=ticker,
        target_quarter=target_quarter,
        max_pages=50,
        num_urls=len(ticker_urls)
    )
    
    if len(ticker_urls) == 1:
        print(f'Scanning IR website for {ticker}: {ticker_urls[0]}')
    else:
        print(f'Scanning {len(ticker_urls)} IR websites for {ticker}:')
        for i, url in enumerate(ticker_urls, 1):
            print(f'  {i}. {url}')
    
    # Initialize services
    ir_document_service = IRDocumentService()
    ir_url_service = IRURLService()
    
    # Get all existing URLs before processing (to skip them in crawler and processor)
    all_existing_docs = ir_document_service.get_all_ir_documents(ticker)
    existing_urls = {doc.get('url') for doc in all_existing_docs if doc.get('url')}
    if existing_urls and verbose:
        print(f'Found {len(existing_urls)} already-downloaded documents in database')
    
    # Initialize crawler and processor with metrics service (sharing browser pool manager)
    crawler = IRWebsiteCrawler(
        browser_pool_manager=browser_pool_manager,
        metrics_service=metrics_service,
        ticker=ticker
    )
    processor = IRDocumentProcessor(
        browser_pool_manager=browser_pool_manager,
        metrics_service=metrics_service
    )
    
    # Collect documents from all URLs
    all_documents = []
    all_detail_urls_visited = []
    
    for ir_url in ticker_urls:
        if verbose:
            print(f'\n{"="*80}')
            print(f'Processing URL: {ir_url}')
            print(f'{"="*80}')
        
        # Get cached detail page URLs for this IR URL (to skip revisiting)
        cached_detail_urls = ir_url_service.get_cached_detail_urls(ticker, ir_url)
        skip_urls = set(cached_detail_urls) | existing_urls  # Skip both cached and already-downloaded
        
        if skip_urls and verbose:
            print(f'Skipping {len(skip_urls)} previously-visited detail pages and existing documents')
        
        try:
            # Run crawler to discover documents
            documents, detail_urls_visited = await crawler.discover_documents(
                start_url=ir_url,
                ticker=ticker,
                skip_urls=skip_urls,
                max_pages=50,
                verbose=verbose
            )
            
            if documents:
                if verbose:
                    print(f'\n✅ Crawler found {len(documents)} documents from {ir_url}')
                all_documents.extend(documents)
            else:
                print(f'No documents found from {ir_url}')
            
            # Cache detail page URLs visited (for future runs)
            if detail_urls_visited:
                all_detail_urls_visited.extend(detail_urls_visited)
                ir_url_service.cache_detail_urls(ticker, ir_url, detail_urls_visited)
                if verbose:
                    print(f'Cached {len(detail_urls_visited)} detail page URLs for future runs')
        
        except Exception as e:
            print(f'Error crawling {ir_url}: {e}')
            if verbose:
                import traceback
                traceback.print_exc()
            continue
    
    if not all_documents:
        print(f'\n❌ No documents discovered for {ticker} from any configured URLs')
        return
    
    # Normalize documents: ensure each has a 'url' field (from pdf_url or page_url)
    for doc in all_documents:
        if 'url' not in doc:
            # Crawler uses 'pdf_url' or 'page_url', we need to normalize to 'url'
            doc['url'] = doc.get('pdf_url') or doc.get('page_url')
    
    # Remove duplicates based on URL (same document might appear on multiple pages)
    seen_urls: Set[str] = set()
    documents = []
    docs_without_url = 0
    for doc in all_documents:
        url = doc.get('url', '')
        if not url:
            docs_without_url += 1
            if verbose:
                print(f'⚠️  Skipping document without URL: {doc.get("title", "unknown")}')
            continue
        if url not in seen_urls:
            seen_urls.add(url)
            documents.append(doc)
    
    if docs_without_url > 0:
        print(f'⚠️  Skipped {docs_without_url} document(s) without URLs')
    
    if len(all_documents) > len(documents) + docs_without_url:
        print(f'Removed {len(all_documents) - len(documents) - docs_without_url} duplicate document(s)')
    
    print(f'\n📦 Total unique documents discovered: {len(documents)}')
    
    # Process and store documents
    print(f'\n{"="*80}')
    print(f'Downloading and storing documents...')
    print(f'{"="*80}\n')
    
    processed_count, skipped_count = await processor.process_documents(
        ticker=ticker,
        documents=documents,
        existing_urls=existing_urls,
        target_quarter=target_quarter,
        verbose=verbose
    )
    
    # Calculate scan duration and log completion
    scan_duration_seconds = time.time() - scan_start_time
    
    # Log scan complete with all metrics
    metrics_service.log_scan_complete(
        ticker=ticker,
        duration_seconds=scan_duration_seconds,
        total_documents=len(documents),
        documents_processed=processed_count,
        documents_skipped=skipped_count,
        total_tokens=crawler.total_tokens,
        prompt_tokens=crawler.total_prompt_tokens,
        response_tokens=crawler.total_response_tokens,
        target_quarter=target_quarter
    )
    
    print(f'\n{"="*80}')
    print(f'✅ Scan complete!')
    print(f'{"="*80}')
    print(f'  📥 Documents stored: {processed_count}')
    print(f'  ⏭️  Documents skipped: {skipped_count}')
    if all_detail_urls_visited:
        print(f'  🔖 Detail pages cached: {len(all_detail_urls_visited)} (for future optimization)')
    print(f'  ⏱️  Duration: {scan_duration_seconds:.1f} seconds')
    print(f'  🔢 Total tokens: {crawler.total_tokens:,}')
    print(f'  💰 Estimated cost: ${(crawler.total_prompt_tokens * 0.075 + crawler.total_response_tokens * 0.30) / 1_000_000:.4f}')
    print(f'  🆔 Execution ID: {metrics_service.get_execution_id()}')


async def scan_ir_website_async_with_cleanup(ticker: str, target_quarter: Optional[str] = None, verbose: bool = False) -> None:
    """Wrapper that ensures browser cleanup."""
    try:
        await scan_ir_website_async(ticker, target_quarter, verbose)
    finally:
        # Cleanup browser resources
        if browser_pool_manager:
            try:
                await browser_pool_manager.close(verbose=verbose)
                if verbose:
                    print('\n🔒 Browser closed')
            except Exception as e:
                if verbose:
                    print(f'\n⚠️  Error closing browser: {e}')


def scan_ir_website(ticker: str, target_quarter: Optional[str] = None, verbose: bool = False) -> None:
    """Synchronous wrapper for scan_ir_website_async."""
    asyncio.run(scan_ir_website_async_with_cleanup(ticker, target_quarter, verbose))


def main():
    global browser_pool_manager
    
    parser = argparse.ArgumentParser(
        description='Scan IR websites and download earnings releases/presentations',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog='''
Examples:
  # Scan and download documents
  python scan_ir_website.py AAPL
  python scan_ir_website.py AAPL --quarter 2024Q3 --verbose
  
  # Debug with visible browser
  python scan_ir_website.py AAPL --no-headless --verbose
        '''
    )
    
    parser.add_argument('ticker', help='Stock ticker symbol (e.g., AAPL, MSFT)')
    parser.add_argument('--quarter', metavar='QUARTER', help='Filter scan to specific quarter (format: YYYYQN)')
    parser.add_argument('--verbose', action='store_true', help='Enable verbose output')
    parser.add_argument('--no-headless', action='store_true', help='Run browser in visible mode (for debugging)')
    
    args = parser.parse_args()
    
    # Initialize browser pool manager with headless setting
    headless = not args.no_headless
    browser_pool_manager = BrowserPoolManager(headless=headless)
    
    if not headless:
        print('🖥️  Running in visible browser mode (debugging)')
    
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
