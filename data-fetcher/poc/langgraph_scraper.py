#!/usr/bin/env python3
"""
Test script for IR website crawler using LangGraph.

This script demonstrates the usage of the IRWebsiteCrawler module.
Use this to test the crawler functionality before integrating with scan_ir_website.py.
"""

import os
import sys
import asyncio
import json

# Add parent directory to path to import ir_crawler
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from ir_crawler import IRWebsiteCrawler


async def main():
    """Example usage of the IR website crawler."""
    import argparse
    
    parser = argparse.ArgumentParser(description='LangGraph Website Scraper with Gemini')
    parser.add_argument('--url', type=str, required=True, help='URL to start scraping (must be a listing page)')
    parser.add_argument('--max-pages', type=int, default=5, help='Maximum pages to visit')
    parser.add_argument('--ticker', type=str, default='TEST', help='Stock ticker symbol')
    parser.add_argument('--model', type=str, default='gemini-2.5-pro', help='Gemini model to use')
    parser.add_argument('--output', type=str, help='Optional: Output JSON file for results')
    args = parser.parse_args()
    
    # Create crawler
    crawler = IRWebsiteCrawler(model_name=args.model)
    
    # Run crawling with new interface
    documents, visited_detail_urls = await crawler.discover_documents(
        args.url,
        ticker=args.ticker,
        skip_urls=set(),  # No skipping for test script
        max_pages=args.max_pages,
        verbose=True
    )
    
    # Print detailed summary
    print("\n" + "="*80)
    print("SCRAPING SUMMARY")
    print("="*80)
    print(f"\nStatus: ✅ Success")
    print(f"Documents Found: {len(documents)}")
    print(f"Detail Pages Visited: {len(visited_detail_urls)}")
    
    # Show detail pages visited
    if visited_detail_urls:
        print(f"\n📄 Detail Pages Visited ({len(visited_detail_urls)}):")
        for i, url in enumerate(visited_detail_urls, 1):
            display_url = url[:100] if len(url) <= 100 else url[:97] + "..."
            print(f"  {i}. {display_url}")
    
    # Show documents with fiscal period info
    docs_with_period = [d for d in documents 
                       if d.get('fiscal_year') or d.get('fiscal_quarter')]
    
    if docs_with_period:
        print(f"\n📦 Documents with Fiscal Period ({len(docs_with_period)} of {len(documents)}):\n")
        for i, doc in enumerate(docs_with_period, 1):
            print(f"  {i}. {doc['title']}")
            print(f"     Category: {doc.get('category', 'unknown')}")
            fiscal_info = []
            if doc.get('fiscal_quarter'):
                fiscal_info.append(doc['fiscal_quarter'])
            if doc.get('fiscal_year'):
                fiscal_info.append(str(doc['fiscal_year']))
            if fiscal_info:
                print(f"     Fiscal Period: {' '.join(fiscal_info)}")
            
            if doc.get('pdf_url'):
                print(f"     PDF: {doc['pdf_url']}")
            elif doc.get('page_url'):
                print(f"     Page URL: {doc['page_url']}")
            
            print(f"     Method: {doc.get('extraction_method', 'unknown')}")
            
            if doc.get('detail_page_url'):
                print(f"     Detail Page: {doc['detail_page_url'][:80]}")
            elif doc.get('source_listing'):
                print(f"     From: {doc['source_listing'][:80]}")
            
            print()
    
    # Save to file if requested
    if args.output:
        results = {
            'success': True,
            'documents': documents,
            'visited_detail_urls': visited_detail_urls,
            'total_documents': len(documents),
            'total_detail_pages': len(visited_detail_urls)
        }
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2)
        print(f"💾 Results saved to: {args.output}")
    else:
        print(f"💡 Tip: Use --output results.json to save results to a file")


if __name__ == '__main__':
    asyncio.run(main())
