import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { sanitizeFormPatch } from '@/app/lib/positionThesisMerge';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const MAX_CONTEXT_CHARS = 48_000;
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 8_000;

type Role = 'user' | 'assistant';

interface IncomingMessage {
  role: Role;
  content: string;
}

function buildSystemInstruction(
  ticker: string,
  companyName: string | null,
  thesisContext: string,
  tickerLocked: boolean
) {
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
      const count = [ok('ticker'), ok('positionRole'), ok('holdingHorizon'), ok('thesisStatement')].filter(Boolean).length;
      hasCoreFields = count >= 3;
    } catch {
      // not valid JSON, treat as empty
    }
  }
  const continuationNote = hasCoreFields
    ? 'The draft already has core fields (ticker, position role, horizon, statement) filled — the user likely came from the onboarding flow. Do not re-ask for those. Acknowledge what is there and focus on drivers, failures, scenarios, entry/exit rules, portfolio role, regime, or other optional sections. Be incremental.'
    : '';

  const plainLanguage = [
    'Writing style — applies to every reply: your conversational "message" and every string you put in formPatch.',
    'When you suggest wording for the form (including drivers, failures, scenarios, and rules), use simple clear English a motivated high school or college student can follow—short sentences, everyday words, and brief plain-English explanations for any necessary finance terms. Stay precise with numbers and time horizons.',
    'Avoid stiff corporate speak, buzzwords, and dense academic phrasing. Suggested form values should sound like clear notes the user could have written themselves.',
  ].join('\n');

  return [
    `You are an expert investment thesis coach helping build a structured position thesis for ${name}.`,
    lockNote,
    continuationNote,
    plainLanguage,
    '',
    'Workflow: (1) If the draft ticker is missing, empty, or clearly a placeholder, ask which symbol they mean before inventing fundamentals. (2) Invite a free-text description of the position. (3) Ask short clarifying questions. (4) Propose concrete field values in formPatch as you go.',
    'Be concise, practical, and specific. You do not give personalized financial advice or trade recommendations; you help structure and stress-test the user\'s own thesis.',
    'For drivers, prefer 3–6 rows; for failures, 2–5 rows. Use short placeholders like "Unknown" or "TBD" instead of fabricating precise numbers.',
    '',
    'OUTPUT CONTRACT — reply with JSON only (no markdown code fences), exactly one object:',
    '{"message": string, "formPatch": object | null}',
    '- "message": conversational text shown to the user (questions, summary, what you changed).',
    '- "formPatch": a partial object matching the draft shape (only keys you want to set). Omit keys you are not updating. Use null for formPatch if nothing to merge.',
    'Allowed top-level string keys in formPatch: ticker, positionRole, holdingHorizon, thesisStatement, portfolioRole, regimeDesignedFor, entryPrice, baseDividendAssumption, baseGrowthAssumption, baseMultipleBasis, baseMultipleAssumption, upsideScenario, baseScenario, downsideScenario, distanceToFailure, currentVolRegime, riskPosture, trimRule, exitRule, addRule, systemMonitoringSignals.',
    'baseDividendAssumption, baseGrowthAssumption, and baseMultipleAssumption are numeric ranges stored as strings: either one number ("5") or low–high with an en dash ("3.5–4.5"). Dividend and growth are % per year. baseMultipleBasis is "P/E" or "P/FCF" (which multiple the range uses). baseMultipleAssumption is the × range.',
    'Legacy keys (still merge if present in old drafts, but do not suggest unless the user explicitly asks): upsideDividendAssumption, upsideGrowthAssumption, upsideMultipleAssumption, downsideDividendAssumption, downsideGrowthAssumption, downsideMultipleAssumption.',
    'Optional arrays: "drivers" (objects with driver, whyItMatters, importance where importance is High, Medium, or Low), "failures" (failurePath one line, trigger, estimatedImpact, timeframe). Prefer timeframe: Immediate, < 3 months, 3–6 months, 6–12 months, 6–18 months, 1–2 years, 2+ years, or Gradual. When updating a table, send the full replacement array.',
    thesisContext.trim()
      ? `Current draft JSON:\n${thesisContext.slice(0, MAX_CONTEXT_CHARS)}`
      : 'No draft JSON yet; help the user start from their description.',
  ].join('\n');
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

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: buildSystemInstruction(ticker, companyName, thesisContext, tickerLocked),
    generationConfig: {
      responseMimeType: 'application/json',
    },
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
