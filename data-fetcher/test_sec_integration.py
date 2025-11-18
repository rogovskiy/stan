#!/usr/bin/env python3
"""
Test SEC Data Integration

Simple test script to verify SEC data fetching is working.
"""

import os
import sys
from datetime import datetime

# Add the current directory to path so we can import our modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

def test_sec_imports():
    """Test that all SEC-related imports work"""
    try:
        print("Testing SEC imports...")
        
        from secfsdstools.e_collector.companycollecting import CompanyReportCollector
        print("✅ CompanyReportCollector imported successfully")
        
        from secfsdstools.f_standardize.is_standardize import IncomeStatementStandardizer
        print("✅ IncomeStatementStandardizer imported successfully")
        
        from secfsdstools.f_standardize.bs_standardize import BalanceSheetStandardizer
        print("✅ BalanceSheetStandardizer imported successfully")
        
        from secfsdstools.f_standardize.cf_standardize import CashFlowStandardizer
        print("✅ CashFlowStandardizer imported successfully")
        
        from secfsdstools.d_container.databagmodel import RawDataBag
        print("✅ RawDataBag imported successfully")
        
        return True
        
    except Exception as e:
        print(f"❌ Import error: {e}")
        return False

def test_sec_service():
    """Test basic SEC data service functionality"""
    try:
        print("\nTesting SEC data service...")
        
        from sec_data_service import SECDataService
        
        service = SECDataService()
        print("✅ SECDataService initialized successfully")
        
        return True
        
    except Exception as e:
        print(f"❌ SEC service error: {e}")
        return False

def test_company_data_access():
    """Test accessing company data from SEC database"""
    try:
        print("\nTesting company data access...")
        
        from secfsdstools.e_collector.companycollecting import CompanyReportCollector
        
        # Try to get collector for a known company (Apple)
        print("Creating collector for AAPL...")
        collector = CompanyReportCollector.get_company_collector("AAPL")
        print(f"✅ Created collector for AAPL")
        
        # Try to get some data bags
        print("Getting raw data bags...")
        raw_bags = collector.get_all_company_filing_rawdatabags()
        
        if raw_bags:
            print(f"✅ Found {len(raw_bags)} raw data bags for AAPL")
            
            # Show info about the first few
            for i, bag in enumerate(raw_bags[:3]):
                print(f"   Bag {i+1}: {bag.form} filed on {bag.filing_date}")
        else:
            print("⚠️  No raw data bags found")
        
        return True
        
    except Exception as e:
        print(f"❌ Company data access error: {e}")
        return False

def test_time_series_util():
    """Test time series utility"""
    try:
        print("\nTesting time series utility...")
        
        from time_series_util import TimeSeriesDataUtil
        
        util = TimeSeriesDataUtil()
        print("✅ TimeSeriesDataUtil initialized successfully")
        
        return True
        
    except Exception as e:
        print(f"❌ Time series util error: {e}")
        return False

def main():
    """Run all tests"""
    print("🧪 Testing SEC Data Integration")
    print("=" * 50)
    
    test_results = []
    
    # Run tests
    test_results.append(("SEC Imports", test_sec_imports()))
    test_results.append(("SEC Service", test_sec_service()))
    test_results.append(("Company Data Access", test_company_data_access()))
    test_results.append(("Time Series Util", test_time_series_util()))
    
    # Summary
    print("\n" + "=" * 50)
    print("🎯 Test Summary:")
    
    passed = 0
    total = len(test_results)
    
    for test_name, result in test_results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"   {test_name}: {status}")
        if result:
            passed += 1
    
    print(f"\nOverall: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed! SEC integration is ready to use.")
        print("\nNext steps:")
        print("1. Run: python download_max_data.py AAPL")
        print("2. Check results: python time_series_util.py AAPL")
    else:
        print("\n⚠️  Some tests failed. Please check the errors above.")

if __name__ == "__main__":
    main()