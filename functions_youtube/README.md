# functions_youtube

Pub/Sub-triggered Firebase Functions:

1. **youtube_refresh** — Subscribes to `youtube-refresh-requests`; each message carries `{"subscriptionId": "<firestore-doc-id>"}`. Uses YouTube Data API (resolve @handles) + public RSS feed; upserts to Firestore (`youtube_subscriptions`, `youtube_videos`). Does not fetch transcripts in the cloud (to avoid IP blocking).

2. **youtube_transcript_analysis** — Subscribes to `youtube-transcript-analysis-requests`; each message carries `{"videoId": "<id>"}`. Reads transcript from Storage (`youtube_transcripts/{videoId}.txt`), summarizes with Gemini, writes `transcriptSummary` and `transcriptSummaryUpdatedAt` to Firestore.

## Environment

- **YOUTUBE_API_KEY** (required for refresh): YouTube Data API key for resolving channel handles. Set in Firebase Functions config or Secret Manager.
- **GEMINI_API_KEY** (required for transcript analysis): Set in Secret Manager for the transcript-analysis function.

## Pub/Sub topics and subscriptions

- **Topics** (create if missing): `youtube-refresh-requests`, `youtube-transcript-analysis-requests`
  ```bash
  cd functions_youtube && make create-topic
  ```
  Or manually: `gcloud pubsub topics create TOPIC_NAME --project=YOUR_PROJECT_ID`

- **Subscriptions** are created automatically when you deploy the functions. If topics exist but have no subscriptions, the trigger functions were not deployed. Deploy the full youtube codebase so both functions (and their subscriptions) are created:
  ```bash
  firebase deploy --only functions:youtube
  ```
  Then verify in GCP Console → Pub/Sub → Subscriptions (you should see one per topic, e.g. pointing to the Cloud Run service for each function).

## Local run (refresh)

From project root, with `data-fetcher/.env.local` containing `FIREBASE_*` and `YOUTUBE_API_KEY`:

```bash
cd functions_youtube && pip install -r requirements.txt
python run_local.py <subscription_id>
```

Or from `run_youtube`: `make run SUBSCRIPTION_ID=<id>`.

## Local transcript script (run_transcript.py)

To avoid YouTube IP blocking, transcripts are fetched **locally** and uploaded to Storage; the script then publishes to `youtube-transcript-analysis-requests` so the Cloud Function runs the Gemini summary.

**Setup:** Same Firebase env as above (e.g. copy `data-fetcher/.env.local` or set `FIREBASE_PROJECT_ID`, `FIREBASE_PRIVATE_KEY`, etc.). Optionally set `GOOGLE_CLOUD_PROJECT` (defaults to `FIREBASE_PROJECT_ID`).

**Run:**
```bash
cd functions_youtube && pip install -r requirements.txt
python run_transcript.py
```

Processes all `youtube_videos` that have no `transcriptStorageRef`. For each: fetches transcript via `youtube-transcript-api`, uploads to `youtube_transcripts/{videoId}.txt`, updates Firestore, publishes one message to `youtube-transcript-analysis-requests`.

Optional args: `--video-id VIDEO_ID` to process a single video; `--dry-run` to only list videos that would be processed.

## Trigger analysis (videos that have transcript but no summary)

To run the Cloud Function (Gemini summary) for every video that already has a transcript but no `transcriptSummary`:

```bash
cd functions_youtube && make trigger-analysis
```

Trigger analysis for **one video** (must have `transcriptStorageRef`):

```bash
make trigger-analysis VIDEO_ID=abc123xyz
```

Dry run (only list which videos would be triggered):

```bash
make trigger-analysis DRY_RUN=1
```

Or run the script directly: `python trigger_analysis.py`, `python trigger_analysis.py --video-id ID`, `python trigger_analysis.py --dry-run`.

### Run transcript analysis locally (no deployment)

To run the same logic (Storage → Gemini → Firestore) on your machine without invoking the Cloud Function, set `GEMINI_API_KEY` in `../data-fetcher/.env.local` and run:

```bash
make run-analysis                    # all videos with transcript but no summary
make run-analysis VIDEO_ID=abc123   # one video
```

Or: `python run_transcript_analysis_local.py`, `python run_transcript_analysis_local.py --video-id ID`. Requires `google-genai` (in requirements).

## Deploy

1. Ensure both topics exist (`make create-topic` from `functions_youtube` if needed).
2. Deploy **all** youtube functions (this creates the Pub/Sub subscriptions):

```bash
firebase deploy --only functions:youtube
```

This deploys both `youtube_refresh` and `youtube_transcript_analysis`. Each function’s deployment creates the subscription for its topic. If you previously deployed only `youtube_refresh`, run the command above again so `youtube_transcript_analysis` is deployed and the `youtube-transcript-analysis-requests` subscription is created.
