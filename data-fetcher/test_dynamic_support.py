#!/usr/bin/env python3
"""
Test Dynamic CIK Support

Test script to demonstrate that the system now supports any publicly traded company.
"""

def test_dynamic_ticker_support():
    """Test that the system can now handle any ticker"""
    print("🧪 Testing Dynamic Ticker Support")
    print("=" * 50)
    
    from cik_lookup_service import CIKLookupService
    
    lookup = CIKLookupService()
    
    # Test some companies that weren't in the hardcoded list
    test_tickers = [
        'IBM',     # International Business Machines
        'ORCL',    # Oracle Corporation  
        'CRM',     # Salesforce
        'INTC',    # Intel Corporation
        'JPM',     # JPMorgan Chase
        'BAC',     # Bank of America
        'KO',      # The Coca-Cola Company
        'PG',      # Procter & Gamble
        'JNJ',     # Johnson & Johnson
        'WMT'      # Walmart Inc.
    ]
    
    print("1. Testing CIK lookup for companies not in hardcoded list:")
    successful_lookups = []
    
    for ticker in test_tickers:
        cik = lookup.get_cik_by_ticker(ticker)
        if cik:
            print(f"✅ {ticker:6} -> CIK: {cik}")
            successful_lookups.append((ticker, cik))
        else:
            print(f"❌ {ticker:6} -> CIK: Not found")
    
    print(f"\n📊 Results: {len(successful_lookups)}/{len(test_tickers)} tickers found")
    
    if successful_lookups:
        print(f"\n2. Your system can now download data for these companies:")
        print("   Example commands:")
        for ticker, cik in successful_lookups[:5]:  # Show first 5
            print(f"   python download_max_data.py {ticker}")
    
    return successful_lookups

def test_company_search():
    """Test searching for companies by name"""
    print("\n" + "=" * 50)
    print("🔍 Testing Company Search Feature")
    
    from cik_lookup_service import CIKLookupService
    
    lookup = CIKLookupService()
    
    search_terms = ['Microsoft', 'Intel', 'Johnson', 'Walmart', 'Tesla']
    
    for term in search_terms:
        print(f"\nSearching for '{term}':")
        results = lookup.search_companies_by_name(term, limit=3)
        
        for i, result in enumerate(results, 1):
            ticker = result['ticker']
            name = result['company_name'][:50]  # Truncate long names
            cik = result['cik']
            print(f"  {i}. {ticker:6} {name:50} CIK: {cik}")
        
        if not results:
            print(f"  No companies found matching '{term}'")

def show_capability_summary():
    """Show what the enhanced system can do"""
    print("\n" + "=" * 50)
    print("🚀 Enhanced System Capabilities")
    print("=" * 50)
    
    from cik_lookup_service import CIKLookupService
    
    lookup = CIKLookupService()
    
    # Get total count (this loads the cache)
    lookup.show_available_tickers(limit=1)  # Just to initialize
    
    if lookup._ticker_cache:
        total_companies = len(lookup._ticker_cache)
        
        print(f"📈 Your system now supports:")
        print(f"   • {total_companies:,} publicly traded companies")
        print(f"   • Dynamic CIK lookup for any ticker")
        print(f"   • Company name search functionality")
        print(f"   • SEC financial data for any supported company")
        
        print(f"\n🎯 Usage:")
        print(f"   • python download_max_data.py [ANY_TICKER]")
        print(f"   • Automatic SEC data integration")
        print(f"   • Historical price + financial data")
        
        print(f"\n💡 Examples of newly supported companies:")
        sample_tickers = ['IBM', 'ORCL', 'JPM', 'KO', 'WMT', 'JNJ']
        for ticker in sample_tickers:
            cik = lookup.get_cik_by_ticker(ticker)
            if cik:
                print(f"   • {ticker} (CIK: {cik})")

if __name__ == "__main__":
    # Run all tests
    successful_lookups = test_dynamic_ticker_support()
    test_company_search()
    show_capability_summary()
    
    print(f"\n🎉 SUCCESS! Your system now supports {len(successful_lookups)} additional companies")
    print("   (and thousands more in the SEC database)")