#!/usr/bin/env python3
"""
SEC Database Initialization Script

Properly initialize the secfsdstools database from scratch.
"""

import os
import sys
from pathlib import Path

def initialize_sec_database():
    """Initialize SEC database from scratch"""
    try:
        print("🔧 Initializing SEC Database...")
        
        # Create the necessary directories
        home_dir = Path.home()
        sec_data_dir = home_dir / "secfsdstools" / "data"
        db_dir = sec_data_dir / "db"
        download_dir = sec_data_dir / "dld"
        parquet_dir = sec_data_dir / "parquet"
        
        # Create directories if they don't exist
        for directory in [sec_data_dir, db_dir, download_dir, parquet_dir]:
            directory.mkdir(parents=True, exist_ok=True)
            print(f"✅ Created directory: {directory}")
        
        # Create configuration file
        config_file = home_dir / ".secfsdstools.cfg"
        config_content = f"""[DEFAULT]
downloaddirectory = {download_dir}
dbdirectory = {db_dir}
parquetdirectory = {parquet_dir}
useragentemail = your.email@example.com
autoupdate = True
keepzipfiles = False
noparallelprocessing = False
dailyprocessing = False
"""
        
        with open(config_file, 'w') as f:
            f.write(config_content)
        print(f"✅ Created config file: {config_file}")
        
        # Initialize the database using DbCreator
        from secfsdstools.b_setup.setupdb import DbCreator
        
        print(f"🗄️  Creating SEC database in: {db_dir}")
        db_creator = DbCreator(str(db_dir))
        db_creator.create_db()
        print("✅ SEC database created successfully")
        
        return True
        
    except Exception as e:
        print(f"❌ Error initializing SEC database: {e}")
        import traceback
        traceback.print_exc()
        return False

def download_sec_data():
    """Download initial SEC data"""
    try:
        print("\n📥 Downloading SEC data...")
        
        # Import after database is created
        from secfsdstools.update import update
        
        print("Starting SEC data download (this may take several minutes)...")
        update()
        print("✅ SEC data download completed")
        
        return True
        
    except Exception as e:
        print(f"❌ Error downloading SEC data: {e}")
        import traceback
        traceback.print_exc()
        return False

def test_sec_setup():
    """Test that SEC setup is working"""
    try:
        print("\n🧪 Testing SEC setup...")
        
        from secfsdstools.e_collector.companycollecting import CompanyReportCollector
        
        # Try to create a collector for a known company
        collector = CompanyReportCollector.get_company_collector("AAPL")
        print("✅ Successfully created company collector for AAPL")
        
        # Try to get some data
        raw_bags = collector.get_all_company_filing_rawdatabags()
        print(f"✅ Found {len(raw_bags)} SEC filings for AAPL")
        
        if raw_bags:
            sample_bag = raw_bags[0]
            print(f"   Sample filing: {sample_bag.form} from {sample_bag.filing_date}")
        
        return True
        
    except Exception as e:
        print(f"❌ Error testing SEC setup: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Main initialization process"""
    print("🚀 SEC Database Setup")
    print("=" * 50)
    
    # Step 1: Initialize database
    if not initialize_sec_database():
        print("❌ Database initialization failed")
        return False
    
    # Step 2: Download data
    if not download_sec_data():
        print("❌ Data download failed")
        return False
    
    # Step 3: Test setup
    if not test_sec_setup():
        print("❌ Setup test failed")
        return False
    
    print("\n🎉 SEC Database Setup Complete!")
    print("\nNext steps:")
    print("1. Run: python download_max_data.py AAPL")
    print("2. Check results: python time_series_util.py AAPL")
    
    return True

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)