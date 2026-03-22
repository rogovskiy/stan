import { NextResponse } from 'next/server';
import { sanitizeFormPatch } from '@/app/lib/positionThesisMerge';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const MAX_CONTEXT_CHARS = 48_000;
const MAX_MESSAGES = 32;
const MAX_MESSAGE_CHARS = 8_000;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

type Role = 'user' | 'assistant';

interface IncomingMessage {
  role: Role;
  content: string;
}

function buildOnboardSystemInstruction(draftJson: string) {
  return [
    'You are an **exploratory investment thesis advisor** — proactive, curious, and research-driven. The user is typing briefly; your job is to enrich their sparse input with thoughtful exploration and real-world context.',
    '',
    '**Use Google Search** whenever it would strengthen your response: current price action, recent news, earnings, macro backdrop, sector trends, analyst views, or what might break the thesis. Be aware of the current situation. Cite or reference what you find when relevant.',
    '',
    '**Exploratory stance**: Do not act like a form-filler. Ask probing questions. Offer hypotheses and invite pushback. Suggest angles they might not have considered.',
    '',
    '**Advisory tone**: You are a sparring partner, not a clerk. Challenge assumptions gently. Propose concrete drivers, failure modes, or regime conditions. When the user is brief, infer and elaborate — then confirm rather than asking them to type everything out.',
    '',
    '**Make questions obvious**: When you need input from the user, put your question on its own line with a clear prefix. Examples:',
    '- "**What ticker or company** are you thinking about?"',
    '- "**Question:** How long do you plan to hold this?"',
    '- When offering choices, number them: "1) Core compounder  2) Tactical trade  3) Macro hedge — which fits best?"',
    'Never bury a question in the middle of a long paragraph. Lead with it or put it at the end with a clear **Question:** or **Which of these:** label.',
    '',
    '**Collect for the thesis builder** (ticker, positionRole, holdingHorizon, thesisStatement plus optional depth). Populate formPatch as you go, but prioritize rich dialogue over exhaustive field coverage.',
    '',
    '**Balance**: After core four fields + meaningful exploration (roughly 6–10 turns, or when the user says "enough" / "skip" / "let\'s go"), indicate they can continue to the builder.',
    '',
    'Tone: direct, insightful, non-advice. You help them think; you do not recommend buys or sells.',
    '',
    'Respond in natural conversational text. Do not output JSON.',
    '',
    draftJson.trim()
      ? `Current draft (JSON):\n${draftJson.slice(0, MAX_CONTEXT_CHARS)}`
      : 'No draft yet — welcome them, ask what company or thesis they are considering, and use search if they name a ticker to offer relevant context.',
  ].join('\n');
}

function buildStructurizePrompt(freeText: string, draftJson: string): string {
  return [
    'You are a conversion step. The following is an assistant\'s free-text response from an investment thesis onboarding chat. Convert it into a strict JSON object.',
    '',
    'OUTPUT: Valid JSON only. No markdown, no extra text. Exactly this shape:',
    '{"message": string, "formPatch": object | null, "readyForBuilder": boolean}',
    '',
    '- message: The conversational text to show the user. Preserve it as-is or lightly clean. Use \\n for line breaks. Escape quotes. Preserve markdown **bold** for question labels and emphasis (e.g. **Question:**, **What ticker or company**). Do not remove or convert double-asterisk emphasis.',
    '- formPatch: Extract any thesis field updates implied or stated. Allowed keys: ticker, positionRole, holdingHorizon, thesisStatement, portfolioRole, regimeDesignedFor, entryPrice, upsideDividendAssumption, upsideGrowthAssumption, upsideMultipleAssumption, baseDividendAssumption, baseGrowthAssumption, baseMultipleAssumption, downsideDividendAssumption, downsideGrowthAssumption, downsideMultipleAssumption, upsideScenario, baseScenario, downsideScenario, distanceToFailure, currentVolRegime, riskPosture, trimRule, exitRule, addRule, systemMonitoringSignals. Optional arrays: drivers, failures. Use null if nothing to merge.',
    '- readyForBuilder: true only if the assistant suggests moving to the builder, or core four fields appear filled and the user seems ready. Otherwise false.',
    '',
    'Current draft (for context):',
    draftJson.trim().slice(0, 4000) || '(empty)',
    '',
    '---',
    'ASSISTANT FREE-TEXT RESPONSE:',
    freeText,
  ].join('\n');
}

function extractJsonFromText(text: string): string | null {
  const trimmed = text.trim();
  // 1. Direct parse
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // continue
  }
  // 2. Markdown code block
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
  // 3. THESIS_PATCH: delimiter
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
  // 4. Find outermost { } containing "message" (greedy from end)
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
  // 5. Any { ... } with "message" key (first match)
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

  // Fallback: use raw text as message when parsing fails (user sees response instead of error)
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

  const contents = [
    ...messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
      parts: [{ text: m.content }],
    })),
    { role: 'user' as const, parts: [{ text: last.content }] },
  ];

  const requestBody = {
    contents,
    systemInstruction: {
      parts: [{ text: buildOnboardSystemInstruction(draftJson) }],
    },
    tools: [{ google_search: {} }],
  };

  const modelPath = MODEL.startsWith('models/') ? MODEL : `models/${MODEL}`;
  const url = `${API_BASE}/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    // Step 1: Grounded free-text response (with Google Search)
    const res1 = await fetch(url, {
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

    // Step 2: Convert free text to structured JSON (no tools, JSON mode)
    const structurizeBody = {
      contents: [{ role: 'user' as const, parts: [{ text: buildStructurizePrompt(freeText, draftJson) }] }],
      generationConfig: { responseMimeType: 'application/json' as const },
    };
    const res2 = await fetch(url, {
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
      // Fallback: use free text as message when structurize fails
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
