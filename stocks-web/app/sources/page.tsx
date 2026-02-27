'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import AppNavigation from '../components/AppNavigation';
import { useAuth } from '@/app/lib/authContext';
import type { YouTubeVideo, YouTubeSubscription } from '../lib/services/youtubeSubscriptionService';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function formatDate(iso: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  } catch {
    return iso;
  }
}

function parsePublishedAt(iso: string): number {
  try {
    return new Date(iso).getTime();
  } catch {
    return 0;
  }
}

function VideoCard({ video, sourceLabel }: { video: YouTubeVideo; sourceLabel: string }) {
  return (
    <button
      type="button"
      onClick={() => window.open(video.url, '_blank', 'noopener,noreferrer')}
      className="text-left rounded-lg border border-gray-200 bg-white overflow-hidden shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
    >
      <div className="aspect-video w-full bg-gray-100 relative">
        <img
          src={`https://img.youtube.com/vi/${video.videoId}/mqdefault.jpg`}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      </div>
      <div className="p-2">
        <div className="text-sm font-medium text-gray-900 line-clamp-2 leading-tight">{video.title}</div>
        <div className="flex items-center gap-1.5 mt-1 text-xs text-gray-600 min-w-0">
          <span className="shrink-0 w-4 h-4 rounded-full bg-red-600 flex items-center justify-center" aria-hidden>
            <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
            </svg>
          </span>
          <span className="truncate min-w-0" title={sourceLabel}>{sourceLabel}</span>
        </div>
        <div className="text-[11px] text-gray-500 mt-0.5">
          {formatDate(video.publishedAt)}
        </div>
      </div>
    </button>
  );
}

