#!/usr/bin/env python3
"""
Test script to download a single PDF file for debugging.
Simulates the real workflow by navigating to the listing page first.
"""

import sys
from browser_pool_manager import BrowserPoolManager

def test_download(url: str, headless: bool = True, context_url: str = None):
    """Test downloading a single document.
    
    Args:
        url: URL to download
        headless: Whether to run in headless mode
        context_url: Optional URL to visit first to build context (like the listing page)
    """
    print(f"🧪 Testing download of: {url}")
    if not headless:
        print(f"🖥️  Running in visible browser mode")
    if context_url:
        print(f"🌐 Will navigate to context page first: {context_url}")
    print()
    
    browser_manager = BrowserPoolManager(headless=headless)
    
    try:
        # Step 1: Navigate to context page first (if provided) to build browser state
        if context_url:
            print(f"📄 Step 1: Navigating to context page to build browser state...")
            html = browser_manager.get_page_html(context_url, verbose=True)
            if html:
                print(f"   ✅ Context page loaded successfully ({len(html):,} chars)")
                print(f"   🔧 Browser now has cookies, session, and context\n")
            else:
                print(f"   ⚠️  Failed to load context page, continuing anyway...\n")
        
        # Step 2: Download the document
        print(f"📥 Step 2: Downloading document...")
        content = browser_manager.download_document(url, verbose=True)
        
        if content:
            print(f"\n✅ Download successful!")
            print(f"   Size: {len(content):,} bytes")
            print(f"   Type: {'PDF' if content.startswith(b'%PDF') else 'HTML/Other'}")
            return True
        else:
            print(f"\n❌ Download failed - no content returned")
            return False
            
    except Exception as e:
        print(f"\n❌ Error during download: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python test_single_download.py <URL> [--no-headless] [--context-url <URL>]")
        print("\nExamples:")
        print("  # Basic test")
        print("  python test_single_download.py 'https://investors.tempus.com/node/9301/pdf'")
        print()
        print("  # With visible browser")
        print("  python test_single_download.py 'https://investors.tempus.com/node/9301/pdf' --no-headless")
        print()
        print("  # With context page (simulates real workflow)")
        print("  python test_single_download.py 'https://investors.tempus.com/static-files/...' \\")
        print("    --context-url 'https://investors.tempus.com/financials/financial-information' \\")
        print("    --no-headless")
        sys.exit(1)
    
    url = sys.argv[1]
    headless = '--no-headless' not in sys.argv
    
    # Check for --context-url
    context_url = None
    if '--context-url' in sys.argv:
        context_idx = sys.argv.index('--context-url')
        if context_idx + 1 < len(sys.argv):
            context_url = sys.argv[context_idx + 1]
    
    success = test_download(url, headless=headless, context_url=context_url)
    sys.exit(0 if success else 1)
