#!/usr/bin/env python3
"""
Simple Crawlee script to print all links from Robinhood quarterly results page.
"""

import asyncio
from urllib.parse import urljoin
from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext
from bs4 import BeautifulSoup

URL = "https://investors.robinhood.com/financials/quarterly-results"


async def main():
    """Main function to crawl and print links."""
    crawler = PlaywrightCrawler(
        headless=True,
        browser_type='chromium',
    )
    
    @crawler.router.default_handler
    async def request_handler(context: PlaywrightCrawlingContext) -> None:
        """Handler to extract and print links from the page."""
        url = str(context.request.url)
        print(f"\nCrawling: {url}\n")
        
        try:
            # Navigate to the page
            await context.page.goto(url, wait_until='domcontentloaded', timeout=60000)
            
            # Wait for page to fully load
            await context.page.wait_for_load_state('networkidle', timeout=30000)
            
            # Get page HTML
            html_content = await context.page.content()
            
            # Parse HTML with BeautifulSoup
            soup = BeautifulSoup(html_content, 'html.parser')
            
            # Extract all links
            links = []
            for link in soup.find_all('a', href=True):
                href = link.get('href', '')
                if not href or href.startswith('#') or href.startswith('javascript:'):
                    continue
                
                # Convert relative URLs to absolute
                full_url = urljoin(url, href)
                link_text = link.get_text(strip=True)
                
                links.append({
                    'url': full_url,
                    'text': link_text or '(no text)',
                })
            
            # Print all links
            print(f"Found {len(links)} links:\n")
            print("=" * 80)
            for i, link in enumerate(links, 1):
                print(f"{i}. {link['text']}")
                print(f"   URL: {link['url']}")
                print()
            print("=" * 80)
            print(f"\nTotal links: {len(links)}")
            
        except Exception as e:
            print(f"Error processing {url}: {e}")
            raise
    
    # Add the initial request - try passing URL string directly
    await crawler.add_requests([URL])
    
    # Run the crawler
    await crawler.run()


if __name__ == "__main__":
    asyncio.run(main())

