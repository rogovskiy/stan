# LangGraph Website Scraper Workflow (Updated)

This document visualizes the updated LangGraph state machine workflow using the **Listing/Details Page Classification Model**.

## Page Classification Model

The scraper now uses a simple two-page classification:

### 1. LISTING PAGE
- Contains links to documents or other pages
- Examples: IR hub, earnings archive, news listing
- **Action**: Extract links and navigate to detail pages

### 2. DOCUMENT DETAILS PAGE  
- Contains information about a specific document
- Examples: Specific earnings release, presentation page, filing details
- **Action**: Extract document metadata and return to listing

### Key Principle
**Never navigate from details page to details page** - always return to a listing page first.

## Graph Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                         START                                    │
│                    (with listing URL)                            │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │   navigate_node       │
                    │                       │
                    │ - Load page           │
                    │ - Get HTML & text     │
                    └───────────┬───────────┘
                                │
                                ▼
                    ┌───────────────────────┐
                    │  classify_page_node   │
                    │                       │
                    │ - Ask Gemini: listing │
                    │   or document details?│
                    └───────────┬───────────┘
                                │
                ┌───────────────┴──────────────┐
                │                              │
                ▼                              ▼
    ┌─────────────────────┐      ┌─────────────────────┐
    │  process_listing    │      │  process_details    │
    │       _node         │      │      _node          │
    │                     │      │                     │
    │ - Extract links to  │      │ - Extract doc info  │
    │   detail pages      │      │   (title, date,     │
    │ - Extract links to  │      │    type, etc.)      │
    │   other listings    │      │ - Mark as visited   │
    │ - Queue for later   │      │                     │
    └──────────┬──────────┘      └──────────┬──────────┘
               │                            │
               └──────────┬─────────────────┘
                          │
                          ▼
                ┌───────────────────────┐
                │   decide_next_node    │
                │                       │
                │ - Check page type     │
                │ - Decide navigation   │
                └───────────┬───────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
        ▼                   ▼                   ▼
┌─────────────┐   ┌──────────────────┐  ┌────────────┐
│ From        │   │ From Listing:    │  │ Reached    │
│ Details:    │   │ - Visit detail   │  │ Max Pages  │
│             │   │ - Visit listing  │  │            │
│ Return to   │   │ - Or finish      │  │            │
│ listing     │   │                  │  │            │
└──────┬──────┘   └────────┬─────────┘  └──────┬─────┘
       │                   │                   │
       │                   │                   │
       │ LOOP BACK         │                   ▼
       └──────────┬────────┘         ┌──────────────────┐
                  │                  │       END        │
                  ▼                  │                  │
      ┌───────────────────────┐     │ Return results:  │
      │   navigate_node       │     │ - Listing pages  │
      │  (with next URL)      │     │ - Detail pages   │
      └───────────────────────┘     │ - Documents      │
                                    └──────────────────┘
```

## State Schema

```python
class ScraperState(TypedDict):
    # Current navigation
    url: str                              # Current URL to visit
    current_page_html: str                # Raw HTML
    current_page_text: str                # Text (first 5000 chars)
    page_title: str                       # Page title
    page_type: str                        # 'listing' or 'document_details'
    
    # Navigation tracking
    listing_pages: List[str]              # Queue of listings to visit
    listing_pages_visited: List[str]      # Listings already visited
    detail_pages_visited: List[str]       # Details already visited
    
    # Extracted data
    documents_found: List[Dict[str, Any]] # Extracted documents
    
    # Control flow
    next_action: str                      # 'navigate' or 'finish'
    error: Optional[str]                  # Error if any
    max_pages: int                        # Page limit
    current_depth: int                    # Depth counter
```

## Workflow Logic

### 1. Classification Logic (classify_page_node)

Gemini classifies each page as either:

**LISTING** if it contains:
- Links to multiple documents/pages
- Navigation elements
- Archive or index structure
- Multiple quarters/years

**DOCUMENT DETAILS** if it contains:
- Specific document information
- Single filing/release content
- Specific date/quarter
- Download link for ONE document

### 2. Processing Logic

#### If LISTING page:
1. Extract all relevant links
2. Classify each link as "detail" or "listing"
3. Queue detail links for immediate visit
4. Queue listing links for later visit
5. Go to decide_next

#### If DOCUMENT DETAILS page:
1. Use Gemini to extract structured data:
   - Title
   - Type (earnings, 10-K, presentation, etc.)
   - Date
   - Quarter/Year
   - Download URL
   - Description
2. Store in documents_found
3. Go to decide_next

### 3. Decision Logic (decide_next_node)

```
IF page_type == 'document_details':
    → Return to last listing page
    
