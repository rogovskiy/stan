'use client';

import React, { useState, useEffect, useCallback } from 'react';
import type { ProvenanceEntry } from '@/app/lib/services/youtubeSubscriptionService';

const FEEDBACK_COMMENT_MAX_LENGTH = 2000;

export interface ExecutionFeedbackWidgetProps {
  /** Provenance array linking to prompt executions (e.g. [{ analysis: "<execution_id>" }]). */
  provenance: ProvenanceEntry[];
  /** Prompt ID (e.g. youtube_transcript_summary) used to build execution API and deep link. */
  promptId: string;
  /** Optional className for the wrapper. */
  className?: string;
}

interface ExecutionMeta {
  executionId: string;
  rating: number | null;
  feedbackComment: string | null;
  createdAt?: string;
}

function getExecutionIds(provenance: ProvenanceEntry[]): string[] {
  return provenance.map((p) => p.analysis).filter((id): id is string => Boolean(id));
}

/** Return only the last execution ID (most recent run). */
function getLastExecutionId(provenance: ProvenanceEntry[]): string | null {
  const ids = getExecutionIds(provenance);
  return ids.length > 0 ? ids[ids.length - 1]! : null;
}

export function ExecutionFeedbackWidget({
  provenance,
  promptId,
  className = '',
}: ExecutionFeedbackWidgetProps) {
  const lastExecutionId = getLastExecutionId(provenance);
  const [meta, setMeta] = useState<ExecutionMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  useEffect(() => {
    if (!meta) return;
    setRating(meta.rating ?? null);
    setComment(meta.feedbackComment ?? '');
  }, [meta]);

  const fetchMeta = useCallback(
    async (executionId: string) => {
      try {
        const res = await fetch(
          `/api/admin/prompts/${encodeURIComponent(promptId)}/executions/${encodeURIComponent(executionId)}`
        );
        if (!res.ok) return null;
        const data = await res.json();
        return {
          executionId,
          rating: data.rating ?? null,
          feedbackComment: data.feedbackComment ?? null,
          createdAt: data.createdAt,
        } as ExecutionMeta;
      } catch {
        return null;
      }
    },
    [promptId]
  );

  useEffect(() => {
    if (!lastExecutionId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchMeta(lastExecutionId)
      .then((result) => {
        if (!cancelled && result) setMeta(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [promptId, lastExecutionId, fetchMeta]);

  const saveFeedback = useCallback(
    async (executionId: string, rating: number | null, feedbackComment: string) => {
      setSaveStatus('saving');
      try {
        const res = await fetch(
          `/api/admin/prompts/${encodeURIComponent(promptId)}/executions/${encodeURIComponent(executionId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              rating,
              feedbackComment: feedbackComment.trim() || null,
            }),
          }
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error((err as { error?: string }).error || res.statusText);
        }
        const data = await res.json();
        setMeta((prev) => ({
          executionId,
          rating: data.rating ?? null,
          feedbackComment: data.feedbackComment ?? null,
          createdAt: prev?.createdAt,
        }));
        setRating(data.rating ?? null);
        setComment(data.feedbackComment ?? '');
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
      } catch {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus('idle'), 3000);
      }
    },
    [promptId]
  );

  if (!lastExecutionId) return null;

  const showComment = rating != null || comment.trim() !== '';
  const dirty =
    rating !== (meta?.rating ?? null) || comment !== (meta?.feedbackComment ?? '');

  return (
    <div className={`space-y-2 ${className}`}>
      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-gray-500">AI Quality rating</span>
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                onClick={() => setRating((r) => (r === star ? null : star))}
                className="text-lg leading-none focus:outline-none focus:ring-2 focus:ring-blue-300 rounded p-0.5 text-gray-300 hover:text-amber-400 focus:text-amber-400 transition-colors"
                aria-label={`${star} star${star > 1 ? 's' : ''}`}
              >
                {rating != null && star <= rating ? (
                  <span className="text-amber-500">★</span>
                ) : (
                  <span>☆</span>
                )}
              </button>
            ))}
            <a
              href={`/prompts?openExecutions=${encodeURIComponent(promptId)}&executionId=${encodeURIComponent(lastExecutionId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-gray-400 hover:text-gray-500 ml-1"
            >
              View details
            </a>
          </div>
          {showComment && (
            <>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, FEEDBACK_COMMENT_MAX_LENGTH))}
                placeholder="Optional comment…"
                rows={2}
                className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm resize-y placeholder:text-gray-400 focus:border-gray-300 focus:outline-none"
              />
              {dirty && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => saveFeedback(lastExecutionId, rating, comment)}
                    disabled={saveStatus === 'saving'}
                    className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saveStatus === 'saving' ? 'Saving…' : saveStatus === 'saved' ? 'Saved' : 'Save'}
                  </button>
                  {saveStatus === 'error' && (
                    <span className="text-xs text-red-500">Save failed</span>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
