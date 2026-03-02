# YouTube refresh (Firebase Function)

YouTube subscription refresh runs as a **Firebase Cloud Function** in `functions_youtube`. It is triggered by Pub/Sub messages on `youtube-refresh-requests` (each message contains a `subscriptionId`). The function uses the **YouTube Data API** to resolve @handles to channel IDs and the **public RSS feed** to fetch latest videos, then upserts into Firestore (`youtube_subscriptions`, `youtube_videos`). No custom Docker image is used.

**Required:** Set `YOUTUBE_API_KEY` for the YouTube function (Firebase config or Secret Manager). Create a key in Google Cloud Console → APIs & Services → Credentials.

## How to run locally

From the **project root** or `run_youtube`:

1. Install dependencies for the YouTube function:  
   `cd functions_youtube && python3.11 -m venv venv && source venv/bin/activate && pip install -r requirements.txt`
2. Ensure `data-fetcher/.env.local` exists with Firebase service account vars and **`YOUTUBE_API_KEY`**.
3. Run one subscription:  
   `python functions_youtube/run_local.py <subscription_id>`  
   Or from `run_youtube`: `make run SUBSCRIPTION_ID=<firestore-doc-id>`

## Make targets (from `run_youtube`)

| Target | Description |
|--------|-------------|
| `make run` | Run YouTube refresh locally for one subscription (invokes `functions_youtube/run_local.py`). Usage: `make run SUBSCRIPTION_ID=<id>`. |
| `make create-topic` | Create Pub/Sub topic `youtube-refresh-requests` (once per project). |
| `make trigger-function` | Publish one message to `youtube-refresh-requests`. Usage: `make trigger-function SUBSCRIPTION_ID=<id>`. |

## Deploy

Deploy all functions (including YouTube) with Firebase:

```bash
firebase deploy --only functions
```

To deploy only the YouTube codebase:

```bash
firebase deploy --only functions:youtube
```

Firebase creates the Pub/Sub subscription for `youtube-refresh-requests` when the function is deployed. Configure **YOUTUBE_API_KEY** for the YouTube function (e.g. Firebase Functions config or Secret Manager).

If you previously had a **push subscription** pointing at the old Cloud Run URL, remove it or leave it; the new Cloud Function subscribes via Firebase’s own subscription.

## Triggering

After deploy, the scheduler in `functions/main.py` publishes one message per subscription to `youtube-refresh-requests` daily at 01:00 UTC. To trigger manually:

```bash
make trigger-function SUBSCRIPTION_ID=<subscription-doc-id>
```

Override project: `make trigger-function SUBSCRIPTION_ID=abc PROJECT_ID=your-project-id`.

**Supported subscription URL formats:** channel ID (`UC...`), `youtube.com/channel/UC...`, `@handle`, `youtube.com/@handle`.
