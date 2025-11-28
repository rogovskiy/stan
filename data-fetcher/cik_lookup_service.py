#!/usr/bin/env python3
"""
CIK Lookup Utility

Demonstrates different ways to find CIK (Central Index Key) by ticker symbol.
"""

import requests
import json
from typing import Dict, List, Optional, Any
import time

class CIKLookupService:
    """Service for looking up CIK numbers by ticker symbol"""
    
    def __init__(self):
        self._ticker_cache = None
        self._last_cache_update = None
    
    def get_cik_by_ticker(self, ticker: str) -> Optional[int]:
        """Get CIK for a ticker using SEC's official API"""
        try:
            ticker_upper = ticker.upper()
            
            # Load SEC company tickers if not cached
            if self._ticker_cache is None:
                self._load_sec_company_tickers()
            
            return self._ticker_cache.get(ticker_upper)
            
        except Exception as e:
            print(f"Error getting CIK for {ticker}: {e}")
            return None
    
    def _load_sec_company_tickers(self, verbose: bool = True):
        """Load company tickers from SEC's official API"""
        try:
            if verbose:
                print("📥 Downloading SEC company tickers database...")
            
            # SEC's official endpoint
            url = "https://www.sec.gov/files/company_tickers.json"
            
            # SEC requires a proper user agent
            headers = {
                'User-Agent': 'StockAnalysis/1.0 (contact@example.com)',
                'Accept': 'application/json'
            }
            
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            
            # Build ticker -> CIK mapping
            self._ticker_cache = {}
            
            for key, company in data.items():
                if 'ticker' in company and 'cik_str' in company:
                    ticker = company['ticker'].upper()
                    cik = int(company['cik_str'])
                    self._ticker_cache[ticker] = cik
            
            self._last_cache_update = time.time()
            
            if verbose:
                print(f"✅ Loaded {len(self._ticker_cache)} companies from SEC")
            
        except Exception as e:
            print(f"❌ Error loading SEC company tickers: {e}")
            # Fallback to hardcoded mapping
            self._ticker_cache = self._get_fallback_mapping()
    
    def _get_fallback_mapping(self) -> Dict[str, int]:
        """Fallback mapping for common tickers"""
        return {
            'AAPL': 320193,
            'MSFT': 789019,
            'GOOGL': 1652044,
            'GOOG': 1652044,
            'AMZN': 1018724,
            'TSLA': 1318605,
            'META': 1326801,
            'NVDA': 1045810,
            'NFLX': 1065280,
            'AMD': 2488,
            'ORCL': 1341439,
            'CRM': 1108524,
            'IBM': 51143,
            'INTC': 50863
        }
    
    def search_companies_by_name(self, search_term: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Search for companies by name"""
        try:
            url = "https://www.sec.gov/files/company_tickers.json"
            headers = {'User-Agent': 'StockAnalysis/1.0 (contact@example.com)'}
            
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            
            data = response.json()
            results = []
            search_lower = search_term.lower()
            
            for company in data.values():
                if ('title' in company and 
                    search_lower in company.get('title', '').lower()):
                    
                    results.append({
                        'ticker': company.get('ticker', 'N/A'),
                        'company_name': company.get('title', 'N/A'),
                        'cik': int(company.get('cik_str', 0))
                    })
                    
                    if len(results) >= limit:
                        break
            
            return results
            
        except Exception as e:
            print(f"Error searching companies: {e}")
            return []
    
    def show_available_tickers(self, limit: int = 20):
        """Show available tickers"""
        if self._ticker_cache is None:
            self._load_sec_company_tickers()
        
        if self._ticker_cache:
            print(f"\n📋 Available Tickers (showing first {limit}):")
            print("=" * 50)
            
            tickers = list(self._ticker_cache.keys())[:limit]
            for i, ticker in enumerate(tickers, 1):
                cik = self._ticker_cache[ticker]
                print(f"{i:3}. {ticker:8} -> CIK: {cik}")
            
            print(f"\nTotal available: {len(self._ticker_cache)} tickers")

def test_cik_lookup():
    """Test the CIK lookup functionality"""
    print("🧪 Testing CIK Lookup Service")
    print("=" * 40)
    
    service = CIKLookupService()
    
    # Test known tickers
    test_tickers = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META']
    
    print("\n1. Testing known tickers:")
    for ticker in test_tickers:
        cik = service.get_cik_by_ticker(ticker)
        if cik:
            print(f"✅ {ticker:6} -> CIK: {cik}")
        else:
            print(f"❌ {ticker:6} -> CIK: Not found")
    
    # Test search by company name
    print("\n2. Testing company name search:")
    results = service.search_companies_by_name("Apple", limit=3)
    for result in results:
        print(f"   {result['ticker']:6} {result['company_name'][:40]:40} CIK: {result['cik']}")
    
    # Show some available tickers
    print("\n3. Sample of available tickers:")
    service.show_available_tickers(limit=10)
    
    return service

if __name__ == "__main__":
    service = test_cik_lookup()
    
    print("\n" + "=" * 50)
    print("🎯 Usage Examples:")
    print("   service.get_cik_by_ticker('AAPL')  # Returns 320193")
    print("   service.search_companies_by_name('Microsoft')  # Returns matches")
    print("   service.show_available_tickers(20)  # Shows 20 tickers")