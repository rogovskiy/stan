"""
Transcript analysis: read transcript from Storage, summarize with Gemini, write to Firestore.
Used by the Cloud Function triggered by youtube-transcript-analysis-requests.
"""

import logging
from datetime import datetime, timezone

from firebase_admin import firestore, storage

logger = logging.getLogger(__name__)

VIDEO_ECONOMIC_SUMMARY_PROMPT = """You are given a transcript of a video.
Your task is to extract distinct forward-looking economic or market theses expressed by the author.

These may include:
-Stock-specific investment ideas
- Sector themes
- Macro regime shifts (rates, inflation, liquidity, geopolitics)
- Policy changes
- Market-wide risk warnings
- Structural economic changes
- M&A implications

Ignore:
- Purely educational explanations
- Definitions or background history
- Storytelling without forward-looking economic implications
- Repetition

Only extract views that imply a future economic, market, or valuation outcome.

Instructions:
- Identify up to 3 distinct economic theses.
- Each thesis must have a clear forward-looking implication.
- Merge overlapping or closely related claims.
- Be concise and avoid redundancy.

If no forward-looking economic thesis exists, output exactly:
No forward-looking economic thesis identified.

Output format (Markdown only):

## Thesis 1 — [Short Label]
Scope: Stock / Sector / Macro / Policy / Market-wide / Other

1–2 sentences summarizing the forward-looking view.

#### Key Support:
Bullet with only the most important data or reasoning
* Bullet
* Bullet

#### Risks / Uncertainty (if mentioned):
* Bullet
* Bullet

(Repeat for up to 3 theses)
~~~~~~
**Transcript:**

{transcript}
"""

DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"


def run_transcript_analysis(video_id: str, gemini_api_key: str) -> None:
    """
    Load transcript from Storage, summarize with Gemini, write transcriptSummary to Firestore.
    Raises on missing doc, missing transcriptStorageRef, or Gemini failure.
    """
    db = firestore.client()
    bucket = storage.bucket()
    videos_ref = db.collection("youtube_videos")
    doc_ref = videos_ref.document(video_id)
    doc = doc_ref.get()
    if not doc.exists:
        raise ValueError(f"Video {video_id} not found in youtube_videos")
    data = doc.to_dict() or {}
    storage_ref = (data.get("transcriptStorageRef") or "").strip()
    if not storage_ref:
        storage_ref = f"youtube_transcripts/{video_id}.txt"
    blob = bucket.blob(storage_ref)
    if not blob.exists():
        raise FileNotFoundError(f"Transcript blob not found: {storage_ref}")
    transcript = blob.download_as_text()
    if not (transcript or "").strip():
        raise ValueError(f"Transcript empty for {video_id}")
    prompt = VIDEO_ECONOMIC_SUMMARY_PROMPT.replace("{transcript}", transcript)
    try:
        from google import genai
        from google.genai import types
    except ImportError as e:
        raise RuntimeError("google-genai is required for transcript analysis") from e
    client = genai.Client(api_key=gemini_api_key)
    model = DEFAULT_GEMINI_MODEL
    config = types.GenerateContentConfig(
        temperature=0.1,
        max_output_tokens=8192,
    )
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=config,
    )
    if not response.text:
        raise ValueError("Gemini returned empty response")
    summary = response.text.strip()
    now = datetime.now(timezone.utc)
    summary_updated_at = now.isoformat().replace("+00:00", "Z")
    doc_ref.update({
        "transcriptSummary": summary,
        "transcriptSummaryUpdatedAt": summary_updated_at,
    })
    logger.info("Transcript analysis done for %s: summary length=%d", video_id, len(summary))
