#!/usr/bin/env python3
"""
Extract and save filtered SEC data for AAPL, PG, and GOOG for troubleshooting
This creates a local cache of the raw SEC data to speed up debugging
"""

from secfsdstools.e_collector.companycollecting import CompanyReportCollector
from cik_lookup_service import CIKLookupService
import pandas as pd
import pickle
import json
from pathlib import Path
from datetime import datetime

def save_filtered_sec_data(output_dir: str = './sec_data_cache'):
    """
    Extract and save SEC data for AAPL, PG, and GOOG
    
    Args:
        output_dir: Directory to save the cached data
    """
    # Create output directory
    output_path = Path(output_dir)
    output_path.mkdir(exist_ok=True)
    
    # Target tickers
    tickers = ['AAPL', 'PG', 'GOOG']
    
    print(f"Extracting SEC data for: {', '.join(tickers)}")
    print(f"Output directory: {output_path.absolute()}")
    print("=" * 70)
    
    # Get CIKs
    cik_service = CIKLookupService()
    cik_map = {}
    ciks = []
    
    for ticker in tickers:
        cik = cik_service.get_cik_by_ticker(ticker)
        if cik:
            cik_map[ticker] = cik
            ciks.append(cik)
            print(f"✓ {ticker}: CIK {cik}")
        else:
            print(f"✗ {ticker}: CIK not found")
    
    if not ciks:
        print("\nError: No valid CIKs found!")
        return
    
    print(f"\nFetching SEC data from secfsdstools database...")
    
    # Collect data for all companies
    collector = CompanyReportCollector.get_company_collector(ciks)
    raw_data_bag = collector.collect()
    
    # Save metadata
    metadata = {
        'extraction_date': datetime.now().isoformat(),
        'tickers': tickers,
        'cik_map': cik_map,
        'num_df_shape': raw_data_bag.num_df.shape,
        'pre_df_shape': raw_data_bag.pre_df.shape,
        'sub_df_shape': raw_data_bag.sub_df.shape if hasattr(raw_data_bag, 'sub_df') else None,
        'txt_df_shape': raw_data_bag.txt_df.shape if hasattr(raw_data_bag, 'txt_df') else None,
    }
    
    print(f"\n✓ Data collected successfully!")
    print(f"  - num_df (numeric data): {metadata['num_df_shape']} rows x columns")
    print(f"  - pre_df (presentation data): {metadata['pre_df_shape']} rows x columns")
    if metadata['sub_df_shape']:
        print(f"  - sub_df (submission data): {metadata['sub_df_shape']} rows x columns")
    if metadata['txt_df_shape']:
        print(f"  - txt_df (text data): {metadata['txt_df_shape']} rows x columns")
    
    # Save raw data bags as pickle (preserves exact data types)
    print(f"\nSaving data files...")
    
    pickle_file = output_path / 'raw_data_bag.pkl'
    with open(pickle_file, 'wb') as f:
        pickle.dump(raw_data_bag, f)
    print(f"✓ Saved pickle: {pickle_file} ({pickle_file.stat().st_size / 1024 / 1024:.1f} MB)")
    
    # Save individual dataframes as parquet (efficient, readable)
    num_df_file = output_path / 'num_df.parquet'
    raw_data_bag.num_df.to_parquet(num_df_file, index=False)
    print(f"✓ Saved num_df: {num_df_file} ({num_df_file.stat().st_size / 1024 / 1024:.1f} MB)")
    
    pre_df_file = output_path / 'pre_df.parquet'
    raw_data_bag.pre_df.to_parquet(pre_df_file, index=False)
    print(f"✓ Saved pre_df: {pre_df_file} ({pre_df_file.stat().st_size / 1024 / 1024:.1f} MB)")
    
    if hasattr(raw_data_bag, 'sub_df'):
        sub_df_file = output_path / 'sub_df.parquet'
        raw_data_bag.sub_df.to_parquet(sub_df_file, index=False)
        print(f"✓ Saved sub_df: {sub_df_file} ({sub_df_file.stat().st_size / 1024 / 1024:.1f} MB)")
    
    if hasattr(raw_data_bag, 'txt_df'):
        txt_df_file = output_path / 'txt_df.parquet'
        raw_data_bag.txt_df.to_parquet(txt_df_file, index=False)
        print(f"✓ Saved txt_df: {txt_df_file} ({txt_df_file.stat().st_size / 1024 / 1024:.1f} MB)")
    
    # Save metadata as JSON
    metadata_file = output_path / 'metadata.json'
    with open(metadata_file, 'w') as f:
        json.dump(metadata, f, indent=2)
    print(f"✓ Saved metadata: {metadata_file}")
    
    # Create summary statistics
    print(f"\nGenerating summary statistics...")
    
    summary = {
        'metadata': metadata,
        'num_df_columns': list(raw_data_bag.num_df.columns),
        'pre_df_columns': list(raw_data_bag.pre_df.columns),
        'unique_adsh': raw_data_bag.num_df['adsh'].nunique(),
        'unique_tags': raw_data_bag.num_df['tag'].nunique(),
        'date_range': {
            'min': str(raw_data_bag.num_df['ddate'].min()),
            'max': str(raw_data_bag.num_df['ddate'].max())
        },
        'data_by_cik': {}
    }
    
    # Per-ticker statistics
    for ticker, cik in cik_map.items():
        cik_padded = str(cik).zfill(10)
        cik_data = raw_data_bag.num_df[raw_data_bag.num_df['adsh'].str.startswith(cik_padded)]
        
        summary['data_by_cik'][ticker] = {
            'cik': cik,
            'num_records': len(cik_data),
            'unique_adsh': cik_data['adsh'].nunique(),
            'unique_tags': cik_data['tag'].nunique(),
            'date_range': {
                'min': str(cik_data['ddate'].min()),
                'max': str(cik_data['ddate'].max())
            }
        }
        
        print(f"\n  {ticker} (CIK: {cik}):")
        print(f"    - Records: {summary['data_by_cik'][ticker]['num_records']:,}")
        print(f"    - Filings: {summary['data_by_cik'][ticker]['unique_adsh']}")
        print(f"    - Tags: {summary['data_by_cik'][ticker]['unique_tags']}")
        print(f"    - Date range: {summary['data_by_cik'][ticker]['date_range']['min']} to {summary['data_by_cik'][ticker]['date_range']['max']}")
    
    summary_file = output_path / 'summary.json'
    with open(summary_file, 'w') as f:
        json.dump(summary, f, indent=2, default=str)
    print(f"\n✓ Saved summary: {summary_file}")
    
    # Create a README for the cached data
    readme_content = f"""# SEC Data Cache for AAPL, PG, and GOOG

## Overview
This directory contains cached SEC financial data extracted from secfsdstools database.

**Extraction Date:** {metadata['extraction_date']}
**Tickers:** {', '.join(tickers)}

## Files

- `raw_data_bag.pkl` - Complete raw data bag (pickle format, preserves exact data types)
- `num_df.parquet` - Numeric financial data (efficient columnar format)
- `pre_df.parquet` - Presentation/taxonomy data
- `sub_df.parquet` - Submission metadata (if available)
- `txt_df.parquet` - Text blocks (if available)
- `metadata.json` - Extraction metadata and data shapes
- `summary.json` - Detailed statistics and summaries
- `README.md` - This file

## Loading Data

### Load complete data bag (pickle):
```python
import pickle
with open('sec_data_cache/raw_data_bag.pkl', 'rb') as f:
    raw_data_bag = pickle.load(f)
```

### Load individual dataframes (parquet):
```python
import pandas as pd
num_df = pd.read_parquet('sec_data_cache/num_df.parquet')
pre_df = pd.read_parquet('sec_data_cache/pre_df.parquet')
```

## Usage
Use this cached data to speed up debugging and testing without re-querying the SEC database.

## CIK Mappings
{chr(10).join(f'- {ticker}: {cik}' for ticker, cik in cik_map.items())}

## Data Shapes
- num_df: {metadata['num_df_shape'][0]:,} rows × {metadata['num_df_shape'][1]} columns
- pre_df: {metadata['pre_df_shape'][0]:,} rows × {metadata['pre_df_shape'][1]} columns

Generated by: save_filtered_sec_data.py
"""
    
    readme_file = output_path / 'README.md'
    with open(readme_file, 'w') as f:
        f.write(readme_content)
    print(f"✓ Created README: {readme_file}")
    
    print("\n" + "=" * 70)
    print("✓ All data saved successfully!")
    print(f"\nTo load the data in your scripts:")
    print(f"  import pickle")
    print(f"  with open('{pickle_file}', 'rb') as f:")
    print(f"      raw_data_bag = pickle.load(f)")
    print(f"\nOr load individual parquet files:")
    print(f"  import pandas as pd")
    print(f"  num_df = pd.read_parquet('{num_df_file}')")

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Extract and save filtered SEC data for quick troubleshooting')
    parser.add_argument('--output', '-o', default='./sec_data_cache', 
                       help='Output directory for cached data (default: ./sec_data_cache)')
    
    args = parser.parse_args()
    
    save_filtered_sec_data(args.output)

if __name__ == '__main__':
    main()
