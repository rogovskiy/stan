'use client';

import React, { useState, useEffect, useCallback } from 'react';
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

interface ExecutionListItem {
  executionId: string;
  createdAt: string;
  promptVersion: number;
  durationMs: number;
  promptTokenCount: number;
  responseTokenCount: number;
  totalTokenCount: number;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { dateStyle: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { timeStyle: 'short' });
  } catch {
    return iso;
  }
}

function formatVersionDate(iso: string): string {
  return formatDate(iso);
}

/** Parse execution parameters JSON (template/replacement variables). Returns null if invalid. */
function parseParametersJson(jsonStr: string): [string, string][] | null {
  try {
    const obj = JSON.parse(jsonStr);
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return null;
    return Object.entries(obj).map(([k, v]) => [
      k,
      typeof v === 'string' ? v : JSON.stringify(v, null, 2),
    ]);
  } catch {
    return null;
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

  const [executionsDrawerPromptId, setExecutionsDrawerPromptId] = useState<string | null>(null);
  const [executionsDrawerName, setExecutionsDrawerName] = useState<string | null>(null);
  const [executions, setExecutions] = useState<ExecutionListItem[]>([]);
  const [executionsLoading, setExecutionsLoading] = useState(false);
  const [expandedExecutionId, setExpandedExecutionId] = useState<string | null>(null);
  const [showFullInput, setShowFullInput] = useState(false);
  const [executionContent, setExecutionContent] = useState<{
    input?: string;
    output?: string;
    parameters?: string;
  }>({});
  const [executionContentLoading, setExecutionContentLoading] = useState<{
    input?: boolean;
    output?: boolean;
    parameters?: boolean;
  }>({});
  const [executionContentError, setExecutionContentError] = useState<{
    input?: string;
    output?: string;
    parameters?: string;
  }>({});

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

  useEffect(() => {
    const promptId = executionsDrawerPromptId;
    if (!promptId) {
      setExecutions([]);
      setExpandedExecutionId(null);
      setExecutionContent({});
      setExecutionContentError({});
      setExecutionContentLoading({});
      return;
    }
    let cancelled = false;
    setExecutionsLoading(true);
    setExpandedExecutionId(null);
    setExecutionContent({});
    setExecutionContentError({});
    setExecutionContentLoading({});
    fetch(`/api/admin/prompts/${encodeURIComponent(promptId)}/executions`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(res.statusText))))
      .then((data: ExecutionListItem[]) => {
        if (!cancelled) setExecutions(data);
      })
      .catch(() => {
        if (!cancelled) setExecutions([]);
      })
      .finally(() => {
        if (!cancelled) setExecutionsLoading(false);
      });
    return () => { cancelled = true; };
  }, [executionsDrawerPromptId]);

  const fetchExecutionPart = useCallback(
    async (executionId: string, part: 'input' | 'output' | 'parameters') => {
      const promptId = executionsDrawerPromptId;
      if (!promptId || executionContent[part] !== undefined) return;
      setExecutionContentLoading((prev) => ({ ...prev, [part]: true }));
      setExecutionContentError((prev) => ({ ...prev, [part]: undefined }));
      try {
        const res = await fetch(
          `/api/admin/prompts/${encodeURIComponent(promptId)}/executions/${encodeURIComponent(executionId)}?part=${part}`
        );
        if (!res.ok) throw new Error(res.statusText);
        const text = await res.text();
        setExecutionContent((prev) => ({ ...prev, [part]: text }));
      } catch (err) {
        setExecutionContentError((prev) => ({
          ...prev,
          [part]: err instanceof Error ? err.message : 'Failed to load',
        }));
      } finally {
        setExecutionContentLoading((prev) => ({ ...prev, [part]: false }));
      }
    },
    [executionsDrawerPromptId, executionContent]
  );

  const handleExpandExecution = useCallback((executionId: string) => {
    setExpandedExecutionId((prev) => (prev === executionId ? null : executionId));
    setShowFullInput(false);
    setExecutionContent({});
    setExecutionContentError({});
    setExecutionContentLoading({});
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
                    <button
                      type="button"
                      onClick={() => {
                        setExecutionsDrawerPromptId(p.id);
                        setExecutionsDrawerName(p.name || p.id);
                      }}
                      className="text-blue-600 hover:text-blue-800 font-medium mr-3"
                    >
                      Executions
                    </button>
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

        {executionsDrawerPromptId !== null && (
          <div className="fixed inset-0 z-50 flex">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setExecutionsDrawerPromptId(null)}
              aria-hidden
            />
            <div className="absolute right-0 top-0 bottom-0 w-full max-w-5xl bg-white shadow-xl flex flex-col z-10">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
                <h2 className="text-lg font-semibold text-gray-900">
                  Executions — {executionsDrawerName ?? executionsDrawerPromptId}
                </h2>
                <button
                  type="button"
                  onClick={() => setExecutionsDrawerPromptId(null)}
                  className="p-2 text-gray-500 hover:text-gray-700 rounded"
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>
              <div className="flex-1 overflow-auto p-4">
                {executionsLoading ? (
                  <div className="text-sm text-gray-500">Loading executions…</div>
                ) : executions.length === 0 ? (
                  <div className="text-sm text-gray-500">No executions yet. Runs of this prompt will appear here.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-200 bg-gray-50">
                          <th className="text-left px-4 py-2 font-medium text-gray-700">Date</th>
                          <th className="text-left px-4 py-2 font-medium text-gray-700">Duration</th>
                          <th className="text-left px-4 py-2 font-medium text-gray-700">Version</th>
                          <th className="text-left px-4 py-2 font-medium text-gray-700">Tokens</th>
                          <th className="w-20 px-4 py-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {executions.map((ex) => (
                          <React.Fragment key={ex.executionId}>
                            <tr className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="px-4 py-2 text-gray-800">
                                {formatVersionDate(ex.createdAt)}
                              </td>
                              <td className="px-4 py-2 font-mono text-gray-700">{ex.durationMs} ms</td>
                              <td className="px-4 py-2 text-gray-700">v{ex.promptVersion}</td>
                              <td className="px-4 py-2 font-mono text-gray-600">
                                {ex.promptTokenCount} / {ex.responseTokenCount} / {ex.totalTokenCount}
                              </td>
                              <td className="px-4 py-2">
                                <button
                                  type="button"
                                  onClick={() => handleExpandExecution(ex.executionId)}
                                  className="text-blue-600 hover:underline text-xs font-medium"
                                >
                                  {expandedExecutionId === ex.executionId ? 'Hide' : 'View'}
                                </button>
                              </td>
                            </tr>
                            {expandedExecutionId === ex.executionId && (
                              <tr key={`${ex.executionId}-detail`}>
                                <td colSpan={5} className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                                  <div className="text-xs text-gray-500 font-mono mb-2">
                                    ID: {ex.executionId}
                                  </div>
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div
                                      className={`border border-gray-200 rounded bg-white overflow-hidden flex flex-col ${executionContent.parameters === undefined && !executionContentLoading.parameters && !executionContentError.parameters ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors' : ''}`}
                                      role={executionContent.parameters === undefined && !executionContentLoading.parameters && !executionContentError.parameters ? 'button' : undefined}
                                      onClick={executionContent.parameters === undefined && !executionContentLoading.parameters && !executionContentError.parameters ? () => fetchExecutionPart(ex.executionId, 'parameters') : undefined}
                                      tabIndex={executionContent.parameters === undefined && !executionContentLoading.parameters && !executionContentError.parameters ? 0 : undefined}
                                      onKeyDown={executionContent.parameters === undefined && !executionContentLoading.parameters && !executionContentError.parameters ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fetchExecutionPart(ex.executionId, 'parameters'); } } : undefined}
                                    >
                                      <div className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 border-b border-gray-200">
                                        Parameters (template variables)
                                      </div>
                                      <div className={`p-2 max-h-64 overflow-auto ${executionContent.parameters === undefined ? 'min-h-[4rem] flex items-center justify-center' : ''}`}>
                                        {executionContentError.parameters ? (
                                          <p className="text-red-600 text-xs">{executionContentError.parameters}</p>
                                        ) : executionContentLoading.parameters ? (
                                          <p className="text-gray-500 text-sm">Loading…</p>
                                        ) : executionContent.parameters !== undefined ? (
                                          (() => {
                                            const entries = parseParametersJson(executionContent.parameters);
                                            if (!entries || entries.length === 0) {
                                              return (
                                                <pre className="text-xs font-mono whitespace-pre-wrap break-words text-gray-800">{executionContent.parameters}</pre>
                                              );
                                            }
                                            return (
                                              <dl className="space-y-2 text-xs">
                                                {entries.map(([key, value]) => (
                                                  <div key={key} className="border-b border-gray-100 pb-2 last:border-0 last:pb-0">
                                                    <dt className="font-medium text-gray-700 mb-0.5 font-mono">{key}</dt>
                                                    <dd className="font-mono text-gray-800 whitespace-pre-wrap break-words max-h-24 overflow-auto bg-gray-50 rounded px-1.5 py-1">
                                                      {value}
                                                    </dd>
                                                  </div>
                                                ))}
                                              </dl>
                                            );
                                          })()
                                        ) : (
                                          <p className="text-blue-600 text-sm font-medium">Click here to load</p>
                                        )}
                                      </div>
                                      <div className="px-3 py-2 border-t border-gray-100 bg-gray-50">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (executionContent.input === undefined && !executionContentLoading.input) {
                                              fetchExecutionPart(ex.executionId, 'input');
                                            }
                                            setShowFullInput((prev) => !prev);
                                          }}
                                          className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                        >
                                          {showFullInput ? 'Hide full input' : 'View full input'}
                                        </button>
                                        <span className="text-gray-400 text-xs ml-1">(rendered prompt sent to model)</span>
                                      </div>
                                    </div>
                                    <div
                                      className={`border border-gray-200 rounded bg-white overflow-hidden ${executionContent.output === undefined && !executionContentLoading.output && !executionContentError.output ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors' : ''}`}
                                      role={executionContent.output === undefined && !executionContentLoading.output && !executionContentError.output ? 'button' : undefined}
                                      onClick={executionContent.output === undefined && !executionContentLoading.output && !executionContentError.output ? () => fetchExecutionPart(ex.executionId, 'output') : undefined}
                                      tabIndex={executionContent.output === undefined && !executionContentLoading.output && !executionContentError.output ? 0 : undefined}
                                      onKeyDown={executionContent.output === undefined && !executionContentLoading.output && !executionContentError.output ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fetchExecutionPart(ex.executionId, 'output'); } } : undefined}
                                    >
                                      <div className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 border-b border-gray-200">
                                        Output
                                      </div>
                                      <div className={`p-2 max-h-64 overflow-auto ${executionContent.output === undefined ? 'min-h-[4rem] flex items-center justify-center' : ''}`}>
                                        {executionContentError.output ? (
                                          <p className="text-red-600 text-xs">{executionContentError.output}</p>
                                        ) : executionContentLoading.output ? (
                                          <p className="text-gray-500 text-sm">Loading…</p>
                                        ) : executionContent.output !== undefined ? (
                                          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-gray-800">{executionContent.output}</pre>
                                        ) : (
                                          <p className="text-blue-600 text-sm font-medium">Click here to load</p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                  {showFullInput && (
                                    <div className="mt-3 border border-gray-200 rounded bg-white overflow-hidden">
                                      <div className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 border-b border-gray-200">
                                        Full input (rendered prompt)
                                      </div>
                                      <div className="p-2 max-h-64 overflow-auto">
                                        {executionContentError.input ? (
                                          <p className="text-red-600 text-xs">{executionContentError.input}</p>
                                        ) : executionContentLoading.input ? (
                                          <p className="text-gray-500 text-sm">Loading…</p>
                                        ) : executionContent.input !== undefined ? (
                                          <pre className="text-xs font-mono whitespace-pre-wrap break-words text-gray-800">{executionContent.input}</pre>
                                        ) : (
                                          <p className="text-gray-400 text-xs">Loading…</p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
