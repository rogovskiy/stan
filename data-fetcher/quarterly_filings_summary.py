#!/usr/bin/env python3
"""
Generate summary table of quarterly filings per year for each ticker
"""

from load_cached_sec_data import load_cached_data, filter_by_ticker
import pandas as pd
from collections import defaultdict

def generate_quarterly_summary(cache_dir: str = './sec_data_cache'):
    """
    Generate a summary table showing quarterly filings per year for each ticker
    """
    print("Loading cached SEC data...")
    data = load_cached_data(cache_dir)
    
    if not data:
        print("Error: Could not load cached data")
        return
    
    summary = data.get('summary', {})
    tickers = list(summary.get('data_by_cik', {}).keys())
    
    print(f"\nAnalyzing tickers: {', '.join(tickers)}")
    print("=" * 100)
    
    # Process each ticker
    all_results = []
    
    for ticker in tickers:
        print(f"\nProcessing {ticker}...")
        filtered = filter_by_ticker(data, ticker)
        
        if not filtered or 'num_df' not in filtered:
            continue
        
        num_df = filtered['num_df']
        
        # Filter for quarterly data (qtrs=1) with revenue tag
        quarterly_df = num_df[
            (num_df['qtrs'] == 1) & 
            (num_df['tag'] == 'Revenues')
        ].copy()
        
        if len(quarterly_df) == 0:
            print(f"  No quarterly revenue data found for {ticker}")
            continue
        
        # Parse dates and assign fiscal quarters
        quarterly_df['year'] = quarterly_df['ddate'].astype(str).str[:4].astype(int)
        quarterly_df['month'] = quarterly_df['ddate'].astype(str).str[4:6].astype(int)
        
        # Determine fiscal quarter based on month (Apple's fiscal year logic)
        def get_fiscal_info(row):
            month = row['month']
            year = row['year']
            
            if month in [10, 11, 12]:  # Oct-Dec -> Q1 of next fiscal year
                return pd.Series({'fiscal_quarter': 1, 'fiscal_year': year + 1})
            elif month in [1, 2, 3]:  # Jan-Mar -> Q2
                return pd.Series({'fiscal_quarter': 2, 'fiscal_year': year})
            elif month in [4, 5, 6]:  # Apr-Jun -> Q3
                return pd.Series({'fiscal_quarter': 3, 'fiscal_year': year})
            else:  # Jul-Sep -> Q4
                return pd.Series({'fiscal_quarter': 4, 'fiscal_year': year})
        
        quarterly_df[['fiscal_quarter', 'fiscal_year']] = quarterly_df.apply(get_fiscal_info, axis=1)
        
        # Group by fiscal year and quarter - count unique filings (adsh)
        filings_by_year_quarter = defaultdict(lambda: {'Q1': 0, 'Q2': 0, 'Q3': 0, 'Q4': 0})
        
        # Group by fiscal year and quarter, counting unique accession numbers
        grouped = quarterly_df.groupby(['fiscal_year', 'fiscal_quarter'])['adsh'].nunique()
        
        for (fy, fq), count in grouped.items():
            filings_by_year_quarter[fy][f'Q{fq}'] = count
        
        # Convert to list of results
        for fy in sorted(filings_by_year_quarter.keys()):
            quarters = filings_by_year_quarter[fy]
            all_results.append({
                'SYMBOL': ticker,
                'YEAR': fy,
                'Q1': quarters['Q1'],
                'Q2': quarters['Q2'],
                'Q3': quarters['Q3'],
                'Q4': quarters['Q4'],
                'TOTAL': quarters['Q1'] + quarters['Q2'] + quarters['Q3'] + quarters['Q4']
            })
    
    # Create DataFrame and display
    if not all_results:
        print("\nNo quarterly filing data found")
        return
    
    df = pd.DataFrame(all_results)
    
    print("\n" + "=" * 100)
    print("QUARTERLY FILINGS SUMMARY")
    print("=" * 100)
    print("\nTable shows number of quarterly filings (10-Q) per quarter for each fiscal year")
    print("Note: Q4 data is typically included in annual reports (10-K), not separate 10-Q filings")
    print()
    
    # Display table
    print(df.to_string(index=False))
    
    # Summary statistics
    print("\n" + "=" * 100)
    print("SUMMARY STATISTICS")
    print("=" * 100)
    
    for ticker in tickers:
        ticker_df = df[df['SYMBOL'] == ticker]
        if len(ticker_df) == 0:
            continue
        
        print(f"\n{ticker}:")
        print(f"  Total fiscal years: {len(ticker_df)}")
        print(f"  Total Q1 filings: {ticker_df['Q1'].sum()}")
        print(f"  Total Q2 filings: {ticker_df['Q2'].sum()}")
        print(f"  Total Q3 filings: {ticker_df['Q3'].sum()}")
        print(f"  Total Q4 filings: {ticker_df['Q4'].sum()}")
        print(f"  Total quarterly filings: {ticker_df['TOTAL'].sum()}")
        
        # Find years with missing quarters
        missing_q4 = ticker_df[ticker_df['Q4'] == 0]
        if len(missing_q4) > 0:
            print(f"  ⚠️  Years missing Q4: {sorted(missing_q4['YEAR'].tolist())}")
        
        complete_years = ticker_df[(ticker_df['Q1'] > 0) & (ticker_df['Q2'] > 0) & 
                                   (ticker_df['Q3'] > 0) & (ticker_df['Q4'] > 0)]
        print(f"  ✓ Years with all 4 quarters: {len(complete_years)}")
    
    return df

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Generate quarterly filings summary table')
    parser.add_argument('--cache-dir', '-c', default='./sec_data_cache',
                       help='Cache directory (default: ./sec_data_cache)')
    parser.add_argument('--output', '-o', help='Output CSV file path (optional)')
    
    args = parser.parse_args()
    
    df = generate_quarterly_summary(args.cache_dir)
    
    if df is not None and args.output:
        df.to_csv(args.output, index=False)
        print(f"\n✓ Saved to {args.output}")

if __name__ == '__main__':
    main()
