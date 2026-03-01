import { NextRequest, NextResponse } from 'next/server';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/app/lib/firebase';

const COLLECTION = 'job_runs';

export interface JobRunDetail {
  id: string;
  job_type: string;
  date: string;
  started_at: string;
  finished_at?: string;
  status: 'success' | 'error';
  execution_id: string;
  entity?: string;
  error_message?: string;
  payload?: Record<string, unknown>;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ executionId: string }> }
) {
  try {
    const { executionId } = await params;
    if (!executionId) {
      return NextResponse.json({ error: 'executionId is required' }, { status: 400 });
    }

    const ref = doc(db, COLLECTION, executionId);
    const snapshot = await getDoc(ref);

    if (!snapshot.exists()) {
      return NextResponse.json({ error: 'Job run not found' }, { status: 404 });
    }

    const data = snapshot.data();
    const started = data?.started_at;
    const finished = data?.finished_at;

    const run: JobRunDetail = {
      id: snapshot.id,
      job_type: data?.job_type ?? '',
      date: data?.date ?? '',
      started_at: typeof started?.toDate === 'function' ? started.toDate().toISOString() : String(started ?? ''),
      finished_at: finished != null
        ? (typeof finished?.toDate === 'function' ? finished.toDate().toISOString() : String(finished))
        : undefined,
      status: data?.status === 'error' ? 'error' : 'success',
      execution_id: data?.execution_id ?? snapshot.id,
      entity: data?.entity,
      error_message: data?.error_message,
      payload: data?.payload as Record<string, unknown> | undefined,
    };

    return NextResponse.json(run);
  } catch (error) {
    console.error('Job run detail API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch job run',
      },
      { status: 500 }
    );
  }
}
