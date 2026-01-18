#!/usr/bin/env python3
"""
IR Website Crawler using LangGraph and Gemini

A modular, stateful web crawler for investor relations websites with intelligent navigation.

Key Features:
- Intentional navigation (listing pages vs detail pages)
- Skip URL optimization (avoid re-visiting cached pages)
- Gemini-powered document extraction
- Rate limit handling with automatic retry
"""

import os
import json
import asyncio
import tempfile
import time
from typing import TypedDict, List, Dict, Any, Optional, Set, Tuple
from urllib.parse import urljoin
from datetime import datetime
from dotenv import load_dotenv

import google.generativeai as genai
from google.api_core.exceptions import ResourceExhausted, InvalidArgument
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.memory import MemorySaver

from browser_pool_manager import BrowserPoolManager
from extraction_utils import (
    get_gemini_model,
    initialize_gemini_model,
    extract_json_from_llm_response,
    load_prompt_template
)

# Load environment variables
env_path = os.path.join(os.path.dirname(__file__), '.env.local')
load_dotenv(env_path)

# Define the state for our graph
class ScraperState(TypedDict):
    """State that flows through the scraping graph."""
    url: str
    current_page_html: str
    page_title: str
    ticker: str  # Stock ticker for context
    
    # Navigation queues
    listing_pages_queue: List[str]
    detail_pages_queue: List[str]
    
    # Visited tracking
    listing_pages_visited: List[str]
    detail_pages_visited: List[str]
    
    # Skip optimization
    skip_urls: Set[str]  # URLs to skip (cached + existing)
    
    # Results
    documents_found: List[Dict[str, Any]]
    
    # Control
    next_action: str
    error: Optional[str]
    max_pages: int
    verbose: bool
    
    # Context
    _current_listing_url: Optional[str]


