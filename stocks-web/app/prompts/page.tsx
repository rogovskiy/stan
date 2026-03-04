'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppNavigation from '../components/AppNavigation';

interface PromptListItem {
  id: string;
  name: string;
  currentVersion: number;
  model: string | null;
  updatedAt: string;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { dateStyle: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { timeStyle: 'short' });
  } catch {
    return iso;
  }
}

/** Human-readable ID: lowercase letters, numbers, underscores only. */
function isValidPromptId(id: string): boolean {
  return /^[a-z0-9_]+$/.test(id) && id.length > 0;
}

export default function PromptsPage() {
  const router = useRouter();
  const [selectedTicker, setSelectedTicker] = useState('AAPL');
  const [prompts, setPrompts] = useState<PromptListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newId, setNewId] = useState('');
  const [newIdError, setNewIdError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/admin/prompts')
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setPrompts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load prompts');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleCreateOpen = () => {
    setNewId('');
    setNewIdError(null);
    setCreateOpen(true);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const slug = newId.trim().toLowerCase().replace(/\s+/g, '_');
    if (!slug) {
      setNewIdError('Enter a prompt ID');
      return;
    }
    if (!isValidPromptId(slug)) {
      setNewIdError('Use only lowercase letters, numbers, and underscores (e.g. market_shift_merge)');
      return;
    }
    setCreateOpen(false);
    router.push(`/prompts/${encodeURIComponent(slug)}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 font-sans antialiased">
      <AppNavigation selectedTicker={selectedTicker} onTickerChange={setSelectedTicker} />

      <div className="w-full max-w-none px-6 py-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Prompts</h1>
            <p className="text-sm text-gray-600 mt-2">
              Edit prompt templates by human-readable ID. Content is stored in object storage with versioning.
            </p>
          </div>
          <button
            type="button"
            onClick={handleCreateOpen}
            className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            Create prompt
          </button>
        </div>

        {createOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setCreateOpen(false)}>
            <div
              className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Create prompt</h2>
              <form onSubmit={handleCreateSubmit}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prompt ID</label>
                <input
                  type="text"
                  value={newId}
                  onChange={(e) => { setNewId(e.target.value); setNewIdError(null); }}
                  placeholder="e.g. market_shift_merge"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
                {newIdError && (
                  <p className="mt-1 text-sm text-red-600">{newIdError}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">Lowercase letters, numbers, and underscores only.</p>
                <div className="mt-6 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-800 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="text-gray-500">Loading prompts…</div>
        ) : prompts.length === 0 ? (
          <div className="border border-gray-200 rounded-lg bg-white p-8 text-center text-gray-500">
            No prompts yet. Click &quot;Create prompt&quot; to add one, then save to create the first version.
          </div>
        ) : (
        <div className="border border-gray-200 rounded-lg bg-white shadow-sm overflow-hidden">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left p-3 font-medium text-gray-700">ID</th>
                <th className="text-left p-3 font-medium text-gray-700">Name</th>
                <th className="text-left p-3 font-medium text-gray-700">Model</th>
                <th className="text-left p-3 font-medium text-gray-700">Active version</th>
                <th className="text-left p-3 font-medium text-gray-700">Last updated</th>
                <th className="text-right p-3 font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {prompts.map((p) => (
                <tr key={p.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="p-3 font-mono text-gray-800">{p.id}</td>
                  <td className="p-3 text-gray-700">{p.name}</td>
                  <td className="p-3 text-gray-600 font-mono text-xs">{p.model ?? '—'}</td>
                  <td className="p-3 text-gray-700 font-medium">{p.currentVersion}</td>
                  <td className="p-3 text-gray-500">{formatDate(p.updatedAt)}</td>
                  <td className="p-3 text-right">
                    <Link
                      href={`/prompts/${p.id}`}
                      className="text-blue-600 hover:text-blue-800 font-medium"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
}
