# Yahoo refresh function (codebase: yahoo)

Pub/Sub-triggered function that refreshes Yahoo Finance data (price, earnings, analyst, splits) for one ticker per message. The scheduler in `functions` publishes to `yf-refresh-requests`; this function subscribes to that topic.

## Make targets

Run from the `functions_yahoo` directory:

| Target | Description |
|--------|-------------|
| `make run` | Run Yahoo refresh locally for one ticker (default AAPL). Uses `../data-fetcher/.env.local`. Populates `vendor/` from data-fetcher if missing. |
| `make deploy` | Deploy the Yahoo Pub/Sub function. Populates `vendor/` if missing. |
| `make vendor` | Copy shared code from `../data-fetcher/` into `vendor/` (done automatically by `run` and `deploy`). Does not copy `yahoo/` (lives in this package). |

The `vendor/` directory is gitignored and is filled by the Makefile (services, yfinance_service, financial_data_validator, cloud_logging_setup). The `yahoo/` package lives in this repo.

## Run Yahoo refresh locally

1. **Set up venv and deps** (once):

   ```bash
   cd functions_yahoo
   python3.11 -m venv venv
   source venv/bin/activate   # Windows: .\venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Create `data-fetcher/.env.local`** with Firebase service account vars (same file the data-fetcher uses):

   - **Firebase**: `FIREBASE_PRIVATE_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, etc.

   Local run always loads `../data-fetcher/.env.local`.

3. **Run** (from `functions_yahoo` with venv activated):

   ```bash
   make run
   ```

   This runs refresh for ticker AAPL. To run for another ticker: `python run_local.py MSFT`.

## Deploy

1. **Set up venv and deps** (once):

   ```bash
   cd functions_yahoo
   python3.11 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Deploy** (from `functions_yahoo`):

   ```bash
   make deploy
   ```

## Triggering the function

The function is triggered by Pub/Sub messages on `yf-refresh-requests`. The scheduler in `functions` (default codebase) runs daily and publishes one message per enabled ticker (and benchmarks) to this topic. After deploy, ensure the topic subscription targets this function (Firebase may create it automatically when you deploy).

To test manually, publish a message to the topic:

```bash
# Publish one message for AAPL (project and topic from your firebase.json / project)
gcloud pubsub topics publish yf-refresh-requests --message='{"ticker":"AAPL"}' --project=stan-1464e
```

(Use your project ID if different.)

## Job runs

Successful and failed runs are recorded to Firestore (`job_runs` collection) when running in Cloud Functions, for the Jobs UI. The vendored `job_run_service` is patched to record when `FUNCTION_TARGET` or `K_SERVICE` is set.