class IRWebsiteCrawler:
    """LangGraph-based IR website crawler with intelligent navigation."""
    
    def __init__(self, model_name: str = "gemini-2.5-pro", browser_pool_manager: BrowserPoolManager = None, 
                 ticker: Optional[str] = None, logger=None):
        """Initialize the crawler.
        
        Args:
            model_name: Gemini model to use (defaults to env var or 'gemini-2.5-pro')
            browser_pool_manager: Optional shared BrowserPoolManager instance (creates new one if not provided)
            ticker: Optional ticker for metrics logging
            logger: ContextLogger instance for structured logging (required)
        """
        # Use extraction_utils to get model name and initialize Gemini
        self.model_name = model_name
        
        # Use provided browser manager or create new one
        self.browser_manager = browser_pool_manager or BrowserPoolManager()
        
        # Store ticker
        self.ticker = ticker
        
        # Store the logger
        self.log = logger
        
        # Override with specified model name if provided
        self.model = initialize_gemini_model(model_name, generation_config={
            "max_output_tokens": 65535,
            "temperature": 0.1,
        })
        
        # Token usage tracking
        self.total_prompt_tokens = 0
        self.total_response_tokens = 0
        self.total_tokens = 0
        
        # Build the graph
        self.graph = self._build_graph()
    
    async def _call_gemini_with_retry(self, func, *args, max_retries: int = 5, **kwargs):
        """Wrapper to call Gemini API with automatic retry on 429 rate limits."""
        for attempt in range(max_retries):
            try:
                response = await asyncio.to_thread(func, *args, **kwargs)
                return response
                
            except ResourceExhausted as e:
                retry_delay = 60
                error_str = str(e)
                
                if 'retry_delay' in error_str and 'seconds:' in error_str:
                    try:
                        import re
                        match = re.search(r'seconds:\s*(\d+)', error_str)
                        if match:
                            retry_delay = int(match.group(1))
                    except:
                        pass
                
                if attempt < max_retries - 1:
                    self.log.warning(f"   ⚠️  Rate limit hit (429). Waiting {retry_delay} seconds before retry {attempt + 1}/{max_retries}...")
                    await asyncio.sleep(retry_delay)
                else:
                    self.log.error(f"   ❌ Max retries ({max_retries}) exceeded. Giving up.")
                    raise
            
            except Exception as e:
                raise
    
    def _parse_json_response(self, response_text: str) -> Any:
        """Parse JSON from Gemini response, handling code blocks."""
        # Use extraction_utils helper
        cleaned_text = extract_json_from_llm_response(response_text)
        return json.loads(cleaned_text)
    
    async def _upload_html_to_gemini(self, html_content: str) -> Tuple[Any, str]:
        """Upload HTML content to Gemini as a temporary file."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.html', delete=False, encoding='utf-8') as f:
            f.write(html_content)
            temp_path = f.name
        
        html_file = await asyncio.to_thread(
            genai.upload_file,
            temp_path,
            mime_type='text/html'
        )
        
        return html_file, temp_path
    
    async def _cleanup_gemini_file(self, file_obj: Any, temp_path: str):
        """Clean up temporary file and Gemini uploaded file."""
        try:
            if os.path.exists(temp_path):
                os.unlink(temp_path)
        except:
            pass
        
        try:
            await asyncio.to_thread(genai.delete_file, file_obj.name)
        except:
            pass
    
    def _build_graph(self) -> StateGraph:
        """Build the LangGraph workflow."""
        workflow = StateGraph(ScraperState)
        
        workflow.add_node("navigate_listing", self._navigate_listing_node)
        workflow.add_node("process_listing", self._process_listing_node)
        workflow.add_node("process_all_details", self._process_all_details_batch)
        workflow.add_node("decide_next", self._decide_next_listing_node)
        
        workflow.set_entry_point("navigate_listing")
        
        workflow.add_edge("navigate_listing", "process_listing")
        workflow.add_edge("process_listing", "process_all_details")
        workflow.add_edge("process_all_details", "decide_next")
        
        workflow.add_conditional_edges(
            "decide_next",
            self._route_decision,
            {
                "next_listing": "navigate_listing",
                "finish": END,
            }
        )
        
        memory = MemorySaver()
        return workflow.compile(checkpointer=memory)
    
    async def _navigate_listing_node(self, state: ScraperState) -> ScraperState:
        """Navigate to a listing page."""
        if state['verbose']:
            self.log.info(f"📋 Navigating to LISTING page: {state['url'][:80]}...", 
                         page_type='listing', url=state['url'])
        
        try:
            html_content = await self.browser_manager.get_html(state['url'], wait_time=30, verbose=False)
            
            if html_content is None:
                raise Exception("Failed to load page")
            
            title = await self.browser_manager.get_title(verbose=False)
            
            state['current_page_html'] = html_content
            state['page_title'] = title or "Untitled"
            
            if state['url'] not in state['listing_pages_visited']:
                state['listing_pages_visited'].append(state['url'])
            
            if state['verbose']:
                self.log.info(f"✅ Loaded: {title[:70] if title else 'Untitled'}", 
                            page_title=title, url=state['url'])
            
        except Exception as e:
            error_msg = str(e)
            self.log.error(f"❌ Navigation error: {error_msg}", 
                          url=state['url'], error=error_msg)
            
            # Check for critical browser errors that should fail immediately
            critical_errors = [
                'Target page, context or browser has been closed',
                'Browser has been closed',
                'Context has been closed',
                'launch_persistent_context',
                'Chromium sandboxing failed',
                'Browser pool',
                'Browser type',
            ]
            
            is_critical = any(critical_err in error_msg for critical_err in critical_errors)
            
            if is_critical:
                # Critical browser infrastructure error - raise immediately
                raise RuntimeError(f"Critical browser error - cannot continue: {error_msg}") from e
            
            # Non-critical error - mark for finishing this run
            state['error'] = error_msg
            state['next_action'] = 'finish'
        
        return state
    
    async def _extract_document_from_detail_page(self, url: str, html: str, title: str, verbose: bool = False) -> Optional[Dict[str, Any]]:
        """Extract document information from a detail page using Gemini."""
        start_time = time.time()
        try:
            html_file, html_file_path = await self._upload_html_to_gemini(html)
            
            try:
                # Load prompt template
                prompt = load_prompt_template(
                    'ir_detail_page_extraction_prompt.txt',
                    page_title=title,
                    page_url=url
                )
                
                response = await self._call_gemini_with_retry(
                    self.model.generate_content,
                    [prompt, html_file],
                    generation_config=genai.types.GenerationConfig(
                        max_output_tokens=65535,
                        temperature=0.1,
                    )
                )
                
                if hasattr(response, 'usage_metadata'):
                    usage = response.usage_metadata
                    self.total_prompt_tokens += usage.prompt_token_count
                    self.total_response_tokens += usage.candidates_token_count
                    self.total_tokens += usage.total_token_count
                    
                    # Log metrics for this API call
                    duration_ms = (time.time() - start_time) * 1000
                    url_truncated = url[:200] if url else None
                    self.log.info('Metric: gemini_api_call',
                        operation_type='gemini_api_call',
                        operation='detail_page_extraction',
                        url=url_truncated,
                        prompt_tokens=usage.prompt_token_count,
                        response_tokens=usage.candidates_token_count,
                        total_tokens=usage.total_token_count,
                        duration_ms=duration_ms
                    )
                
                doc_info = self._parse_json_response(response.text)
                
                # Filter out consolidated financial statements
                if 'consolidated financial' in doc_info.get('title', '').lower():
                    if verbose:
                        self.log.info("      ⏭️  Skipping consolidated financial statement")
                    return None
                
                pdf_url = doc_info.get('pdf_url')
                if pdf_url:
                    if not pdf_url.startswith('http'):
                        pdf_url = urljoin(url, pdf_url)
                    doc_url = pdf_url
                    url_type = 'pdf_url'
                elif doc_info.get('is_financial_statement') and doc_info.get('fiscal_year'):
                    doc_url = url
                    url_type = 'page_url'
                else:
                    return None
                
                doc = {
                    'title': doc_info.get('title', title),
                    'category': doc_info.get('category', 'unknown'),
                    'fiscal_year': doc_info.get('fiscal_year'),
                    'fiscal_quarter': doc_info.get('fiscal_quarter'),
                    'detail_page_url': url,
                    'extraction_method': 'details_page'
                }
                
                if url_type == 'pdf_url':
                    doc['pdf_url'] = doc_url
                else:
                    doc['page_url'] = doc_url
                
                return doc
                
            finally:
                await self._cleanup_gemini_file(html_file, html_file_path)
                    
        except InvalidArgument as e:
            if "token count exceeds" in str(e) or "1048576" in str(e):
                if verbose:
                    self.log.warning("      ⚠️  Page HTML too large (exceeds 1M token limit)")
                return None
            raise
        
        except json.JSONDecodeError as e:
            if verbose:
                self.log.error(f"      ❌ JSON parsing error: {e.msg}")
            return None
            
        except Exception as e:
            if verbose:
                self.log.warning(f"      ⚠️ Error extracting document: {e}")
            return None
    
    async def _process_listing_node(self, state: ScraperState) -> ScraperState:
        """Process a listing page: use LLM to extract structured document info and identify listing pages."""
        if state['verbose']:
            self.log.info("📋 Processing LISTING page...")
        
        start_time = time.time()
        try:
            if state['url'] not in state['listing_pages_visited']:
                state['listing_pages_visited'].append(state['url'])
            
            state['_current_listing_url'] = state['url']
            
            if state['verbose']:
                self.log.info("   🤖 Analyzing page HTML with Gemini (as file attachment)...")
            
            html_file, html_file_path = await self._upload_html_to_gemini(state['current_page_html'])
            
            if state['verbose']:
                self.log.info(f"      ✅ Uploaded HTML file: {html_file.name}")
            
            try:
                # Load prompt template
                prompt = load_prompt_template(
                    'ir_listing_page_extraction_prompt.txt',
                    page_title=state['page_title'],
                    page_url=state['url']
                )
                
                if state['verbose']:
                    self.log.info(f"      🤖 Model: {self.model_name}")
                    self.log.info(f"      ⚙️  Config: max_output_tokens={65535}, temperature={0.1}")
                
                response = await self._call_gemini_with_retry(
                    self.model.generate_content,
                    [prompt, html_file],
                    generation_config=genai.types.GenerationConfig(
                        max_output_tokens=65535,
                        temperature=0.1,
                    )
                )
                
                if state['verbose']:
                    self.log.info(f"      ✅ Response received: {len(response.text)} chars")
                
                if hasattr(response, 'usage_metadata'):
                    usage = response.usage_metadata
                    if state['verbose']:
                        self.log.info(f"      📊 Tokens: {usage.prompt_token_count} prompt + {usage.candidates_token_count} response = {usage.total_token_count} total")
                    
                    self.total_prompt_tokens += usage.prompt_token_count
                    self.total_response_tokens += usage.candidates_token_count
                    self.total_tokens += usage.total_token_count
                    
                    # Log metrics for this API call
                    duration_ms = (time.time() - start_time) * 1000
                    url_truncated = state['url'][:200] if state['url'] else None
                    self.log.info('Metric: gemini_api_call',
                        operation_type='gemini_api_call',
                        operation='listing_page_extraction',
                        url=url_truncated,
                        prompt_tokens=usage.prompt_token_count,
                        response_tokens=usage.candidates_token_count,
                        total_tokens=usage.total_token_count,
                        duration_ms=duration_ms
                    )
                    
                    if usage.candidates_token_count >= 8190 and state['verbose']:
                        self.log.warning("      ⚠️  WARNING: Hit ~8,192 token output limit! (not a problem for pro models)")
                
                try:
                    analysis = self._parse_json_response(response.text)
                except json.JSONDecodeError as e:
                    error_doc = e.doc if hasattr(e, 'doc') else response.text
                    
                    if state['verbose']:
                        self.log.error(f"   ❌ JSON parsing error at position {e.pos}: {e.msg}")
                        self.log.error(f"   📝 Response length: {len(error_doc)} characters")
                        
                        start_pos = max(0, e.pos - 100)
                        end_pos = min(len(error_doc), e.pos + 100)
                        self.log.error(f"   📝 Error context: ...{error_doc[start_pos:end_pos]}...")
                        
                        failed_file = f"/tmp/gemini_failed_listing_{int(datetime.now().timestamp())}.json"
                        with open(failed_file, 'w', encoding='utf-8') as f:
                            f.write(error_doc)
                        self.log.error(f"   💾 Saved broken JSON to: {failed_file}")
                    
                    analysis = {'documents': [], 'listing_pages': []}
                
                documents = analysis.get('documents', [])
                listing_pages = analysis.get('listing_pages', [])
                
                if state['verbose']:
                    self.log.info(f"   ✅ LLM found {len(documents)} documents and {len(listing_pages)} pagination links")
                
            finally:
                await self._cleanup_gemini_file(html_file, html_file_path)
            
            direct_pdfs = 0
            detail_pages = 0
            skipped_cached = 0
            
            for doc in documents:
                doc_url = doc['url']
                if not doc_url.startswith('http'):
                    doc_url = urljoin(state['url'], doc_url)
                    doc['url'] = doc_url
                
                # Filter out consolidated financial statements
                if 'consolidated financial' in doc.get('title', '').lower():
                    continue
                
                if doc_url in state['listing_pages_visited'] or doc_url in state['detail_pages_visited']:
                    continue
                
                if doc['link_type'] == 'pdf_download':
                    # Direct PDF - save immediately
                    doc_info = {
                        'title': doc['title'],
                        'category': doc.get('category', 'unknown'),
                        'pdf_url': doc_url,
                        'fiscal_year': doc.get('fiscal_year'),
                        'fiscal_quarter': doc.get('fiscal_quarter'),
                        'source_listing': state['url'],
                        'discovered_at': datetime.now().isoformat(),
                        'extraction_method': 'direct_link'
                    }
                    
                    if not any(d.get('pdf_url') == doc_info['pdf_url'] for d in state['documents_found']):
                        state['documents_found'].append(doc_info)
                        direct_pdfs += 1
                
                elif doc['link_type'] == 'details_page':
                    # Check skip_urls BEFORE adding to queue
                    if doc_url in state['skip_urls']:
                        skipped_cached += 1
                        continue
                    
                    if doc_url not in state['detail_pages_queue']:
                        state['detail_pages_queue'].append(doc_url)
                        detail_pages += 1
            
            # ALWAYS add pagination listing pages (never skip them)
            for listing in listing_pages:
                listing_url = listing['url']
                if not listing_url.startswith('http'):
                    listing_url = urljoin(state['url'], listing_url)
                    listing['url'] = listing_url
                
                if listing_url not in state['listing_pages_queue'] and listing_url not in state['listing_pages_visited']:
                    state['listing_pages_queue'].append(listing_url)
            
            if state['verbose']:
                self.log.info(f"   ✅ Direct PDFs: {direct_pdfs}")
                self.log.info(f"   ✅ Detail pages to visit: {detail_pages}")
                if skipped_cached > 0:
                    self.log.info(f"   ⏭️  Skipped {skipped_cached} cached detail pages")
                self.log.info(f"   ✅ Pagination links found: {len(listing_pages)}")
                
                if listing_pages:
                    self.log.info("      Pagination:")
                    for i, listing in enumerate(listing_pages[:5], 1):
                        purpose = listing.get('purpose', 'No description')
                        self.log.info(f"        {i}. {listing['title'][:40]} - {purpose[:40]}")
                    if len(listing_pages) > 5:
                        self.log.info(f"        ... and {len(listing_pages) - 5} more")
                
                self.log.info(f"   📦 Total documents so far: {len(state['documents_found'])}")
                
                if documents and direct_pdfs > 0:
                    self.log.info("      Sample documents:")
                    for i, doc in enumerate([d for d in documents if d['link_type'] == 'pdf_download'][:3], 1):
                        year_qtr = f"{doc.get('fiscal_quarter', '')} {doc.get('fiscal_year', '')}".strip()
                        category = doc.get('category', 'unknown')
                        self.log.info(f"        {i}. [{category}] {doc['title'][:50]} ({year_qtr})")
            
        except InvalidArgument as e:
            if "token count exceeds" in str(e) or "1048576" in str(e):
                if state['verbose']:
                    self.log.warning("   ⚠️  Page HTML too large (exceeds 1M token limit)")
                    self.log.warning(f"   ⏭️  Skipping this listing page: {state['url']}")
            else:
                self.log.warning(f"   ⚠️ Listing processing error: {e}", exc_info=True)
        
        except Exception as e:
            self.log.warning(f"   ⚠️ Listing processing error: {e}", exc_info=True)
        
        return state
    
    async def _process_all_details_batch(self, state: ScraperState) -> ScraperState:
        """Batch process ALL detail pages from the current listing."""
        detail_pages = state['detail_pages_queue'].copy()
        
        if not detail_pages:
            if state['verbose']:
                self.log.info("📦 No detail pages to process")
            state['detail_pages_queue'] = []
            return state
        
        total_visited = len(state['listing_pages_visited']) + len(state['detail_pages_visited'])
        
        if state['verbose']:
            self.log.info(f"📦 Batch processing {len(detail_pages)} detail pages...")
        
        for i, detail_url in enumerate(detail_pages, 1):
            if total_visited >= state['max_pages']:
                remaining = len(detail_pages) - i + 1
                if state['verbose']:
                    self.log.info(f"   🛑 Hit page limit, stopping batch ({remaining} pages not visited)")
                break
            
            if detail_url in state['detail_pages_visited']:
                continue
            
            if state['verbose']:
                self.log.info(f"📄 Detail page {i}/{len(detail_pages)}: {detail_url[:70]}...")
            
            try:
                html = await self.browser_manager.get_html(detail_url, wait_time=30, verbose=False)
                if html is None:
                    if state['verbose']:
                        self.log.error("   ❌ Failed to load page")
                    continue
                
                title = await self.browser_manager.get_title(verbose=False)
                if state['verbose']:
                    self.log.info(f"   ✅ Loaded: {title[:60] if title else 'Untitled'}")
                
                state['detail_pages_visited'].append(detail_url)
                total_visited += 1
                
                if state['verbose']:
                    self.log.info("   🤖 Extracting document with Gemini...")
                doc = await self._extract_document_from_detail_page(detail_url, html, title or "Untitled", state['verbose'])
                
                if doc:
                    is_duplicate = any(
                        (d.get('pdf_url') == doc.get('pdf_url') and doc.get('pdf_url')) or 
                        (d.get('page_url') == doc.get('page_url') and doc.get('page_url'))
                        for d in state['documents_found']
                    )
                    
                    if not is_duplicate:
                        doc['source_listing'] = state.get('_current_listing_url')
                        doc['discovered_at'] = datetime.now().isoformat()
                        
                        state['documents_found'].append(doc)
                        if state['verbose']:
                            self.log.info(f"   ✅ Saved: {doc['title'][:50]}")
                            
                            fiscal_info = []
                            if doc.get('fiscal_quarter'):
                                fiscal_info.append(doc['fiscal_quarter'])
                            if doc.get('fiscal_year'):
                                fiscal_info.append(str(doc['fiscal_year']))
                            if fiscal_info:
                                self.log.info(f"      Fiscal Period: {' '.join(fiscal_info)}")
                            
                            if doc.get('pdf_url'):
                                self.log.info(f"      PDF: {doc['pdf_url'][:60]}...")
                            elif doc.get('page_url'):
                                self.log.info(f"      Page URL: {doc['page_url'][:60]}...")
                    else:
                        if state['verbose']:
                            self.log.info("   ⏭️  Duplicate, skipping")
                else:
                    if state['verbose']:
                        self.log.warning("   ⚠️  No document found on this page")
                    
            except Exception as e:
                if state['verbose']:
                    self.log.warning(f"   ⚠️ Error processing detail page: {e}")
        
        state['detail_pages_queue'] = []
        
        if state['verbose']:
            self.log.info(f"✅ Batch complete: processed {len(state['detail_pages_visited'])} detail pages total")
        
        return state
    
    async def _decide_next_listing_node(self, state: ScraperState) -> ScraperState:
        """Decide what listing page to visit next."""
        if state['verbose']:
            self.log.info("🤔 Deciding next action...")
        
        listings_pending = len(state['listing_pages_queue'])
        if state['verbose']:
            self.log.info(f"   📊 Listing pages remaining: {listings_pending}")
        
        total_visited = len(state['listing_pages_visited']) + len(state['detail_pages_visited'])
        if state['verbose']:
            self.log.info(f"   📊 Pages visited so far: {total_visited}/{state['max_pages']}")
        
        if total_visited >= state['max_pages']:
            if state['verbose']:
                self.log.info(f"   🛑 Reached max pages limit ({state['max_pages']})")
                if listings_pending > 0:
                    self.log.warning(f"   ⚠️  Stopped with {listings_pending} listings still queued")
            state['next_action'] = 'finish'
            return state
        
        if state['listing_pages_queue']:
            next_listing = state['listing_pages_queue'].pop(0)
            
            if next_listing in state['listing_pages_visited']:
                if state['verbose']:
                    self.log.info("   ⏭️  Skipping already visited listing")
                return await self._decide_next_listing_node(state)
            
            state['url'] = next_listing
            state['next_action'] = 'next_listing'
            if state['verbose']:
                self.log.info("   ➡️  Next: LISTING page")
                self.log.info(f"      {next_listing[:80]}")
            return state
        
        if state['verbose']:
            self.log.info("   ✅ No more listing pages to visit")
        state['next_action'] = 'finish'
        return state
    
    def _route_decision(self, state: ScraperState) -> str:
        """Route based on the decision made."""
        return state['next_action']
    
    async def discover_documents(
        self, 
        start_url: str, 
        ticker: str,
        skip_urls: Set[str] = None,
        max_pages: int = 50,
        verbose: bool = False
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        """Crawl IR website and return discovered documents.
        
        Args:
            start_url: Starting URL to crawl
            ticker: Stock ticker (for context in Gemini prompts)
            skip_urls: Set of URLs to skip (cached detail pages + existing docs)
            max_pages: Maximum pages to visit
            verbose: Print progress (logging handled internally)
        
        Returns tuple of:
            (documents, visited_detail_urls)
            
        Where:
            - documents: List of discovered financial documents
            - visited_detail_urls: List of detail page URLs visited (for caching)
        """
        if verbose:
            self.log.info("🚀 Starting IR Website Crawler", 
                         start_url=start_url, 
                         max_pages=max_pages,
                         skip_urls_count=len(skip_urls) if skip_urls else 0)
        
        initial_state = ScraperState(
            url=start_url,
            current_page_html="",
            page_title="",
            ticker=ticker,
            listing_pages_queue=[],
            detail_pages_queue=[],
            listing_pages_visited=[],
            detail_pages_visited=[],
            skip_urls=skip_urls or set(),
            documents_found=[],
            next_action="next_listing",
            error=None,
            max_pages=max_pages,
            verbose=verbose,
            _current_listing_url=None
        )
        
        try:
            config = {
                "configurable": {"thread_id": f"scraping_{ticker}_{int(datetime.now().timestamp())}"},
                "recursion_limit": 50
            }
            final_state = await self.graph.ainvoke(initial_state, config)
            
            documents = final_state['documents_found']
            visited_detail_urls = final_state['detail_pages_visited']
            
            if verbose:
                direct_pdfs = sum(1 for d in documents if d.get('extraction_method') == 'direct_link')
                from_details = sum(1 for d in documents if d.get('extraction_method') == 'details_page')
                
                self.log.info("✅ Crawling Complete!", 
                             listing_pages=len(final_state['listing_pages_visited']),
                             detail_pages=len(visited_detail_urls),
                             documents_found=len(documents),
                             direct_pdfs=direct_pdfs,
                             from_details=from_details,
                             prompt_tokens=self.total_prompt_tokens,
                             response_tokens=self.total_response_tokens,
                             total_tokens=self.total_tokens)
                
                unvisited_details = len(final_state['detail_pages_queue'])
                unvisited_listings = len(final_state['listing_pages_queue'])
                if unvisited_details > 0 or unvisited_listings > 0:
                    self.log.warning(f"⚠️  Unvisited pages (increase max_pages to visit more)",
                                   unvisited_details=unvisited_details,
                                   unvisited_listings=unvisited_listings)
            
            return (documents, visited_detail_urls)
            
        except Exception as e:
            self.log.error(f"❌ Crawling failed: {e}", exc_info=True, start_url=start_url)
            import traceback
            traceback.print_exc()
            return ([], [])
        
        # Note: Don't close browser here - it's shared with the document processor
        # The orchestrator (scan_ir_website.py) is responsible for browser lifecycle

