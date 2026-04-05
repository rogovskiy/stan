# Portfolio functions (codebase: `portfolio`)

Workflows:

1. **`portfolio_weekly_publish`** (scheduled) — reads all portfolio document IDs from Firestore, publishes one Pub/Sub message per portfolio to `portfolio-channel-exposure-requests`, and also publishes one thesis-evaluation message per linked thesis to `position-thesis-evaluation-requests`.
2. **`portfolio_channel_exposure_refresh`** (Pub/Sub) — handles **each** message and runs `run_channel_exposure` for that `portfolioId` (same path as after transaction import).
3. **`position_thesis_evaluation_refresh`** (Pub/Sub) — handles thesis evaluation messages from `position-thesis-evaluation-requests`, runs the two-step evaluation flow, and stores the latest result under `position_theses/{thesisId}/evaluations/latest`.

## Functions

| Function | Trigger | Role |
|----------|---------|------|
| `portfolio_weekly_publish` | Schedule `0 6 * * 1` (Monday 06:00 UTC) | One `{"portfolioId": "..."}` publish per portfolio |
| `portfolio_channel_exposure_refresh` | Pub/Sub topic below | Refresh channel exposure for that portfolio |
| `position_thesis_evaluation_refresh` | Pub/Sub topic below | Produce grounded markdown report, structurize it to JSON, derive card status, persist latest evaluation |

## Topic and messages

**Topics:**

- `portfolio-channel-exposure-requests`
- `position-thesis-evaluation-requests`

Create if needed:

```bash
gcloud pubsub topics create portfolio-channel-exposure-requests --project=YOUR_PROJECT_ID
gcloud pubsub topics create position-thesis-evaluation-requests --project=YOUR_PROJECT_ID
```

**JSON body (only shape supported):**

- `{"portfolioId": "<id>"}` — refresh that portfolio (weekly job sends one message per id; importers send one after transactions).
- `{"portfolioId": "<id>", "thesisDocId": "<thesis-id>"}` — evaluate one linked thesis for a refreshed portfolio.

## IAM

The **`portfolio_weekly_publish`** runtime service account needs **`roles/pubsub.publisher`** on both topics (or project-level Pub/Sub Publisher). In GCP Console: Pub/Sub → topic → Permissions, or:

```bash
gcloud pubsub topics add-iam-policy-binding portfolio-channel-exposure-requests \
  --project=YOUR_PROJECT_ID \
  --member="serviceAccount:PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/pubsub.publisher"

gcloud pubsub topics add-iam-policy-binding position-thesis-evaluation-requests \
  --project=YOUR_PROJECT_ID \
  --member="serviceAccount:PROJECT_ID@appspot.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

Use the actual service account shown on the deployed scheduled function if different.

## Deploy

From repo root (after `python3 -m venv venv && pip install -r requirements.txt` in this directory if you use `make run`):

```bash
cd functions_portfolio
make deploy
```

Or:

```bash
firebase deploy --only functions:portfolio:portfolio_weekly_publish,functions:portfolio:portfolio_channel_exposure_refresh,functions:portfolio:position_thesis_evaluation_refresh
```

## Run weekly publisher now

```bash
make trigger-publish
```

Override if your Scheduler job name differs:

```bash
make trigger-publish SCHEDULER_JOB=firebase-schedule-portfolio_weekly_publish-us-central1 REGION=us-central1
```

## Channel exposure document shape

`run_channel_exposure` writes `channelExposures` on each portfolio document. Each channel entry includes:

- `proxy`, `beta`, `rSquared` — portfolio-level regression vs the channel proxy
- `contributors` — optional array (top 8) of `{ ticker, weightPct, beta, contribution }` per holding (weight × position beta), for UI tooltips

Re-run the job (CLI, Pub/Sub, or weekly) after upgrading to populate `contributors` for existing portfolios.

## Local

Channel exposure logic lives in **`portfolio_channel_exposure.py`** in this directory (not under `vendor/`). `vendor/` only mirrors shared `data-fetcher/services/*` via `make vendor`.

Requires `../data-fetcher/.env.local` with Firebase service account variables (or `.env.local` here).

```bash
make vendor
python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
make run
# or: make run PORTFOLIO_ID=otherId
# or: python portfolio_channel_exposure.py PORTFOLIO_ID --verbose
```

## Job runs

Both functions call `record_job_run`:

- **`portfolio_channel_exposure_publish`** — one run per weekly scheduler execution (payload includes `published` / `portfolio_count`).
- **`portfolio_channel_exposure`** — one run per Pub/Sub message (entity = portfolio id).
- **`position_thesis_evaluation`** — one run per thesis evaluation message (entity = thesis id).

## Thesis evaluations

`position_thesis_evaluation_refresh` uses two admin-configured prompts:

- `position_thesis_evaluation_report` — grounded markdown report
- `position_thesis_evaluation_structurize` — markdown-to-JSON conversion

Latest output is stored at:

- `position_theses/{thesisId}/evaluations/latest`

The evaluation artifact includes:

- `reportMarkdown`
- `structuredResult`
- `derivedResult`
- prompt/version metadata
- status such as `healthy`, `unsure`, `problematic`, `trim`, `exit`, or `possible_add`

## Adding more portfolio jobs

Keep a single Pub/Sub topic per workflow or add new topics and `@pubsub_fn` handlers in `main.py`, reusing `vendor/` services and `make vendor` sources.
