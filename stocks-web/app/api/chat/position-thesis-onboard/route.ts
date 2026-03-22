import { NextResponse } from 'next/server';
import { sanitizeFormPatch } from '@/app/lib/positionThesisMerge';
import {
  PROMPT_POSITION_THESIS_ONBOARD,
  PROMPT_POSITION_THESIS_ONBOARD_STRUCTURIZE,
} from '@/app/lib/promptIds';
import {
  applyPromptPlaceholders,
  isPromptExecutable,
  loadPromptVersion,
  promptNotConfiguredMessage,
  resolveGeminiModel,
} from '@/app/lib/server/loadPrompt';

const MAX_CONTEXT_CHARS = 48_000;
const MAX_STRUCT_DRAFT_CHARS = 4_000;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_CHARS = 8_000;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

type Role = 'user' | 'assistant';

interface IncomingMessage {
  role: Role;
  content: string;
}

function extractJsonFromText(text: string): string | null {
  const trimmed = text.trim();
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // continue
  }
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    const inner = codeBlock[1].trim();
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      // ignore
    }
  }
  const patchIdx = trimmed.lastIndexOf('THESIS_PATCH:');
  if (patchIdx >= 0) {
    const candidate = trimmed.slice(patchIdx + 'THESIS_PATCH:'.length).trim();
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // ignore
    }
  }
  const startIdx = trimmed.lastIndexOf('{"message"');
  if (startIdx >= 0) {
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx; i < trimmed.length; i++) {
      if (trimmed[i] === '{') depth++;
      if (trimmed[i] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx > startIdx) {
      const candidate = trimmed.slice(startIdx, endIdx + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // ignore
      }
    }
  }
  const genericMatch = trimmed.match(/\{\s*"message"\s*:/);
  if (genericMatch) {
    const start = genericMatch.index!;
    let depth = 0;
    let endIdx = -1;
    for (let i = start; i < trimmed.length; i++) {
      if (trimmed[i] === '{') depth++;
      if (trimmed[i] === '}') {
        depth--;
        if (depth === 0) {
          endIdx = i;
          break;
        }
      }
    }
    if (endIdx > start) {
      const candidate = trimmed.slice(start, endIdx + 1);
      try {
        JSON.parse(candidate);
        return candidate;
      } catch {
        // ignore
      }
    }
  }
  return null;
}

