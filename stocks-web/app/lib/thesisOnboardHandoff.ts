import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';

const KEY = 'stocks_thesis_onboard_handoff_v2';

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface ThesisOnboardHandoff {
  ticker: string;
  payload: PositionThesisPayload;
  chatHistory?: ChatHistoryEntry[];
}

export function writeThesisOnboardHandoff(data: ThesisOnboardHandoff): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore quota / private mode
  }
}

/** Returns payload and chat history if stored ticker matches route ticker, then clears storage (one-shot). */
export function takeThesisOnboardHandoff(
  routeTicker: string
): { payload: PositionThesisPayload; chatHistory: ChatHistoryEntry[] } | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ThesisOnboardHandoff;
    if (!parsed?.payload || typeof parsed.ticker !== 'string') return null;
    if (parsed.ticker.trim().toUpperCase() !== routeTicker.trim().toUpperCase()) return null;
    sessionStorage.removeItem(KEY);
    const chatHistory = Array.isArray(parsed.chatHistory)
      ? parsed.chatHistory.filter(
          (e) =>
            e &&
            (e.role === 'user' || e.role === 'assistant') &&
            typeof e.content === 'string'
        )
      : [];
    return { payload: parsed.payload, chatHistory };
  } catch {
    return null;
  }
}