ELSE IF page_type == 'listing':
    IF pending_details exist:
        → Visit next detail page
    ELSE IF listing_pages queue not empty:
        → Visit next listing page
    ELSE:
        → Finish
        
IF total_pages >= max_pages:
    → Finish
```

## Navigation Flow Example

```
Session: https://investor.apple.com/

1. Navigate to: https://investor.apple.com/investor-relations/default.aspx
   └─ Classify → LISTING
   └─ Process → Extract 12 detail links, 3 listing links
   └─ Decide → Visit first detail

2. Navigate to: https://investor.apple.com/earnings/q4-2023
   └─ Classify → DOCUMENT DETAILS
   └─ Process → Extract: "Q4 2023 Earnings Release", date: 2023-11-02
   └─ Decide → Return to listing

3. Navigate back to: https://investor.apple.com/investor-relations/default.aspx
   └─ Decide → Visit next detail (from queue)

4. Navigate to: https://investor.apple.com/earnings/q3-2023
   └─ Classify → DOCUMENT DETAILS
   └─ Process → Extract: "Q3 2023 Earnings Release", date: 2023-08-03
   └─ Decide → Return to listing

5. Navigate back to: https://investor.apple.com/investor-relations/default.aspx
   └─ Decide → All details visited, go to next listing

6. Navigate to: https://investor.apple.com/financial-information/
   └─ Classify → LISTING
   └─ Process → Extract 8 detail links
   └─ Decide → Visit first detail

... continues until max_pages reached ...

END
```

## Key Advantages

### 1. **Clear Navigation Pattern**
- Always know where you are (listing vs details)
- Predictable back-navigation
- No circular loops

### 2. **Better State Management**
- Separate tracking of listing vs detail pages
- Queue-based navigation (breadth-first)
- Can prioritize certain page types

### 3. **Efficient Crawling**
- Visit all details from one listing before moving on
- Avoid redundant navigation
- Natural depth-first within listings

### 4. **Easier to Debug**
- Clear separation of page types
- Can track which listings produced which documents
- Simple decision tree

### 5. **More Accurate Extraction**
- Different extraction logic for different page types
- Gemini knows what to look for on each page type
- Less confusion about page purpose

## Comparison to Previous Workflow

| Aspect | Old Workflow | New Workflow |
|--------|-------------|--------------|
| Page Types | 4 types (hub/listing/document/other) | 2 types (listing/details) |
| Navigation | AI decides each time | Rule-based with queues |
| Extraction | Same logic for all | Different logic per type |
| State | Single pages_visited list | Separate listing/detail tracking |
| Back-nav | Could visit details→details | Always details→listing |
| Predictability | Variable | Deterministic |

## Example Output

```json
{
  "success": true,
  "listing_pages_visited": [
    "https://investor.apple.com/investor-relations/default.aspx",
    "https://investor.apple.com/financial-information/"
  ],
  "detail_pages_visited": [
    "https://investor.apple.com/earnings/q4-2023",
    "https://investor.apple.com/earnings/q3-2023"
  ],
  "total_pages": 4,
  "total_listings": 2,
  "total_details": 2,
  "documents_found": [
    {
      "title": "Q4 2023 Earnings Release",
      "type": "earnings_release",
      "date": "2023-11-02",
      "quarter": "Q4",
      "year": 2023,
      "page_url": "https://investor.apple.com/earnings/q4-2023",
      "download_url": "https://investor.apple.com/pdf/q4-2023.pdf"
    }
  ],
  "total_documents": 2
}
```

## Customization Ideas

### Add Priority Scoring
```python
def _score_link(self, link):
    score = 0
    if 'earnings' in link['text'].lower(): score += 10
    if 'q4' in link['text'].lower(): score += 5
    return score
```

### Add Document Filtering
```python
# Only visit detail pages from 2023 or later
if self._extract_year(detail_link) < 2023:
    continue
```

### Add Domain Restrictions
```python
# Only follow links within same domain
if urlparse(link['url']).netloc != urlparse(state['url']).netloc:
    continue
```

### Add Caching
```python
# Skip if we've seen this document before (by title/date)
if (doc_title, doc_date) in seen_documents:
    continue
```