function parseOnboardJson(
  text: string
): { message: string; formPatchRaw: unknown; readyForBuilder: boolean } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const jsonStr = extractJsonFromText(trimmed);
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr) as {
        message?: unknown;
        formPatch?: unknown;
        readyForBuilder?: unknown;
      };
      if (parsed && typeof parsed.message === 'string' && parsed.message.length > 0) {
        return {
          message: parsed.message,
          formPatchRaw: parsed.formPatch === undefined ? null : parsed.formPatch,
          readyForBuilder: parsed.readyForBuilder === true,
        };
      }
    } catch {
      // fall through to fallback
    }
  }

  return {
    message: trimmed,
    formPatchRaw: null,
    readyForBuilder: false,
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Chat is unavailable: GEMINI_API_KEY is not configured on the server.' },
      { status: 503 }
    );
  }

  let body: {
    messages?: IncomingMessage[];
    draftJson?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length === 0) {
    return NextResponse.json({ error: 'messages must be a non-empty array' }, { status: 400 });
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: `At most ${MAX_MESSAGES} messages allowed` }, { status: 400 });
  }

  const last = messages[messages.length - 1];
  if (last.role !== 'user' || typeof last.content !== 'string') {
    return NextResponse.json({ error: 'Last message must be from user with string content' }, { status: 400 });
  }

  for (const m of messages) {
    if ((m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return NextResponse.json({ error: 'Invalid message shape' }, { status: 400 });
    }
    if (m.content.length > MAX_MESSAGE_CHARS) {
      return NextResponse.json({ error: 'Message too long' }, { status: 400 });
    }
  }

  const draftJson = typeof body.draftJson === 'string' ? body.draftJson : '';

  const onboardPrompt = await loadPromptVersion(PROMPT_POSITION_THESIS_ONBOARD, null);
  if (!isPromptExecutable(onboardPrompt)) {
    return NextResponse.json(
      { error: promptNotConfiguredMessage(PROMPT_POSITION_THESIS_ONBOARD) },
      { status: 503 }
    );
  }

  const structPrompt = await loadPromptVersion(PROMPT_POSITION_THESIS_ONBOARD_STRUCTURIZE, null);
  if (!isPromptExecutable(structPrompt)) {
    return NextResponse.json(
      { error: promptNotConfiguredMessage(PROMPT_POSITION_THESIS_ONBOARD_STRUCTURIZE) },
      { status: 503 }
    );
  }

  const draftJsonSnippetOnboard = draftJson.trim()
    ? `Current draft (JSON):\n${draftJson.slice(0, MAX_CONTEXT_CHARS)}`
    : 'No draft yet — welcome them, ask what company or thesis they are considering, and use search if they name a ticker to offer relevant context.';

  const onboardSystemText = applyPromptPlaceholders(onboardPrompt.content, {
    draftJsonSnippet: draftJsonSnippetOnboard,
  });

  const contents = [
    ...messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    })),
    { role: 'user' as const, parts: [{ text: last.content }] },
  ];

  const modelStep1 = resolveGeminiModel(onboardPrompt.params);
  const modelPath1 = modelStep1.startsWith('models/') ? modelStep1 : `models/${modelStep1}`;
  const url1 = `${API_BASE}/${modelPath1}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const requestBody: Record<string, unknown> = {
    contents,
    systemInstruction: {
      parts: [{ text: onboardSystemText }],
    },
  };
  if (onboardPrompt.params.groundingEnabled) {
    requestBody.tools = [{ google_search: {} }];
  }
  if (onboardPrompt.params.temperature != null) {
    requestBody.generationConfig = { temperature: onboardPrompt.params.temperature };
  }

  try {
    const res1 = await fetch(url1, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const json1 = (await res1.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!res1.ok) {
      const msg = json1.error?.message ?? res1.statusText;
      console.error('POST /api/chat/position-thesis-onboard: step 1 API error', res1.status, msg);
      return NextResponse.json(
        { error: msg || 'Gemini request failed' },
        { status: 502 }
      );
    }
    const parts1 = json1.candidates?.[0]?.content?.parts ?? [];
    const freeText = parts1
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('\n')
      .trim();
    if (!freeText) {
      console.error('POST /api/chat/position-thesis-onboard: empty step 1 response');
      return NextResponse.json(
        { error: 'Assistant returned no response. Try again.' },
        { status: 502 }
      );
    }

    const structUserText = applyPromptPlaceholders(structPrompt.content, {
      draftJsonSnippet: draftJson.trim().slice(0, MAX_STRUCT_DRAFT_CHARS) || '(empty)',
      freeText,
    });

    const modelStep2 = resolveGeminiModel(structPrompt.params);
    const modelPath2 = modelStep2.startsWith('models/') ? modelStep2 : `models/${modelStep2}`;
    const url2 = `${API_BASE}/${modelPath2}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const structGenerationConfig: { responseMimeType: string; temperature?: number } = {
      responseMimeType: 'application/json',
    };
    if (structPrompt.params.temperature != null) {
      structGenerationConfig.temperature = structPrompt.params.temperature;
    }

    const structurizeBody: Record<string, unknown> = {
      contents: [{ role: 'user' as const, parts: [{ text: structUserText }] }],
      generationConfig: structGenerationConfig,
    };

    const res2 = await fetch(url2, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(structurizeBody),
    });
    const json2 = (await res2.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!res2.ok) {
      const msg = json2.error?.message ?? res2.statusText;
      console.error('POST /api/chat/position-thesis-onboard: step 2 API error', res2.status, msg);
      return NextResponse.json({
        reply: freeText,
        readyForBuilder: false,
      });
    }
    const parts2 = json2.candidates?.[0]?.content?.parts ?? [];
    const structText = parts2
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('\n')
      .trim();
    const parsed = parseOnboardJson(structText);
    const useFreeTextFallback =
      !parsed ||
      !parsed.message ||
      parsed.message.trim().startsWith('{');
    if (useFreeTextFallback) {
      console.warn('POST /api/chat/position-thesis-onboard: step 2 parse failed, using free text', structText?.slice(0, 200));
      return NextResponse.json({
        reply: freeText,
        readyForBuilder: false,
      });
    }

    let formPatch = null;
    if (parsed.formPatchRaw !== null && parsed.formPatchRaw !== undefined) {
      formPatch = sanitizeFormPatch(parsed.formPatchRaw, { tickerLocked: false });
    }

    const responseBody: {
      reply: string;
      readyForBuilder: boolean;
      formPatch?: Record<string, unknown>;
    } = {
      reply: parsed.message,
      readyForBuilder: parsed.readyForBuilder,
    };
    if (formPatch && Object.keys(formPatch).length > 0) {
      responseBody.formPatch = formPatch as Record<string, unknown>;
    }

    return NextResponse.json(responseBody);
  } catch (err) {
    console.error('POST /api/chat/position-thesis-onboard:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gemini request failed' },
      { status: 502 }
    );
  }
}
