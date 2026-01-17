# Proof of Concept Scripts

This directory contains experimental and proof-of-concept implementations for various data fetching and scraping approaches.

## LangGraph Website Scraper

A stateful, graph-based web scraper that uses LangGraph to orchestrate scraping workflows and Gemini for intelligent content extraction.

### Features

- **State Management**: Maintains state across scraping steps using LangGraph's state graph
- **AI-Powered Decisions**: Uses Gemini to analyze pages, decide which links to follow, and when to stop
- **Graph-Based Workflow**: Clear separation of concerns with nodes for navigation, analysis, extraction, and decision-making
- **Conditional Routing**: Intelligently routes between nodes based on page analysis
- **Document Detection**: Automatically identifies and extracts financial documents (PDFs, presentations, etc.)

### How It Works

The scraper uses a LangGraph state machine with the following nodes:

1. **Navigate**: Loads the page using Playwright
2. **Analyze Page**: Uses Gemini to understand page content and purpose
3. **Extract Links**: Finds relevant links (filtered by financial/IR keywords)
4. **Extract Documents**: Identifies downloadable documents (PDFs, presentations)
5. **Decide Next**: Uses AI to decide which page to visit next or whether to stop

The workflow loops through pages until either:
- Max pages limit is reached
- No more relevant links are found
- Gemini decides enough information has been gathered

### Usage

```bash
# Activate virtual environment
source ../venv/bin/activate

# Install dependencies (if not already installed)
pip install -r ../requirements.txt

# Run the scraper (results shown in console)
python langgraph_scraper.py --url https://investor.apple.com --max-pages 5 --headless

# Optionally save results to JSON
python langgraph_scraper.py \
  --url https://investor.apple.com/investor-relations/default.aspx \
  --max-pages 10 \
  --headless \
  --output results.json

# Use different Gemini model
python langgraph_scraper.py \
  --url https://example.com \
  --model gemini-1.5-pro \
  --max-pages 5
```

**Note:** The `.env.local` file should be in the `data-fetcher/` directory (parent of `poc/`). The script will automatically load it from there.

### Arguments

- `--url`: Starting URL for the scraper (required)
- `--max-pages`: Maximum number of pages to visit (default: 5)
- `--headless`: Run browser in headless mode (no visible window)
- `--model`: Gemini model to use (default: gemini-2.0-flash-exp)
- `--output`: Optional path to save results JSON file (results always shown in console)

### Example Output

```json
{
  "success": true,
  "pages_visited": [
    "https://investor.apple.com/investor-relations/default.aspx",
    "https://investor.apple.com/investor-relations/financial-information/default.aspx"
  ],
  "total_pages": 2,
  "documents_found": [
    {
      "url": "https://investor.apple.com/earnings-report-q4-2023.pdf",
      "text": "Q4 2023 Earnings Report",
      "source_page": "https://investor.apple.com/investor-relations/financial-information/default.aspx",
      "discovered_at": "2026-01-11T10:30:00",
      "type": "document"
    }
  ],
  "total_documents": 1,
  "links_discovered": 15
}
```

### Advantages Over Tool-Calling Approach

Compared to the existing `gemini_crawler_assistant.py` (which uses function calling):

1. **State Management**: LangGraph provides built-in state persistence and checkpointing
2. **Clear Workflow**: The graph structure makes the workflow visible and maintainable
3. **Easier Testing**: Individual nodes can be tested in isolation
4. **Conditional Logic**: Complex routing decisions are explicit in the graph
5. **Resumability**: Can pause and resume scraping sessions using checkpoints
6. **Visualization**: LangGraph can generate visual representations of the workflow

### Use Cases

- Scraping investor relations websites for earnings documents
- Monitoring competitor websites for new content
- Automated document discovery and cataloging
- Research data collection from multiple sources

## Gemini Crawler Assistant

The `gemini_crawler_assistant.py` file contains an alternative approach using Gemini's function calling feature. This is more suitable for interactive, user-driven scraping sessions where a human provides guidance through chat.

### Comparison

| Feature | LangGraph Scraper | Gemini Crawler Assistant |
|---------|------------------|--------------------------|
| Approach | Autonomous graph-based | Interactive chat-based |
| State Management | Built-in with LangGraph | Manual |
| User Interaction | Minimal (just start URL) | Conversational throughout |
| Best For | Automated scraping | Exploratory scraping |
| Complexity | Higher (graph setup) | Lower (direct tool calls) |

## Environment Variables

Both scrapers require:

```bash
GEMINI_API_KEY=your_api_key_here
# or
GOOGLE_AI_API_KEY=your_api_key_here
```

Set these in `.env.local` file in the `data-fetcher` directory.

