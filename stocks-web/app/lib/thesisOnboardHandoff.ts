import type { PositionThesisPayload } from '@/app/lib/types/positionThesis';

const KEY = 'stocks_thesis_onboard_handoff_v2';

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface ThesisOnboardPortfolioLink {
  portfolioId: string;
  positionId: string;
}

export interface ThesisOnboardHandoff {
  ticker: string;
  payload: PositionThesisPayload;
  chatHistory?: ChatHistoryEntry[];
  /** Opaque Firestore thesis doc id when using multi-thesis storage. */
  thesisDocId?: string;
  portfolioLink?: ThesisOnboardPortfolioLink;
  /** Same string passed to coach APIs (optional echo for builder). */
  portfolioContextSummary?: string;
}

export function writeThesisOnboardHandoff(data: ThesisOnboardHandoff): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // ignore quota / private mode
  }
}

export type ThesisOnboardHandoffPayload = {
  payload: PositionThesisPayload;
  chatHistory: ChatHistoryEntry[];
  thesisDocId?: string;
  portfolioLink?: ThesisOnboardPortfolioLink;
  portfolioContextSummary?: string;
};

function parseHandoffForRoute(
  raw: string,
  routeTicker: string
): ThesisOnboardHandoffPayload | null {
  const parsed = JSON.parse(raw) as ThesisOnboardHandoff;
  if (!parsed?.payload || typeof parsed.ticker !== 'string') return null;
  if (parsed.ticker.trim().toUpperCase() !== routeTicker.trim().toUpperCase()) return null;
  const chatHistory = Array.isArray(parsed.chatHistory)
    ? parsed.chatHistory.filter(
        (e) =>
          e &&
          (e.role === 'user' || e.role === 'assistant') &&
          typeof e.content === 'string'
      )
    : [];
  return {
    payload: parsed.payload,
    chatHistory,
    thesisDocId: typeof parsed.thesisDocId === 'string' ? parsed.thesisDocId : undefined,
    portfolioLink:
      parsed.portfolioLink &&
      typeof parsed.portfolioLink.portfolioId === 'string' &&
      typeof parsed.portfolioLink.positionId === 'string'
        ? parsed.portfolioLink
        : undefined,
    portfolioContextSummary:
      typeof parsed.portfolioContextSummary === 'string' ? parsed.portfolioContextSummary : undefined,
  };
}

/**
 * Read handoff without clearing. Use this when the consumer may run twice (e.g. React Strict Mode)
 * or cancel async work; call {@link clearThesisOnboardHandoff} after state is committed.
 */
export function peekThesisOnboardHandoff(routeTicker: string): ThesisOnboardHandoffPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    return parseHandoffForRoute(raw, routeTicker);
  } catch {
    return null;
  }
}

export function clearThesisOnboardHandoff(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/** Returns handoff if stored ticker matches route ticker, then clears storage (one-shot). */
export function takeThesisOnboardHandoff(routeTicker: string): ThesisOnboardHandoffPayload | null {
  const data = peekThesisOnboardHandoff(routeTicker);
  if (data) clearThesisOnboardHandoff();
  return data;
}
