import type { PersistedChatMessage } from '@/app/lib/types/chatTranscript';

export type FetchTranscriptResult =
  | { ok: true; messages: PersistedChatMessage[] }
  | { ok: false; error: string };

export type SaveTranscriptResult = { ok: true } | { ok: false; error: string };

export async function fetchPositionThesisChatTranscript(
  thesisDocId: string,
  idToken: string
): Promise<FetchTranscriptResult> {
  const id = encodeURIComponent(thesisDocId.trim());
  const res = await fetch(`/api/position-theses/${id}/chat`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${idToken}` },
  });
  const json = (await res.json()) as {
    success?: boolean;
    data?: { messages?: unknown };
    error?: string;
  };
  if (!res.ok || json.success === false) {
    return { ok: false, error: json.error || res.statusText || 'Request failed' };
  }
  const raw = json.data?.messages;
  if (!Array.isArray(raw)) {
    return { ok: true, messages: [] };
  }
  const messages: PersistedChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (o.role !== 'user' && o.role !== 'assistant') continue;
    if (typeof o.content !== 'string') continue;
    const row: PersistedChatMessage = { role: o.role, content: o.content };
    if (typeof o.assistantLabel === 'string') row.assistantLabel = o.assistantLabel;
    if (o.messageKind === 'factCheck') row.messageKind = 'factCheck';
    messages.push(row);
  }
  return { ok: true, messages };
}

export async function savePositionThesisChatTranscript(
  thesisDocId: string,
  messages: PersistedChatMessage[],
  idToken: string
): Promise<SaveTranscriptResult> {
  const id = encodeURIComponent(thesisDocId.trim());
  const res = await fetch(`/api/position-theses/${id}/chat`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages }),
  });
  const json = (await res.json()) as { success?: boolean; error?: string };
  if (!res.ok || json.success === false) {
    return { ok: false, error: json.error || res.statusText || 'Request failed' };
  }
  return { ok: true };
}
