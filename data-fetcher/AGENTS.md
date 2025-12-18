# AGENTS.md - Data Fetcher Instructions

This document provides instructions for AI agents working with the data-fetcher codebase.

## ⚠️ CRITICAL: Always Use Virtual Environment (venv)

**ALWAYS use a Python virtual environment when running any Python scripts in this directory.**

### Setting Up Virtual Environment

1. **Create a virtual environment** (if it doesn't exist):
   ```bash
   cd data-fetcher
   python3 -m venv venv
   ```

2. **Activate the virtual environment**:
   ```bash
   source venv/bin/activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Verify activation**: Your terminal prompt should show `(venv)` prefix when activated.

### Running Python Scripts

**ALWAYS ensure the virtual environment is activated before running any Python script:**

```bash
# Make sure venv is activated (you should see (venv) in your prompt)
source venv/bin/activate  # if not already activated

# Then run scripts
python download_max_data.py AAPL
python extract_kpis.py --ticker AAPL
python generate_quarterly_summary.py --ticker AAPL
```

### Coding Principals

- Don't assume the code should be backward compatible by default. Avoid creating multiple fallbacks unless specified or confirmed by the human.

## Project Structure

### Core Services
- `yfinance_service.py` - Yahoo Finance data fetching
- `firebase_cache.py` - Firebase Firestore and Storage caching
- `unified_data_service.py` - Unified data access layer
- `cik_lookup_service.py` - SEC CIK lookup functionality

### Data Extraction
- `extract_kpis.py` - Extract KPIs from SEC filings
- `extract_sec_financials.py` - Extract financial data from SEC filings
- `document_text_extractor.py` - Extract text from SEC documents

### Data Generation
- `generate_company_summary.py` - Generate company summaries
- `generate_quarterly_summary.py` - Generate quarterly analysis summaries
- `generate_quarterly_timeseries.py` - Generate quarterly timeseries data

### Utilities
- `download_max_data.py` - Main script for downloading maximum historical data
- `financial_data_validator.py` - Validate financial data
- `inspect_firebase_data.py` - Inspect Firebase data
- `load_cached_sec_data.py` - Load cached SEC data
- `save_filtered_sec_data.py` - Save filtered SEC data
- `fetch_analyst_data.py` - Fetch analyst data
- `scan_ir_website.py` - Scan investor relations websites
- `quarterly_filings_summary.py` - Generate quarterly filings summary

### Testing
- `test_sec_financials.py` - Test SEC financials extraction
- `test_stock_split_eps.py` - Test stock split and EPS calculations

## Environment Variables

The project requires Firebase configuration via environment variables. See `README.md` for details.

Required environment variables:
- `FIREBASE_PROJECT_ID`
- `FIREBASE_PRIVATE_KEY_ID`
- `FIREBASE_PRIVATE_KEY`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_CLIENT_ID`
- `FIREBASE_AUTH_URI`
- `FIREBASE_TOKEN_URI`

These should be set in a `.env.local` file (not committed to git).

## Common Tasks

### Running Scripts

Always follow this pattern:
1. Activate venv: `source venv/bin/activate`
2. Run script: `python <script_name>.py [args]`

### Adding Dependencies

1. Activate venv
2. Install package: `pip install <package_name>`
3. Update requirements: `pip freeze > requirements.txt`

### Testing Changes

1. Activate venv
2. Run test scripts: `python test_*.py`

## Code Style

- Follow PEP 8 Python style guide
- Use type hints where appropriate
- Add docstrings to functions and classes
- Handle errors gracefully with try/except blocks

## Firebase Data Structure

- **Price data**: `price_data/{TICKER}/{YEAR}.json` in Storage
- **Financial data**: `tickers/{TICKER}/quarters/{YEAR}Q{QUARTER}` in Firestore
- **Metadata**: `tickers/{TICKER}` in Firestore

## Cache Expiration Policies

- Metadata: 7 days
- Price data (current year): 24 hours
- Price data (past years): 30 days
- Financial data: 12 hours

## When Making Changes

1. **Always activate venv first**
2. Test your changes with sample tickers (e.g., AAPL, MSFT)
3. Verify Firebase data structure compatibility
4. Check that error handling is appropriate
5. Update documentation if adding new features

## Troubleshooting

### Import Errors
- **Check venv is activated**: Look for `(venv)` in prompt
- **Reinstall dependencies**: `pip install -r requirements.txt`

### Firebase Connection Issues
- Verify environment variables are set correctly
- Check service account permissions
- Ensure Firebase project ID is correct

### Script Execution Errors
- Ensure venv is activated
- Check Python version compatibility (Python 3.8+)
- Verify all dependencies are installed


