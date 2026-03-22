# Yahoo refresh function (codebase: yahoo)

Pub/Sub-triggered function that refreshes Yahoo Finance data (price, earnings, analyst, splits) for one ticker per message. The scheduler in `functions` publishes to `yf-refresh-requests`; this function subscribes to that topic.

## Make targets

Run from the `functions_yahoo` directory:

| Target | Description |
|--------|-------------|
| `make run` | Run Yahoo refresh locally for one ticker (default AAPL). Uses `../data-fetcher/.env.local`. Populates `vendor/` from data-fetcher if missing. |
| `make deploy` | Deploy the Yahoo Pub/Sub function. Populates `vendor/` if missing. |
| `make vendor` | Copy shared code from `../data-fetcher/` into `vendor/` (done automatically by `run` and `deploy`). Does not copy `yahoo/` (lives in this package). |
| `make trigger-function` | Publish one message to `yf-refresh-requests` to trigger the deployed function (default ticker AAPL). Override: `make trigger-function TICKER=MSFT PROJECT_ID=my-project`. |

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

To test manually, run from `functions_yahoo`:

```bash
make trigger-function
```

Default ticker is AAPL. To use another ticker or project: `make trigger-function TICKER=MSFT PROJECT_ID=your-project-id`.

## Job runs

Successful and failed runs are recorded to Firestore (`job_runs` collection) when running in Cloud Functions, for the Jobs UI. The vendored `job_run_service` is patched to record when `FUNCTION_TARGET` or `K_SERVICE` is set.

## Options IV/skew chart (marketdata backfill + plot)

Run from `functions_yahoo` with venv activated:

```bash
MARKETDATA_API_TOKEN=your_token python scripts/backfill_and_plot_options_iv_skew_timeseries.py --start-date 2026-02-10 --end-date 2026-03-12 --tickers USO SPY --target-dte 45 --skew-dtes 30 45 60
```

Skew (per chosen expiry) is **mean IV of puts with BS delta in `[--put-delta-hi, --put-delta-lo]`** (default `-0.30` … `-0.20`) **minus** **mean IV of calls with delta in `[--call-delta-lo, --call-delta-hi]`** (default `0.20` … `0.30`). Override with `--call-delta-lo`, `--call-delta-hi`, `--put-delta-lo`, `--put-delta-hi`.

This backfills missing `option_data/<TICKER>/<DATE>.csv.gz` snapshots (via marketdata.app) and writes:

- `../output/options_iv_skew_timeseries_<start>_<end>.csv` (combined; `skew_*` plus band debug: `iv_*_band_avg`, `n_*_band`, strike min/max per side, `delta_*_band_mean`, expiry/DTE columns, `*_expiry_changed`)
- `../output/options_iv_skew_timeseries_USO_<start>_<end>.png` and `../output/options_iv_skew_timeseries_SPY_<start>_<end>.png` (one chart per ticker; skew panel: **mean skew across `--skew-dtes`**, **min–max band** across those DTEs, faint dashed lines per DTE). CSV adds `skew_across_dte_mean` / `_min` / `_max` / `_std`.
