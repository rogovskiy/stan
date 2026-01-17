#!/usr/bin/env python3
"""
Browser Pool Manager

Stateful browsing engine that maintains a single browser context/page for web scraping operations.
"""

import os
import asyncio
import threading
import tempfile
from typing import Optional
from datetime import datetime
from playwright.async_api import TimeoutError as PlaywrightTimeoutError
from crawlee.crawlers import PlaywrightCrawler

# Global event loop management (for running async Crawlee operations from sync code)
_event_loop = None
_event_loop_thread = None
_event_loop_ready = False


class BrowserPoolManager:
    """Stateful browsing engine that maintains a single browser context/page using Crawlee's browser infrastructure."""
    
    def __init__(self, headless: bool = True):
        """Initialize the browser pool manager.
        
        Args:
            headless: Whether to run browser in headless mode (default: True)
        """
        # Create Crawlee crawler for browser infrastructure
        self._crawler = PlaywrightCrawler(
            headless=headless,
            browser_type='chromium',
            max_request_retries=0,  # We handle retries ourselves
        )
        # Browser/context/page will be lazily initialized on first use
        self._browser = None
        self._context = None
        self._page = None
        # Keep browser pool context active
        self._browser_pool_context = None

    async def _ensure_browser_initialized(self, verbose: bool = False):
        """Lazy initialization of browser, context, and page using Crawlee's browser launcher."""
        # Check if page is still valid
        if self._page is not None:
            try:
                # Try to access a property to see if page is still valid
                _ = self._page.url
                if not self._page.is_closed():
                    return
            except:
                # Page is invalid, reset it
                self._page = None
                self._context = None
                self._browser = None
        
        if verbose:
            print('Initializing browser using Crawlee...')
        
        # Get page from Crawlee's browser pool - must be 100% through Crawlee
        if self._page is None:
            # Access Crawlee's browser pool directly
            if not hasattr(self._crawler, '_browser_pool'):
                raise RuntimeError("Crawlee browser pool not available - crawler may not be properly initialized")
            
            browser_pool = self._crawler._browser_pool
            if not browser_pool:
                raise RuntimeError("Crawlee browser pool is None - crawler may not be properly initialized")
            
            # Use Crawlee's browser pool to get a new page
            # This is 100% through Crawlee - we're using Crawlee's browser pool method
            if verbose:
                print('Getting page through Crawlee browser pool...')
            
            # Use Crawlee's new_page method within the browser pool's async context
            # This ensures we're using Crawlee's browser infrastructure
            # The page comes with its own browser and context managed by Crawlee
            # We need to keep the context active, so we enter it and store it
            if self._browser_pool_context is None:
                self._browser_pool_context = browser_pool
                await self._browser_pool_context.__aenter__()
            
            page_controller = await browser_pool.new_page()
            
            # Extract the actual Playwright page from the controller
            # The page controller wraps the Playwright page
            if hasattr(page_controller, 'page'):
                self._page = page_controller.page
            elif hasattr(page_controller, '_page'):
                self._page = page_controller._page
            else:
                # If the controller itself is the page, use it directly
                self._page = page_controller
            
            # Get browser and context from the page for reference
            if self._page:
                self._context = self._page.context
                self._browser = self._context.browser
            
            if verbose:
                print('Page obtained through Crawlee browser pool')
        
        if verbose:
            print('Browser initialized using Crawlee infrastructure')
    
    async def navigate_to_html(self, url: str, wait_time: int = 10, verbose: bool = False) -> Optional[str]:
        """Navigate to an HTML page and extract content.
        
        Args:
            url: URL to navigate to
            wait_time: Timeout in seconds
            verbose: Whether to print verbose output
            
        Returns:
            HTML content as string, or None if failed
        """
        await self._ensure_browser_initialized(verbose)
        
        try:
            if verbose:
                print(f'Navigating to: {url}')
            
            # Navigate to URL
            await self._page.goto(url, wait_until='domcontentloaded', timeout=wait_time * 1000)
            
            # Wait for page to be fully loaded
            try:
                await self._page.wait_for_load_state('networkidle', timeout=wait_time * 1000)
            except PlaywrightTimeoutError:
                if verbose:
                    print('Warning: Network idle timeout, proceeding with available content')
                # Still wait a bit for dynamic content
                await self._page.wait_for_timeout(2000)  # Wait 2 seconds for JS to execute
            
            # Extract HTML content
            html = await self._page.content()
            
            if verbose:
                print(f'Page loaded, HTML length: {len(html)} characters')
            
            return html
            
        except Exception as e:
            if verbose:
                print(f'Error navigating to page: {e}')
            return None
    
    async def download_file(self, url: str, verbose: bool = False) -> Optional[bytes]:
        """Download a file from URL using a two-tier approach.
        
        Primary: Direct browser request (fast, works for most PDFs)
        Fallback: Download event (handles JS redirects, complex cases)
        
        Args:
            url: URL to download
            verbose: Whether to print verbose output
            
        Returns:
            File content as bytes, or None if failed
        """
        await self._ensure_browser_initialized(verbose)
        
        try:
            if verbose:
                print(f'Setting up download for: {url}')
            
            # PRIMARY METHOD: Direct browser request (fast, maintains bot protection)
            try:
                if verbose:
                    print(f'Attempting direct fetch via browser request API (10s timeout)...')
                
                # Use asyncio.wait_for for hard timeout enforcement
                async def do_request():
                    response = await self._page.request.get(url, timeout=10000)
                    if response.ok:
                        return await response.body()
                    else:
                        raise Exception(f"HTTP {response.status}")
                
                content = await asyncio.wait_for(do_request(), timeout=10.0)
                
                if verbose:
                    print(f'✅ Successfully fetched {len(content)} bytes via browser request API')
                return content
            
            except asyncio.TimeoutError:
                if verbose:
                    print(f'⚠️  Direct fetch timed out after 10s - trying download event fallback...')
            
            except Exception as request_error:
                if verbose:
                    print(f'⚠️  Direct fetch failed ({type(request_error).__name__}: {request_error}) - trying download event fallback...')
            
            # FALLBACK METHOD: Download event (for JS-generated downloads, redirects, etc.)
            if verbose:
                print(f'Using download event method (30s timeout)...')
            
            async def do_download_event():
                download_waiter = self._page.wait_for_event("download", timeout=30000)
                
                # Navigate with 'commit' to avoid "Download is starting" error
                try:
                    await self._page.goto(url, wait_until='commit', timeout=60000)
                except Exception as e:
                    # Handle "Download is starting" error gracefully
                    if "Download is starting" not in str(e):
                        raise
                
                # Wait for download to complete
                download = await download_waiter
                if verbose:
                    print(f'Download event received: {download.suggested_filename}')
                
                # Save to temporary file
                temp_path = os.path.join(tempfile.gettempdir(), download.suggested_filename)
                await download.save_as(temp_path)
                
                # Read file content
                with open(temp_path, 'rb') as f:
                    content = f.read()
                
                # Clean up temp file
                try:
                    os.remove(temp_path)
                except:
                    pass
                
                return content
            
            # Wrap download event with hard timeout
            content = await asyncio.wait_for(do_download_event(), timeout=30.0)
            
            if verbose:
                print(f'✅ Successfully downloaded {len(content)} bytes via download event')
            
            return content
            
        except Exception as e:
            if verbose:
                print(f'❌ Both download methods failed: {e}')
            return None
    
    async def get_html(self, url: str, wait_time: int = 30, verbose: bool = False) -> Optional[str]:
        """Navigate to URL and get HTML content.
        
        Args:
            url: URL to navigate to
            wait_time: Timeout in seconds
            verbose: Whether to print verbose output
            
        Returns:
            HTML content as string, or None if failed
        """
        return await self.navigate_to_html(url, wait_time, verbose)
    
    async def get_text(self, verbose: bool = False) -> Optional[str]:
        """Get text content from current page.
        
        Args:
            verbose: Whether to print verbose output
            
        Returns:
            Text content as string, or None if failed
        """
        await self._ensure_browser_initialized(verbose)
        
        try:
            if self._page is None:
                return None
            
            # Extract text content from body
            text = await self._page.inner_text('body')
            
            if verbose:
                print(f'Extracted text length: {len(text)} characters')
            
            return text
            
        except Exception as e:
            if verbose:
                print(f'Error extracting text: {e}')
            return None
    
    async def get_title(self, verbose: bool = False) -> Optional[str]:
        """Get page title from current page.
        
        Args:
            verbose: Whether to print verbose output
            
        Returns:
            Page title as string, or None if failed
        """
        await self._ensure_browser_initialized(verbose)
        
        try:
            if self._page is None:
                return None
            
            title = await self._page.title()
            
            if verbose:
                print(f'Page title: {title}')
            
            return title
            
        except Exception as e:
            if verbose:
                print(f'Error getting title: {e}')
            return None
    
    async def get_current_url(self, verbose: bool = False) -> Optional[str]:
        """Get current page URL.
        
        Args:
            verbose: Whether to print verbose output
            
        Returns:
            Current URL as string, or None if failed
        """
        await self._ensure_browser_initialized(verbose)
        
        try:
            if self._page is None:
                return None
            
            url = self._page.url
            
            if verbose:
                print(f'Current URL: {url}')
            
            return url
            
        except Exception as e:
            if verbose:
                print(f'Error getting URL: {e}')
            return None
    
    async def close(self, verbose: bool = False):
        """Close the browser and clean up resources.
        
        Args:
            verbose: Whether to print verbose output
        """
        try:
            if self._page and not self._page.is_closed():
                await self._page.close()
                if verbose:
                    print('Page closed')
            
            if self._context:
                await self._context.close()
                if verbose:
                    print('Context closed')
            
            if self._browser:
                await self._browser.close()
                if verbose:
                    print('Browser closed')
            
            if self._browser_pool_context:
                await self._browser_pool_context.__aexit__(None, None, None)
                if verbose:
                    print('Browser pool context exited')
            
            # Reset state
            self._page = None
            self._context = None
            self._browser = None
            self._browser_pool_context = None
            
        except Exception as e:
            if verbose:
                print(f'Error during cleanup: {e}')
    
    def get_page_html(self, url: str, verbose: bool = False) -> Optional[str]:
        """Get HTML content from a URL (sync wrapper).
        
        Args:
            url: URL to navigate to
            verbose: Whether to print verbose output
        """
        return run_in_event_loop(self.navigate_to_html(url, verbose=verbose))

    def download_document(self, url: str, verbose: bool = False) -> Optional[bytes]:
        """Download a document from URL (sync wrapper).
        
        Args:
            url: URL to download
            verbose: Whether to print verbose output
        """
        return run_in_event_loop(self.download_file(url, verbose=verbose))


def _get_event_loop():
    """Get or create a persistent event loop in a background thread."""
    global _event_loop, _event_loop_thread, _event_loop_ready
    
    if _event_loop is None or not _event_loop_ready:
        loop_ready_event = threading.Event()
        
        def run_event_loop():
            global _event_loop, _event_loop_ready
            _event_loop = asyncio.new_event_loop()
            asyncio.set_event_loop(_event_loop)
            _event_loop_ready = True
            loop_ready_event.set()
            _event_loop.run_forever()
        
        _event_loop_thread = threading.Thread(target=run_event_loop, daemon=True)
        _event_loop_thread.start()
        
        # Wait for event loop to be ready (with timeout)
        if not loop_ready_event.wait(timeout=5.0):
            raise RuntimeError("Failed to initialize event loop within timeout")
    
    return _event_loop


def run_in_event_loop(coro):
    """Run a coroutine in the persistent event loop with timeout protection."""
    loop = _get_event_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    # Add 60 second timeout to prevent indefinite hangs
    # This is a safety net - the async methods have their own timeouts
    try:
        return future.result(timeout=60.0)
    except TimeoutError:
        print(f"⚠️  Operation timed out after 60 seconds")
        future.cancel()
        return None
