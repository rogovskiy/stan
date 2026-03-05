import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/app/lib/firebase-admin';

const PROMPTS_COLLECTION = 'prompts';
const LIMIT = 50;

export interface ExecutionListItem {
  executionId: string;
  createdAt: string;
  promptVersion: number;
  durationMs: number;
  promptTokenCount: number;
  responseTokenCount: number;
  totalTokenCount: number;
  rating: number | null;
  feedbackComment: string | null;
}

function toISOString(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const db = getAdminFirestore();
    const snapshot = await db
      .collection(PROMPTS_COLLECTION)
      .doc(id)
      .collection('executions')
      .orderBy('createdAt', 'desc')
      .limit(LIMIT)
      .get();

    const list: ExecutionListItem[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        executionId: doc.id,
        createdAt: toISOString(data.createdAt),
        promptVersion: typeof data.promptVersion === 'number' ? data.promptVersion : 0,
        durationMs: typeof data.durationMs === 'number' ? data.durationMs : 0,
        promptTokenCount: typeof data.promptTokenCount === 'number' ? data.promptTokenCount : 0,
        responseTokenCount: typeof data.responseTokenCount === 'number' ? data.responseTokenCount : 0,
        totalTokenCount: typeof data.totalTokenCount === 'number' ? data.totalTokenCount : 0,
        rating: typeof data.rating === 'number' ? data.rating : null,
        feedbackComment: typeof data.feedbackComment === 'string' ? data.feedbackComment : null,
      };
    });

    return NextResponse.json(list);
  } catch (err) {
    console.error('GET /api/admin/prompts/[id]/executions:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list executions' },
      { status: 500 }
    );
  }
}
