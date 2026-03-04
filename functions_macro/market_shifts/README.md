# Market Shifts

Market shifts are **structural market drivers** (risks and tailwinds) discovered from recent financial news. The pipeline uses Gemini with Google Search grounding to extract shifts, optionally merges duplicates, runs deep analysis (timeline + canonical driver) on new shifts, and saves results to Firestore.

## Concepts

- **MarketShift** — A structural driver: the real-world cause affecting markets (e.g. “Iran escalation raises risk of disruption to oil shipments through the Strait of Hormuz”), not just the market reaction.
- **Canonical driver** — A one-sentence identity for the shift: Actor/Event → Constraint/Bottleneck → Primary market channel. Used to merge related news into one shift.
- **Timeline** — For each shift: canonical driver, rationale, first-surfaced date, and chronological major developments with article refs.
- **Channels** — Macro channels (e.g. OIL, RATES_SHORT, EQUITIES_US) used for clustering and display.

## Pipeline (when merge is enabled)

1. **Extract** — Gemini + Google Search discovers shifts from the last 30 days; output is normalized (type, category, headline, summary, channels, articleRefs).
2. **Merge clustering (in memory)** — Combined list = existing shifts (Firestore) + newly extracted. Cluster by type, category, primary channel. For each cluster with >1 shift, the merge LLM decides whether they represent the same driver (pairwise: existing vs incoming). Shifts that are merged **into** an existing shift are not treated as new.
3. **Deep analysis** — Only for **new** shifts (extracted shifts that were not merged into an existing one). For each, Gemini with Google Search produces a timeline: canonical driver, rationale, firstSurfacedAt, majorDevelopments (with dates and article refs).
4. **Save and apply merges** — Apply merge decisions to Firestore (update canonical doc, delete duplicates). Save any new shifts that are not duplicates (singletons or chosen canonicals from merge).
5. **Summaries** — Generate market state summaries (e.g. “yesterday and today”, “last 7 days”) from the final set of shifts and risk scores.

When merge is **skipped**, the flow is: extract (with optional deep analysis on all) → save → summaries.

## Merge process

- **Clustering** — By `type`, `category`, and `primaryChannel` only (valid channels: EQUITIES_US, CREDIT, VOL, RATES_SHORT, RATES_LONG, USD, OIL, GOLD, INFLATION, GLOBAL_RISK). No scoring used.
- **Canonical choice** — Within a cluster, the canonical shift is the one with the **earliest** `firstSeenAt` (or first in stable order).
- **Pairwise LLM** — For each candidate, the LLM compares “existing” (current canonical) vs “incoming” (candidate). It returns: merge yes/no, relationship type (OCCURRENCE, DEVELOPMENT, EXPANSION, REACTION, INTERPRETATION, APPLICATION), optional revised summary/driver, and **timeline additions** (revisedFirstSurfacedAt, newMajorDevelopments, revisedCanonicalDriverRationale). Merges are applied sequentially so the canonical can be updated after each merge.
- **Scoring on merge** — The merged document’s momentum score is set to the **maximum** of the cluster’s scores. The LLM does not choose by score; it chooses by structural driver.

## Momentum scoring and decay

- **New shift** — Score = status-based boost only: EMERGING = 5, BUILDING = 8, BREAKING = 12.
- **Existing shift (re-save)** — Previous score **decays** with a 7-day half-life: `decayed = stored_score * 0.5^(days_elapsed/7)`. New score = decayed + status boost. So scores deteriorate over time if the shift is not re-surfaced.
- **After a merge** — Merged doc gets `max(cluster scores)`; decay applies only on the next re-save of that doc.

## Firestore

- **Shifts** — `macro/us_market/market_shifts` (collection). Each document has: type, category, headline, summary, primaryChannel, secondaryChannels, status, articleRefs, momentumScore, momentumScorePrev, momentumUpdatedAt, firstSeenAt, asOf, fetchedAt, optional timeline, analyzedAt.
- **Meta** — `macro/us_market/market_shifts_meta` (e.g. latest asOf, count).
- **Summaries** — `macro/us_market/market_summaries`.

## How to run

**Full pipeline (from repo root or functions_macro):**

- `make run` — Runs macro refresh + market shifts (merge is currently skipped in this path; see `run_local.py`).
- From `market_shifts/`:  
  `python scan_market_shifts.py` — Full pipeline with merge.  
  `python scan_market_shifts.py --skip-merge` — No merge (extract → save → summaries).  
  `python scan_market_shifts.py --skip-deep-analysis` — No timeline/deep analysis.  
  `python scan_market_shifts.py --merge-only` — No extract; load from Firestore, run merge, then summaries if merge changed anything.  
  `python scan_market_shifts.py --dry-run` — Extract (and optional deep analysis), print JSON, no Firestore write.

**Merge from file (run_local.py):**

- `python run_local.py --merge-from-file path/to/shifts.json` — Load shifts from JSON + existing from Firestore, cluster, run merge LLM per cluster with verbose before/after output, pause after each cluster. No Firestore write (debug only).

Requires `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY` (and Firebase credentials in `../data-fetcher/.env.local` for local run).

## Prompts and schemas

- **Prompts** — In `functions_macro/prompts/`: discovery, markdown-to-JSON, deep analysis, merge, market state summary. See `prompts/README.md`.
- **Timeline schema** — `schemas/market_shift_timeline_schema.json`: canonicalDriver, canonicalDriverRationale, firstSurfacedAt, majorDevelopments (date, description, articleRef).

## Limits

- **Deep analysis per run** — Capped (e.g. 5 new shifts per run) to control cost and latency.
- **Time window** — Discovery and deep analysis use a 30-day cutoff; only developments within that window are included.
