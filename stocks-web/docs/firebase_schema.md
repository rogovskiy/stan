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

### `/tickers/{ticker}/analyst/{timestamp}` (Consolidated Analyst Data)

All analyst predictions are stored together in a single consolidated document per timestamp. This allows efficient retrieval (1 document read instead of 4) and ensures all data types are from the same snapshot time.

**Structure:**
```
/tickers/{ticker}/analyst/{timestamp}  (All data types together)
/tickers/{ticker}/analyst/latest       (Latest consolidated snapshot)
```

**Example: `/tickers/AAPL/analyst/2024-11-18T14-30-00`**
```json
{
  "ticker": "AAPL",
  "fetched_at": "2024-11-18T14:30:00",
  "data_source": "yfinance",
  "price_targets": {
    "current_price": 278.85,
    "target_high": 345.0,
    "target_low": 215.0,
    "target_mean": 281.75,
    "target_median": 280.0,
    "number_of_analysts": 41
  },
  "recommendations": {
    "recommendations_by_period": [
      {
        "period": "0m",
        "strongBuy": 5,
        "buy": 24,
        "hold": 15,
        "sell": 1,
        "strongSell": 3
      }
    ],
    "recommendation_mean": 2.0,
    "recommendation_key": "buy",
    "number_of_analysts": 41
  },
  "growth_estimates": {
    "stock_trend": {
      "0q": 0.1078,
      "+1q": 0.1126,
      "0y": 0.1048,
      "+1y": 0.1059
    }
  },
  "earnings_trend": {
    "earnings_estimate": {
      "avg": { "0q": 2.66, "+1q": 1.84, "0y": 8.25, "+1y": 9.10 }
    },
    "earnings_history": [
      {
        "quarter": "2024-12-31",
        "epsActual": 2.4,
        "epsEstimate": 2.34,
        "surprisePercent": 0.0252
      }
    ]
  }
}
```

**Benefits:**
- ✅ Single document read to get all analyst data (75% fewer reads)
- ✅ Atomic consistency - all data from same timestamp guaranteed together
- ✅ Easier historical analysis - all types at same timestamp
- ✅ Still supports accessing individual types (extract from document)

**Notes:**
- Timestamp format: `YYYY-MM-DDTHH-MM-SS` (colons replaced with hyphens for Firestore document ID compatibility)
- Data accumulates over time - each fetch creates a new document
- Use the `latest` document for quick access to current data
- Historical snapshots allow tracking changes in analyst predictions over time

---

### `/portfolios/{portfolioId}` (Portfolio Management)

Portfolios are top-level collections that contain investment portfolios with positions. Each portfolio can have multiple positions, and positions can optionally link to investment theses.

**Structure:**
```
/portfolios/{portfolioId}                              (Portfolio document)
/portfolios/{portfolioId}/positions/{positionId}       (Position subcollection – stored aggregates)
/portfolios/{portfolioId}/transactions/{transactionId} (Transaction subcollection – source of truth for changes)
```

**Example: `/portfolios/abc123`**
```json
{
  "name": "Growth Portfolio",
  "description": "Long-term growth investments",
  "cashBalance": 1250.00,
  "bands": [
    {
      "id": "band-uuid-1",
      "name": "Core",
      "sizeMinPct": 10,
      "sizeMaxPct": 20,
      "maxPositionSizePct": 5,
      "maxDrawdownPct": 15
    }
  ],
  "userId": null,
  "createdAt": "2024-11-20T10:00:00Z",
  "updatedAt": "2024-11-20T15:30:00Z"
}
```

**Example: `/portfolios/abc123/positions/xyz789`** (stored aggregate, one doc per ticker)
```json
{
  "ticker": "AAPL",
  "quantity": 100,
  "purchaseDate": "2024-01-15",
  "purchasePrice": 185.50,
  "thesisId": "thesis-123",
  "notes": "Bought on iPhone launch thesis",
  "bandId": "band-uuid-1",
  "createdAt": "2024-11-20T10:15:00Z",
  "updatedAt": "2024-11-20T10:15:00Z"
}
```

**Example: `/portfolios/abc123/transactions/tx001`**
```json
{
  "type": "buy",
  "ticker": "AAPL",
  "date": "2024-01-15",
  "quantity": 100,
  "price": 185.50,
  "amount": -18550.00,
  "notes": "",
  "createdAt": "2024-11-20T10:15:00Z",
  "updatedAt": "2024-11-20T10:15:00Z"
}
```

