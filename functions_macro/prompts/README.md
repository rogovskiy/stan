# Macro / market-shifts prompts only

This folder contains only the prompts used by the macro refresh and market-shifts pipeline:

- `market_shift_discovery_prompt.txt` – step 1: discover shifts in markdown (Google Search)
- `market_shift_markdown_to_json_prompt.txt` – step 2: convert markdown to JSON (structured output)
- `market_shift_timeline_prompt.txt` – timeline analysis per shift (optional)
- `market_state_summary_prompt.txt` – market state summaries
- `market_shift_merge_prompt.txt` – merge similar shifts (market_shift_merge)

Do not add IR, KPI, quarterly, or other data-fetcher prompts here.
