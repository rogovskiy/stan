# Stock Data Download Scripts

This directory contains scripts for downloading and caching stock data from Yahoo Finance.

## downloadMaxData.ts

Downloads and caches maximum available historical data from Yahoo Finance for a given ticker.

### Features

- **Historical Price Data**: Downloads up to 50 years of daily price data (open, high, low, close, volume)
- **Financial Data**: Downloads quarterly earnings history and forecasts
- **Company Metadata**: Downloads company name, exchange, sector information
- **Smart Caching**: Uses Firebase Storage for efficient data storage and retrieval
- **Data Verification**: Verifies cached data integrity after download

### Usage

```bash
# Basic usage
npx ts-node scripts/downloadMaxData.ts AAPL

# Clear existing cache and download fresh data
npx ts-node scripts/downloadMaxData.ts MSFT --clear

# Verbose output showing detailed progress
npx ts-node scripts/downloadMaxData.ts GOOGL --verbose

# Limit historical data to last 20 years
npx ts-node scripts/downloadMaxData.ts TSLA --max-years=20

# Combine options
npx ts-node scripts/downloadMaxData.ts AMZN --clear --verbose --max-years=30
```

### Options

- `--clear`: Clear existing cache before downloading fresh data
- `--verbose`: Show detailed progress information during download
- `--max-years=<N>`: Maximum years to go back for historical data (default: 50)

### Data Storage

The script organizes data in Firebase as follows:

#### Price Data
- **Location**: Firebase Storage at `price_data/{TICKER}/{YEAR}.json`
- **Format**: Annual JSON files containing daily OHLCV data
- **Metadata**: Stored in Firestore with references to storage files

#### Financial Data
- **Location**: Firestore at `tickers/{TICKER}/quarters/{QUARTER}`
- **Format**: Quarterly documents containing EPS and other financial metrics
- **Coverage**: Historical earnings and future estimates

#### Company Metadata
- **Location**: Firestore at `tickers/{TICKER}`
- **Content**: Company name, exchange, sector, last update timestamp

### Example Output

```
🚀 Starting maximum data download for AAPL
Options: clearExisting=false, maxYearsBack=50

📋 Fetching company metadata...
✅ Metadata cached for AAPL

📈 Fetching maximum historical price data...
   Fetching data from 1975-11-17 to 2025-11-17
   Retrieved 12,847 daily price points
   Organized data into 50 years
✅ Cached 50 years of price data for AAPL

💰 Fetching financial and earnings data...
   Found 20 historical earnings records
   Found 4 quarterly forecasts
✅ Cached 24 quarters of financial data for AAPL

🔍 Verifying cached data...
   Cache verification for AAPL:
   ✓ Price data complete: Yes
   ✓ Financial data complete: Yes
   ✓ Metadata: Apple Inc. (NASDAQ)

🎉 Maximum data download completed successfully for AAPL!
```

### Error Handling

- **Network Issues**: Retries failed requests automatically
- **Missing Data**: Continues processing even if some data is unavailable
- **Cache Failures**: Reports specific failures while continuing with other data
- **Invalid Tickers**: Provides clear error messages for non-existent symbols

### Performance

- **Parallel Processing**: Downloads and caches data efficiently
- **Smart Caching**: Avoids re-downloading existing data unless expired
- **Compression**: Stores data in optimized JSON format
- **Rate Limiting**: Respects Yahoo Finance API limits

### Dependencies

- `yahoo-finance2`: For fetching data from Yahoo Finance
- `firebase/firestore`: For metadata and financial data storage
- `firebase/storage`: For historical price data files
- `dotenv`: For environment configuration

### Environment Setup

Ensure your `.env` file contains the required Firebase configuration:

```env
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_auth_domain
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_STORAGE_BUCKET=your_storage_bucket
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
```

### Troubleshooting

1. **Permission Errors**: Ensure Firebase credentials have read/write access
2. **Network Timeouts**: Try reducing `--max-years` for initial downloads
3. **Invalid Ticker**: Verify the ticker symbol exists on Yahoo Finance
4. **Storage Quota**: Monitor Firebase Storage usage for large datasets