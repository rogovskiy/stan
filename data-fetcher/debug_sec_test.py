#!/usr/bin/env python3
"""
SEC Debug Test - Enable Debug Logging

Test SEC functionality with debug logging enabled to see the problematic SQL queries.
"""

import logging
import traceback
import sys

def setup_debug_logging():
    """Enable debug logging for secfsdstools"""
    # Set up root logger
    logging.basicConfig(
        level=logging.DEBUG,
        format='%(asctime)s [%(levelname)s] %(name)s - %(message)s',
        handlers=[logging.StreamHandler(sys.stdout)]
    )
    
    # Specifically enable debug for secfsdstools
    secfsds_logger = logging.getLogger('secfsdstools')
    secfsds_logger.setLevel(logging.DEBUG)
    
    # Enable debug for the specific modules we're interested in
    db_logger = logging.getLogger('secfsdstools.a_utils.dbutils')
    db_logger.setLevel(logging.DEBUG)
    
    index_logger = logging.getLogger('secfsdstools.c_index.indexdataaccess')
    index_logger.setLevel(logging.DEBUG)
    
    print("✅ Debug logging enabled")

def test_sec_with_debug():
    """Test SEC functionality with debug logging to see SQL queries"""
    try:
        print("🧪 Testing SEC with debug logging...")
        
        from secfsdstools.e_collector.companycollecting import CompanyReportCollector
        
        print("\nAttempting to create collector for AAPL...")
        print("Watch for SQL debug messages below:")
        print("-" * 50)
        
        # This should trigger the problematic SQL query
        collector = CompanyReportCollector.get_company_collector("AAPL")
        print("✅ Successfully created collector")
        
        print("\nAttempting to get raw data bags...")
        raw_bags = collector.get_all_company_filing_rawdatabags()
        print(f"✅ Found {len(raw_bags)} SEC filings")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Error occurred:")
        print(f"Exception: {e}")
        print("\nFull traceback:")
        traceback.print_exc()
        return False

def test_direct_db_access():
    """Test direct database access to see what tables exist"""
    try:
        print("\n" + "="*50)
        print("🔍 Testing Direct Database Access")
        
        from secfsdstools.a_utils.dbutils import DB
        import os
        
        # Get the database path
        db_dir = os.path.expanduser("~/secfsdstools/data/db")
        db = DB(db_dir)
        
        if not db.db_file_exists():
            print(f"❌ Database file doesn't exist at: {db.database}")
            return False
        
        print(f"✅ Database file exists: {db.database}")
        
        # Check what tables exist
        tables_sql = "SELECT name FROM sqlite_master WHERE type='table'"
        tables = db.execute_fetchall(tables_sql)
        print(f"📋 Available tables: {[table[0] for table in tables]}")
        
        # Check the schema of each table
        for table in tables:
            table_name = table[0]
            schema_sql = f"PRAGMA table_info({table_name})"
            schema = db.execute_fetchall(schema_sql)
            print(f"\n📊 Table '{table_name}' schema:")
            for col in schema:
                print(f"   {col[1]} ({col[2]})")  # column name and type
        
        return True
        
    except Exception as e:
        print(f"❌ Error in direct DB access: {e}")
        traceback.print_exc()
        return False

def main():
    """Main debug test"""
    print("🔧 SEC Debug Test")
    print("=" * 50)
    
    # Enable debug logging first
    setup_debug_logging()
    
    # Test direct database access to understand the schema
    print("\nStep 1: Check database schema")
    db_success = test_direct_db_access()
    
    if not db_success:
        print("❌ Cannot access database - stopping here")
        return False
    
    # Test SEC functionality with debug output
    print("\nStep 2: Test SEC functionality with debug logging")
    sec_success = test_sec_with_debug()
    
    if sec_success:
        print("\n🎉 SEC functionality is working!")
    else:
        print("\n❌ SEC test failed - check debug output above")
    
    return sec_success

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)