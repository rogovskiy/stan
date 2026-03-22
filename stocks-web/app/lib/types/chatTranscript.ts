/**
 * Position thesis builder chat transcript (Storage JSON + API payloads).
 */

export const POSITION_THESIS_CHAT_SCOPE = 'position_thesis_builder' as const;
export const POSITION_THESIS_FIRESTORE_COLLECTION = 'position_theses';

export interface PersistedChatMessage {
  role: 'user' | 'assistant';
  content: string;
  assistantLabel?: string;
  messageKind?: 'factCheck';
}

export interface ChatTranscriptFileV1 {
  version: 1;
  updatedAt: string;
  messages: PersistedChatMessage[];
}

/** Server-side sanity caps for PUT body (not the same as coach API window). */
const MAX_STORED_MESSAGES = 5000;
const MAX_CONTENT_CHARS_PER_MESSAGE = 500_000;

export function coercePersistedChatMessages(raw: unknown): PersistedChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.length > MAX_STORED_MESSAGES) return null;
  const out: PersistedChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const o = item as Record<string, unknown>;
    if (o.role !== 'user' && o.role !== 'assistant') return null;
    if (typeof o.content !== 'string') return null;
    if (o.content.length > MAX_CONTENT_CHARS_PER_MESSAGE) return null;
    const row: PersistedChatMessage = { role: o.role, content: o.content };
    if (typeof o.assistantLabel === 'string' && o.assistantLabel.length <= 200) {
      row.assistantLabel = o.assistantLabel;
    }
    if (o.messageKind === 'factCheck') {
      row.messageKind = 'factCheck';
    }
    out.push(row);
  }
  return out;
}

export function buildTranscriptFile(messages: PersistedChatMessage[]): ChatTranscriptFileV1 {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    messages,
  };
}
