#!/usr/bin/env python3
"""
Gemini Chatbot Assistant for Web Crawling

A chatbot powered by Google Gemini that can assist with and control web crawling processes.
The bot has access to tools for navigating, clicking, extracting data, and more.
"""

import os
import json
import asyncio
from typing import Dict, List, Optional, Any, Callable
from urllib.parse import urljoin
from dotenv import load_dotenv
from bs4 import BeautifulSoup

import google.generativeai as genai
from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext
from playwright.async_api import Page

# Load environment variables
load_dotenv('.env.local')

from extraction_utils import get_gemini_model


class CrawlerTools:
    """Tools available to the Gemini chatbot for controlling the crawler."""
    
    def __init__(self, page: Page, context: PlaywrightCrawlingContext):
        self.page = page
        self.context = context
        self.current_url = None
        self.extracted_data = []
    
    async def navigate_to_url(self, url: str) -> Dict[str, Any]:
        """Navigate to a URL.
        
        Args:
            url: The URL to navigate to
            
        Returns:
            Dict with status and page info
        """
        try:
            response = await self.page.goto(url, wait_until='domcontentloaded', timeout=600000)  # 10 minutes
            self.current_url = str(self.page.url)
            return {
                'status': 'success',
                'url': self.current_url,
                'status_code': response.status if response else None,
                'title': await self.page.title()
            }
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    async def click_element(self, selector: str, wait_for_navigation: bool = False) -> Dict[str, Any]:
        """Click an element on the page.
        
        Args:
            selector: CSS selector or text to click
            wait_for_navigation: Whether to wait for navigation after clicking
            
        Returns:
            Dict with status and result
        """
        try:
            # Try as CSS selector first
            try:
                element = await self.page.wait_for_selector(selector, timeout=5000)
                if element:
                    if wait_for_navigation:
                        await asyncio.gather(
                            self.page.wait_for_navigation(timeout=600000),  # 10 minutes
                            element.click()
                        )
                    else:
                        await element.click()
                    return {'status': 'success', 'message': f'Clicked element: {selector}'}
            except:
                # Try clicking by text
                await self.page.click(f'text="{selector}"')
                if wait_for_navigation:
                    await self.page.wait_for_navigation(timeout=600000)  # 10 minutes
                return {'status': 'success', 'message': f'Clicked text: {selector}'}
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    async def extract_text(self, selector: Optional[str] = None) -> Dict[str, Any]:
        """Extract text from the page or a specific element.
        
        Args:
            selector: Optional CSS selector. If None, extracts all text from page.
            
        Returns:
            Dict with extracted text
        """
        try:
            if selector:
                element = await self.page.wait_for_selector(selector, timeout=5000)
                text = await element.inner_text() if element else None
            else:
                text = await self.page.inner_text('body')
            
            return {'status': 'success', 'text': text}
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    async def extract_links(self, filter_text: Optional[str] = None) -> Dict[str, Any]:
        """Extract all links from the page.
        
        Args:
            filter_text: Optional text to filter links by
            
        Returns:
            Dict with list of links
        """
        try:
            html_content = await self.page.content()
            soup = BeautifulSoup(html_content, 'html.parser')
            
            links = []
            for link in soup.find_all('a', href=True):
                href = link.get('href', '')
                if not href or href.startswith('#') or href.startswith('javascript:'):
                    continue
                
                full_url = urljoin(self.current_url or str(self.page.url), href)
                link_text = link.get_text(strip=True)
                
                if not filter_text or filter_text.lower() in link_text.lower() or filter_text.lower() in full_url.lower():
                    links.append({
                        'url': full_url,
                        'text': link_text or '(no text)'
                    })
            
            return {'status': 'success', 'links': links, 'count': len(links)}
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    async def get_page_content(self, format: str = 'html') -> Dict[str, Any]:
        """Get the current page content.
        
        Args:
            format: 'html' or 'text'
            
        Returns:
            Dict with page content
        """
        try:
            if format == 'html':
                content = await self.page.content()
            else:
                content = await self.page.inner_text('body')
            
            return {'status': 'success', 'content': content, 'format': format}
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    async def take_screenshot(self, path: Optional[str] = None) -> Dict[str, Any]:
        """Take a screenshot of the current page.
        
        Args:
            path: Optional path to save screenshot
            
        Returns:
            Dict with screenshot info
        """
        try:
            screenshot_bytes = await self.page.screenshot()
            if path:
                with open(path, 'wb') as f:
                    f.write(screenshot_bytes)
            
            return {
                'status': 'success',
                'saved_to': path,
                'size_bytes': len(screenshot_bytes)
            }
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    async def wait_for_element(self, selector: str, timeout: int = 10000) -> Dict[str, Any]:
        """Wait for an element to appear on the page.
        
        Args:
            selector: CSS selector
            timeout: Timeout in milliseconds
            
        Returns:
            Dict with status
        """
        try:
            element = await self.page.wait_for_selector(selector, timeout=timeout)
            return {'status': 'success', 'element_found': element is not None}
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    async def scroll_page(self, direction: str = 'down', pixels: int = 500) -> Dict[str, Any]:
        """Scroll the page.
        
        Args:
            direction: 'down', 'up', or 'to_bottom'
            pixels: Number of pixels to scroll (if direction is 'down' or 'up')
            
        Returns:
            Dict with status
        """
        try:
            if direction == 'to_bottom':
                await self.page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
            elif direction == 'down':
                await self.page.evaluate(f'window.scrollBy(0, {pixels})')
            elif direction == 'up':
                await self.page.evaluate(f'window.scrollBy(0, -{pixels})')
            
            return {'status': 'success', 'direction': direction}
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    async def fill_form(self, selector: str, value: str) -> Dict[str, Any]:
        """Fill a form field.
        
        Args:
            selector: CSS selector for the input field
            value: Value to fill in
            
        Returns:
            Dict with status
        """
        try:
            await self.page.fill(selector, value)
            return {'status': 'success', 'message': f'Filled {selector} with value'}
        except Exception as e:
            return {'status': 'error', 'error': str(e)}
    
    async def get_page_info(self) -> Dict[str, Any]:
        """Get information about the current page.
        
        Returns:
            Dict with page information
        """
        try:
            return {
                'status': 'success',
                'url': str(self.page.url),
                'title': await self.page.title(),
                'viewport': self.page.viewport_size
            }
        except Exception as e:
            return {'status': 'error', 'error': str(e)}


