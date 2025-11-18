# Data Fetcher - Python Version

Python equivalent of the TypeScript downloadMaxData script for fetching and caching stock data from Yahoo Finance to Firebase.

## Features

- 📈 Downloads maximum available historical price data from Yahoo Finance
- 💰 Fetches earnings and financial data (historical and forecasts)
- 🔥 Caches data to Firebase Firestore and Storage
- ⚡ Smart caching with expiration policies
- 🚀 CLI interface with progress indicators
- 🔍 Data verification and validation

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Set up environment variables in `.env.local`:
```bash
# Firebase Configuration (Service Account)
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY_ID=your-private-key-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
FIREBASE_CLIENT_ID=your-client-id
FIREBASE_AUTH_URI=https://accounts.google.com/o/oauth2/auth
FIREBASE_TOKEN_URI=https://oauth2.googleapis.com/token
```

## Usage

### Basic Usage

Download data for a stock ticker:
```bash
python download_max_data.py AAPL
```

### Advanced Options

```bash
# Clear existing cache before downloading
python download_max_data.py MSFT --clear

# Show detailed progress information
python download_max_data.py GOOGL --verbose

# Limit historical data to specific years
python download_max_data.py TSLA --max-years 10

# Combine options
python download_max_data.py NVDA --clear --verbose --max-years 20
```

### Command Line Options

- `ticker` - Stock ticker symbol (required)
- `--clear` - Clear existing cache before downloading
- `--verbose` - Show detailed progress information
- `--max-years N` - Maximum years to go back (default: 50)

## Architecture

### YFinanceService (`yfinance_service.py`)
- Fetches data from Yahoo Finance using the `yfinance` library
- Handles company metadata, historical prices, and financial data
- Groups daily data by years for efficient storage
- Processes earnings history and forecasts

### FirebaseCache (`firebase_cache.py`)
- Manages data storage in Firebase Firestore and Storage
- Implements smart caching with expiration policies
- Handles data retrieval and verification
- Provides cache clearing functionality

### Data Structure

#### Price Data Storage
- Annual price data stored in Firebase Storage as JSON files
- Path: `price_data/{TICKER}/{YEAR}.json`
- References stored in Firestore: `tickers/{TICKER}/price/consolidated`

#### Financial Data Storage
- Quarterly financial data stored in Firestore
- Path: `tickers/{TICKER}/quarters/{YEAR}Q{QUARTER}`

#### Metadata Storage
- Company metadata stored in Firestore
- Path: `tickers/{TICKER}`

## Cache Expiration

- **Metadata**: 7 days
- **Price data (current year)**: 24 hours
- **Price data (past years)**: 30 days
- **Financial data**: 12 hours

## Error Handling

The script includes comprehensive error handling for:
- Firebase connection issues
- Yahoo Finance API failures
- Data validation errors
- Missing environment variables

## Examples

### Download Apple stock data
```bash
python download_max_data.py AAPL
```

Output:
```
✅ Firebase configuration loaded successfully
📍 Project ID: your-project-id

🚀 Starting maximum data download for AAPL
Options: clearExisting=False, maxYearsBack=50

📋 Fetching company metadata...
✅ Metadata cached for AAPL

📈 Fetching maximum historical price data...
   Fetching data from 1975-11-18 to 2025-11-18
   Retrieved 12543 daily price points
   Organized data into 50 years
✅ Cached 50 years of price data for AAPL

💰 Fetching financial and earnings data...
   📊 Fetching actual financial data from Yahoo Finance...
   Found 4 quarterly earnings records
   Found 2 earnings forecasts
   ✅ Financial data summary:
     - Historical earnings: 4 quarters
     - Forecasts: 2 quarters
     - Total cached: 6 quarters
✅ Cached 6 quarters of financial data for AAPL

🔍 Verifying cached data...
   Cache verification for AAPL:
   ✓ Price data complete: Yes
   ✓ Financial data complete: No
   ✓ Metadata: Apple Inc. (NASDAQ)

🎉 Maximum data download completed successfully for AAPL!
```

## Comparison with TypeScript Version

This Python implementation provides equivalent functionality to the TypeScript version with these key differences:

### Similarities
- Same Firebase data structure and caching strategy
- Identical CLI interface and options
- Same data processing and validation logic
- Compatible cache expiration policies

### Differences
- Uses `yfinance` Python library instead of `yahoo-finance2` Node.js
- Firebase Admin SDK for Python instead of Firebase Web SDK
- Python-specific error handling and logging
- Pandas DataFrame processing for financial data

## Troubleshooting

### Firebase Authentication Issues
1. Verify all environment variables are set correctly
2. Ensure the service account has proper permissions
3. Check that the Firebase project ID is correct

### Yahoo Finance API Issues
1. Some tickers may have limited historical data
2. Financial data availability varies by company
3. Try running with `--verbose` for detailed error information

### Performance
- Large datasets (50 years) may take several minutes to download
- Firebase Storage uploads can be slow for large files
- Use `--max-years` to limit data range for testing