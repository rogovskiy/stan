'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

function serializeThesisContext(form: PositionThesisPayload): string {
  try {
    return JSON.stringify(form, null, 2);
  } catch {
    return '';
  }
}

export default function ThesisBuilderChat({
  ticker,
  companyName,
  form,
}: {
  ticker: string;
  companyName?: string | null;
  form: PositionThesisPayload;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const thesisContext = serializeThesisContext(form);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

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
      const res = await fetch('/api/chat/position-thesis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker,
          companyName: companyName ?? null,
          thesisContext,
          messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = (await res.json()) as { reply?: string; error?: string };
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, ticker, companyName, thesisContext]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col min-h-[28rem] max-h-[min(70vh,640px)] rounded-2xl border border-slate-200/90 bg-white shadow-md shadow-slate-200/60 overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 bg-gradient-to-br from-slate-50 via-white to-stone-50/60 border-b border-slate-100">
        <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">Thesis assistant</h2>
      </div>

      {error && (
        <div className="mx-3 mt-3 rounded-lg border border-red-200/90 bg-red-50/90 px-3 py-2 text-xs text-red-800 shadow-sm">
          {error}
        </div>
      )}

      {/* Transcript */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 bg-gradient-to-b from-slate-50/70 to-white">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200/90 bg-white/60 px-3 py-3 text-center shadow-sm">
            <p className="text-[12px] leading-relaxed text-slate-600">
              Tighten your thesis, stress-test downside, or clarify rules — each message includes your
              current form as context.
            </p>
          </div>
        )}
        <div className="space-y-3">
          {messages.map((m) => (
            <div
              key={m.id}
              className={
                m.role === 'user'
                  ? 'relative rounded-r-lg rounded-bl-lg border-l-[3px] border-slate-400 bg-slate-100/80 py-2 pl-3 pr-3 shadow-sm'
                  : 'relative rounded-r-lg rounded-bl-lg border-l-[3px] border-stone-300 bg-stone-50/90 py-2 pl-3 pr-3 shadow-sm'
              }
            >
              <span
                className={
                  m.role === 'user'
                    ? 'pointer-events-none absolute right-2 top-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600'
                    : 'pointer-events-none absolute right-2 top-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500'
                }
              >
                {m.role === 'user' ? 'You' : 'Assistant'}
              </span>
              <p
                className={
                  m.role === 'user'
                    ? 'pr-20 text-[13px] leading-relaxed text-slate-800 whitespace-pre-wrap'
                    : 'pr-20 text-[13px] leading-relaxed text-slate-700 whitespace-pre-wrap'
                }
              >
                {m.content}
              </p>
            </div>
          ))}
        </div>
        {loading && (
          <div className="mt-3 flex items-center gap-2.5 text-[12px] text-slate-600">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-slate-400 opacity-35" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-slate-500" />
            </span>
            Thinking…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Composer */}
      <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50/80 px-3 py-3">
        <div className="rounded-xl border border-slate-200/90 bg-white p-2 shadow-sm ring-1 ring-slate-100">
          <textarea
            className="w-full resize-y rounded-lg border-0 bg-transparent px-2 py-1.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 min-h-[56px] max-h-36"
            placeholder="Message… (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading}
          />
          <div className="flex justify-end border-t border-slate-100 pt-2 mt-1">
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || !input.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-slate-900 disabled:opacity-45 disabled:hover:bg-slate-800"
            >
              Send
              <svg className="h-3.5 w-3.5 opacity-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
