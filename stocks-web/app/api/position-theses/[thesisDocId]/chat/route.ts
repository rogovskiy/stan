import { NextResponse } from 'next/server';
import { requireUidFromRequest } from '@/app/lib/requireAuth';
import {
  assertPositionThesisOwnedByUid,
  readPositionThesisChatTranscript,
  writePositionThesisChatTranscript,
} from '@/app/lib/server/positionThesisChatStorage';
import { coercePersistedChatMessages } from '@/app/lib/types/chatTranscript';

const MAX_PUT_BODY_CHARS = 12_000_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ thesisDocId: string }> }
) {
  const auth = await requireUidFromRequest(request);
  if (!auth.ok) return auth.response;

  const { thesisDocId } = await params;
  if (!thesisDocId?.trim()) {
    return NextResponse.json({ success: false, error: 'Missing thesis document id' }, { status: 400 });
  }

  try {
    const owned = await assertPositionThesisOwnedByUid(thesisDocId.trim(), auth.uid);
    if (!owned) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    const messages = await readPositionThesisChatTranscript(auth.uid, thesisDocId.trim());
    return NextResponse.json({ success: true, data: { messages } });
  } catch (e) {
    console.error('GET /api/position-theses/[thesisDocId]/chat:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Failed to load transcript' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ thesisDocId: string }> }
) {
  const auth = await requireUidFromRequest(request);
  if (!auth.ok) return auth.response;

  const { thesisDocId } = await params;
  if (!thesisDocId?.trim()) {
    return NextResponse.json({ success: false, error: 'Missing thesis document id' }, { status: 400 });
  }

  let rawText: string;
  try {
    rawText = await request.text();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid body' }, { status: 400 });
  }
  if (rawText.length > MAX_PUT_BODY_CHARS) {
    return NextResponse.json({ success: false, error: 'Payload too large' }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawText) as unknown;
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const messagesRaw =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { messages?: unknown }).messages
      : undefined;
  const messages = coercePersistedChatMessages(messagesRaw);
  if (messages === null) {
    return NextResponse.json({ success: false, error: 'Invalid messages' }, { status: 400 });
  }

  try {
    const owned = await assertPositionThesisOwnedByUid(thesisDocId.trim(), auth.uid);
    if (!owned) {
      return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
    }
    await writePositionThesisChatTranscript(auth.uid, thesisDocId.trim(), messages);
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('PUT /api/position-theses/[thesisDocId]/chat:', e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Failed to save transcript' },
      { status: 500 }
    );
  }
}
