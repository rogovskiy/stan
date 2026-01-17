# Token Usage Monitoring

## Overview

Added token usage logging to track Gemini API consumption and verify that responses are not being truncated due to token limits.

## What Was Added

Token usage information is now displayed after each Gemini API call:

```
📊 Tokens: 119249 prompt + 6959 response = 126208 total
```

This shows:
- **Prompt tokens**: Input size (HTML file + prompt text)
- **Response tokens**: Output size (generated JSON)
- **Total tokens**: Combined token count

## Implementation

Added after each `generate_content` call in both `_process_listing_node` and `_process_details_node`:

```python
# Show token usage
if hasattr(response, 'usage_metadata'):
    usage = response.usage_metadata
    print(f"      📊 Tokens: {usage.prompt_token_count} prompt + "
          f"{usage.candidates_token_count} response = "
          f"{usage.total_token_count} total")
```

## Token Limits

### Gemini 2.5 Flash
- **Max output tokens**: 22,000 (configured)
- **Max input tokens**: ~1 million
- **Total context window**: ~1 million tokens

### What This Tells Us

From the Apple IR page example:
- **Listing page**: 6,959 response tokens (32% of 22,000 limit) ✅ Not truncated
- **Detail page**: 75 response tokens (0.3% of 22,000 limit) ✅ Not truncated

## Benefits

1. **Verify No Truncation**: Confirm responses aren't hitting token limits
2. **Cost Tracking**: Monitor API usage for billing purposes
3. **Optimization**: Identify pages with high token usage
4. **Debugging**: See if truncation is a token limit issue or something else

## Example Output

```
📋 Processing LISTING page...
   🤖 Analyzing page HTML with Gemini (as file attachment)...
      ✅ Uploaded HTML file: files/pund5nbqkxjy
      📊 Tokens: 119249 prompt + 6959 response = 126208 total
   ✅ LLM found 64 documents and 0 pagination links
```

## Cost Estimation

With Gemini 2.5 Flash pricing (as of January 2026):
- **Input**: ~$0.075 per 1M tokens
- **Output**: ~$0.30 per 1M tokens

For the Apple IR page:
- **Input cost**: 119,249 tokens × $0.075/1M = ~$0.009
- **Output cost**: 6,959 tokens × $0.30/1M = ~$0.002
- **Total per page**: ~$0.011

For a typical scraping session (20 pages):
- **Estimated cost**: ~$0.22

## Token Usage Patterns

### Typical Listing Page
- **Prompt**: 100K-150K tokens (large HTML file)
- **Response**: 5K-10K tokens (many documents in JSON)
- **Total**: 105K-160K tokens

### Typical Detail Page
- **Prompt**: 50K-120K tokens (moderate HTML file)
- **Response**: 50-500 tokens (single document info)
- **Total**: 50K-120K tokens

## When to Be Concerned

If you see response tokens approaching 22,000:
```
📊 Tokens: 150000 prompt + 21500 response = 171500 total  ⚠️ Near limit!
```

This means:
1. The page has **many documents** (100+)
2. Response might be **truncated**
3. Consider **pagination** or **filtering** the results

## Files Modified

- `/Users/sergei/dev/stocks/data-fetcher/poc/langgraph_scraper.py`
  - Added token usage logging in `_process_listing_node`
  - Added token usage logging in `_process_details_node`

## Related Features

- Works with **explicit generation_config** (max_output_tokens=22000)
- Complements **JSON error handling** (detects truncation)
- Part of overall **observability** improvements

