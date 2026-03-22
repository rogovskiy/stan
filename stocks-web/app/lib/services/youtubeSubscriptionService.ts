import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
  query,
  orderBy,
  where,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';

export interface YouTubeSubscription {
  id: string;
  url: string;
  label?: string | null;
  userId?: string | null;
  createdAt?: string;
}

/** Provenance entry linking to a prompt execution (e.g. transcript analysis). */
export interface ProvenanceEntry {
  analysis?: string;
  [key: string]: string | undefined;
}

/** Structured thesis row from transcript analysis (optional ticker for watchlist actions). */
export interface TranscriptSummaryThesis {
  title?: string;
  summary?: string;
  ticker?: string | null;
}

export interface YouTubeVideo {
  id: string;
  videoId: string;
  url: string;
  title: string;
  publishedAt: string;
  subscriptionId: string;
  userId?: string | null;
  createdAt?: string;
  transcriptStorageRef?: string | null;
  transcriptSummary?: string | null;
  /** Machine-readable theses from structured transcript analysis; UI uses `ticker` when present. */
  transcriptSummaryTheses?: TranscriptSummaryThesis[] | null;
  /** Links to prompt executions that produced this content (e.g. [{ analysis: "<execution_id>" }]). */
  provenance?: ProvenanceEntry[] | null;
}

const SUBS_COLLECTION = 'youtube_subscriptions';
const VIDEOS_COLLECTION = 'youtube_videos';
const TRANSCRIPT_REVIEWS_COLLECTION = 'youtube_transcript_reviews';

function toSubscription(docId: string, data: Record<string, unknown>): YouTubeSubscription {
  return {
    id: docId,
    url: (data.url as string) ?? '',
    label: (data.label as string) ?? null,
    userId: (data.userId as string) ?? null,
    createdAt:
      (data.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ??
      (typeof data.createdAt === 'string' ? data.createdAt : undefined),
  };
}

function parseTranscriptSummaryTheses(raw: unknown): TranscriptSummaryThesis[] | null {
  if (!Array.isArray(raw)) return null;
  const out: TranscriptSummaryThesis[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title : '';
    const summary = typeof o.summary === 'string' ? o.summary : '';
    const t = o.ticker;
    const ticker =
      typeof t === 'string' && t.trim() ? t.trim().toUpperCase() : t === null ? null : undefined;
    out.push({ title, summary, ticker: ticker ?? null });
  }
  return out.length > 0 ? out : null;
}

function toVideo(docId: string, data: Record<string, unknown>): YouTubeVideo {
  const videoId = (data.videoId as string) ?? docId;
  return {
    id: docId,
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: (data.title as string) ?? '',
    publishedAt:
      (data.publishedAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ??
      (typeof data.publishedAt === 'string' ? data.publishedAt : ''),
    subscriptionId: (data.subscriptionId as string) ?? '',
    userId: (data.userId as string) ?? null,
    createdAt:
      (data.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ??
      (typeof data.createdAt === 'string' ? data.createdAt : undefined),
    transcriptStorageRef: (data.transcriptStorageRef as string) ?? null,
    transcriptSummary: (data.transcriptSummary as string) ?? null,
    transcriptSummaryTheses: parseTranscriptSummaryTheses(data.transcriptSummaryTheses),
    provenance: Array.isArray(data.provenance)
      ? (data.provenance as ProvenanceEntry[])
      : null,
  };
}

export async function getSubscriptions(userId?: string | null): Promise<YouTubeSubscription[]> {
  const ref = collection(db, SUBS_COLLECTION);
  const q = userId
    ? query(
        ref,
        where('userId', '==', userId),
        orderBy('createdAt', 'desc')
      )
    : query(ref, orderBy('createdAt', 'desc'));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => toSubscription(d.id, d.data() as Record<string, unknown>));
}

export async function addSubscription(params: {
  url: string;
  label?: string | null;
  userId?: string | null;
}): Promise<string> {
  const ref = collection(db, SUBS_COLLECTION);
  const docRef = await addDoc(ref, {
    url: params.url.trim(),
    label: params.label?.trim() ?? null,
    userId: params.userId ?? null,
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function deleteSubscription(subscriptionId: string): Promise<void> {
  await deleteDoc(doc(db, SUBS_COLLECTION, subscriptionId));
}

export async function getVideos(
  userId?: string | null,
  limitCount: number = 500
): Promise<YouTubeVideo[]> {
  const ref = collection(db, VIDEOS_COLLECTION);
  const q = userId
    ? query(
        ref,
        where('userId', '==', userId),
        orderBy('publishedAt', 'desc'),
        limit(limitCount)
      )
    : query(ref, orderBy('publishedAt', 'desc'), limit(limitCount));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => toVideo(d.id, d.data() as Record<string, unknown>));
}

/** Document ID for transcript review: one per user per video. */
function transcriptReviewDocId(userId: string, videoId: string): string {
  return `${userId}_${videoId}`;
}

/**
 * Mark a video's transcript as reviewed by the user (e.g. when they open the transcript drawer).
 * Requires a logged-in user.
 */
export async function markTranscriptReviewed(userId: string, videoId: string): Promise<void> {
  const ref = doc(db, TRANSCRIPT_REVIEWS_COLLECTION, transcriptReviewDocId(userId, videoId));
  await setDoc(ref, {
    userId,
    videoId,
    reviewedAt: serverTimestamp(),
  });
}

/**
 * Return the set of video IDs that the user has reviewed (opened transcript/summary).
 * Returns empty set if userId is missing.
 */
export async function getReviewedVideoIds(userId: string | undefined | null): Promise<Set<string>> {
  if (!userId) return new Set();
  const ref = collection(db, TRANSCRIPT_REVIEWS_COLLECTION);
  const q = query(ref, where('userId', '==', userId));
  const snapshot = await getDocs(q);
  const ids = new Set<string>();
  snapshot.docs.forEach((d) => {
    const videoId = (d.data().videoId as string) ?? null;
    if (videoId) ids.add(videoId);
  });
  return ids;
}
