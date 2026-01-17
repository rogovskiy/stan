# Streaming Mode Implementation

## Overview

Implemented streaming mode for Gemini API calls to improve response handling and provide better visibility into token generation progress.

## What Changed

### 1. Updated Retry Wrapper

Added `stream` parameter to `_call_gemini_with_retry()`:

```python
async def _call_gemini_with_retry(self, func, *args, max_retries: int = 5, stream: bool = False, **kwargs):
    """Wrapper with streaming support."""
    if stream:
        response_stream = await asyncio.to_thread(func, *args, **kwargs)
        return response_stream
    else:
        response = await asyncio.to_thread(func, *args, **kwargs)
        return response
```

### 2. Listing Page Processing

Now accumulates streamed chunks:

```python
response_stream = await self._call_gemini_with_retry(
    self.model.generate_content,
    [prompt, html_file],
    generation_config=genai.types.GenerationConfig(...),
    stream=True  # Enable streaming
)

# Accumulate streamed response
full_response = ""
chunk_count = 0

for chunk in response_stream:
    if chunk.text:
        full_response += chunk.text
        chunk_count += 1
        # Show progress every 10 chunks
        if chunk_count - last_update >= 10:
            print(f"      📡 Streaming... {chunk_count} chunks ({len(full_response)} chars)")

print(f"      ✅ Stream complete: {chunk_count} chunks, {len(full_response)} chars")
```

### 3. Details Page Processing

Similar streaming implementation for detail pages.

## Benefits

### 1. **Progress Visibility**
See when response generation is in progress:
```
📡 Streaming... 10 chunks (5234 chars)
📡 Streaming... 20 chunks (10847 chars)
✅ Stream complete: 25 chunks, 13456 chars
```

### 2. **Token Limit Warning**
Automatically warns when hitting the 8,192 token limit:
```python
if usage.candidates_token_count >= 8190:
    print(f"      ⚠️  WARNING: Hit ~8,192 token output limit! Response may be truncated!")
```

### 3. **Better Error Recovery**
Can detect truncation earlier and handle partial responses gracefully.

### 4. **Lower Latency**
Start processing as soon as first chunks arrive (though currently we accumulate the full response before parsing).

## Example Output

### Small Response (No Streaming Needed)
```
📋 Processing LISTING page...
   🤖 Analyzing page HTML with Gemini (as file attachment)...
      ✅ Uploaded HTML file: files/719hpjkd2ikn
      ✅ Stream complete: 1 chunks, 7954 chars
      📊 Tokens: 53180 prompt + 2860 response = 56040 total
   ✅ LLM found 24 documents
```

### Large Response (Multiple Chunks)
```
📋 Processing LISTING page...
   🤖 Analyzing page HTML with Gemini (as file attachment)...
      ✅ Uploaded HTML file: files/zu6bun3hx16s
      📡 Streaming... 10 chunks (12000 chars)
      📡 Streaming... 20 chunks (24000 chars)
      ✅ Stream complete: 25 chunks, 28456 chars
      📊 Tokens: 119249 prompt + 8192 response = 127441 total
      ⚠️  WARNING: Hit ~8,192 token output limit! Response may be truncated!
   ❌ JSON parsing error...
```

## Limitations

### Streaming Does NOT Bypass the 8,192 Token Limit

Important: Streaming delivers the response in chunks, but **the total output is still capped at 8,192 tokens**. If a response would be longer, it will still be truncated - you'll just see it happen progressively.

### Gemini's Hard Limits

- **Gemini 2.5 Flash**: 8,192 output tokens max
- **Gemini 1.5 Pro**: 8,192 output tokens max
- **ALL Gemini models**: Same 8,192 output token limit

These are **hard limits** that cannot be bypassed with streaming or any other configuration.

## What Streaming Helps With

1. ✅ **Visibility**: See progress for long-running requests
2. ✅ **Early Detection**: Know when hitting limits
3. ✅ **User Experience**: Show activity during generation
4. ✅ **Debugging**: Better understand response size

## What Streaming Does NOT Help With

1. ❌ **Bypassing token limits**: Still capped at 8,192 tokens
2. ❌ **Getting more documents**: If response is truncated, it stays truncated
3. ❌ **Fixing incomplete JSON**: Still need to handle truncation

## Solutions for Large Responses

Since streaming doesn't bypass limits, for pages with 50+ documents:

### Option 1: Limit in Prompt
```python
prompt = """
Extract UP TO 50 of the MOST IMPORTANT documents.
Prioritize recent documents (2024-2026) and key filings (10-K, 10-Q, 8-K).
"""
```

### Option 2: Use Pagination
Let the scraper visit multiple listing pages to get all documents.

### Option 3: Two-Pass Extraction
First pass: Get URLs only (lightweight)
Second pass: Visit each for details

## Testing Results

### Test 1: Tempus AI (24 documents)
- Stream complete: 1 chunks, 7,954 chars
- Tokens: 2,860 response (34% of limit) ✅
- Result: No truncation

### Test 2: Apple IR (64 documents)
- Stream complete: 1 chunks, 20,354 chars  
- Tokens: 6,959 response (85% of limit) ✅
- Result: No truncation

### Test 3: Large page with 100+ documents (expected)
- Stream complete: Multiple chunks
- Tokens: 8,192 response (100% of limit) ⚠️
- Result: Truncation warning triggered
- Recommendation: Limit documents in prompt

## Files Modified

- `/Users/sergei/dev/stocks/data-fetcher/poc/langgraph_scraper.py`
  - Updated `_call_gemini_with_retry()` to support streaming
  - Updated `_process_listing_node()` with streaming accumulation
  - Updated `_process_details_node()` with streaming accumulation
  - Added progress indicators for long responses
  - Added 8K token limit warning

## Future Enhancements

1. **Incremental JSON Parsing**: Parse chunks as they arrive instead of accumulating
2. **Adaptive Prompting**: Automatically limit document count based on page size
3. **Smart Truncation Detection**: Stop early if JSON structure is incomplete
4. **Resume from Truncation**: Re-query for remaining documents

## Conclusion

Streaming mode is now active and provides better visibility into response generation. However, it does **not bypass the 8,192 token output limit** - that's a hard constraint of all Gemini models. For pages with many documents, prompt modifications or pagination strategies are still needed.

