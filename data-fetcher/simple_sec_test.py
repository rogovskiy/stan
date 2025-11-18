#!/usr/bin/env python3
"""
Simple SEC Test

Basic test to verify SEC data access is working.
"""

def test_simple_sec():
    """Test the simplified SEC service"""
    try:
        from sec_data_service_simple import SECDataService
        
        service = SECDataService()
        result = service.test_basic_functionality("AAPL")
        
        print("\nTest Results:")
        print(f"Success: {result['success']}")
        print(f"Message: {result['message']}")
        
        if result['success']:
            print(f"Found {result['bags_found']} SEC filings for AAPL")
        else:
            print(f"Error: {result.get('error', 'Unknown error')}")
        
        return result['success']
        
    except Exception as e:
        print(f"Test failed: {e}")
        return False

if __name__ == "__main__":
    print("🧪 Simple SEC Test")
    print("=" * 30)
    
    success = test_simple_sec()
    
    if success:
        print("\n✅ SEC basic functionality is working!")
    else:
        print("\n❌ SEC test failed")