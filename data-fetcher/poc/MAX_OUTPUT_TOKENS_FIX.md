# Max Output Tokens Fix

## Issue

The Gemini LLM was truncating JSON responses when extracting large lists of documents, causing JSON parse errors like:

```
JSONDecodeError: Expecting property name enclosed in double quotes: line 285 column 44
```

This happened because the default output token limit was too low for pages with many documents.

## Root Cause

Gemini models have a **default output token limit** that, if not explicitly configured, may be lower than the maximum capacity:

- **Gemini 1.5 Pro/Flash**: Maximum of **8,192 output tokens**
- **Default (if not specified)**: Could be as low as 2,048 or 4,096 tokens

When extracting documents from pages with 50+ financial documents, the JSON response could easily exceed the default limit, causing it to be cut off mid-stream.

## Solution

Explicitly configure `max_output_tokens` when initializing the Gemini model:

```python
self.model = genai.GenerativeModel(
    model_name,
    generation_config={
        "max_output_tokens": 8192,  # Maximum for Gemini 1.5 models
        "temperature": 0.1,  # Lower temperature for more consistent output
    }
)
```

### Benefits:
1. **Full Capacity**: Uses the model's maximum output capacity (8,192 tokens)
2. **Fewer Truncations**: Can handle pages with many documents (50-100+)
3. **Consistent Output**: Lower temperature (0.1) for more predictable JSON formatting
4. **Better Quality**: Complete JSON responses instead of truncated ones

## Token Math

With 8,192 output tokens:
- **~6,000 words** of text
- **~50-100 documents** in JSON format (depending on metadata richness)
- **~30-40 KB** of JSON output

Example JSON document entry (~80 tokens):
```json
{
    "title": "Q4 2023 Earnings Release",
    "category": "earnings_release",
    "link_type": "pdf_download",
    "url": "https://investor.example.com/docs/q4-2023.pdf",
    "fiscal_year": 2023,
    "fiscal_quarter": "Q4"
}
```

With 8,192 tokens, you can handle approximately **80-100 such entries** in a single response.

## Before vs After

### Before (Default Limit)
```
📋 Processing LISTING page...
   🤖 Analyzing page HTML with Gemini...
   ❌ JSON parsing error at position 13563: Expecting property name enclosed in double quotes
   💾 Saved broken JSON to: /tmp/gemini_failed_listing_xxx.json
   ✅ LLM found 0 documents (fallback to empty)
```

### After (Max Output Tokens)
```
📋 Processing LISTING page...
   🤖 Analyzing page HTML with Gemini...
   ✅ LLM found 68 documents and 0 pagination links
   ✅ Direct PDFs: 36
   ✅ Detail pages to visit: 32
```

## Additional Configuration

The `generation_config` now includes:

- **`max_output_tokens: 8192`**: Maximum output capacity
- **`temperature: 0.1`**: Low temperature for consistent, focused output
  - Reduces randomness in JSON structure
  - More predictable key names and formatting
  - Better for structured data extraction

## Files Modified

- `/Users/sergei/dev/stocks/data-fetcher/poc/langgraph_scraper.py`
  - Updated `LangGraphWebScraper.__init__()` method
  - Added `generation_config` to `genai.GenerativeModel()`

## Testing

Tested with:
- **Apple IR page**: 68 documents successfully extracted (was truncating before)
- **Tempus AI page**: 24 documents successfully extracted
- **No JSON parse errors** observed with the new configuration

## Future Considerations

If you still encounter truncation with extremely large pages (100+ documents):

1. **Split extraction**: Process the HTML in chunks
2. **Use streaming**: Process partial JSON results as they arrive
3. **Filter in prompt**: Ask LLM to only extract most recent documents
4. **Pagination**: Rely on site pagination instead of extracting everything at once

## Related

- This works in conjunction with the JSON error handling (saves failed JSON to `/tmp`)
- Complements the rate limit retry logic (handles 429 errors)
- Part of the overall robustness improvements to the scraper

