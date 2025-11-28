#!/usr/bin/env python3
"""
Helper script to load and inspect cached SEC data for troubleshooting
"""

import pickle
import pandas as pd
import json
from pathlib import Path

def load_cached_data(cache_dir: str = './sec_data_cache', verbose: bool = True):
    """
    Load cached SEC data from disk
    
    Returns:
        dict with keys: 'raw_data_bag', 'num_df', 'pre_df', 'sub_df', 'metadata', 'summary'
    """
    cache_path = Path(cache_dir)
    
    if not cache_path.exists():
        print(f"Error: Cache directory not found: {cache_path}")
        print(f"Run 'python save_filtered_sec_data.py' first to create the cache")
        return None
    
    if verbose:
        print(f"Loading cached SEC data from: {cache_path.absolute()}")
        print("=" * 70)
    
    data = {}
    
    # Load pickle (complete raw data bag)
    pickle_file = cache_path / 'raw_data_bag.pkl'
    if pickle_file.exists():
        with open(pickle_file, 'rb') as f:
            data['raw_data_bag'] = pickle.load(f)
        if verbose:
            print(f"✓ Loaded raw_data_bag from pickle")
    
    # Load parquet files
    num_df_file = cache_path / 'num_df.parquet'
    if num_df_file.exists():
        data['num_df'] = pd.read_parquet(num_df_file)
        if verbose:
            print(f"✓ Loaded num_df: {data['num_df'].shape}")
    
    pre_df_file = cache_path / 'pre_df.parquet'
    if pre_df_file.exists():
        data['pre_df'] = pd.read_parquet(pre_df_file)
        if verbose:
            print(f"✓ Loaded pre_df: {data['pre_df'].shape}")
    
    sub_df_file = cache_path / 'sub_df.parquet'
    if sub_df_file.exists():
        data['sub_df'] = pd.read_parquet(sub_df_file)
        if verbose:
            print(f"✓ Loaded sub_df: {data['sub_df'].shape}")
    
    # Load metadata
    metadata_file = cache_path / 'metadata.json'
    if metadata_file.exists():
        with open(metadata_file, 'r') as f:
            data['metadata'] = json.load(f)
        if verbose:
            print(f"✓ Loaded metadata")
    
    # Load summary
    summary_file = cache_path / 'summary.json'
    if summary_file.exists():
        with open(summary_file, 'r') as f:
            data['summary'] = json.load(f)
        if verbose:
            print(f"✓ Loaded summary")
    
    if verbose:
        print("=" * 70)
        print(f"✓ All cached data loaded successfully!")
    
    return data

def inspect_cached_data(cache_dir: str = './sec_data_cache'):
    """Quick inspection of cached data"""
    data = load_cached_data(cache_dir)
    
    if not data:
        return
    
    print("\n" + "=" * 70)
    print("DATA INSPECTION")
    print("=" * 70)
    
    # Show metadata
    if 'metadata' in data:
        meta = data['metadata']
        print(f"\nExtraction Date: {meta['extraction_date']}")
        print(f"Tickers: {', '.join(meta['tickers'])}")
        print(f"\nCIK Mappings:")
        for ticker, cik in meta['cik_map'].items():
            print(f"  {ticker}: {cik}")
    
    # Show summary statistics
    if 'summary' in data:
        summary = data['summary']
        print(f"\nData Statistics:")
        print(f"  Unique filings (adsh): {summary['unique_adsh']}")
        print(f"  Unique tags: {summary['unique_tags']}")
        print(f"  Date range: {summary['date_range']['min']} to {summary['date_range']['max']}")
        
        print(f"\nPer-Ticker Statistics:")
        for ticker, stats in summary['data_by_cik'].items():
            print(f"  {ticker}:")
            print(f"    Records: {stats['num_records']:,}")
            print(f"    Filings: {stats['unique_adsh']}")
            print(f"    Tags: {stats['unique_tags']}")
    
    # Show sample data
    if 'num_df' in data:
        print(f"\nnum_df columns: {list(data['num_df'].columns)}")
        print(f"\nSample num_df rows:")
        print(data['num_df'].head())
    
    if 'pre_df' in data:
        print(f"\npre_df columns: {list(data['pre_df'].columns)}")
        print(f"\nSample pre_df rows:")
        print(data['pre_df'].head())
    
    return data

def filter_by_ticker(data, ticker: str, verbose: bool = True):
    """Filter cached data for a specific ticker"""
    if 'summary' not in data:
        print("Error: Summary data not found")
        return None
    
    cik = data['summary']['data_by_cik'].get(ticker, {}).get('cik')
    if not cik:
        print(f"Error: Ticker {ticker} not found in cached data")
        print(f"Available tickers: {', '.join(data['summary']['data_by_cik'].keys())}")
        return None
    
    cik_padded = str(cik).zfill(10)
    
    filtered_data = {}
    
    if 'num_df' in data:
        filtered_data['num_df'] = data['num_df'][data['num_df']['adsh'].str.startswith(cik_padded)]
        if verbose:
            print(f"✓ Filtered num_df for {ticker}: {filtered_data['num_df'].shape}")
    
    if 'pre_df' in data:
        # pre_df filtering requires matching adsh values
        ticker_adsh = filtered_data['num_df']['adsh'].unique()
        filtered_data['pre_df'] = data['pre_df'][data['pre_df']['adsh'].isin(ticker_adsh)]
        if verbose:
            print(f"✓ Filtered pre_df for {ticker}: {filtered_data['pre_df'].shape}")
    
    if 'sub_df' in data:
        filtered_data['sub_df'] = data['sub_df'][data['sub_df']['adsh'].isin(ticker_adsh)]
        if verbose:
            print(f"✓ Filtered sub_df for {ticker}: {filtered_data['sub_df'].shape}")
    
    return filtered_data

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Load and inspect cached SEC data')
    parser.add_argument('--cache-dir', '-c', default='./sec_data_cache',
                       help='Cache directory (default: ./sec_data_cache)')
    parser.add_argument('--ticker', '-t', help='Filter for specific ticker (AAPL, PG, or GOOG)')
    parser.add_argument('--inspect', '-i', action='store_true', help='Show detailed inspection')
    
    args = parser.parse_args()
    
    if args.inspect:
        data = inspect_cached_data(args.cache_dir)
    else:
        data = load_cached_data(args.cache_dir)
    
    if data and args.ticker:
        print(f"\n" + "=" * 70)
        print(f"Filtering for {args.ticker.upper()}")
        print("=" * 70)
        filtered = filter_by_ticker(data, args.ticker.upper())
        
        if filtered:
            print(f"\n✓ Filtered data ready for use")
            print(f"\nExample: Access filtered data with:")
            print(f"  filtered['num_df']  # Numeric data for {args.ticker.upper()}")
            print(f"  filtered['pre_df']  # Presentation data for {args.ticker.upper()}")

if __name__ == '__main__':
    main()
