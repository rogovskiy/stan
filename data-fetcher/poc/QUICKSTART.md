# LangGraph Scraper Quick Start

Get up and running with the LangGraph website scraper in 5 minutes.

## Prerequisites

- Python 3.8+
- Google Gemini API key

## Step 1: Install Dependencies

```bash
cd data-fetcher

# Activate virtual environment
source venv/bin/activate

# Install/update requirements
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

## Step 2: Set Up API Key

Create or edit `.env.local` in the `data-fetcher` directory:

```bash
# Add your Gemini API key
GEMINI_API_KEY=your_api_key_here
```

Get your API key from: https://makersuite.google.com/app/apikey

## Step 3: Run Your First Scrape

```bash
cd poc

# Run the scraper on Apple's IR website
# Results will be shown in console by default
python langgraph_scraper.py \
  --url https://investor.apple.com/investor-relations/default.aspx \
  --max-pages 3 \
  --headless

# Or save results to JSON file
python langgraph_scraper.py \
  --url https://investor.apple.com/investor-relations/default.aspx \
  --max-pages 3 \
  --headless \
  --output results.json
```

## Step 4: View Results

```bash
# Pretty print the results
cat results.json | python -m json.tool

# Or view in Python
python
>>> import json
>>> with open('results.json') as f:
...     results = json.load(f)
>>> print(f"Found {results['total_documents']} documents")
>>> for doc in results['documents_found']:
...     print(f"  - {doc['text']}: {doc['url']}")
```

## What Just Happened?

The scraper:
1. ✅ Navigated to the starting URL
2. ✅ Used Gemini to analyze each page
3. ✅ Extracted relevant links (filtered by financial keywords)
4. ✅ Identified documents (PDFs, presentations)
5. ✅ Decided which pages to visit next using AI
6. ✅ Displayed results in console (and saved to JSON if --output was specified)

## Try Different Examples

### Example 1: Different Company

```bash
python langgraph_scraper.py \
  --url https://ir.tesla.com/ \
  --max-pages 5 \
  --headless
```

### Example 2: Non-Headless Mode (See Browser)

```bash
# Remove --headless to see the browser in action
python langgraph_scraper.py \
  --url https://investor.apple.com/investor-relations/default.aspx \
  --max-pages 3
```

### Example 3: Run Example Script

```bash
# Run the example with multiple scenarios
python langgraph_example.py
```

## Understanding the Output

### Console Output

```
🚀 Starting LangGraph Web Scraper
   Start URL: https://investor.apple.com/...
   Max Pages: 3

📍 Navigating to: https://investor.apple.com/...
✅ Loaded page: Apple Investor Relations

🤖 Analyzing page: Apple Investor Relations
  📊 Page Type: hub
  📄 Has Financial Docs: true
  💡 Suggested Action: extract_links
  🎯 Confidence: 0.95

🔗 Extracting links from page...
  ✅ Found 12 new relevant links (total: 12)

📄 Extracting document information...
  📄 Document: Q4 2023 Earnings Release
  📄 Document: FY2023 Annual Report
  ✅ Total documents found: 2

🤔 Deciding next action...
🔧 Function calls detected: 1
  → navigate_to_url(url='https://...')
  ➡️ Next: https://investor.apple.com/financial-information
  💡 Reason: This page likely contains more financial documents

[Process continues for more pages...]

✅ Scraping Complete!
   📄 Pages Visited: 3
   📄 Documents Found: 5
   🔗 Links Discovered: 28

================================================================================
SCRAPING SUMMARY
================================================================================

Status: ✅ Success
Pages Visited: 3
Links Discovered: 28
Documents Found: 5

📍 Pages Visited (3):
  1. https://investor.apple.com/investor-relations/default.aspx
  2. https://investor.apple.com/financial-information/
  3. https://investor.apple.com/news-and-events/

