#!/usr/bin/env python3
"""
SEC Only Test - No Firebase

Test SEC functionality without requiring Firebase credentials.
"""

import traceback
import sys

def test_sec_without_firebase():
    """Test SEC imports and basic functionality without Firebase"""
    try:
        print("Testing SEC imports...")
        
        from secfsdstools.e_collector.companycollecting import CompanyReportCollector
        print("✅ CompanyReportCollector imported successfully")
        
        from secfsdstools.f_standardize.is_standardize import IncomeStatementStandardizer
        print("✅ IncomeStatementStandardizer imported successfully")
        
        print("\nTesting basic SEC data access...")
        
        # Try to get a collector for Apple
        try:
            collector = CompanyReportCollector.get_company_collector("AAPL")
            print("✅ Created collector for AAPL")
        except Exception as e:
            print(f"❌ Error creating collector:")
            print(f"Exception: {e}")
            print("Full traceback:")
            traceback.print_exc()
            return False
        
        # Try to get some basic info
        try:
            raw_bags = collector.get_all_company_filing_rawdatabags()
            print(f"✅ Found {len(raw_bags)} SEC filings for AAPL")
        except Exception as e:
            print(f"❌ Error getting raw data bags:")
            print(f"Exception: {e}")
            print("Full traceback:")
            traceback.print_exc()
            return False
        
        if raw_bags and len(raw_bags) > 0:
            # Show info about first few filings
            print("\nRecent filings:")
            for i, bag in enumerate(raw_bags[:5]):
                try:
                    print(f"   {i+1}. {bag.form} filed on {bag.filing_date} (FY {bag.fiscal_year})")
                except Exception as e:
                    print(f"   {i+1}. Error displaying bag info: {e}")
                
            # Try to process one filing
            test_bag = raw_bags[0]
            print(f"\nTesting data extraction from {test_bag.form}...")
            
            # Try income statement
            try:
                print("Creating IncomeStatementStandardizer...")
                is_standardizer = IncomeStatementStandardizer(test_bag)
                print("Getting standardized data...")
                income_df = is_standardizer.get_standardized_data()
                
                if income_df is not None and not income_df.empty:
                    print(f"✅ Income statement extracted: {income_df.shape[0]} line items")
                    print(f"   Sample items: {list(income_df.index[:3])}")
                else:
                    print("⚠️  Income statement is empty")
                    
            except Exception as e:
                print(f"❌ Error extracting income statement:")
                print(f"Exception: {e}")
                print("Full traceback:")
                traceback.print_exc()
                # Continue with test even if this fails
        
        return True
        
    except Exception as e:
        print(f"❌ Unexpected error in main test:")
        print(f"Exception: {e}")
        print("Full traceback:")
        traceback.print_exc()
        return False

def test_sec_configuration():
    """Test SEC configuration and database status"""
    try:
        print("\n" + "="*50)
        print("Testing SEC Configuration...")
        
        # Check if we can access configuration
        try:
            import os
            config_file = os.path.expanduser("~/.secfsdstools.cfg")
            if os.path.exists(config_file):
                print(f"✅ Config file found at: {config_file}")
            else:
                print(f"❌ Config file not found at: {config_file}")
        except Exception as e:
            print(f"❌ Error checking config file: {e}")
            traceback.print_exc()
        
        # Check database directory
        try:
            db_dir = os.path.expanduser("~/secfsdstools/data/db")
            if os.path.exists(db_dir):
                print(f"✅ Database directory found: {db_dir}")
                
                db_file = os.path.join(db_dir, "secfsdstools.db")
                if os.path.exists(db_file):
                    size_mb = os.path.getsize(db_file) / (1024 * 1024)
                    print(f"✅ Database file exists: {db_file} ({size_mb:.1f} MB)")
                else:
                    print(f"❌ Database file not found: {db_file}")
            else:
                print(f"❌ Database directory not found: {db_dir}")
        except Exception as e:
            print(f"❌ Error checking database: {e}")
            traceback.print_exc()
            
    except Exception as e:
        print(f"❌ Error in configuration test: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    print("🧪 SEC Only Test (No Firebase) - With Full Stack Traces")
    print("=" * 60)
    
    # Test configuration first
    test_sec_configuration()
    
    # Test main functionality
    print("\n" + "="*50)
    print("Testing SEC Functionality...")
    
    success = test_sec_without_firebase()
    
    if success:
        print("\n🎉 SEC data access is working!")
        print("\nNext steps:")
        print("1. Set up Firebase credentials in your environment")
        print("2. Test the full integration with caching")
    else:
        print("\n❌ SEC test failed - check the errors and stack traces above")
        sys.exit(1)