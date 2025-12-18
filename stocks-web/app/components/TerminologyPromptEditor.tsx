'use client';

import { useState, useEffect } from 'react';

interface PromptFragment {
  id: string;
  title: string;
  content: string;
  created_at?: string;
  updated_at?: string;
  order?: number;
}

interface TerminologyPromptEditorProps {
  ticker: string;
  showFullPrompt?: boolean;
}

export default function TerminologyPromptEditor({ ticker, showFullPrompt = true }: TerminologyPromptEditorProps) {
  const [fragments, setFragments] = useState<PromptFragment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ title: '', content: '' });

  useEffect(() => {
    fetchFragments();
  }, [ticker]);

  const fetchFragments = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/kpi-prompt-fragments/${ticker}`);
      if (!response.ok) {
        throw new Error('Failed to fetch prompt fragments');
      }
      const result = await response.json();
      setFragments(result.data || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch fragments');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.title.trim() || !formData.content.trim()) {
      setError('Title and content are required');
      return;
    }

    try {
      setError(null);
      const url = `/api/kpi-prompt-fragments/${ticker}`;
      const method = editingId ? 'PUT' : 'POST';
      
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editingId && { id: editingId }),
          title: formData.title.trim(),
          content: formData.content.trim()
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save fragment');
      }

      // Reset form and refresh
      setFormData({ title: '', content: '' });
      setIsAdding(false);
      setEditingId(null);
      await fetchFragments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save fragment');
    }
  };

  const handleEdit = (fragment: PromptFragment) => {
    setFormData({ title: fragment.title, content: fragment.content });
    setEditingId(fragment.id);
    setIsAdding(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this prompt fragment?')) {
      return;
    }

    try {
      setError(null);
      const response = await fetch(`/api/kpi-prompt-fragments/${ticker}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete fragment');
      }

      await fetchFragments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete fragment');
    }
  };

  const handleCancel = () => {
    setFormData({ title: '', content: '' });
    setIsAdding(false);
    setEditingId(null);
    setError(null);
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200">
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900">
              Terminology Prompt Fragments
            </h3>
            <p className="text-sm text-gray-600 mt-1">
              Add terminology clarifications to improve KPI extraction for {ticker}
            </p>
          </div>
          {!isAdding && (
            <button
              onClick={() => setIsAdding(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
            >
              Add Fragment
            </button>
          )}
        </div>
      </div>

      <div className="p-4">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Add/Edit Form */}
        {isAdding && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">
              {editingId ? 'Edit' : 'Add New'} Prompt Fragment
            </h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., Revenue Terminology"
                  className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Content
                </label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  placeholder="Enter terminology clarification text that will be added to the KPI extraction prompt..."
                  rows={6}
                  className="w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  {editingId ? 'Update' : 'Save'} Fragment
                </button>
                <button
                  onClick={handleCancel}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600 text-sm">Loading fragments...</p>
          </div>
        )}

        {/* Fragments List */}
        {!loading && fragments.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-500 text-sm mb-2">No prompt fragments yet</p>
            <p className="text-gray-400 text-xs">Click "Add Fragment" to create your first terminology clarification</p>
          </div>
        )}

        {!loading && fragments.length > 0 && (
          <div className="space-y-3">
            {fragments.map((fragment) => (
              <div
                key={fragment.id}
                className="p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
              >
                <div className="flex items-start justify-between mb-2">
                  <h5 className="font-semibold text-gray-900 text-sm">
                    {fragment.title}
                  </h5>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit(fragment)}
                      className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(fragment.id)}
                      className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {showFullPrompt && (
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-3 rounded border border-gray-100">
                    {fragment.content}
                  </pre>
                )}
                {(fragment.created_at || fragment.updated_at) && (
                  <div className="mt-2 text-xs text-gray-500">
                    {fragment.updated_at && (
                      <span>Updated: {new Date(fragment.updated_at).toLocaleDateString()}</span>
                    )}
                    {fragment.created_at && !fragment.updated_at && (
                      <span>Created: {new Date(fragment.created_at).toLocaleDateString()}</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

