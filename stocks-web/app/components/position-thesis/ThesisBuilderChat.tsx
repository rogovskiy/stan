'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import {
  canRunGroundedThesisFactCheck,
  factCheckGateBlockedMessage,
  getBlockedRequiredSections,
} from '@/app/lib/positionThesisCompleteness';
import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';
import { sanitizeFormPatch } from '@/app/lib/positionThesisMerge';
import { factCheckMarkdownComponents } from './factCheckMarkdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Shown in the top-right chip for assistant messages (default: "Assistant"). */
  assistantLabel?: string;
  /** Enables colored section styling for Fact Check reports. */
  messageKind?: 'factCheck';
}

function toChatMessages(entries: Array<{ role: string; content: string }>): ChatMessage[] {
  return entries.map((e, i) => ({
    id: e.role === 'assistant' ? `a-${i}` : `u-${i}`,
    role: e.role === 'assistant' ? 'assistant' : 'user',
    content: typeof e.content === 'string' ? e.content : '',
  }));
}

function serializeThesisContext(form: PositionThesisPayload): string {
  try {
    return JSON.stringify(form, null, 2);
  } catch {
    return '';
  }
}

export default function ThesisBuilderChat({
  apiTicker,
  companyName,
  form,
  tickerLocked,
  onFormPatch,
  initialMessages = [],
  autoSendMessage = null,
}: {
  /** Effective symbol for the coach (usually form.ticker). */
  apiTicker: string;
  companyName?: string | null;
  form: PositionThesisPayload;
  tickerLocked: boolean;
  onFormPatch: (patch: Partial<PositionThesisPayload>) => void;
  /** Chat history carried over from new-thesis onboarding. */
  initialMessages?: Array<{ role: string; content: string }>;
  /** When `nonce` changes, send `text` as a user message (e.g. section help from the form). */
  autoSendMessage?: { nonce: number; text: string } | null;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    initialMessages.length > 0 ? toChatMessages(initialMessages) : []
  );
  useEffect(() => {
    if (initialMessages.length > 0 && messages.length === 0) {
      setMessages(toChatMessages(initialMessages));
    }
  }, [initialMessages, messages.length]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [factCheckLoading, setFactCheckLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const factCheckReady = useMemo(() => canRunGroundedThesisFactCheck(form), [form]);
  const factCheckBlockedTitle = useMemo(() => {
    if (factCheckReady) return '';
    return factCheckGateBlockedMessage(getBlockedRequiredSections(form));
  }, [form, factCheckReady]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, factCheckLoading]);

  const submitConversation = useCallback(
    async (conversationMessages: ChatMessage[]) => {
      setLoading(true);
      setError(null);
      const ctx = serializeThesisContext(form);
      try {
        const res = await fetch('/api/chat/position-thesis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ticker: apiTicker.trim().toUpperCase() || 'UNKNOWN',
            companyName: companyName ?? null,
            thesisContext: ctx,
            tickerLocked,
            messages: conversationMessages.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        const data = (await res.json()) as {
          reply?: string;
          formPatch?: Partial<PositionThesisPayload>;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(data.error || res.statusText);
        }
        if (!data.reply) {
          throw new Error('Empty reply');
        }
        setMessages([
          ...conversationMessages,
          { id: `a-${Date.now()}`, role: 'assistant', content: data.reply },
        ]);
        if (data.formPatch && typeof data.formPatch === 'object') {
          const clean = sanitizeFormPatch(data.formPatch, { tickerLocked });
          if (clean && Object.keys(clean).length > 0) {
            onFormPatch(clean);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Request failed');
      } finally {
        setLoading(false);
      }
    },
    [apiTicker, companyName, form, tickerLocked, onFormPatch]
  );

  const runFactCheck = useCallback(async () => {
    if (!canRunGroundedThesisFactCheck(form) || loading || factCheckLoading) return;
    setFactCheckLoading(true);
    setError(null);
    const ctx = serializeThesisContext(form);
    try {
      const res = await fetch('/api/chat/position-thesis/reality-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: apiTicker.trim().toUpperCase() || 'UNKNOWN',
          companyName: companyName ?? null,
          thesisContext: ctx,
        }),
      });
      const data = (await res.json()) as { report?: string; error?: string };
      if (!res.ok) {
        throw new Error(data.error || res.statusText);
      }
      const report = data.report?.trim();
      if (!report) {
        throw new Error('Empty report');
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `fc-${Date.now()}`,
          role: 'assistant',
          assistantLabel: 'Fact Check',
          messageKind: 'factCheck',
          content: `## Fact Check\n\n${report}`,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fact Check failed');
    } finally {
      setFactCheckLoading(false);
    }
  }, [apiTicker, companyName, form, loading, factCheckLoading]);

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
    await submitConversation(nextMessages);
  }, [input, loading, messages, submitConversation]);

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const lastAutoNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!autoSendMessage?.text?.trim() || loading || factCheckLoading) return;
    if (autoSendMessage.nonce === lastAutoNonce.current) return;
    lastAutoNonce.current = autoSendMessage.nonce;
    const text = autoSendMessage.text.trim();
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    };
    const nextMessages = [...messagesRef.current, userMsg];
    setMessages(nextMessages);
    void submitConversation(nextMessages);
  }, [autoSendMessage, loading, factCheckLoading, submitConversation]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex flex-col min-h-[28rem] xl:min-h-[calc(100vh-8rem)] xl:max-h-[calc(100vh-6rem)] rounded-2xl border border-slate-200/90 bg-white shadow-md shadow-slate-200/60 overflow-hidden">
      <div className="flex-shrink-0 px-4 pt-4 pb-3 bg-gradient-to-br from-slate-50 via-white to-stone-50/60 border-b border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-slate-900">Thesis assistant</h2>
          <button
            type="button"
            onClick={() => void runFactCheck()}
            disabled={!factCheckReady || loading || factCheckLoading}
            title={
              factCheckReady
                ? 'Uses web search to compare factual claims in your draft to public sources (not financial advice).'
                : factCheckBlockedTitle
            }
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-emerald-300/90 bg-emerald-50/90 px-3 py-2 text-[13px] font-semibold text-emerald-900 shadow-sm transition hover:border-emerald-400 hover:bg-emerald-100/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/80 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none"
          >
            <svg
              className="h-3.5 w-3.5 shrink-0 text-emerald-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            Fact Check
          </button>
        </div>
      </div>

      {error && (
        <div className="mx-3 mt-3 rounded-lg border border-red-200/90 bg-red-50/90 px-3 py-2 text-xs text-red-800 shadow-sm">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3 bg-gradient-to-b from-slate-50/70 to-white">
        {messages.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-200/90 bg-white/60 px-3 py-3 text-left shadow-sm space-y-2">
            <p className="text-[12px] font-medium text-slate-800">Start here</p>
            <ol className="text-[12px] leading-relaxed text-slate-600 list-decimal list-inside space-y-1">
              {!tickerLocked && (
                <li>
                  Confirm the <span className="font-medium text-slate-700">ticker</span> in the form (or say
                  it in chat). It locks when you save.
                </li>
              )}
              <li>
                Describe your thesis in your own words—why you own it, horizon, upside/downside, what would
                break the story.
              </li>
              <li>
                The assistant will ask follow-ups and can fill sections on the left; you can edit anything
                anytime.
              </li>
            </ol>
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
                {m.role === 'user' ? 'You' : (m.assistantLabel ?? 'Assistant')}
              </span>
              <div
                className={
                  m.role === 'user'
                    ? 'pr-20 text-[13px] leading-relaxed text-slate-800 whitespace-pre-wrap'
                    : m.messageKind === 'factCheck'
                      ? 'pr-20 text-[13px] leading-relaxed text-slate-700 [&_strong]:font-semibold'
                      : 'pr-20 text-[13px] leading-relaxed text-slate-700 [&_strong]:font-semibold [&_strong]:text-slate-900 [&_p]:my-1 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5'
                }
              >
                {m.role === 'assistant' ? (
                  m.messageKind === 'factCheck' ? (
                    <ReactMarkdown components={factCheckMarkdownComponents}>{m.content}</ReactMarkdown>
                  ) : (
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  )
                ) : (
                  m.content
                )}
              </div>
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
        {factCheckLoading && (
          <div className="mt-3 flex items-center gap-2.5 text-[12px] text-slate-600">
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/40 opacity-35" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
            </span>
            Running Fact Check…
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="flex-shrink-0 border-t border-slate-100 bg-slate-50/80 px-3 py-3">
        <div className="rounded-xl border border-slate-200/90 bg-white p-2 shadow-sm ring-1 ring-slate-100">
          <textarea
            className="w-full resize-y rounded-lg border-0 bg-transparent px-2 py-1.5 text-[13px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-0 min-h-[56px] max-h-36"
            placeholder="Message… (Enter to send, Shift+Enter for newline)"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={loading || factCheckLoading}
          />
          <div className="flex justify-end border-t border-slate-100 pt-2 mt-1">
            <button
              type="button"
              onClick={() => void send()}
              disabled={loading || factCheckLoading || !input.trim()}
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
