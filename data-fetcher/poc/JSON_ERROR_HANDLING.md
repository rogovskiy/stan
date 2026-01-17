# JSON Parse Error Handling Update

## Overview

Added robust JSON parsing error handling to the LangGraph scraper to catch and debug malformed JSON responses from Gemini.

## What Was Added

### For Listing Pages (`_process_listing_node`)

When Gemini returns malformed JSON, the scraper now:

1. **Catches the error** with detailed information:
   - Error position in the JSON string
   - Error message (e.g., "Expecting ',' delimiter")
   - Response length

2. **Shows context** around the error:
   - 100 characters before the error position
   - 100 characters after the error position

3. **Saves broken JSON** to a file:
   - Location: `/tmp/gemini_failed_listing_<timestamp>.json`
   - Full response text saved with UTF-8 encoding

4. **Continues gracefully** with empty results:
   - Uses `{'documents': [], 'listing_pages': []}` as fallback
   - Allows scraping to continue to other pages

### For Detail Pages (`_process_details_node`)

Similar error handling, but:
- Saves to: `/tmp/gemini_failed_details_<timestamp>.json`
- Skips the current detail page and continues

## Example Output

When a JSON parse error occurs:

```
📋 Processing LISTING page...
   🤖 Analyzing page HTML with Gemini (as file attachment)...
      ✅ Uploaded HTML file: files/abc123
   ❌ JSON parsing error at position 13563: Expecting property name enclosed in double quotes
   📝 Response length: 15842 characters
   📝 Error context: ..."fiscal_year": 2023, "fiscal_quarter": "Q4"}],  "listing_pages": []...
   💾 Saved broken JSON to: /tmp/gemini_failed_listing_1768175313.json
   ✅ LLM found 0 documents and 0 pagination links
```

## Benefits

1. **Debuggability**: Full broken JSON saved for inspection
2. **Resilience**: Scraper continues instead of crashing
3. **Visibility**: Clear error messages show what went wrong
4. **Context**: Shows where in the JSON the error occurred

## Debugging Broken JSON

When you see a parse error:

1. **Check the saved file**:
   ```bash
   cat /tmp/gemini_failed_listing_*.json | jq .
   # or
   less /tmp/gemini_failed_listing_*.json
   ```

2. **Common issues to look for**:
   - Missing commas
   - Trailing commas before closing braces
   - Unescaped quotes in strings
   - Incomplete JSON (cut off mid-response)
   - Extra characters after valid JSON

3. **Fix the prompt if needed**:
   - If errors are frequent, adjust the Gemini prompt
   - Add more explicit JSON formatting instructions
   - Request stricter JSON compliance

## Example of Saved Error

From `/tmp/gemini_failed_listing_1768175313.json`:
```json
{
  "documents": [
    {
      "title": "Q4 2023 Earnings",
      "category": "earnings_release",
      "link_type": "pdf_download",
      "url": "https://example.com/file.pdf"
      "fiscal_year": 2023,  // <-- Missing comma here (line 311)
      "fiscal_quarter": "Q4"
    }
  ],
  "listing_pages": []
}
```

## Files Modified

- `/Users/sergei/dev/stocks/data-fetcher/poc/langgraph_scraper.py`
  - Added try/catch around `json.loads()` in `_process_listing_node`
  - Added try/catch around `json.loads()` in `_process_details_node`
  - Error context extraction and file saving

## Related

This complements the existing retry logic for rate limits (429 errors) by handling a different class of errors - malformed responses.

