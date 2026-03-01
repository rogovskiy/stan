# Macro refresh function (codebase: macro)

Scheduled function that runs macro risk scores and market shifts daily at 06:00 UTC. No Pub/Sub—runs on schedule only.

## Make targets

Run from the `functions_macro` directory:

| Target | Description |
|--------|-------------|
| `make run` | Run macro refresh locally (verbose). Uses `../data-fetcher/.env.local`. Populates `vendor/` from data-fetcher if missing. |
| `make deploy` | Deploy the macro scheduled function. Populates `vendor/` if missing. |
| `make trigger-function` | Run the deployed macro function now via Cloud Scheduler (job: `firebase-schedule-macro_refresh-us-central1`). Override with `SCHEDULER_JOB` or `REGION` if needed. |
| `make vendor` | Copy shared code from `../data-fetcher/` into `vendor/` (done automatically by `run` and `deploy`). |

The `vendor/` directory is gitignored and is filled by the Makefile from `data-fetcher` (extraction_utils, firebase_base_service, channels_config_service).

## Run macro refresh locally

1. **Set up venv and deps** (once):

   ```bash
   cd functions_macro
   python3.11 -m venv venv
   source venv/bin/activate   # Windows: .\venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Create `data-fetcher/.env.local`** with Firebase and Gemini keys (same file the data-fetcher uses):

   - **Firebase**: `FIREBASE_PRIVATE_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, etc. (service account).
   - **Gemini**: `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY` (for market shifts).

   Local run always loads `../data-fetcher/.env.local`; there are no other credential options.

3. **Run** (from `functions_macro` with venv activated):

   ```bash
   make run
   ```

   This runs `refresh_macro_scores` then `run_scan_market_shifts` (verbose) and writes to your Firebase project.

## Deploy

1. **Set up venv and deps** (once, so Firebase CLI can analyze the code):

   ```bash
   cd functions_macro
   python3.11 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Deploy** (from `functions_macro`):

   ```bash
   make deploy
   ```

## Trigger the deployed function

To run the deployed function once without waiting for the schedule:

```bash
make trigger-function
```

To use a different job or region: `make trigger-function SCHEDULER_JOB=name REGION=region`

Alternatively: in Google Cloud Console go to **Cloud Scheduler** → find the job for `macro_refresh` → **Run now**.

## Secrets (Gemini API key)

The macro pipeline calls Gemini for market shifts. Set the API key via Google Cloud Secret Manager and attach it to the function.

1. **Create or reuse a secret** (e.g. same as Cloud Run):

   ```bash
   # If you already have ir_scanner_gemini_api_key:
   gcloud secrets describe ir_scanner_gemini_api_key --project=YOUR_PROJECT
   ```

2. **Grant the default Cloud Functions service account access** to the secret:

   ```bash
   PROJECT_ID=your-project-id
   SA="YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com"  # or the 2nd-gen functions SA
   gcloud secrets add-iam-policy-binding ir_scanner_gemini_api_key \
     --member="serviceAccount:${SA}" --role="roles/secretmanager.secretAccessor" \
     --project=${PROJECT_ID}
   ```

3. **Configure the function to use the secret** (Firebase/Cloud Functions 2nd gen):

   In the Firebase Console: Functions → macro_refresh → Configuration → add secret `GEMINI_API_KEY` from Secret Manager.

   Or via `firebase.json` / deployment: set the function’s `secrets` so `GEMINI_API_KEY` is bound to your secret (see [Firebase docs](https://firebase.google.com/docs/functions/config-env#secret-manager)).

The code reads `GEMINI_API_KEY` or `GOOGLE_AI_API_KEY` from the environment.

## Timeout

Scheduled functions (2nd gen) can run up to 30 minutes. If needed, set the function timeout to 9–10 minutes in the function options so macro + shifts complete.
