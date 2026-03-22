'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';
import { mergePositionThesisPayload, sanitizeFormPatch } from '@/app/lib/positionThesisMerge';
import {
  scratchPositionThesisPayload,
  savePositionThesis,
} from '@/app/lib/services/positionThesisService';
import { writeThesisOnboardHandoff } from '@/app/lib/thesisOnboardHandoff';
import { useAuth } from '@/app/lib/authContext';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

function serializeDraft(form: PositionThesisPayload): string {
  try {
    return JSON.stringify(form, null, 2);
  } catch {
    return '';
  }
}

function coreFieldsComplete(d: PositionThesisPayload): boolean {
  return Boolean(
    d.ticker.trim() &&
      d.positionRole.trim() &&
      d.holdingHorizon.trim() &&
      d.thesisStatement.trim()
  );
}

export default function NewThesisOnboardingPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [draft, setDraft] = useState<PositionThesisPayload>(() => scratchPositionThesisPayload());
  const [companyName, setCompanyName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continueError, setContinueError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [aiReadyForBuilder, setAiReadyForBuilder] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => {
    if (!loading) {
      inputRef.current?.focus();
    }
  }, [loading]);

  useEffect(() => {
    const t = draft.ticker.trim().toUpperCase();
    if (t.length < 1 || t.length > 8) {
      setCompanyName(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/tickers?ticker=${encodeURIComponent(t)}`);
        const result = await response.json();
        if (cancelled) return;
        if (result.success && result.data?.name) {
          setCompanyName(result.data.name as string);
        } else {
          setCompanyName(null);
        }
      } catch {
        if (!cancelled) setCompanyName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draft.ticker]);

  const onPatch = useCallback((patch: Partial<PositionThesisPayload>) => {
    setDraft((prev) => mergePositionThesisPayload(prev, patch, { tickerLocked: false }));
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/chat/position-thesis-onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
          draftJson: serializeDraft(draft),
        }),
      });
      const data = (await res.json()) as {
        reply?: string;
        formPatch?: Partial<PositionThesisPayload>;
        readyForBuilder?: boolean;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      if (!data.reply) {
        throw new Error('Empty reply');
      }
      setMessages((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, role: 'assistant', content: data.reply! },
      ]);
      if (data.readyForBuilder === true) {
        setAiReadyForBuilder(true);
      }
      if (data.formPatch && typeof data.formPatch === 'object') {
        const clean = sanitizeFormPatch(data.formPatch, { tickerLocked: false });
        if (clean && Object.keys(clean).length > 0) {
          onPatch(clean);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, draft, onPatch]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const handleContinue = async () => {
    setContinueError(null);
    if (!coreFieldsComplete(draft)) {
      setContinueError(
        'Add ticker, position role, holding horizon, and thesis statement (chat can help).'
      );
      return;
    }
    const t = draft.ticker.trim().toUpperCase();
    const fullPayload = { ...draft, ticker: t };
    const chatHistory = messages.map((m) => ({ role: m.role, content: m.content }));
    setSaving(true);
    try {
      if (user?.uid) {
        await savePositionThesis(user.uid, t, fullPayload, 'draft');
      }
      writeThesisOnboardHandoff({ ticker: t, payload: fullPayload, chatHistory });
      router.push(`/${t}/thesis-builder`);
    } catch (e) {
      setContinueError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const coreDone = coreFieldsComplete(draft);

  return (
    <div className="h-screen overflow-hidden flex flex-col bg-slate-50 font-sans antialiased text-slate-900">
      <header className="flex-shrink-0 flex items-center gap-4 px-4 sm:px-6 py-3 border-b border-slate-200/90 bg-white shadow-sm">
        <Link
          href="/portfolios"
          className="text-base font-medium text-slate-600 hover:text-slate-900 transition-colors"
        >
          ← Back
        </Link>
      </header>

      <div className="flex-1 flex flex-col min-h-0 max-w-3xl w-full mx-auto px-3 sm:px-4 py-4">
        {continueError && (
          <div className="mb-3 rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2.5 text-sm text-amber-900 shadow-sm">
            {continueError}
          </div>
        )}

        <div className="flex flex-col flex-1 min-h-0 rounded-2xl border border-slate-200/90 bg-white shadow-md shadow-slate-200/60 overflow-hidden">
          <div className="flex-shrink-0 px-4 pt-4 pb-3 bg-gradient-to-br from-slate-50 via-white to-stone-50/60 border-b border-slate-100">
            <div className="min-w-0">
              <h2 className="text-lg sm:text-xl font-semibold tracking-tight text-slate-900">
                Thesis assistant
              </h2>
              <p className="text-sm sm:text-[15px] text-slate-600 mt-1 leading-relaxed">
                New position thesis — chat through ticker, role, horizon, and statement, then open the
                full builder to refine.
              </p>
            </div>
          </div>

          {error && (
            <div className="mx-3 mt-3 rounded-lg border border-red-200/90 bg-red-50/90 px-3 py-2.5 text-sm text-red-800 shadow-sm">
              {error}
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-4 py-3 bg-gradient-to-b from-slate-50/70 to-white">
            {messages.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200/90 bg-white/60 px-4 py-4 text-left shadow-sm space-y-3">
                <p className="text-base font-medium text-slate-800">Start here</p>
                <ol className="text-sm sm:text-[15px] leading-relaxed text-slate-600 list-decimal list-inside space-y-2">
                  <li>
                    Share a <span className="font-medium text-slate-700">ticker</span> or company name, or
                    paste a rough thesis in your own words.
                  </li>
                  <li>
                    The assistant will confirm{' '}
                    <span className="font-medium text-slate-700">position role</span>,{' '}
                    <span className="font-medium text-slate-700">holding horizon</span>, and a{' '}
                    <span className="font-medium text-slate-700">thesis statement</span>, then offer a few
                    optional follow-ups with suggested answers.
                  </li>
                  <li>
                    When you are ready, use <span className="font-medium text-slate-700">Open thesis builder</span> to
                    refine the form
                    {user ? ' (your draft is saved).' : ' (draft is passed in-browser if you are not signed in).'}
                  </li>
                </ol>
              </div>
            )}

            <div className="space-y-3 mt-1">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === 'user'
                      ? 'relative rounded-r-lg rounded-bl-lg border-l-[3px] border-slate-400 bg-slate-100/80 py-2.5 pl-3 pr-3 shadow-sm'
                      : 'relative rounded-r-lg rounded-bl-lg border-l-[3px] border-stone-300 bg-stone-50/90 py-2.5 pl-3 pr-3 shadow-sm'
                  }
                >
                  <span
                    className={
                      m.role === 'user'
                        ? 'pointer-events-none absolute right-2 top-2 text-[11px] font-semibold uppercase tracking-wider text-slate-600'
                        : 'pointer-events-none absolute right-2 top-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500'
                    }
                  >
                    {m.role === 'user' ? 'You' : 'Assistant'}
                  </span>
                  <div
                    className={
                      m.role === 'user'
                        ? 'pr-20 text-sm sm:text-[15px] leading-relaxed text-slate-800 whitespace-pre-wrap'
                        : 'pr-20 text-sm sm:text-[15px] leading-relaxed text-slate-700 [&_strong]:font-semibold [&_strong]:text-slate-900 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0'
                    }
                  >
                    {m.role === 'assistant' ? (
                      <ReactMarkdown>{m.content}</ReactMarkdown>
                    ) : (
                      m.content
                    )}
                  </div>
                </div>
              ))}
            </div>

            {loading && (
              <div className="mt-3 flex items-center gap-2.5 text-sm text-slate-600">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-slate-400 opacity-35" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-slate-500" />
                </span>
                Thinking…
              </div>
            )}

            {coreDone && (
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-900 shadow-sm">
                <span className="leading-relaxed">
                  {companyName ? (
                    <>
                      <span className="font-semibold text-emerald-950">{draft.ticker.toUpperCase()}</span>
                      {' — '}
                      {companyName}
                    </>
                  ) : (
                    <>
                      Core fields ready for{' '}
                      <span className="font-semibold text-emerald-950">{draft.ticker.toUpperCase()}</span>
                    </>
                  )}
                  {aiReadyForBuilder ? ' — Assistant suggests moving on.' : ''}
                </span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleContinue()}
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:opacity-50"
                >
                  {saving ? 'Opening…' : 'Open thesis builder'}
                </button>
              </div>
            )}

            <div ref={endRef} />
          </div>

          <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50/80 px-3 py-3">
            <div className="rounded-xl border border-slate-200/90 bg-white p-2 shadow-sm ring-1 ring-slate-100">
              <textarea
                ref={inputRef}
                autoFocus
                className="w-full resize-y rounded-lg border-0 bg-transparent px-2 py-2 text-sm sm:text-[15px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 min-h-[56px] max-h-36"
                placeholder="Message… (Enter to send, Shift+Enter for newline)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={loading}
              />
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-slate-100 pt-2 mt-1">
                {!user ? (
                  <span className="text-xs sm:text-sm text-slate-500 px-1 leading-relaxed">
                    Sign in to save your draft to the cloud when you continue.
                  </span>
                ) : (
                  <span className="hidden sm:block sm:flex-1" aria-hidden />
                )}
                <div className="flex justify-end sm:justify-end">
                  <button
                    type="button"
                    onClick={() => void send()}
                    disabled={loading || !input.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-900 disabled:opacity-45 disabled:hover:bg-slate-800"
                  >
                    Send
                    <svg
                      className="h-3.5 w-3.5 opacity-90"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M14 5l7 7m0 0l-7 7m7-7H3"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
