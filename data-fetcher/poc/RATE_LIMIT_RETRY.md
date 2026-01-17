# Rate Limit Retry Feature

## Overview

The LangGraph scraper now includes automatic retry logic for handling Gemini API rate limit errors (HTTP 429). This ensures the scraper can continue operating even when hitting API quota limits.

## Implementation

### Retry Wrapper Function

Added `_call_gemini_with_retry()` method to the `LangGraphWebScraper` class:

```python
async def _call_gemini_with_retry(self, func, *args, max_retries: int = 5, **kwargs):
    """Wrapper to call Gemini API with automatic retry on 429 rate limits.
    
    Args:
        func: The function to call (e.g., self.model.generate_content)
        *args: Positional arguments for the function
        max_retries: Maximum number of retry attempts (default: 5)
        **kwargs: Keyword arguments for the function
        
    Returns:
        The response from the Gemini API
        
    Raises:
        ResourceExhausted: If max retries exceeded
    """
    for attempt in range(max_retries):
        try:
            # Call the function in a thread (since Gemini SDK is sync)
            response = await asyncio.to_thread(func, *args, **kwargs)
            return response
            
        except ResourceExhausted as e:
            # Extract retry delay from error if available
            retry_delay = 60  # Default 60 seconds
            error_str = str(e)
            
            # Try to parse retry_delay from error message
            if 'retry_delay' in error_str and 'seconds:' in error_str:
                try:
                    import re
                    match = re.search(r'seconds:\s*(\d+)', error_str)
                    if match:
                        retry_delay = int(match.group(1))
                except:
                    pass
            
            if attempt < max_retries - 1:
                print(f"   ⚠️  Rate limit hit (429). Waiting {retry_delay} seconds before retry {attempt + 1}/{max_retries}...")
                await asyncio.sleep(retry_delay)
            else:
                print(f"   ❌ Max retries ({max_retries}) exceeded. Giving up.")
                raise
        
        except Exception as e:
            # For other errors, don't retry
            raise
```

### Key Features

1. **Intelligent Retry Delay**: Extracts the suggested retry delay from the Gemini API error message
2. **Default Fallback**: Uses 60 seconds if no retry delay is specified
3. **Max Retries**: Configurable maximum retry attempts (default: 5)
4. **User Feedback**: Prints clear messages about rate limit hits and wait times
5. **Non-Rate-Limit Errors**: Other exceptions are raised immediately without retry

### Updated LLM Calls

Both listing and details page processing now use the retry wrapper:

#### Listing Page Processing

```python
# Before:
response = await asyncio.to_thread(
    self.model.generate_content,
    [prompt, html_file]
)

# After:
response = await self._call_gemini_with_retry(
    self.model.generate_content,
    [prompt, html_file]
)
```

#### Details Page Processing

```python
# Before:
response = await asyncio.to_thread(
    self.model.generate_content,
    [prompt, html_file]
)

# After:
response = await self._call_gemini_with_retry(
    self.model.generate_content,
    [prompt, html_file]
)
```

## Error Message Example

When a rate limit error occurs, the error message from Gemini looks like:

```
google.api_core.exceptions.ResourceExhausted: 429 You exceeded your current quota. 
Please migrate to Gemini 2.5 Flash Image (models/gemini-2.5-flash-image) for higher quota limits.
...
retry_delay {
  seconds: 56
}
```

The retry wrapper extracts the `56` from this message and waits exactly that amount of time.

## Testing

Tested with Apple's investor relations page and successfully handled 429 errors:

```bash
cd /Users/sergei/dev/stocks/data-fetcher/poc
source ../venv/bin/activate
python langgraph_scraper.py \
  --url https://investor.apple.com/investor-relations/default.aspx \
  --max-pages 5 \
  --headless
```

**Output:**
```
📄 Processing DETAILS page...
   🤖 Analyzing page HTML with Gemini (as file attachment)...
      ✅ Uploaded HTML file: files/tpy2tm7ly926
   ⚠️  Rate limit hit (429). Waiting 38 seconds before retry 1/5...
   ⚠️  Rate limit hit (429). Waiting 60 seconds before retry 2/5...
   ⚠️  No PDF link found and page is not a financial statement
```

The scraper automatically waited and retried, successfully continuing the scraping process.

## Configuration

### Adjusting Max Retries

You can modify the `max_retries` parameter when calling the retry wrapper:

```python
# Allow up to 10 retries
response = await self._call_gemini_with_retry(
    self.model.generate_content,
    [prompt, html_file],
    max_retries=10
)
```

### Modifying Default Retry Delay

The default retry delay (when none is specified in the error) is 60 seconds. You can modify this in the function:

```python
retry_delay = 60  # Change this value (in seconds)
```

## Benefits

1. **Robustness**: Scraper continues even when hitting API limits
2. **Efficiency**: Waits exactly as long as the API recommends (not more, not less)
3. **User Awareness**: Clear console messages about what's happening
4. **Graceful Degradation**: After max retries, fails with a clear error message
5. **Smart Error Handling**: Only retries on 429 errors, not other exceptions

## Rate Limit Information

From the Gemini API error:

- **Quota Metric**: `generate_content_paid_tier_input_token_count`
- **Quota ID**: `GenerateContentPaidTierInputTokensPerModelPerMinute`
- **Quota Value**: 250,000 tokens per minute (for `gemini-2.0-flash-exp`)
- **Suggested Action**: Migrate to `gemini-2.5-flash-image` for higher limits

## Future Enhancements

Potential improvements:

1. **Exponential Backoff**: Instead of using the API's suggested delay, implement exponential backoff
2. **Token Rate Limiting**: Pre-emptively rate limit requests based on estimated token usage
3. **Model Switching**: Automatically switch to a different model if rate limits are consistently hit
4. **Metrics Tracking**: Track how often rate limits are hit for monitoring/optimization
5. **Configurable Behavior**: Add command-line flags to control retry behavior

## Related Files

- `/Users/sergei/dev/stocks/data-fetcher/poc/langgraph_scraper.py` - Updated with retry logic
- Added imports: `time` (for future use), `ResourceExhausted` from `google.api_core.exceptions`

## Dependencies

- `google-api-core` - Provides the `ResourceExhausted` exception
- Built-in `asyncio` - For async sleep during retry delays
- Built-in `re` - For parsing retry delay from error messages