**Portfolio document fields:**
- `name` (string, required): Portfolio name
- `description` (string, optional): Portfolio description
- `cashBalance` (number, optional): Stored cash balance; updated when transactions are applied (sum of transaction amounts). Default 0.
- `bands` (array, optional): Risk bands for this portfolio. Each band has: `id`, `name`, `sizeMinPct`, `sizeMaxPct`, and optionally `maxPositionSizePct`, `maxDrawdownPct`. Defined in portfolio settings; positions can reference a band via `bandId`.
- `userId` (string, optional): User ID for multi-user support (future)
- `createdAt` (timestamp): Creation timestamp
- `updatedAt` (timestamp): Last update timestamp

**Position document (stored aggregate):** Positions are written/updated by `recomputeAndWriteAggregates` when transactions change. Only aggregate fields are derived from transactions; thesisId, notes, and bandId are position-level and preserved.
- `ticker` (string, required): Stock ticker symbol (uppercase)
- `quantity` (number, required): Total position size in shares (aggregate)
- `purchaseDate` (string, optional): Earliest transaction date for this ticker
- `purchasePrice` (number, optional): Average price / cost basis (aggregate)
- `thesisId` (string, optional): Position-level; link to investment thesis (editable on position, not from transactions)
- `notes` (string, optional): Position-level notes (editable on position, not from transactions)
- `bandId` (string, optional): Id of a band from this portfolio's `bands` array (risk management; assign in position edit dialog)
- `createdAt` (timestamp): Creation timestamp
- `updatedAt` (timestamp): Last update timestamp

**Transaction document:** Source of truth for changes. Creating, updating, or deleting a transaction triggers recompute of affected position(s) and portfolio cashBalance.
- `type` (string, required): One of `buy`, `sell`, `dividend`, `dividend_reinvest`, `cash`
- `ticker` (string, optional): Ticker (null for type `cash` only)
- `date` (string, required): ISO date (YYYY-MM-DD)
- `quantity` (number): Shares; positive for buy/dividend_reinvest, negative for sell, 0 for dividend/cash
- `price` (number, optional): Per-share price when applicable
- `amount` (number, required): Cash impact in USD (+ in, - out)
- `notes` (string, optional): Per-transaction memo
- `createdAt` (timestamp): Creation timestamp
- `updatedAt` (timestamp): Last update timestamp

**Benefits:**
- ✅ Transactions drive position and cash aggregates; positions are stored for fast reads
- ✅ Cash balance and per-ticker position size / average price derived from transactions
- ✅ Position-level thesisId and notes for display; transaction history available per ticker
- ✅ Supports dividends, dividend reinvestment, and cash in/out (e.g. options as cash)

---

### `/watchlist/{itemId}` (Watchlist Management)

Watchlist items are stocks you're watching or considering for investment but haven't purchased yet. This is separate from portfolios which contain actual positions.

**Structure:**
```
/watchlist/{itemId}  (Watchlist item document)
```

**Example: `/watchlist/xyz789`**
```json
{
  "ticker": "AAPL",
  "notes": "Watching for iPhone launch impact",
  "thesisId": "thesis-123",
  "targetPrice": 180.00,
  "priority": "high",
  "userId": null,
  "createdAt": "2024-11-20T10:00:00Z",
  "updatedAt": "2024-11-20T15:30:00Z"
}
```

**Fields:**
- `ticker` (string, required): Stock ticker symbol (uppercase)
- `notes` (string, optional): Notes about why you're watching this stock
- `thesisId` (string, optional): Reference to investment thesis document
- `targetPrice` (number, optional): Target price at which you'd consider buying
- `priority` (string, optional): Priority level - "low", "medium", or "high" (default: "medium")
- `userId` (string, optional): User ID for multi-user support (future)
- `createdAt` (timestamp): Creation timestamp
- `updatedAt` (timestamp): Last update timestamp

**Benefits:**
- ✅ Track stocks you're considering before making investment decisions
- ✅ Set target prices for entry points
- ✅ Priority levels help organize your watchlist
- ✅ Optional linking to investment theses
- ✅ Same top-level experience as portfolios in the UI

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

