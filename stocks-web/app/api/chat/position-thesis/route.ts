import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sanitizeFormPatch } from '@/app/lib/positionThesisMerge';
import { PROMPT_POSITION_THESIS_BUILDER } from '@/app/lib/promptIds';
import {
  applyPromptPlaceholders,
  isPromptExecutable,
  loadPromptVersion,
  promptNotConfiguredMessage,
  resolveGeminiModel,
} from '@/app/lib/server/loadPrompt';

const MAX_CONTEXT_CHARS = 48_000;
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 8_000;

type Role = 'user' | 'assistant';

interface IncomingMessage {
  role: Role;
  content: string;
}

function buildThesisBuilderPlaceholders(
  ticker: string,
  companyName: string | null,
  thesisContext: string,
  tickerLocked: boolean
): Record<string, string> {
  const name = companyName ? `${companyName} (${ticker})` : ticker;
  const lockNote = tickerLocked
    ? 'The ticker is already fixed for this thesis document. Do not include "ticker" in formPatch.'
    : 'The user may still change the ticker until they save; you may set formPatch.ticker if they state a symbol (uppercase).';

  let hasCoreFields = false;
  if (thesisContext.trim().length > 0) {
    try {
      const draft = JSON.parse(thesisContext.trim()) as Record<string, unknown>;
      const ok = (k: string) =>
        typeof draft[k] === 'string' && (draft[k] as string).trim().length > 0;
      const count = [ok('ticker'), ok('positionRole'), ok('holdingHorizon'), ok('thesisStatement')].filter(
        Boolean
      ).length;
      hasCoreFields = count >= 3;
    } catch {
      // not valid JSON, treat as empty
    }
  }
  const continuationNote = hasCoreFields
    ? 'The draft already has core fields (ticker, position role, horizon, statement) filled — the user likely came from the onboarding flow. Do not re-ask for those. Acknowledge what is there and focus on drivers, failures, scenarios, entry/exit rules, portfolio role, regime, or other optional sections. Be incremental.'
    : '';

  const thesisContextBlock = thesisContext.trim()
    ? `Current draft JSON:\n${thesisContext.slice(0, MAX_CONTEXT_CHARS)}`
    : 'No draft JSON yet; help the user start from their description.';

  return {
    name,
    lockNote,
    continuationNote,
    thesisContextBlock,
  };
}

function parseModelJson(text: string): { message: string; formPatchRaw: unknown } | null {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed) as { message?: unknown; formPatch?: unknown };
    const message = typeof parsed.message === 'string' ? parsed.message : '';
    if (!message) return null;
    return { message, formPatchRaw: parsed.formPatch === undefined ? null : parsed.formPatch };
  } catch {
    const idx = trimmed.lastIndexOf('THESIS_PATCH:');
    if (idx >= 0) {
      const jsonPart = trimmed.slice(idx + 'THESIS_PATCH:'.length).trim();
      try {
        const patch = JSON.parse(jsonPart);
        const human = trimmed.slice(0, idx).trim();
        if (human) return { message: human, formPatchRaw: patch };
      } catch {
        return null;
      }
    }
  }
  return null;
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
    ticker?: string;
    companyName?: string | null;
    thesisContext?: string;
    tickerLocked?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : '';
  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 });
  }

  const tickerLocked = body.tickerLocked === true;

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

  const thesisContext =
    typeof body.thesisContext === 'string' ? body.thesisContext : '';
  const companyName =
    typeof body.companyName === 'string' && body.companyName.trim()
      ? body.companyName.trim()
      : null;

  const promptLoaded = await loadPromptVersion(PROMPT_POSITION_THESIS_BUILDER, null);
  if (!isPromptExecutable(promptLoaded)) {
    return NextResponse.json(
      { error: promptNotConfiguredMessage(PROMPT_POSITION_THESIS_BUILDER) },
      { status: 503 }
    );
  }

  const systemInstruction = applyPromptPlaceholders(
    promptLoaded.content,
    buildThesisBuilderPlaceholders(ticker, companyName, thesisContext, tickerLocked)
  );

  const modelId = resolveGeminiModel(promptLoaded.params);
  const generationConfig: {
    responseMimeType: string;
    temperature?: number;
  } = {
    responseMimeType: 'application/json',
  };
  if (promptLoaded.params.temperature != null) {
    generationConfig.temperature = promptLoaded.params.temperature;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelId,
    systemInstruction,
    generationConfig,
  });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));

  try {
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(last.content);
    const text = result.response.text();
    const parsed = parseModelJson(text);
    if (!parsed) {
      console.error('POST /api/chat/position-thesis: invalid model JSON', text.slice(0, 500));
      return NextResponse.json(
        { error: 'Assistant returned invalid response format. Try again.' },
        { status: 502 }
      );
    }

    let formPatch = null;
    if (parsed.formPatchRaw !== null && parsed.formPatchRaw !== undefined) {
      formPatch = sanitizeFormPatch(parsed.formPatchRaw, { tickerLocked });
    }

    const responseBody: { reply: string; formPatch?: Record<string, unknown> } = {
      reply: parsed.message,
    };
    if (formPatch && Object.keys(formPatch).length > 0) {
      responseBody.formPatch = formPatch as Record<string, unknown>;
    }

    return NextResponse.json(responseBody);
  } catch (err) {
    console.error('POST /api/chat/position-thesis:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gemini request failed' },
      { status: 502 }
    );
  }
}
