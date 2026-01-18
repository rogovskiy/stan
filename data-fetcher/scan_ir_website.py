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

from cloud_logging_setup import ContextLogger, get_logger
from services.ir_url_service import IRURLService
from services.ir_document_service import IRDocumentService
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


def load_ir_urls(logger) -> Dict[str, List[str]]:
    """Load IR URLs from configuration file.
    
    Returns a dictionary where each ticker maps to a list of URL strings.
    """
    try:
        with open(IR_URLS_FILE, 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        logger.warning(f'{IR_URLS_FILE} not found. Create it with IR URLs per ticker.')
        return {}
    except json.JSONDecodeError as e:
        logger.error(f'Error parsing {IR_URLS_FILE}: {e}')
        return {}


def get_ir_urls_for_ticker(ticker: str, logger) -> List[str]:
    """Get list of IR URLs for a ticker. Checks Firebase first, then falls back to JSON config.
    
    Args:
        ticker: Stock ticker symbol
        
    Returns:
        List of URLs for the ticker (from Firebase if available, otherwise from JSON)
    """
    ir_urls = load_ir_urls(logger)
    
    # Initialize Firebase service to get URLs from Firebase
    ir_url_service = IRURLService()

    ticker_upper = ticker.upper()
    
    # First, try to get URLs from Firebase (priority)
    firebase_urls = ir_url_service.get_ir_urls(ticker)
    if firebase_urls:
        urls = []
        for url_data in firebase_urls:
            url = url_data.get('url')
            if url:
                urls.append(url)
        if urls:
            return urls
    
    # Fallback to JSON config if Firebase has no URLs
    if ticker_upper in ir_urls:
        urls = ir_urls[ticker_upper]
        if isinstance(urls, list):
            return urls
    
    return []

async def scan_ir_website_async(ticker: str, target_quarter: Optional[str], verbose: bool, logger: ContextLogger) -> None:
    """Step 1: Scan IR website using LangGraph crawler and download documents.
    
    Args:
        ticker: Stock ticker symbol
        target_quarter: Optional quarter filter (format: YYYYQN, e.g., '2024Q3')
        verbose: Print verbose output
        logger: ContextLogger instance for structured logging
    """
    
    # Use the passed logger
    log = logger
    
    scan_start_time = time.time()
    
    # Validate quarter format if provided
    if target_quarter and not re.match(r'^\d{4}Q[1-4]$', target_quarter):
        logger.error(f'Invalid quarter format: {target_quarter}. Use YYYYQN (e.g., 2024Q2)')
        return
    
    # Get all URLs for this ticker (from Firebase first, then JSON fallback)
    ticker_urls = get_ir_urls_for_ticker(ticker, logger)
    
    if not ticker_urls:
        logger.error(f'No IR URL configured for {ticker}')
        logger.error(f'Add it to {IR_URLS_FILE} or Firebase (tickers/{ticker}/ir_urls)')
        return
    
    # Log scan start
    logger.info('Metric: scan_start', operation_type='scan_start', target_quarter=target_quarter, max_pages=50, num_urls=len(ticker_urls))
    
    if len(ticker_urls) == 1:
        logger.info(f'Scanning IR website for {ticker}: {ticker_urls[0]}')
    else:
        logger.info(f'Scanning {len(ticker_urls)} IR websites for {ticker}:')
        for i, url in enumerate(ticker_urls, 1):
            logger.info(f'  {i}. {url}')
    
    # Initialize services
    ir_document_service = IRDocumentService(logger=logger)
    ir_url_service = IRURLService()
    # Initialize crawler and processor (sharing browser pool manager)
    crawler = IRWebsiteCrawler(
        browser_pool_manager=browser_pool_manager,
        ticker=ticker,
        logger=logger
    )
    processor = IRDocumentProcessor(
        browser_pool_manager=browser_pool_manager,
        logger=logger
    )

    # Get all IR URLs from Firebase to check if they've been scanned before
    firebase_ir_urls = ir_url_service.get_ir_urls(ticker)
    url_scan_history = {url_data['url']: url_data.get('last_scanned') for url_data in firebase_ir_urls}
    
    # Get all existing URLs before processing (to skip them in crawler and processor)
    all_existing_docs = ir_document_service.get_all_ir_documents(ticker)
    existing_urls = {doc.get('url') for doc in all_existing_docs if doc.get('url')}
    if existing_urls and verbose:
        logger.info(f'Found {len(existing_urls)} already-downloaded documents in database')
    
    # Collect documents from all URLs
    all_documents = []
    all_detail_urls_visited = []
    
    for ir_url in ticker_urls:
        # Determine scan_type: "new" if never scanned, "update" if scanned before
        scan_type = "new" if not url_scan_history.get(ir_url) else "update"
        
        # Set scan_type in environment for logging context
        logger.set_scan_type(scan_type)
        
        if verbose:
            logger.info(f'Processing URL: {ir_url}')
            logger.info(f'Scan type: {scan_type}')
        
        # Get cached detail page URLs for this IR URL (to skip revisiting)
        cached_detail_urls = ir_url_service.get_cached_detail_urls(ticker, ir_url)
        skip_urls = set(cached_detail_urls) | existing_urls  # Skip both cached and already-downloaded
        
        if skip_urls and verbose:
            logger.info(f'Skipping {len(skip_urls)} previously-visited detail pages and existing documents')
        
        try:
            # Run crawler to discover documents
            documents, detail_urls_visited = await crawler.discover_documents(
                start_url=ir_url,
                ticker=ticker,
                skip_urls=skip_urls,
                max_pages=50,
                verbose=verbose
            )
            
            # Count how many NEW documents (not already in database) were found
            new_docs_count = 0
            for doc in documents:
                doc_url = doc.get('pdf_url') or doc.get('page_url')
                if doc_url and doc_url not in existing_urls:
                    new_docs_count += 1
            
            # Update scan tracking immediately for this URL
            ir_url_service.update_scan_result(
                ticker=ticker,
                url=ir_url,
                documents_found_count=new_docs_count
            )
            
            if documents:
                if verbose:
                    logger.info(f'\n✅ Crawler found {len(documents)} documents from {ir_url}')
                    if new_docs_count > 0:
                        logger.info(f'   📝 {new_docs_count} are new (not in database)')
                all_documents.extend(documents)
            else:
                logger.info(f'No documents found from {ir_url}')
            
            # Cache detail page URLs visited (for future runs)
            if detail_urls_visited:
                all_detail_urls_visited.extend(detail_urls_visited)
                ir_url_service.cache_detail_urls(ticker, ir_url, detail_urls_visited)
                if verbose:
                    logger.info(f'Cached {len(detail_urls_visited)} detail page URLs for future runs')
        
        except RuntimeError as e:
            # Critical error (e.g., browser failure) - re-raise to stop processing
            logger.critical(f'💥 CRITICAL ERROR crawling {ir_url}: {e}')
            logger.critical(f'Cannot continue - browser infrastructure failure')
            raise
        
        except Exception as e:
            # Non-critical error - log and continue with next URL
            logger.error(f'Error crawling {ir_url}: {e}', exc_info=verbose)
            # Still update scan timestamp even on error
            ir_url_service.update_scan_result(
                ticker=ticker,
                url=ir_url,
                documents_found_count=0
            )
            continue
    
    if not all_documents:
        logger.warning(f'❌ No documents discovered for {ticker} from any configured URLs')
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
                logger.warning(f'⚠️  Skipping document without URL: {doc.get("title", "unknown")}')
            continue
        if url not in seen_urls:
            seen_urls.add(url)
            documents.append(doc)
    
    if docs_without_url > 0:
        logger.warning(f'⚠️  Skipped {docs_without_url} document(s) without URLs')
    
    if len(all_documents) > len(documents) + docs_without_url:
        logger.info(f'Removed {len(all_documents) - len(documents) - docs_without_url} duplicate document(s)')
    
    logger.info(f'📦 Total unique documents discovered: {len(documents)}')
    
    # Process and store documents
    logger.info(f'Downloading and storing documents...')
    
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
    estimated_cost_usd = (crawler.total_prompt_tokens * 0.075 + crawler.total_response_tokens * 0.30) / 1_000_000
    logger.info('Metric: scan_complete',
        operation_type='scan_complete',
        duration_seconds=scan_duration_seconds,
        total_documents=len(documents),
        documents_processed=processed_count,
        documents_skipped=skipped_count,
        total_tokens=crawler.total_tokens,
        prompt_tokens=crawler.total_prompt_tokens,
        response_tokens=crawler.total_response_tokens,
        target_quarter=target_quarter,
        estimated_cost_usd=estimated_cost_usd
    )
    
    logger.info(f'✅ Scan complete!')
    logger.info(f'  📥 Documents stored: {processed_count}')
    logger.info(f'  ⏭️  Documents skipped: {skipped_count}')
    if all_detail_urls_visited:
        logger.info(f'  🔖 Detail pages cached: {len(all_detail_urls_visited)} (for future optimization)')
    logger.info(f'  ⏱️  Duration: {scan_duration_seconds:.1f} seconds')
    logger.info(f'  🔢 Total tokens: {crawler.total_tokens:,}')


async def scan_ir_website_async_with_cleanup(ticker: str, target_quarter: Optional[str], verbose: bool, logger) -> None:
    """Wrapper that ensures browser cleanup."""
    
    try:
        await scan_ir_website_async(ticker, target_quarter, verbose, logger)
    finally:
        # Cleanup browser resources
        if browser_pool_manager:
            try:
                await browser_pool_manager.close(verbose=verbose)
                if verbose:
                    logger.info('🔒 Browser closed')
            except Exception as e:
                if verbose:
                    logger.warning(f'⚠️  Error closing browser: {e}')


def scan_ir_website(ticker: str, target_quarter: Optional[str], verbose: bool, logger) -> None:
    """Synchronous wrapper for scan_ir_website_async."""
    asyncio.run(scan_ir_website_async_with_cleanup(ticker, target_quarter, verbose, logger))


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
    
    # Create logger for CLI usage
    cli_logger = get_logger(__name__, ticker=args.ticker.upper())
    
    # Initialize browser pool manager with headless setting
    headless = not args.no_headless
    browser_pool_manager = BrowserPoolManager(headless=headless)
    
    if not headless:
        cli_logger.info('🖥️  Running in visible browser mode (debugging)')
    
    # Validate quarter format if provided
    if args.quarter and not re.match(r'^\d{4}Q[1-4]$', args.quarter):
        parser.error(f'Invalid quarter format: {args.quarter}. Use YYYYQN (e.g., 2024Q2)')
    
    try:
        scan_ir_website(args.ticker.upper(), args.quarter, args.verbose, cli_logger)
    
    except KeyboardInterrupt:
        cli_logger.info('\n\nInterrupted by user')
        sys.exit(1)
    except Exception as e:
        cli_logger.error(f'Error: {e}', exc_info=args.verbose)
        sys.exit(1)


if __name__ == '__main__':
    main()