### **Get all latest analyst data (single read):**
```javascript
// Single document read gets all analyst data types
const latestRef = await getDoc(
  doc(db, 'tickers', 'AAPL', 'analyst', 'latest')
);
const allAnalystData = latestRef.data();

// Extract individual types
const priceTargets = allAnalystData?.price_targets;
const recommendations = allAnalystData?.recommendations;
const growthEstimates = allAnalystData?.growth_estimates;
const earningsTrend = allAnalystData?.earnings_trend;
```

### **Get specific analyst data type:**
```javascript
// Get latest and extract specific type
const latestRef = await getDoc(
  doc(db, 'tickers', 'AAPL', 'analyst', 'latest')
);
const priceTargets = latestRef.data()?.price_targets;
```

### **Get analyst data history (consolidated):**
```javascript
// Get all historical consolidated snapshots
const analystRef = collection(
  db, 
  'tickers', 
  'AAPL', 
  'analyst'
);

// Query with date range (exclude 'latest' document)
const q = query(
  analystRef,
  where('fetched_at', '>=', '2024-11-01T00:00:00'),
  where('fetched_at', '<=', '2024-11-30T23:59:59'),
  orderBy('fetched_at', 'desc')
);

const snapshot = await getDocs(q);
const history = snapshot.docs
  .filter(doc => doc.id !== 'latest')
  .map(doc => doc.data());

// Each snapshot contains all 4 data types at that timestamp
history.forEach(snapshot => {
  console.log('Price targets at', snapshot.fetched_at, ':', snapshot.price_targets);
  console.log('Recommendations at', snapshot.fetched_at, ':', snapshot.recommendations);
});
```

### **Get historical data for specific type:**
```javascript
// Get history and extract specific type from each snapshot
const analystRef = collection(db, 'tickers', 'AAPL', 'analyst');
const q = query(analystRef, orderBy('fetched_at', 'desc'));
const snapshot = await getDocs(q);

const priceTargetHistory = snapshot.docs
  .filter(doc => doc.id !== 'latest')
  .map(doc => ({
    date: doc.data().fetched_at,
    priceTargets: doc.data().price_targets
  }));
```

### **Get all portfolios:**
```javascript
const portfoliosRef = collection(db, 'portfolios');
const q = query(portfoliosRef, orderBy('createdAt', 'desc'));
const snapshot = await getDocs(q);
const portfolios = snapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data()
}));
```

### **Get portfolio with positions:**
```javascript
// Get portfolio document
const portfolioRef = doc(db, 'portfolios', 'abc123');
const portfolioSnap = await getDoc(portfolioRef);
const portfolio = portfolioSnap.data();

// Get positions subcollection
const positionsRef = collection(db, 'portfolios', 'abc123', 'positions');
const positionsSnapshot = await getDocs(positionsRef);
const positions = positionsSnapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data()
}));
```

### **Add position to portfolio:**
```javascript
const positionsRef = collection(db, 'portfolios', 'abc123', 'positions');
await addDoc(positionsRef, {
  ticker: 'AAPL',
  quantity: 100,
  purchaseDate: '2024-01-15',
  purchasePrice: 185.50,
  thesisId: 'thesis-123',
  notes: 'Bought on iPhone launch thesis',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});
```

### **Query positions by ticker:**
```javascript
const positionsRef = collection(db, 'portfolios', 'abc123', 'positions');
const q = query(positionsRef, where('ticker', '==', 'AAPL'));
const snapshot = await getDocs(q);
const aaplPositions = snapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data()
}));
```

### **Get all watchlist items:**
```javascript
const watchlistRef = collection(db, 'watchlist');
const q = query(watchlistRef, orderBy('createdAt', 'desc'));
const snapshot = await getDocs(q);
const items = snapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data()
}));
```

### **Add item to watchlist:**
```javascript
const watchlistRef = collection(db, 'watchlist');
await addDoc(watchlistRef, {
  ticker: 'AAPL',
  notes: 'Watching for iPhone launch impact',
  thesisId: 'thesis-123',
  targetPrice: 180.00,
  priority: 'high',
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});
```

### **Query watchlist by priority:**
```javascript
const watchlistRef = collection(db, 'watchlist');
const q = query(watchlistRef, where('priority', '==', 'high'));
const snapshot = await getDocs(q);
const highPriorityItems = snapshot.docs.map(doc => ({
  id: doc.id,
  ...doc.data()
}));
```