def create_tool_definitions():
    """Create function/tool definitions for Gemini using proper format."""
    import google.generativeai as genai
    
    return [
        {
            'name': 'navigate_to_url',
            'description': 'Navigate to a URL. Use this to go to a new page or website.',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    'url': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='The URL to navigate to'
                    )
                },
                required=['url']
            )
        },
        {
            'name': 'click_element',
            'description': 'Click an element on the page. Can use CSS selector or text content.',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    'selector': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='CSS selector or text to click'
                    ),
                    'wait_for_navigation': genai.protos.Schema(
                        type=genai.protos.Type.BOOLEAN,
                        description='Whether to wait for navigation after clicking'
                    )
                },
                required=['selector']
            )
        },
        {
            'name': 'extract_text',
            'description': 'Extract text from the page or a specific element.',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    'selector': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='Optional CSS selector. If not provided, extracts all text from page.'
                    )
                }
            )
        },
        {
            'name': 'extract_links',
            'description': 'Extract all links from the current page. Can optionally filter by text.',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    'filter_text': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='Optional text to filter links by (searches in link text and URL)'
                    )
                }
            )
        },
        {
            'name': 'get_page_content',
            'description': 'Get the current page content as HTML or text.',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    'format': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='Format to return content in (html or text)'
                    )
                }
            )
        },
        {
            'name': 'take_screenshot',
            'description': 'Take a screenshot of the current page.',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    'path': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='Optional path to save the screenshot'
                    )
                }
            )
        },
        {
            'name': 'wait_for_element',
            'description': 'Wait for an element to appear on the page.',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    'selector': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='CSS selector to wait for'
                    ),
                    'timeout': genai.protos.Schema(
                        type=genai.protos.Type.NUMBER,
                        description='Timeout in milliseconds'
                    )
                },
                required=['selector']
            )
        },
        {
            'name': 'scroll_page',
            'description': 'Scroll the page up, down, or to the bottom.',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    'direction': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='Direction to scroll (down, up, or to_bottom)'
                    ),
                    'pixels': genai.protos.Schema(
                        type=genai.protos.Type.NUMBER,
                        description='Number of pixels to scroll (for up/down)'
                    )
                }
            )
        },
        {
            'name': 'fill_form',
            'description': 'Fill a form field with a value.',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={
                    'selector': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='CSS selector for the input field'
                    ),
                    'value': genai.protos.Schema(
                        type=genai.protos.Type.STRING,
                        description='Value to fill in'
                    )
                },
                required=['selector', 'value']
            )
        },
        {
            'name': 'get_page_info',
            'description': 'Get information about the current page (URL, title, viewport).',
            'parameters': genai.protos.Schema(
                type=genai.protos.Type.OBJECT,
                properties={}
            )
        }
    ]