📄 Documents Found (5):

  1. Q4 2023 Earnings Release
     URL: https://investor.apple.com/q4-2023-earnings.pdf
     Type: document
     Source: https://investor.apple.com/financial-information/

  2. FY2023 Annual Report
     URL: https://investor.apple.com/annual-report-2023.pdf
     Type: document
     Source: https://investor.apple.com/financial-information/

💡 Tip: Use --output results.json to save results to a file
```

### JSON Output Structure

```json
{
  "success": true,
  "pages_visited": [
    "https://investor.apple.com/investor-relations/default.aspx",
    "https://investor.apple.com/financial-information/",
    "https://investor.apple.com/news-and-events/"
  ],
  "total_pages": 3,
  "documents_found": [
    {
      "url": "https://investor.apple.com/q4-2023-earnings.pdf",
      "text": "Q4 2023 Earnings Release",
      "source_page": "https://investor.apple.com/financial-information/",
      "discovered_at": "2026-01-11T10:30:00",
      "type": "document"
    }
  ],
  "total_documents": 5,
  "links_discovered": 28,
  "error": null
}
```

## Common Issues

### Issue: "GEMINI_API_KEY not set"

**Solution:** Make sure `.env.local` exists in `data-fetcher/` directory (parent of `poc/`) with your API key.

```bash
# From the poc directory
cd ..
echo 'GEMINI_API_KEY=your_key_here' > .env.local

# Or from data-fetcher directory
cd data-fetcher
echo 'GEMINI_API_KEY=your_key_here' > .env.local
```

### Issue: "playwright not found"

**Solution:** Install Playwright browsers:

```bash
playwright install chromium
```

### Issue: "langgraph module not found"

**Solution:** Install/update requirements:

```bash
pip install -r requirements.txt
```

### Issue: Browser crashes or timeouts

**Solution:** Try running in headless mode and increase timeout:

```bash
# Edit langgraph_scraper.py, line 46:
await self.page.goto(state['url'], wait_until='domcontentloaded', timeout=60000)
```

## Customization

### Change Max Pages

```bash
python langgraph_scraper.py \
  --url https://example.com \
  --max-pages 10  # Scrape up to 10 pages
```

### Use Different Gemini Model

```bash
python langgraph_scraper.py \
  --url https://example.com \
  --model gemini-1.5-pro  # More capable but slower
```

### Save Results to Custom Location

```bash
python langgraph_scraper.py \
  --url https://example.com \
  --output ~/Desktop/scrape_results.json
```

## Next Steps

1. **Read the full documentation**: See `README.md` for detailed feature explanations
2. **Understand the workflow**: Check `LANGGRAPH_WORKFLOW.md` for graph visualization
3. **Customize the scraper**: Modify `langgraph_scraper.py` to add custom nodes
4. **Integrate with your project**: Import and use the scraper in your own scripts

## Example Integration

```python
import asyncio
from langgraph_scraper import LangGraphWebScraper

async def scrape_company(ticker: str, ir_url: str):
    """Scrape IR website for a company."""
    scraper = LangGraphWebScraper(headless=True)
    results = await scraper.scrape(ir_url, max_pages=5)
    
    # Process results
    documents = results['documents_found']
    print(f"{ticker}: Found {len(documents)} documents")
    
    return documents

# Use it
asyncio.run(scrape_company('AAPL', 'https://investor.apple.com/...'))
```

## Tips

1. **Start small**: Test with `--max-pages 3` first
2. **Use headless mode**: Faster and more stable for production
3. **Save outputs**: Always use `--output` to save results
4. **Monitor tokens**: Gemini has rate limits; add delays if scraping many pages
5. **Review results**: Check the JSON to see what was found

## Support

For issues or questions:
- Check the full `README.md`
- Review `LANGGRAPH_WORKFLOW.md` for workflow details
- Compare with `gemini_crawler_assistant.py` for alternative approach

Happy scraping! 🚀

