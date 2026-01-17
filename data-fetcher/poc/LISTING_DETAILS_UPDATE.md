# Listing/Details Page Classification Update

## Overview

Refactored the LangGraph scraper to use a **two-page classification model** for cleaner, more predictable scraping workflows.

## Key Changes

### 1. Simplified Page Classification

**Before:** 4 page types (hub, listing, document, other)
**After:** 2 page types (listing, document_details)

#### LISTING PAGE
- Contains links to other pages or documents
- Examples: IR hub, earnings archive, news listing
- **Action**: Extract links and queue for visiting

#### DOCUMENT DETAILS PAGE
- Contains information about a specific document
- Examples: Specific earnings release, presentation page
- **Action**: Extract structured data and return to listing

### 2. New Navigation Rules

**Core Principle**: Never navigate from details page to details page

```
Listing → Detail → Back to Listing → Next Detail → Back to Listing → ...
```

**Old Flow:**
```
Any Page → AI decides → Any Page → AI decides → ...
```

**New Flow:**
```
Listing → Extract links → Visit Details (queue) → Return → Visit Next Detail → ...
                       └→ Queue other Listings for later
```

### 3. Updated State Structure

```python
# NEW fields
page_type: str                     # 'listing' or 'document_details'
listing_pages: List[str]           # Queue of listings to visit
listing_pages_visited: List[str]   # Listings already visited
detail_pages_visited: List[str]    # Details already visited

# REMOVED fields
links_found: List[Dict]            # No longer needed (processed immediately)
extraction_results: Dict           # Replaced by documents_found structure
```

### 4. Enhanced Document Extraction

Documents now include richer metadata extracted by Gemini:

```json
{
  "title": "Q4 2023 Earnings Release",
  "type": "earnings_release",
  "date": "2023-11-02",
  "quarter": "Q4",
  "year": 2023,
  "page_url": "https://...",
  "download_url": "https://...pdf",
  "description": "..."
}
```

**Before:** Basic URL and text
**After:** Structured data with dates, quarters, types

### 5. New Graph Nodes

**Replaced:**
- ❌ `analyze_page_node` → ✅ `classify_page_node`
- ❌ `extract_links_node` → ✅ `process_listing_node`
- ❌ `extract_documents_node` → ✅ `process_details_node`

**Improved:**
- ✅ `decide_next_node` - Simplified decision logic

### 6. Updated Workflow

```
START → navigate → classify → process_listing ──┐
                           └→ process_details ──┤
                                                 ↓
                                          decide_next
                                                 │
                                    ┌────────────┴────────────┐
                                    ↓                         ↓
                               navigate (loop)             finish
```

## Benefits

### 1. **Predictable Navigation**
- Clear rules: listing pages branch out, detail pages return
- No confusing AI decisions about where to go next
- Easy to understand and debug

### 2. **Better Organization**
- Separate tracking of listing vs detail pages
- Know exactly what type of page you're on
- Clear purpose for each page type

### 3. **Improved Extraction**
- Different extraction strategies for different page types
- Gemini knows what to expect on each page
- More structured and complete document metadata

### 4. **Efficient Crawling**
- Visit all details from a listing before moving on
- Queue-based navigation (breadth-first)
- No redundant navigation paths

### 5. **Easier Testing**
- Can test classification separately
- Can test each processor independently
- Clear expected behavior for each page type

## Usage Example

```bash
# Start from a listing page (IR hub)
python langgraph_scraper.py \
  --url https://investor.apple.com/investor-relations/default.aspx \
  --max-pages 10 \
  --headless

# Output shows:
# - Which pages were classified as listings
# - Which pages were classified as details
# - Structured document data from each detail page
```

## Example Output

