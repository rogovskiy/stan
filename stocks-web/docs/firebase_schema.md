# Firestore Schema — Stock Data App (Hybrid Storage Model)

## Overview
This app uses a hybrid storage approach:
- **Firestore**: Metadata, quarterly financials, and consolidated storage references
- **Firebase Storage**: Annual price data files (cheaper for large datasets)
- **Bucket**: `gs://stan-1464e.firebasestorage.app`

Data is organized per ticker symbol for easy range queries and cost-effective storage.

---

## Collections & Documents

### `/tickers/{ticker}` (Metadata)
**Example:** `/tickers/AAPL`
```json
{
  "name": "Apple Inc.",
  "exchange": "NASDAQ", 
  "sector": "Technology",
  "lastUpdated": "2024-11-13T20:14:32.229Z"
}
```

### `/tickers/{ticker}/quarters/{YYYYQ}` (Financial Data)
**Example:** `/tickers/AAPL/quarters/2024Q3`
```json
{
  "fiscalYear": 2024,
  "fiscalQuarter": 3,
  "startDate": "2024-07-01",
  "endDate": "2024-09-30",
  "reportDate": "2024-10-31",
  "financials": {
    "revenue": 89500000000,
    "epsDiluted": 1.42,
    "grossMarginPct": 45.1
  }
}
```

### `/tickers/{ticker}/price/consolidated` (Consolidated Annual Price References)
**Example:** `/tickers/AAPL/price/consolidated`
```json
{
  "lastUpdated": "2024-11-13T20:14:32.229Z",
  "dataSource": "yahoo_finance",
  "years": {
    "2022": {
      "year": 2022,
      "startDate": "2022-01-01",
      "endDate": "2022-12-31",
      "storageRef": "price_data/AAPL/2022.json",
      "downloadUrl": "https://firebasestorage.googleapis.com/v0/b/stan-1464e.firebasestorage.app/o/price_data%2FAAPL%2F2022.json",
      "metadata": {
        "totalDays": 252,
        "firstClose": 177.57,
        "lastClose": 129.93,
        "avgVolume": 89500000,
        "fileSize": 145680,
        "compressed": false
      },
      "lastUpdated": "2024-11-13T20:14:32.229Z"
    }
  }
}
```

---

## Firebase Storage Structure

### **Bucket:** `gs://stan-1464e.firebasestorage.app`

```
price_data/
├── AAPL/
│   ├── 2022.json
│   ├── 2023.json
│   ├── 2024.json
│   └── 2025.json
├── MSFT/
│   ├── 2022.json
│   ├── 2023.json
│   └── 2024.json
└── GOOGL/
    ├── 2023.json
    └── 2024.json
```

### **Price Data File Format** (e.g., `AAPL/2024.json`)
```json
{
  "ticker": "AAPL",
  "year": 2024,
  "currency": "USD",
  "timezone": "America/New_York",
  "data": {
    "2024-01-02": { "o": 187.15, "h": 188.44, "l": 183.89, "c": 185.64, "v": 82488200 },
    "2024-01-03": { "o": 184.35, "h": 185.86, "l": 182.73, "c": 184.25, "v": 58414300 },
    "2024-01-04": { "o": 182.09, "h": 183.04, "l": 180.88, "c": 181.91, "v": 76957500 },
    "...": "... all trading days for the year"
  },
  "metadata": {
    "totalDays": 252,
    "generatedAt": "2024-11-13T20:14:32.229Z",
    "source": "yahoo_finance_v2"
  }
}
```

---

## Query Patterns

### **Get stock metadata:**
```javascript
const doc = await getDoc(doc(db, 'tickers', 'AAPL'));
```

### **Get quarterly financials for range:**
```javascript
const q = query(
  collection(db, 'tickers', 'AAPL', 'quarters'),
  where('fiscalYear', '>=', 2023),
  where('fiscalYear', '<=', 2024)
);
```

### **Get all price data references:**
```javascript
const priceDataRef = await getDoc(doc(db, 'tickers', 'AAPL', 'price/consolidated'));
const { years } = priceDataRef.data();
```

### **Get specific year price data:**
```javascript
// 1. Get storage reference from consolidated priceData doc
const priceDataRef = await getDoc(doc(db, 'tickers', 'AAPL', 'price/consolidated'));
const { years } = priceDataRef.data();
const { downloadUrl } = years['2024'];

// 2. Download price data from Storage
const response = await fetch(downloadUrl);
const priceData = await response.json();
```

### **Get multi-year price range:**
```javascript
// Get all references in one query
const priceDataRef = await getDoc(doc(db, 'tickers', 'AAPL', 'price/consolidated'));
const { years } = priceDataRef.data();

// Download specific years in parallel
const targetYears = ['2023', '2024'];
const priceData = await Promise.all(
  targetYears.map(year => 
    fetch(years[year].downloadUrl).then(r => r.json())
  )
);
```

### **Get latest analyst price targets:**
```javascript
const latestRef = await getDoc(
  doc(db, 'tickers', 'AAPL', 'analyst', 'price_targets', 'history', 'latest')
);
const priceTargets = latestRef.data()?.data;
```

### **Get analyst data history:**
```javascript
// Get all historical snapshots for price targets
const historyRef = collection(
  db, 
  'tickers', 
  'AAPL', 
  'analyst', 
  'price_targets', 
  'history'
);

// Query with date range (exclude 'latest' document)
const q = query(
  historyRef,
  where('fetched_at', '>=', '2024-11-01T00:00:00'),
  where('fetched_at', '<=', '2024-11-30T23:59:59'),
  where('fetched_at', '!=', null),
  orderBy('fetched_at', 'desc')
);

const snapshot = await getDocs(q);
const history = snapshot.docs
  .filter(doc => doc.id !== 'latest')
  .map(doc => doc.data());
```

### **Get all latest analyst data types:**
```javascript
const dataTypes = ['price_targets', 'recommendations', 'growth_estimates', 'earnings_trend'];
const latestData = {};

for (const type of dataTypes) {
  const latestRef = await getDoc(
    doc(db, 'tickers', 'AAPL', 'analyst', type, 'history', 'latest')
  );
  latestData[type] = latestRef.data()?.data;
}
```