# Firestore Schema Proposal — Stock Data App

## Overview
Firestore stores stock metadata, quarterly financials, and daily prices.
Data is organized per ticker symbol for easy range queries and compact storage.

---

## Collections & Documents

### `/tickers/{ticker}`
**Example:** `/stocks/AAPL/meta`
```json
{
  "name": "Apple Inc.",
  "exchange": "NASDAQ",
  "sector": "Technology"
}

### `/tickers/{ticker}/quarters/{YYYYQ}`
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
  },
  "priceSummary": {
    "firstClose": 195.42,
    "lastClose": 189.33,
    "avgVol": 70300000
  }
}
```
### `/tickers/{ticker}/price/{YYYYQ}`
```json
{
  "fiscalYear": 2024,
  "fiscalQuarter": 3,
  "days": {
    "2024-07-01": { "o": 192.3, "h": 194.1, "l": 191.5, "c": 193.7, "v": 71000000 },
    "2024-07-02": { "o": 193.7, "h": 195.0, "l": 193.0, "c": 194.6, "v": 69500000 },
    "...": { }
  }
}
```