```
📍 Navigating to: https://investor.apple.com/...
✅ Loaded: Apple Investor Relations

🤖 Classifying page: Apple Investor Relations...
  📊 Type: LISTING
  🎯 Confidence: 0.95

📋 Processing listing page...
  ✅ Found 8 document detail links
  ✅ Found 3 listing page links

🤔 Deciding next action...
  ➡️  Visiting detail page: Q4 2023 Earnings Release

📍 Navigating to: https://investor.apple.com/earnings/q4-2023...
✅ Loaded: Q4 2023 Earnings Release

🤖 Classifying page: Q4 2023 Earnings Release...
  📊 Type: DOCUMENT_DETAILS
  🎯 Confidence: 0.98

📄 Processing document details page...
  ✅ Extracted: Q4 2023 Earnings Release
     Date: 2023-11-02
     Download: https://...pdf

🤔 Deciding next action...
  ↩️  Returning from details page to listing

[continues...]
```

## Migration Notes

### For Existing Code

The API hasn't changed - you can still call:

```python
scraper = LangGraphWebScraper(headless=True)
results = await scraper.scrape(start_url, max_pages=5)
```

### Output Structure Changes

```python
# OLD structure
results = {
    'pages_visited': [...],           # All pages mixed together
    'total_pages': 10,
    'links_discovered': 25,
    'documents_found': [...]          # Basic structure
}

# NEW structure
results = {
    'listing_pages_visited': [...],   # Separate listing pages
    'detail_pages_visited': [...],    # Separate detail pages
    'total_pages': 10,
    'total_listings': 3,
    'total_details': 7,
    'documents_found': [...]          # Rich structure with metadata
}
```

### Starting URL

The start URL should ideally be a **listing page** (IR hub, archive page, etc).

If you accidentally start with a detail page, the scraper will:
1. Classify it as detail
2. Extract the document
3. Have no listing to return to
4. Finish

## Implementation Details

### Classification Prompt

Gemini receives:
- Page title
- URL
- First 5000 chars of text

And responds with:
```json
{
  "page_type": "listing",
  "confidence": 0.95,
  "reasoning": "Contains links to multiple earnings releases",
  "has_download_links": true
}
```

### Link Classification

On listing pages, links are automatically classified as:

**Detail Link** if:
- URL contains `.pdf`, `.pptx`, etc.
- Text contains Q1/Q2/Q3/Q4 or year markers
- Text contains a date

**Listing Link** otherwise

### Queue Management

```python
listing_pages = []          # FIFO queue
_pending_details = []       # FIFO queue from current listing
_last_listing_url = None    # Breadcrumb for returning
```

Navigation priority:
1. Visit pending details from current listing
2. Visit next listing page
3. Finish if no more pages

## Future Enhancements

### Possible Additions

1. **Priority Scoring**: Score links by relevance
2. **Date Filtering**: Only visit pages from certain years
3. **Document Deduplication**: Skip if same title/date seen before
4. **Parallel Extraction**: Visit multiple details simultaneously
5. **Smart Depth Control**: Different max_pages for listings vs details

### Example Customization

```python
# Add custom filtering in process_listing_node
if self._extract_year(link_text) < 2022:
    continue  # Skip old documents

# Add custom scoring
link['priority'] = self._score_link(link)
detail_links.sort(key=lambda x: x.get('priority', 0), reverse=True)
```

## Testing

### Test Cases

1. **Start with listing page** → Should discover and visit details
2. **Start with detail page** → Should extract and finish
3. **Listing with no details** → Should visit other listings
4. **Max pages reached** → Should stop gracefully
5. **Classification error** → Should default to listing

### Debug Mode

Run without `--headless` to see browser navigation in real-time:

```bash
python langgraph_scraper.py --url <url> --max-pages 3
```

## Summary

This refactor provides:
- ✅ Clearer page classification (2 types instead of 4)
- ✅ Predictable navigation (never detail→detail)
- ✅ Better state management (separate tracking)
- ✅ Richer document metadata (structured extraction)
- ✅ Easier debugging (clear decision logic)
- ✅ More maintainable code (simpler graph)

The scraper is now more suitable for production IR website scraping with consistent, predictable behavior.

