'use client';

import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import type { WatchlistItem, WatchlistStatus } from '../../lib/services/watchlistShared';
import { WATCHLIST_STATUSES } from '../../lib/services/watchlistShared';
import { db } from '../../lib/firebase';

const STATUS_LABELS: Record<WatchlistStatus, string> = {
  thesis_needed: 'Exploring',
  watching: 'Watching',
  awaiting_confirmation: 'Awaiting confirmation',
  ready_to_buy: 'Ready to buy',
};

const YOUTUBE_VIDEOS = 'youtube_videos';
const YOUTUBE_SUBSCRIPTIONS = 'youtube_subscriptions';

function formatVideoPublishedDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return iso;
  }
}

function publishedAtFromFirestoreDoc(d: Record<string, unknown>): string | undefined {
  const p = d.publishedAt;
  if (typeof p === 'string' && p.trim()) {
    return formatVideoPublishedDate(p);
  }
  if (p && typeof p === 'object' && 'toDate' in p && typeof (p as { toDate?: () => Date }).toDate === 'function') {
    try {
      const dt = (p as { toDate: () => Date }).toDate();
      return formatVideoPublishedDate(dt.toISOString());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export type LinkedYoutubeVideoMeta = {
  videoId: string;
  title: string;
  watchUrl: string;
  thumbUrl: string;
  sourceLabel?: string;
  /** Display date from `youtube_videos.publishedAt` */
  publishedLabel?: string;
};

function useLinkedYoutubeVideoMeta(watchlistItems: WatchlistItem[]): Record<string, LinkedYoutubeVideoMeta> {
  const [byId, setById] = useState<Record<string, LinkedYoutubeVideoMeta>>({});

  const idsKey = useMemo(() => {
    const s = new Set<string>();
    for (const item of watchlistItems) {
      for (const id of item.linkedYoutubeVideoIds ?? []) {
        if (typeof id === 'string' && id.trim()) s.add(id.trim());
      }
    }
    return [...s].sort().join('\0');
  }, [watchlistItems]);

  useEffect(() => {
    if (!idsKey) return;
    const videoIdList = idsKey.split('\0');
    let cancelled = false;

    (async () => {
      const videoSnaps = await Promise.all(
        videoIdList.map((id) => getDoc(doc(db, YOUTUBE_VIDEOS, id)))
      );
      const subscriptionIds = new Set<string>();
      const rows: Array<{
        videoId: string;
        title: string;
        subscriptionId: string;
        publishedLabel?: string;
      }> = [];

      for (let i = 0; i < videoIdList.length; i++) {
        const id = videoIdList[i]!;
        const snap = videoSnaps[i]!;
        if (!snap.exists) {
          rows.push({ videoId: id, title: '', subscriptionId: '' });
          continue;
        }
        const d = snap.data() as Record<string, unknown>;
        const title = typeof d.title === 'string' ? d.title : '';
        const subId = typeof d.subscriptionId === 'string' ? d.subscriptionId : '';
        if (subId) subscriptionIds.add(subId);
        rows.push({
          videoId: id,
          title,
          subscriptionId: subId,
          publishedLabel: publishedAtFromFirestoreDoc(d),
        });
      }

      const labelBySubId = new Map<string, string>();
      await Promise.all(
        [...subscriptionIds].map(async (sid) => {
          const s = await getDoc(doc(db, YOUTUBE_SUBSCRIPTIONS, sid));
          if (!s.exists) return;
          const d = s.data() as Record<string, unknown>;
          const label =
            typeof d.label === 'string' && d.label.trim()
              ? d.label.trim()
              : typeof d.url === 'string'
                ? d.url
                : '';
          if (label) labelBySubId.set(sid, label);
        })
      );

      if (cancelled) return;
      const out: Record<string, LinkedYoutubeVideoMeta> = {};
      for (const row of rows) {
        const { videoId, title, subscriptionId, publishedLabel } = row;
        out[videoId] = {
          videoId,
          title: title.trim() || `Video ${videoId}`,
          watchUrl: `https://www.youtube.com/watch?v=${videoId}`,
          thumbUrl: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
          sourceLabel: subscriptionId ? labelBySubId.get(subscriptionId) : undefined,
          publishedLabel,
        };
      }
      setById(out);
    })();

    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  return idsKey ? byId : {};
}

function LinkedVideosRow({
  videoIds,
  metaById,
}: {
  videoIds: string[];
  metaById: Record<string, LinkedYoutubeVideoMeta>;
}) {
  if (videoIds.length === 0) return null;
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Source videos</div>
      <ul className="space-y-2">
        {videoIds.map((vid) => {
          const meta = metaById[vid];
          const href = meta?.watchUrl ?? `https://www.youtube.com/watch?v=${vid}`;
          const thumb = meta?.thumbUrl ?? `https://img.youtube.com/vi/${vid}/mqdefault.jpg`;
          const title = meta?.title ?? vid;
          return (
            <li key={vid}>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex gap-3 rounded-lg border border-gray-100 bg-gray-50/80 p-2 hover:bg-gray-100/80 transition-colors min-w-0"
              >
                <img
                  src={thumb}
                  alt=""
                  className="w-24 h-14 shrink-0 rounded object-cover bg-gray-200"
                  width={96}
                  height={56}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 line-clamp-2">{title}</div>
                  {meta?.sourceLabel ? (
                    <div className="text-xs text-gray-500 mt-0.5 truncate" title={meta.sourceLabel}>
                      {meta.sourceLabel}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400 mt-0.5">YouTube</div>
                  )}
                  {meta?.publishedLabel ? (
                    <div className="text-xs text-gray-400 mt-0.5">Published {meta.publishedLabel}</div>
                  ) : null}
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default function WatchlistMainPanel({
  router,
  watchlistItems,
  onOpenAddWatchlist,
  onStartEditWatchlistItem,
  onDeleteWatchlistItem,
  onStatusChange,
  signedIn,
  onSignIn,
}: {
  router: { push: (href: string) => void };
  watchlistItems: WatchlistItem[];
  onOpenAddWatchlist: () => void;
  onStartEditWatchlistItem: (item: WatchlistItem) => void;
  onDeleteWatchlistItem: (id: string) => void;
  onStatusChange: (itemId: string, status: WatchlistStatus) => void;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const linkedVideoMeta = useLinkedYoutubeVideoMeta(watchlistItems);

  if (!signedIn) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="p-6 border-b border-gray-200 bg-white">
          <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
          <p className="text-sm text-gray-600 mt-1">Sign in to track names you&apos;re considering</p>
        </div>
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <p className="text-gray-600 mb-4">Watchlist is available after you sign in with Google.</p>
            <button
              type="button"
              onClick={onSignIn}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Sign in
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 border-b border-gray-200 bg-white">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Watchlist</h1>
            <p className="text-sm text-gray-600 mt-1">Add a ticker and a note; add a thesis when you&apos;re ready</p>
          </div>
          <button
            type="button"
            onClick={onOpenAddWatchlist}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            + Add ticker
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {watchlistItems.length > 0 ? (
          <div className="space-y-4">
            {watchlistItems.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-900">{item.ticker}</h3>
                      <select
                        value={item.status}
                        onChange={(e) =>
                          onStatusChange(item.id!, e.target.value as WatchlistStatus)
                        }
                        className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white text-gray-900 min-w-[12rem]"
                        aria-label="Status"
                      >
                        {WATCHLIST_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {item.notes ? (
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{item.notes}</p>
                    ) : (
                      <p className="text-sm text-gray-400 italic">No note</p>
                    )}

                    <LinkedVideosRow
                      videoIds={item.linkedYoutubeVideoIds ?? []}
                      metaById={linkedVideoMeta}
                    />

                    {item.targetPrice != null && (
                      <p className="text-sm text-gray-600">
                        <span className="text-gray-500">Target:</span> ${item.targetPrice.toFixed(2)}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Thesis
                      </span>
                      {item.thesisId ? (
                        <button
                          type="button"
                          onClick={() => {
                            const q = new URLSearchParams();
                            q.set('thesisDocId', item.thesisId!);
                            router.push(`/${item.ticker}/thesis-builder?${q.toString()}`);
                          }}
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          View Thesis
                        </button>
                      ) : item.id ? (
                        <button
                          type="button"
                          onClick={() =>
                            router.push(
                              `/new-thesis?ticker=${encodeURIComponent(item.ticker)}&watchlistItemId=${encodeURIComponent(item.id)}`
                            )
                          }
                          className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Add thesis
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => onStartEditWatchlistItem(item)}
                      className="p-2 text-gray-500 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                      aria-label="Edit note"
                      title="Edit note"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteWatchlistItem(item.id!)}
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      aria-label="Remove from watchlist"
                      title="Remove"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                        />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-gray-500 mb-4">No tickers yet.</p>
            <button
              type="button"
              onClick={onOpenAddWatchlist}
              className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-md transition-colors"
            >
              Add your first ticker
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
