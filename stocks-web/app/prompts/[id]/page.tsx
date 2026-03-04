'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import AppNavigation from '../../components/AppNavigation';

interface VersionItem {
  version: number;
  updatedAt: string;
}

interface PromptData {
  id: string;
  name: string;
  content: string;
  currentVersion: number;
  viewingVersion?: number;
  updatedAt: string | null;
  versions: VersionItem[];
}

const FALLBACK_CONTENT = 'Prompt content will load from the API.\n\nHuman-readable ID: {{id}}';

function formatVersionDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return iso;
  }
}

export default function PromptEditPage() {
  const params = useParams();
  const id = (params?.id as string) ?? '';
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [content, setContent] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [currentVersion, setCurrentVersion] = useState(0);
  const [viewingVersion, setViewingVersion] = useState(0);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [activateStatus, setActivateStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadPrompt = useCallback(
    (version?: number) => {
      if (!id) return;
      const url =
        version != null && version > 0
          ? `/api/admin/prompts/${encodeURIComponent(id)}?version=${version}`
          : `/api/admin/prompts/${encodeURIComponent(id)}`;
      return fetch(url)
        .then((res) => {
          if (!res.ok) throw new Error(res.status === 404 ? 'Not found' : res.statusText);
          return res.json();
        })
        .then((data: PromptData) => {
          setContent(data.content ?? '');
          setDisplayName(data.name ?? id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
          setCurrentVersion(data.currentVersion ?? 0);
          setViewingVersion(data.viewingVersion ?? data.currentVersion ?? 0);
          setVersions(data.versions ?? []);
          setLoadError(null);
        })
        .catch((err) => {
          setLoadError(err instanceof Error ? err.message : 'Failed to load');
          setContent(FALLBACK_CONTENT.replace('{{id}}', id));
          setDisplayName(id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
          setVersions([]);
        });
    },
    [id]
  );

  useEffect(() => {
    if (!id) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    loadPrompt()
      .then(() => {
        if (!cancelled) setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, loadPrompt]);

  const handleVersionChange = (v: number) => {
    setViewingVersion(v);
    setLoading(true);
    loadPrompt(v).finally(() => setLoading(false));
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      const res = await fetch(`/api/admin/prompts/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      setSaveStatus('saved');
      await loadPrompt();
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (e) {
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  };

  const handleActivate = async () => {
    if (viewingVersion <= 0 || viewingVersion === currentVersion) return;
    setActivateStatus('saving');
    try {
      const res = await fetch(`/api/admin/prompts/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ activateVersion: viewingVersion }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || res.statusText);
      }
      setActivateStatus('saved');
      await loadPrompt();
      setTimeout(() => setActivateStatus('idle'), 2000);
    } catch (e) {
      setActivateStatus('error');
      setTimeout(() => setActivateStatus('idle'), 3000);
    }
  };

  const resolvedDisplayName = displayName || id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const isViewingOlderVersion = viewingVersion > 0 && viewingVersion !== currentVersion;

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation selectedTicker={selectedTicker} onTickerChange={setSelectedTicker} />

      <div className="w-full max-w-none px-6 py-6">
        <div className="mb-6 flex items-center gap-4">
          <Link href="/prompts" className="text-gray-500 hover:text-gray-700 text-sm">
            ← Back to Prompts
          </Link>
        </div>

        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">{resolvedDisplayName}</h1>
          <p className="text-sm text-gray-600 mt-1 font-mono">{id}</p>
          {currentVersion > 0 && (
            <p className="text-sm text-gray-500 mt-1">Active version: {currentVersion}</p>
          )}
        </div>

        {loadError && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded text-amber-800 text-sm">
            {loadError} — showing placeholder content.
          </div>
        )}

        {loading && (
          <div className="mb-4 text-gray-500">Loading prompt…</div>
        )}

        <div className="mb-4 flex items-center gap-4 flex-wrap">
          <label className="text-sm font-medium text-gray-700">Version</label>
          <select
            value={viewingVersion}
            onChange={(e) => handleVersionChange(Number(e.target.value))}
            className="border border-gray-300 rounded px-2 py-1 text-sm bg-white"
          >
            {versions.length === 0 && (
              <option value={0}>No versions yet</option>
            )}
            {versions.map((v) => (
              <option key={v.version} value={v.version}>
                Version {v.version}
                {v.version === currentVersion ? ' (active)' : ''}
                {' — '}
                {formatVersionDate(v.updatedAt)}
              </option>
            ))}
          </select>
          {isViewingOlderVersion && (
            <button
              type="button"
              onClick={handleActivate}
              disabled={activateStatus === 'saving'}
              className="px-3 py-1.5 bg-amber-600 text-white text-sm font-medium rounded hover:bg-amber-700 disabled:opacity-50"
            >
              {activateStatus === 'saving'
                ? 'Activating…'
                : activateStatus === 'saved'
                  ? 'Activated'
                  : activateStatus === 'error'
                    ? 'Failed'
                    : 'Activate this version'}
            </button>
          )}
        </div>

        <div className="border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full min-h-[400px] p-4 font-mono text-sm text-gray-800 border-0 focus:ring-0 focus:outline-none resize-y"
            placeholder="Prompt body..."
            spellCheck={false}
            readOnly={isViewingOlderVersion}
          />
        </div>

        {isViewingOlderVersion && (
          <p className="mt-2 text-sm text-gray-500">
            Viewing an older version (read-only). Click &quot;Activate this version&quot; to make it the active version, or select the active version to edit.
          </p>
        )}

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            type="button"
            onClick={handleSave}
            disabled={saveStatus === 'saving' || isViewingOlderVersion}
            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saveStatus === 'saving'
              ? 'Saving…'
              : saveStatus === 'saved'
                ? 'Saved'
                : saveStatus === 'error'
                  ? 'Save failed'
                  : 'Save as new version'}
          </button>
          {saveStatus === 'saved' && (
            <span className="text-sm text-green-600">New version saved to object storage.</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-sm text-red-600">Save failed. Check console or try again.</span>
          )}
        </div>
      </div>
    </div>
  );
}
