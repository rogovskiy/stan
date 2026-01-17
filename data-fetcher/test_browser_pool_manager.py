#!/usr/bin/env python3
"""
Test program for browser_pool_manager.py

Tests loading a page and downloading documents using the browser pool manager.
"""

import os
from browser_pool_manager import BrowserPoolManager

browser_pool_manager = BrowserPoolManager()

def test_load_page():
    """Test loading a page using the browser pool manager."""
    url = 'https://ir.energytransfer.com/presentations-webcasts/'
    print(f'\n{"="*80}')
    print(f'Test 1: Loading page')
    print(f'{"="*80}')
    print(f'URL: {url}\n')
    
    html_content = browser_pool_manager.get_page_html(url, verbose=True)
    
    if html_content:
        print(f'\n✓ Successfully loaded page')
        print(f'  HTML length: {len(html_content)} characters')
        print(f'  First 200 characters: {html_content[:200]}...')
        return True
    else:
        print(f'\n✗ Failed to load page')
        return False


def test_download_document(url: str, test_name: str):
    """Test downloading a document using the browser pool manager.
    
    Args:
        url: URL to download
        test_name: Name of the test (for output)
    """
    print(f'\n{"="*80}')
    print(f'Test {test_name}: Downloading document')
    print(f'{"="*80}')
    print(f'URL: {url}\n')
    
    content = browser_pool_manager.download_document(url, verbose=True)
    
    if content:
        print(f'\n✓ Successfully downloaded document')
        print(f'  Content length: {len(content)} bytes')
        
        # Save to file for verification
        filename = url.split('/')[-1]
        if not filename or len(filename) < 3:
            filename = f'downloaded_file_{test_name}'
        
        # Determine file extension based on content
        if content.startswith(b'%PDF'):
            filename += '.pdf'
        elif content.startswith(b'PK'):
            filename += '.zip'
        elif content.startswith(b'<!DOCTYPE') or content.startswith(b'<html'):
            filename += '.html'
        
        filepath = os.path.join(os.path.dirname(__file__), filename)
        with open(filepath, 'wb') as f:
            f.write(content)
        print(f'  Saved to: {filepath}')
        return True
    else:
        print(f'\n✗ Failed to download document')
        return False


def main():
    """Run all tests."""
    print('\n' + '='*80)
    print('Browser Pool Manager Test Suite')
    print('='*80)
    
    results = []
    
    # Test 1: Load page
    results.append(('Load page', test_load_page()))
    
    # Test 2: Download first PDF
    pdf1_url = 'https://ir.energytransfer.com/static-files/ea4d19a6-686d-42fb-9fb8-2fc0476df2b6'
    results.append(('Download PDF 1', test_download_document(pdf1_url, '2')))
    
    # Test 3: Download second PDF
    pdf2_url = 'https://ir.energytransfer.com/static-files/909d8b90-95d7-4265-9c97-9c122580d5e4'
    results.append(('Download PDF 2', test_download_document(pdf2_url, '3')))
    
    # Print summary
    print(f'\n{"="*80}')
    print('Test Summary')
    print('='*80)
    for test_name, success in results:
        status = '✓ PASSED' if success else '✗ FAILED'
        print(f'{status}: {test_name}')
    
    total = len(results)
    passed = sum(1 for _, success in results if success)
    print(f'\nTotal: {passed}/{total} tests passed')
    
    if passed == total:
        print('\n✓ All tests passed!')
        return 0
    else:
        print(f'\n✗ {total - passed} test(s) failed')
        return 1


if __name__ == '__main__':
    exit(main())

