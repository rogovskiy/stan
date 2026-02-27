import {
  collection,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
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

export interface YouTubeVideo {
  id: string;
  videoId: string;
  url: string;
  title: string;
  publishedAt: string;
  subscriptionId: string;
  userId?: string | null;
  createdAt?: string;
}

const SUBS_COLLECTION = 'youtube_subscriptions';
const VIDEOS_COLLECTION = 'youtube_videos';

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

function toVideo(docId: string, data: Record<string, unknown>): YouTubeVideo {
  return {
    id: docId,
    videoId: (data.videoId as string) ?? docId,
    url: (data.url as string) ?? '',
    title: (data.title as string) ?? '',
    publishedAt:
      (data.publishedAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ??
      (typeof data.publishedAt === 'string' ? data.publishedAt : ''),
    subscriptionId: (data.subscriptionId as string) ?? '',
    userId: (data.userId as string) ?? null,
    createdAt:
      (data.createdAt as { toDate?: () => Date })?.toDate?.()?.toISOString() ??
      (typeof data.createdAt === 'string' ? data.createdAt : undefined),
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
