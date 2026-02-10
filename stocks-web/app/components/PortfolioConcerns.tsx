'use client';

import { useState, useEffect, useCallback } from 'react';

export type ConcernSeverity = 'high' | 'medium' | 'low';

export interface PortfolioConcern {
  id: string;
  severity: ConcernSeverity;
  /** Short, friendly question the user can click to start the chat */
  prompt: string;
  /** First message the bot sends when user opens this topic */
  opener: string;
  ticker?: string;
  bandId?: string | null;
  bandName?: string;
  suggestion?: string;
}

interface ChatMessage {
  role: 'user' | 'agent';
  text: string;
  at: string;
}

interface PortfolioConcernsProps {
  portfolioId: string | null;
  onTickerClick?: (ticker: string) => void;
}

const SEVERITY_CONFIG: Record<ConcernSeverity, { label: string; className: string }> = {
  high: { label: 'High', className: 'bg-red-100 text-red-800 border-red-200' },
  medium: { label: 'Medium', className: 'bg-amber-100 text-amber-800 border-amber-200' },
  low: { label: 'Low', className: 'bg-slate-100 text-slate-600 border-slate-200' },
};

/** Mock agent reply for prototype. Uses concern context, risk-aware tone. */
function mockAgentReply(concern: PortfolioConcern | null, userMessage: string): string {
  const lower = userMessage.toLowerCase();
  if (lower.includes('ignore') || lower.includes('dismiss') || lower.includes('fine')) {
    return "No problem — we can revisit whenever you like.";
  }
  if (concern?.ticker && (lower.includes('why') || lower.includes('reason'))) {
    return "That position is outsized from a risk perspective. If your thesis is still strong, you can hold; I'd just keep an eye on concentration over time.";
  }
  if (lower.includes('rate') || lower.includes('interest') || lower.includes('duration')) {
    return "Rates hit bonds and long-duration growth stocks most. We can look at your exposure and whether to add defensives or shorten duration.";
  }
  if (lower.includes('underperform') || lower.includes('lagging') || lower.includes('catch up')) {
    return "Underperformance can be sector mix, stock pick, or timing. We can go through your biggest weights and see if you want to tilt or stay the course.";
  }
  if (lower.includes('rebalance') || lower.includes('how') || lower.includes('what do')) {
    return concern?.suggestion
      ? `From a risk standpoint: ${concern.suggestion.toLowerCase().replace(/^consider /i, '')} Want to go step by step?`
      : "Trim the largest position or add to others to bring risk in line. I can walk you through it.";
  }
  return "Got it. Ask how to rebalance, why I flagged this, or how to manage rate risk.";
}

export default function PortfolioConcerns({ portfolioId, onTickerClick }: PortfolioConcernsProps) {
  const [concerns, setConcerns] = useState<PortfolioConcern[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeConcern, setActiveConcern] = useState<PortfolioConcern | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');

  const fetchConcerns = useCallback(async () => {
    if (!portfolioId) {
      setConcerns([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/portfolios/${portfolioId}/concerns`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setConcerns(json.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
      setConcerns([]);
    } finally {
      setLoading(false);
    }
  }, [portfolioId]);

  useEffect(() => {
    fetchConcerns();
  }, [fetchConcerns]);

  const startChat = (concern: PortfolioConcern) => {
    setActiveConcern(concern);
    setMessages([{ role: 'agent', text: concern.opener, at: new Date().toISOString() }]);
    setInput('');
  };

  const closeChat = () => {
    setActiveConcern(null);
    setMessages([]);
    setInput('');
  };

  const sendMessage = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text, at: new Date().toISOString() }]);
    const reply = mockAgentReply(activeConcern, text);
    setMessages((prev) => [...prev, { role: 'agent', text: reply, at: new Date().toISOString() }]);
  };

  if (!portfolioId) return null;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50/80 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-800">Risks & concerns</h2>
        <button
          type="button"
          onClick={fetchConcerns}
          disabled={loading}
          className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div className="p-4">
        {error && (
          <p className="text-sm text-amber-700 bg-amber-50/80 px-3 py-2 rounded-lg mb-3">{error}</p>
        )}

        {!error && concerns.length === 0 && !loading && (
          <p className="text-sm text-gray-500 py-2">No concerns to review right now.</p>
        )}

        {concerns.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-4">
            {concerns.map((c) => {
              const sev = SEVERITY_CONFIG[c.severity];
              const isActive = activeConcern?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => startChat(c)}
                  className={`
                    text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 flex-wrap
                    ${isActive
                      ? 'bg-gray-900 text-white'
                      : 'bg-white border border-gray-200 text-gray-800 hover:border-gray-300 hover:bg-gray-50'}
                  `}
                >
                  <span className={isActive ? 'text-gray-300' : ''}>{c.prompt}</span>
                  <span
                    className={`
                      shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded border
                      ${isActive ? 'bg-white/20 text-white border-white/30' : sev.className}
                    `}
                  >
                    {sev.label}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {activeConcern && (
          <div className="border border-gray-200 rounded-lg bg-gray-50/50 overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500">Chat</span>
              <button
                type="button"
                onClick={closeChat}
                className="text-gray-400 hover:text-gray-600 p-0.5"
                aria-label="Close chat"
              >
                ✕
              </button>
            </div>
            <div className="p-3 space-y-3 min-h-[120px] max-h-[220px] overflow-y-auto">
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <span
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                      m.role === 'user'
                        ? 'bg-gray-900 text-white'
                        : 'bg-white border border-gray-200 text-gray-800'
                    }`}
                  >
                    {m.text}
                  </span>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-gray-100 flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
                placeholder="Reply…"
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-transparent"
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={!input.trim()}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send
              </button>
            </div>
            {activeConcern.ticker && onTickerClick && (
              <div className="px-3 pb-3">
                <button
                  type="button"
                  onClick={() => onTickerClick(activeConcern.ticker!)}
                  className="text-xs text-gray-500 hover:text-gray-700"
                >
                  View {activeConcern.ticker} →
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
