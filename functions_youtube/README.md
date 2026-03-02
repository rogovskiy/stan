# functions_youtube

Pub/Sub-triggered Firebase Function that refreshes YouTube subscription feeds. Subscribes to topic `youtube-refresh-requests`; each message carries `{"subscriptionId": "<firestore-doc-id>"}`. Uses YouTube Data API (resolve @handles) + public RSS feed; upserts to Firestore (`youtube_subscriptions`, `youtube_videos`).

## Environment

- **YOUTUBE_API_KEY** (required): YouTube Data API key for resolving channel handles. Set in Firebase Functions config or Secret Manager. Create in Google Cloud Console → APIs & Services → Credentials.

## Local run

From project root, with `data-fetcher/.env.local` containing `FIREBASE_*` and `YOUTUBE_API_KEY`:

```bash
cd functions_youtube && pip install -r requirements.txt
python run_local.py <subscription_id>
```

Or from `run_youtube`: `make run SUBSCRIPTION_ID=<id>`.

## Deploy

```bash
firebase deploy --only functions:youtube
```