export default function SourcesPage() {
  const { user } = useAuth();
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [videos, setVideos] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [subscriptions, setSubscriptions] = useState<YouTubeSubscription[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const userId = user?.uid ?? undefined;

  const fetchVideos = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      // Don't filter by userId so we show all videos (including shared / null userId)
      const res = await fetch(`/api/youtube/videos?${params.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load videos');
      setVideos(data.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load videos');
      setVideos([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchSubscriptions = useCallback(async () => {
    setSubsLoading(true);
    try {
      const params = new URLSearchParams();
      // Don't filter by userId so we show all subscriptions (including shared / null userId)
      const res = await fetch(`/api/youtube/subscriptions?${params.toString()}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to load subscriptions');
      setSubscriptions(data.data ?? []);
    } catch {
      setSubscriptions([]);
    } finally {
      setSubsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchVideos();
  }, [fetchVideos]);

  useEffect(() => {
    if (settingsOpen) fetchSubscriptions();
  }, [settingsOpen, fetchSubscriptions]);

  // Load subscriptions for video cards (source/author labels)
  useEffect(() => {
    if (videos.length > 0) {
      fetch('/api/youtube/subscriptions')
        .then((res) => res.json())
        .then((data) => (data.success ? setSubscriptions(data.data ?? []) : []))
        .catch(() => {});
    }
  }, [videos.length > 0]);

  const subscriptionLabelById = subscriptions.reduce<Record<string, string>>(
    (acc, sub) => {
      acc[sub.id] = sub.label?.trim() || sub.url;
      return acc;
    },
    {}
  );

  const { last7Days, older } = useMemo(() => {
    const cutoff = Date.now() - 7 * MS_PER_DAY;
    const sorted = [...videos].sort((a, b) => parsePublishedAt(b.publishedAt) - parsePublishedAt(a.publishedAt));
    const last7Days = sorted.filter((v) => parsePublishedAt(v.publishedAt) >= cutoff);
    const older = sorted.filter((v) => parsePublishedAt(v.publishedAt) < cutoff);
    return { last7Days, older };
  }, [videos]);

  const handleRemoveSubscription = async (id: string) => {
    try {
      const res = await fetch(`/api/youtube/subscriptions/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!data.success) throw new Error(data.error);
      setSubscriptions((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = newUrl.trim();
    if (!url) return;
    setAdding(true);
    setAddError(null);
    try {
      const res = await fetch('/api/youtube/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          label: newLabel.trim() || undefined,
          userId: userId ?? undefined,
        }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to add');
      setNewUrl('');
      setNewLabel('');
      setSubscriptions((prev) => [{ id: data.data.id, url: data.data.url, label: data.data.label ?? null, userId: data.data.userId ?? null }, ...prev]);
    } catch (e) {
      setAddError(e instanceof Error ? e.message : 'Failed to add subscription');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation selectedTicker={selectedTicker} onTickerChange={setSelectedTicker} />

      <div className="w-full max-w-none px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">YouTube Sources</h1>
            <p className="text-sm text-gray-600 mt-2">
              Videos from your subscribed channels. Click a video to open it on YouTube.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
            title="Configure subscriptions"
            aria-label="Configure subscriptions"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 2.31.826 1.37 1.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 2.31-1.37 1.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-2.31-.826-1.37-1.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-2.31 1.37-1.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 p-4 rounded-lg bg-red-50 text-red-800 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-gray-600">Loading videos…</p>
        ) : videos.length === 0 ? (
          <p className="text-gray-600">
            No videos yet. Add a YouTube channel or playlist in Settings, then run the refresh job to fetch videos.
          </p>
        ) : (
          <div className="space-y-8">
            {last7Days.length > 0 && (
              <section>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Last 7 days</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                  {last7Days.map((video) => (
                    <VideoCard
                      key={video.id}
                      video={video}
                      sourceLabel={subscriptionLabelById[video.subscriptionId] || 'Channel'}
                    />
                  ))}
                </div>
              </section>
            )}
            {older.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Older</h2>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
                {older.map((video) => (
                  <VideoCard
                    key={video.id}
                    video={video}
                    sourceLabel={subscriptionLabelById[video.subscriptionId] || 'Channel'}
                  />
                ))}
              </div>
            </section>
            )}
          </div>
        )}
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Configure subscriptions</h2>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-800"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto flex-1">
              <form onSubmit={handleAddSubscription} className="mb-6">
                <div className="space-y-3">
                  <div>
                    <label htmlFor="sub-url" className="block text-sm font-medium text-gray-800 mb-1">
                      YouTube channel or playlist URL
                    </label>
                    <input
                      id="sub-url"
                      type="url"
                      value={newUrl}
                      onChange={(e) => setNewUrl(e.target.value)}
                      placeholder="https://www.youtube.com/@Channel or https://www.youtube.com/playlist?list=..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
                    />
                  </div>
                  <div>
                    <label htmlFor="sub-label" className="block text-sm font-medium text-gray-800 mb-1">
                      Label (optional)
                    </label>
                    <input
                      id="sub-label"
                      type="text"
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      placeholder="e.g. Channel name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white"
                    />
                  </div>
                  {addError && (
                    <p className="text-sm text-red-600">{addError}</p>
                  )}
                  <button
                    type="submit"
                    disabled={adding || !newUrl.trim()}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {adding ? 'Adding…' : 'Add subscription'}
                  </button>
                </div>
              </form>

              <h3 className="text-sm font-semibold text-gray-800 mb-2">Current subscriptions</h3>
              {subsLoading ? (
                <p className="text-sm text-gray-700">Loading…</p>
              ) : subscriptions.length === 0 ? (
                <p className="text-sm text-gray-600">No subscriptions yet.</p>
              ) : (
                <ul className="space-y-2">
                  {subscriptions.map((sub) => (
                    <li
                      key={sub.id}
                      className="flex items-center justify-between gap-3 py-2 px-3 rounded-lg bg-gray-100 border border-gray-200"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-gray-900 truncate">{sub.label || sub.url}</p>
                        <p className="text-xs text-gray-600 truncate">{sub.url}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveSubscription(sub.id)}
                        className="flex-shrink-0 p-2 rounded text-red-600 hover:bg-red-50"
                        title="Remove"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
