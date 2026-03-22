import { NextResponse } from 'next/server';
import { PROMPT_POSITION_THESIS_REALITY_CHECK } from '@/app/lib/promptIds';
import {
  canRunGroundedThesisFactCheck,
  factCheckGateBlockedMessage,
  getBlockedRequiredSections,
  parseThesisContextForCompleteness,
} from '@/app/lib/positionThesisCompleteness';
import {
  applyPromptPlaceholders,
  isPromptExecutable,
  loadPromptVersion,
  promptNotConfiguredMessage,
  resolveGeminiModel,
} from '@/app/lib/server/loadPrompt';

const MAX_CONTEXT_CHARS = 48_000;
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function buildRealityCheckPlaceholders(
  ticker: string,
  companyName: string | null,
  thesisContext: string
): Record<string, string> {
  const name = companyName ? `${companyName} (${ticker})` : ticker;
  const thesisContextBlock = thesisContext.trim()
    ? `Current draft JSON:\n${thesisContext.slice(0, MAX_CONTEXT_CHARS)}`
    : 'No draft JSON provided.';
  return { name, thesisContextBlock };
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
    ticker?: string;
    companyName?: string | null;
    thesisContext?: string;
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

  const thesisContext = typeof body.thesisContext === 'string' ? body.thesisContext : '';
  if (!thesisContext.trim()) {
    return NextResponse.json({ error: 'thesisContext is required' }, { status: 400 });
  }

  const companyName =
    typeof body.companyName === 'string' && body.companyName.trim()
      ? body.companyName.trim()
      : null;

  const payload = parseThesisContextForCompleteness(thesisContext, ticker);
  if (!payload) {
    return NextResponse.json({ error: 'thesisContext must be valid JSON' }, { status: 400 });
  }

  if (!canRunGroundedThesisFactCheck(payload)) {
    const blocked = getBlockedRequiredSections(payload);
    return NextResponse.json(
      { error: factCheckGateBlockedMessage(blocked) },
      { status: 400 }
    );
  }

  const promptLoaded = await loadPromptVersion(PROMPT_POSITION_THESIS_REALITY_CHECK, null);
  if (!isPromptExecutable(promptLoaded)) {
    return NextResponse.json(
      { error: promptNotConfiguredMessage(PROMPT_POSITION_THESIS_REALITY_CHECK) },
      { status: 503 }
    );
  }

  const systemInstruction = applyPromptPlaceholders(
    promptLoaded.content,
    buildRealityCheckPlaceholders(ticker, companyName, thesisContext)
  );

  const modelId = resolveGeminiModel(promptLoaded.params);
  const modelPath = modelId.startsWith('models/') ? modelId : `models/${modelId}`;
  const url = `${API_BASE}/${modelPath}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const requestBody: Record<string, unknown> = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: 'Run the grounded fact-check described in your instructions on the thesis draft. Output markdown only.',
          },
        ],
      },
    ],
    systemInstruction: {
      parts: [{ text: systemInstruction }],
    },
  };

  if (promptLoaded.params.groundingEnabled) {
    requestBody.tools = [{ google_search: {} }];
  }

  if (promptLoaded.params.temperature != null) {
    requestBody.generationConfig = { temperature: promptLoaded.params.temperature };
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });
    const json = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      error?: { message?: string };
    };
    if (!res.ok) {
      const msg = json.error?.message ?? res.statusText;
      console.error('POST /api/chat/position-thesis/reality-check: API error', res.status, msg);
      return NextResponse.json(
        { error: msg || 'Gemini request failed' },
        { status: 502 }
      );
    }
    const parts = json.candidates?.[0]?.content?.parts ?? [];
    const report = parts
      .map((p) => (typeof p.text === 'string' ? p.text : ''))
      .join('\n')
      .trim();
    if (!report) {
      console.error('POST /api/chat/position-thesis/reality-check: empty response');
      return NextResponse.json(
        { error: 'No report returned. Try again.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ report });
  } catch (err) {
    console.error('POST /api/chat/position-thesis/reality-check:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gemini request failed' },
      { status: 502 }
    );
  }
}
