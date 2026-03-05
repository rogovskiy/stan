import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/app/lib/firebase-admin';
import { getAdminStorageBucket } from '@/app/lib/firebase-admin';

const PROMPTS_COLLECTION = 'prompts';
const FEEDBACK_COMMENT_MAX_LENGTH = 2000;

function toISOString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function buildExecutionPayload(
  executionId: string,
  data: Record<string, unknown>
): Record<string, unknown> {
  return {
    executionId,
    createdAt: toISOString(data.createdAt),
    promptVersion: data.promptVersion ?? 0,
    durationMs: data.durationMs ?? 0,
    promptTokenCount: data.promptTokenCount ?? 0,
    responseTokenCount: data.responseTokenCount ?? 0,
    totalTokenCount: data.totalTokenCount ?? 0,
    inputStorageRef: data.inputStorageRef ?? null,
    outputStorageRef: data.outputStorageRef ?? null,
    parameters: typeof data.parameters === 'string' ? data.parameters : null,
    parametersStorageRef: data.parametersStorageRef ?? null,
    rating: data.rating ?? null,
    feedbackComment: data.feedbackComment ?? null,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  const { id, executionId } = await params;
  const part = request.nextUrl.searchParams.get('part'); // 'input' | 'output' | 'parameters'

  try {
    const db = getAdminFirestore();
    const docRef = db
      .collection(PROMPTS_COLLECTION)
      .doc(id)
      .collection('executions')
      .doc(executionId);
    const doc = await docRef.get();

    if (!doc.exists) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }

    const data = doc.data()!;

    if (part === 'input') {
      const ref = data.inputStorageRef as string | undefined;
      if (!ref) return NextResponse.json({ error: 'Input ref missing' }, { status: 404 });
      const bucket = getAdminStorageBucket();
      const [exists] = await bucket.file(ref).exists();
      if (!exists) return NextResponse.json({ error: 'Input blob not found' }, { status: 404 });
      const [buf] = await bucket.file(ref).download();
      return new NextResponse(buf.toString('utf-8'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    if (part === 'output') {
      const ref = data.outputStorageRef as string | undefined;
      if (!ref) return NextResponse.json({ error: 'Output ref missing' }, { status: 404 });
      const bucket = getAdminStorageBucket();
      const [exists] = await bucket.file(ref).exists();
      if (!exists) return NextResponse.json({ error: 'Output blob not found' }, { status: 404 });
      const [buf] = await bucket.file(ref).download();
      return new NextResponse(buf.toString('utf-8'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }

    if (part === 'parameters') {
      const inline = data.parameters as string | undefined;
      if (typeof inline === 'string') {
        return new NextResponse(inline, {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
        });
      }
      const ref = data.parametersStorageRef as string | undefined;
      if (!ref) return NextResponse.json({ error: 'Parameters ref missing' }, { status: 404 });
      const bucket = getAdminStorageBucket();
      const [exists] = await bucket.file(ref).exists();
      if (!exists) return NextResponse.json({ error: 'Parameters blob not found' }, { status: 404 });
      const [buf] = await bucket.file(ref).download();
      return new NextResponse(buf.toString('utf-8'), {
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    // No part: return full metadata as JSON
    const payload = buildExecutionPayload(doc.id, data);
    return NextResponse.json(payload);
  } catch (err) {
    console.error('GET /api/admin/prompts/[id]/executions/[executionId]:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get execution' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; executionId: string }> }
) {
  const { id, executionId } = await params;
  try {
    const body = await request.json();
    const ratingRaw = body.rating;
    const feedbackCommentRaw = body.feedbackComment;

    const updateData: Record<string, unknown> = {};

    if (ratingRaw !== undefined) {
      if (ratingRaw !== null) {
        const r = Number(ratingRaw);
        if (!Number.isInteger(r) || r < 1 || r > 5) {
          return NextResponse.json(
            { error: 'rating must be 1–5 or null' },
            { status: 400 }
          );
        }
        updateData.rating = r;
      } else {
        updateData.rating = FieldValue.delete();
      }
    }

    if (feedbackCommentRaw !== undefined) {
      if (feedbackCommentRaw !== null) {
        const s = String(feedbackCommentRaw);
        if (s.length > FEEDBACK_COMMENT_MAX_LENGTH) {
          return NextResponse.json(
            { error: `feedbackComment must be at most ${FEEDBACK_COMMENT_MAX_LENGTH} characters` },
            { status: 400 }
          );
        }
        updateData.feedbackComment = s;
      } else {
        updateData.feedbackComment = FieldValue.delete();
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'Provide rating and/or feedbackComment' },
        { status: 400 }
      );
    }

    const db = getAdminFirestore();
    const docRef = db
      .collection(PROMPTS_COLLECTION)
      .doc(id)
      .collection('executions')
      .doc(executionId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
    }
    await docRef.update(updateData);
    const updated = await docRef.get();
    const payload = buildExecutionPayload(updated.id, updated.data()!);
    return NextResponse.json(payload);
  } catch (err) {
    console.error('PATCH /api/admin/prompts/[id]/executions/[executionId]:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update execution' },
      { status: 500 }
    );
  }
}
