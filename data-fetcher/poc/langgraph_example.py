#!/usr/bin/env python3
"""
Simple example demonstrating the LangGraph scraper with a mock scenario.

This script shows how to:
1. Initialize the LangGraph scraper
2. Run it on a sample IR website
3. Process the results
"""

import asyncio
import json
import os
from dotenv import load_dotenv
from langgraph_scraper import LangGraphWebScraper

# Load environment variables from parent directory
env_path = os.path.join(os.path.dirname(__file__), '..', '.env.local')
load_dotenv(env_path)


async def example_basic_scraping():
    """Basic example: scrape an IR website."""
    print("=" * 80)
    print("Example 1: Basic Scraping")
    print("=" * 80)
    
    # Create scraper instance
    scraper = LangGraphWebScraper(
        model_name="gemini-2.0-flash-exp",
        headless=True
    )
    
    # Run scraping on a sample IR website
    # Replace with any actual IR website URL
    results = await scraper.scrape(
        start_url="https://investor.apple.com/investor-relations/default.aspx",
        max_pages=3  # Limit to 3 pages for demo
    )
    
    # Print results
    print("\n" + "=" * 80)
    print("RESULTS")
    print("=" * 80)
    
    print(f"\nSuccess: {results['success']}")
    print(f"Pages Visited: {results['total_pages']}")
    print(f"Documents Found: {results['total_documents']}")
    print(f"Links Discovered: {results['links_discovered']}")
    
    if results['documents_found']:
        print("\nDocuments:")
        for i, doc in enumerate(results['documents_found'], 1):
            print(f"\n  {i}. {doc['text']}")
            print(f"     URL: {doc['url']}")
            print(f"     Type: {doc['type']}")
    
    return results


async def example_multiple_companies():
    """Example: scrape multiple companies in sequence."""
    print("\n" + "=" * 80)
    print("Example 2: Multiple Companies")
    print("=" * 80)
    
    # List of companies to scrape (these are examples)
    companies = [
        {
            'name': 'Apple',
            'url': 'https://investor.apple.com/investor-relations/default.aspx'
        },
        {
            'name': 'Microsoft',
            'url': 'https://www.microsoft.com/en-us/investor'
        },
        {
            'name': 'Tesla',
            'url': 'https://ir.tesla.com/'
        }
    ]
    
    all_results = {}
    
    for company in companies[:1]:  # Only scrape first company for demo
        print(f"\n\n🏢 Scraping {company['name']}...")
        print("-" * 80)
        
        scraper = LangGraphWebScraper(headless=True)
        results = await scraper.scrape(company['url'], max_pages=2)
        
        all_results[company['name']] = results
        
        print(f"\n✅ {company['name']}: Found {results['total_documents']} documents")
    
    return all_results


async def example_with_filtering():
    """Example: scrape with custom filtering logic."""
    print("\n" + "=" * 80)
    print("Example 3: Custom Filtering")
    print("=" * 80)
    
    scraper = LangGraphWebScraper(headless=True)
    results = await scraper.scrape(
        start_url="https://investor.apple.com/investor-relations/default.aspx",
        max_pages=3
    )
    
    # Filter results for specific document types
    earnings_docs = [
        doc for doc in results.get('documents_found', [])
        if 'earnings' in doc['text'].lower() or 'quarterly' in doc['text'].lower()
    ]
    
    presentations = [
        doc for doc in results.get('documents_found', [])
        if 'presentation' in doc['text'].lower() or '.pptx' in doc['url'].lower()
    ]
    
    print(f"\n📊 Earnings Documents: {len(earnings_docs)}")
    for doc in earnings_docs:
        print(f"  - {doc['text']}")
    
    print(f"\n📽️  Presentations: {len(presentations)}")
    for doc in presentations:
        print(f"  - {doc['text']}")
    
    return results


async def main():
    """Run all examples."""
    print("\n🚀 LangGraph Scraper Examples")
    print("=" * 80)
    
    try:
        # Run examples
        print("\nNote: These examples use real websites. They may take time to run.")
        print("You can modify the URLs and parameters to test with different sites.")
        
        # Example 1: Basic scraping
        await example_basic_scraping()
        
        # Uncomment to run additional examples:
        # await example_multiple_companies()
        # await example_with_filtering()
        
    except KeyboardInterrupt:
        print("\n\n❌ Interrupted by user")
    except Exception as e:
        print(f"\n\n❌ Error: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(main())

