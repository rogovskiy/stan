import { NextResponse } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

const MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
const MAX_CONTEXT_CHARS = 48_000;
const MAX_MESSAGES = 24;
const MAX_MESSAGE_CHARS = 8_000;

type Role = 'user' | 'assistant';

interface IncomingMessage {
  role: Role;
  content: string;
}

function buildSystemInstruction(ticker: string, companyName: string | null, thesisContext: string) {
  const name = companyName ? `${companyName} (${ticker})` : ticker;
  return [
    `You are an expert investment thesis coach helping refine a structured position thesis for ${name}.`,
    'Be concise, practical, and specific. Reference the draft fields when relevant (thesis statement, return expectations, drivers, failure map, decision rules).',
    'You do not provide personalized financial advice or trade recommendations; you help structure and stress-test the user\'s own thesis.',
    thesisContext.trim()
      ? `Current draft (JSON or text from the builder):\n${thesisContext.slice(0, MAX_CONTEXT_CHARS)}`
      : 'No draft text was supplied; ask what ticker and thesis they are working on.',
  ].join('\n\n');
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
    systemInstruction: buildSystemInstruction(ticker, companyName, thesisContext),
  });

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.content }],
  }));

  try {
    const chat = model.startChat({ history });
    const result = await chat.sendMessage(last.content);
    const text = result.response.text();
    return NextResponse.json({ reply: text });
  } catch (err) {
    console.error('POST /api/chat/position-thesis:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Gemini request failed' },
      { status: 502 }
    );
  }
}