class GeminiCrawlerAssistant:
    """Gemini-powered chatbot assistant for web crawling."""
    
    def __init__(self, model_name: Optional[str] = None):
        """Initialize the Gemini assistant.
        
        Args:
            model_name: Optional Gemini model name (defaults from env or 'gemini-2.0-flash-exp')
        """
        # Initialize Gemini
        gemini_api_key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_AI_API_KEY')
        if not gemini_api_key:
            raise ValueError('GEMINI_API_KEY or GOOGLE_AI_API_KEY environment variable is not set')
        
        genai.configure(api_key=gemini_api_key)
        self.model_name = model_name or get_gemini_model()
        
        # System prompt for the assistant
        system_instruction = """
You are a financial analyst looking at the investor relations website. Your goal is to find and download all financial documents.
You can interact with the website using the tools provided to you.
"""
        
        # Create tools in the format Gemini expects
        # Gemini can accept tools as a list of function declarations
        tool_definitions = create_tool_definitions()
        self.model = genai.GenerativeModel(
            self.model_name,
            tools=tool_definitions,
            system_instruction=system_instruction
        )
        
        self.tools = None
        self.conversation_history = []
    
    def set_tools(self, tools: CrawlerTools):
        """Set the crawler tools instance."""
        self.tools = tools
    
    async def chat(self, message: str, verbose: bool = False, summary: bool = True) -> str:
        """Send a message to the chatbot and get a response.
        
        Args:
            message: User message
            verbose: Whether to print verbose output
            
        Returns:
            Assistant response
        """
        if verbose:
            print(f"\n🤖 User: {message}\n")
        
        # Add user message to history
        self.conversation_history.append({'role': 'user', 'parts': [message]})
        
        # Start chat with history
        chat = self.model.start_chat(history=self.conversation_history)
        response = await asyncio.to_thread(chat.send_message, message)
        
        # Handle function calls (Gemini may return function calls that need to be executed)
        max_iterations = 10  # Prevent infinite loops
        iteration = 0
        
        while iteration < max_iterations:
            iteration += 1
            
            # Check if response has function calls - check multiple locations
            function_calls = None
            
            if verbose:
                print(f"  🔍 Checking for function calls in response (iteration {iteration})...")
            
            # First check response.parts directly (newer API)
            if hasattr(response, 'parts'):
                try:
                    parts = response.parts
                    if parts:
                        if verbose:
                            print(f"  🔍 Checking response.parts: {len(parts) if hasattr(parts, '__len__') else 'N/A'} parts")
                        for part in parts:
                            if part and hasattr(part, 'function_call') and part.function_call:
                                if function_calls is None:
                                    function_calls = []
                                function_calls.append(part.function_call)
                                if verbose:
                                    print(f"  ✅ Found function call in response.parts: {part.function_call.name if hasattr(part.function_call, 'name') else 'unknown'}")
                except Exception as e:
                    if verbose:
                        print(f"  ⚠️ Error checking response.parts: {e}")
            
            # Also check response.function_calls (if it exists)
            if not function_calls and hasattr(response, 'function_calls') and response.function_calls:
                function_calls = response.function_calls
                if verbose:
                    print(f"  ✅ Found function calls in response.function_calls: {len(function_calls)}")
            
            # Also check candidates (this is where they actually are based on the output!)
            if not function_calls and hasattr(response, 'candidates') and response.candidates and len(response.candidates) > 0:
                if verbose:
                    print(f"  🔍 Checking response.candidates: {len(response.candidates)} candidates")
                # Check if the candidate has function calls
                candidate = response.candidates[0]
                if candidate and hasattr(candidate, 'content') and candidate.content:
                    parts = getattr(candidate.content, 'parts', None)
                    if parts and isinstance(parts, (list, tuple)):
                        if verbose:
                            print(f"  🔍 Checking candidate.content.parts: {len(parts)} parts")
                        for part in parts:
                            if part and hasattr(part, 'function_call') and part.function_call:
                                if function_calls is None:
                                    function_calls = []
                                function_calls.append(part.function_call)
                                if verbose:
                                    func_name = part.function_call.name if hasattr(part.function_call, 'name') else 'unknown'
                                    print(f"  ✅ Found function call in candidates: {func_name}")
            
            if not function_calls or len(function_calls) == 0:
                break
            
            if verbose or summary:
                print(f"🔧 Function calls detected: {len(function_calls)}")
            
            function_responses = []
            for function_call in function_calls:
                if not function_call:
                    continue
                # Handle both function_call object and dict formats
                if hasattr(function_call, 'name'):
                    function_name = function_call.name
                    function_args = dict(function_call.args) if hasattr(function_call, 'args') else {}
                else:
                    function_name = function_call.get('name', '')
                    function_args = function_call.get('args', {})
                
                # Summary view: show function name and key args
                if summary:
                    args_summary = {}
                    for key, value in function_args.items():
                        if isinstance(value, str) and len(value) > 50:
                            args_summary[key] = value[:50] + "..."
                        elif not isinstance(value, (dict, list)):
                            args_summary[key] = value
                    if args_summary:
                        print(f"  → {function_name}({', '.join(f'{k}={v!r}' for k, v in args_summary.items())})")
                    else:
                        print(f"  → {function_name}()")
                
                if verbose:
                    print(f"  → Calling: {function_name}({json.dumps(function_args, indent=2)})")
                
                # Get the tool method
                tool_method = getattr(self.tools, function_name, None)
                if not tool_method:
                    result = {'status': 'error', 'error': f'Unknown function: {function_name}'}
                    if summary:
                        print(f"  ❌ Error: Unknown function")
                else:
                    # Call the tool method
                    try:
                        result = await tool_method(**function_args)
                        # Summary view: show brief result
                        if summary:
                            if result.get('status') == 'success':
                                # Show key info from result
                                result_keys = ['url', 'count', 'title', 'message', 'text']
                                result_summary = {}
                                for key in result_keys:
                                    if key in result:
                                        value = result[key]
                                        if isinstance(value, str) and len(value) > 60:
                                            result_summary[key] = value[:60] + "..."
                                        else:
                                            result_summary[key] = value
                                if result_summary:
                                    summary_str = ', '.join(f'{k}={v!r}' for k, v in result_summary.items())
                                    print(f"  ✓ {function_name}: {summary_str}")
                                else:
                                    print(f"  ✓ {function_name}: success")
                            else:
                                error_msg = result.get('error', 'unknown error')
                                if len(error_msg) > 60:
                                    error_msg = error_msg[:60] + "..."
                                print(f"  ❌ {function_name}: {error_msg}")
                    except Exception as e:
                        result = {'status': 'error', 'error': str(e)}
                        if summary:
                            error_msg = str(e)
                            if len(error_msg) > 60:
                                error_msg = error_msg[:60] + "..."
                            print(f"  ❌ {function_name}: {error_msg}")
                
                if verbose:
                    print(f"  ← Result: {json.dumps(result, indent=2)}")
                
                # Format response for Gemini using FunctionResponse
                import google.generativeai as genai
                function_responses.append(
                    genai.protos.FunctionResponse(
                        name=function_name,
                        response=result
                    )
                )
            
            # Send function responses back to the model
            if verbose:
                print(f"  📤 Sending {len(function_responses)} function responses back to Gemini...")
            
            try:
                # Send function responses - Gemini expects a list of FunctionResponse objects
                response = await asyncio.to_thread(chat.send_message, function_responses)
            except Exception as e:
                if verbose:
                    print(f"  ❌ Error sending function responses: {e}")
                    import traceback
                    traceback.print_exc()
                # Try to continue with the last response or break
                break
            
            if verbose:
                print(f"  📥 Received response type: {type(response)}")
                print(f"  📥 Response str: {str(response)[:200]}")
                if hasattr(response, 'candidates'):
                    print(f"  📥 Response has {len(response.candidates) if response.candidates else 0} candidates")
                # Check if response has more function calls (shouldn't happen, but just in case)
                if hasattr(response, 'function_calls') and response.function_calls:
                    print(f"  ⚠️ Response has more function calls: {len(response.function_calls)}")
                # Try to get text directly - but be careful not to trigger the property if there are function calls
                try:
                    text_preview = response.text[:200] if response.text else None
                    if text_preview:
                        print(f"  📥 response.text preview: {text_preview}")
                except (ValueError, AttributeError) as e:
                    if 'function_call' in str(e):
                        print(f"  📥 response.text cannot be accessed (has function calls)")
                    else:
                        print(f"  📥 response.text access error: {e}")
        
        # Get the final text response - handle both text and function call responses
        response_text = ""
        try:
            if verbose:
                print(f"  🔍 Extracting text from response...")
                print(f"  🔍 Response attributes: {dir(response)}")
            
            # IMPORTANT: Don't access response.text directly if there are function calls!
            # Check for function calls first using parts to avoid the ValueError
            has_function_calls_in_response = False
            if hasattr(response, 'parts'):
                for part in response.parts:
                    if hasattr(part, 'function_call') and part.function_call:
                        has_function_calls_in_response = True
                        if verbose:
                            print(f"  ⚠️ Response still contains function calls, cannot extract text")
                        break
            
            # Only try to get text if there are no function calls
            if not has_function_calls_in_response:
                # Try direct text attribute - but access it safely
                # DON'T use hasattr() because it triggers the property accessor!
                try:
                    text_value = response.text  # This will raise ValueError if there are function calls
                    if text_value:
                        response_text = text_value
                        if verbose:
                            print(f"  ✅ Found text: {response_text[:100]}")
                except ValueError as e:
                    if 'function_call' in str(e):
                        if verbose:
                            print(f"  ⚠️ Cannot convert function calls to text: {e}")
                        # Even though we checked, there might still be function calls
                        has_function_calls_in_response = True
                    else:
                        raise
                except AttributeError:
                    # response.text doesn't exist (shouldn't happen, but handle it)
                    if verbose:
                        print(f"  ⚠️ response.text attribute doesn't exist")
            # Try extracting from candidates
            if not response_text and hasattr(response, 'candidates'):
                if verbose:
                    print(f"  🔍 Checking candidates: {response.candidates}")
                if response.candidates and len(response.candidates) > 0:
                    candidate = response.candidates[0]
                    if verbose:
                        print(f"  🔍 Candidate attributes: {dir(candidate)}")
                    if candidate:
                        # Check for direct text in candidate
                        if hasattr(candidate, 'text') and candidate.text:
                            response_text = candidate.text
                            if verbose:
                                print(f"  ✅ Found text in candidate.text: {response_text[:100]}")
                        # Check for text in content parts
                        elif hasattr(candidate, 'content'):
                            if verbose:
                                print(f"  🔍 Candidate has content: {candidate.content}")
                            if candidate.content:
                                parts = getattr(candidate.content, 'parts', None)
                                if verbose:
                                    print(f"  🔍 Parts: {parts}")
                                if parts and isinstance(parts, (list, tuple)):
                                    text_parts = []
                                    for i, part in enumerate(parts):
                                        if verbose:
                                            print(f"  🔍 Part {i}: {type(part)}, attributes: {dir(part) if part else 'None'}")
                                        if part:
                                            # Check for text attribute
                                            if hasattr(part, 'text'):
                                                if verbose:
                                                    print(f"  🔍 Part {i} has text: {part.text}")
                                                if part.text:
                                                    text_parts.append(part.text)
                                            # Also check for function_call (shouldn't happen here, but just in case)
                                            elif hasattr(part, 'function_call'):
                                                if verbose:
                                                    print(f"  ⚠️ Part {i} has function_call instead of text")
                                    if text_parts:
                                        response_text = ' '.join(text_parts)
                                        if verbose:
                                            print(f"  ✅ Extracted text from parts: {response_text[:100]}")
            
            # If still no text, try to get string representation
            if not response_text:
                response_str = str(response)
                if response_str and response_str != 'None' and len(response_str) > 50:
                    response_text = response_str
                    if verbose:
                        print(f"  ✅ Using string representation: {response_text[:100]}")
                    
        except Exception as e:
            if verbose:
                print(f"  ❌ Error extracting text: {e}")
                import traceback
                traceback.print_exc()
        
        # If we still don't have text, provide a helpful message
        if not response_text:
            if verbose:
                print(f"  ⚠️ No text found in response")
            response_text = "Function calls executed successfully, but no text response was received from the model."
        
        # Add assistant response to history
        self.conversation_history.append({'role': 'model', 'parts': [response_text]})
        
        if verbose:
            print(f"💬 Assistant: {response_text}\n")
        
        return response_text


