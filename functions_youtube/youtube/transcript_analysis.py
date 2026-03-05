"""
Transcript analysis: read transcript from Storage, summarize with Gemini, write to Firestore.
Used by the Cloud Function triggered by youtube-transcript-analysis-requests.

Uses the dynamic prompt system: prompt content and model/temperature are loaded by name
(youtube_transcript_summary) from Firestore/Storage. Create that prompt in the admin UI.
"""

import json
import logging
from datetime import datetime, timezone

from firebase_admin import firestore, storage

from dynamic_prompt_runner import run_llm_with_prompt_name

logger = logging.getLogger(__name__)

PROMPT_NAME = "youtube_transcript_summary"


def run_transcript_analysis(video_id: str, gemini_api_key: str) -> None:
    """
    Load transcript from Storage, summarize with Gemini (dynamic prompt), write transcriptSummary to Firestore.
    Raises on missing doc, missing transcriptStorageRef, or if prompt youtube_transcript_summary is not in admin.
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

    result, execution_id = run_llm_with_prompt_name(
        PROMPT_NAME,
        {"transcript": transcript},
        api_key=gemini_api_key,
    )
    summary = result if isinstance(result, str) else json.dumps(result, indent=2)

    now = datetime.now(timezone.utc)
    summary_updated_at = now.isoformat().replace("+00:00", "Z")
    existing_provenance = data.get("provenance")
    if not isinstance(existing_provenance, list):
        existing_provenance = []
    provenance = existing_provenance + [{"analysis": execution_id}]
    doc_ref.update({
        "transcriptSummary": summary,
        "transcriptSummaryUpdatedAt": summary_updated_at,
        "provenance": provenance,
    })
    logger.info("Transcript analysis done for %s: summary length=%d", video_id, len(summary))