async def main():
    """Example usage of the Gemini Crawler Assistant."""
    import argparse
    
    parser = argparse.ArgumentParser(description='Gemini-powered crawler assistant')
    parser.add_argument('--url', type=str, help='Initial URL to navigate to')
    parser.add_argument('--headless', action='store_true', help='Run browser in headless mode')
    parser.add_argument('--verbose', action='store_true', help='Verbose output')
    args = parser.parse_args()
    
    # Initialize assistant
    assistant = GeminiCrawlerAssistant()
    
    # Create crawler
    crawler = PlaywrightCrawler(
        headless=args.headless,
        browser_type='chromium',
    )
    
    @crawler.router.default_handler
    async def request_handler(context: PlaywrightCrawlingContext) -> None:
        """Handler that integrates Gemini assistant with crawler."""
        url = str(context.request.url)
        print(f"\n🌐 Starting crawler session at: {url}\n")
        
        # Create tools instance
        tools = CrawlerTools(context.page, context)
        assistant.set_tools(tools)
        
        # Navigate to initial URL if provided
        if args.url:
            await tools.navigate_to_url(args.url)
        
        # Interactive chat loop
        print("💬 Gemini Crawler Assistant is ready!")
        print("Type your commands (or 'quit' to exit):\n")
        
        while True:
            try:
                user_input = input("You: ").strip()
                if not user_input or user_input.lower() in ['quit', 'exit', 'q']:
                    break
                
                response = await assistant.chat(user_input, verbose=args.verbose, summary=True)
                print(f"\nAssistant: {response}\n")
                
            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Error: {e}\n")
    
    # Start crawler
    initial_url = args.url or "https://example.com"
    await crawler.add_requests([initial_url])
    await crawler.run()


if __name__ == "__main__":
    asyncio.run(main())

