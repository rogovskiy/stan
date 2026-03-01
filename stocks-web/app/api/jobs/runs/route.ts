import { NextRequest, NextResponse } from 'next/server';
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore';
import { db } from '@/app/lib/firebase';

const COLLECTION = 'job_runs';

export interface JobRun {
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const jobType = searchParams.get('jobType') ?? undefined;

    if (!from || !to) {
      return NextResponse.json(
        { error: 'Query params "from" and "to" (YYYY-MM-DD) are required' },
        { status: 400 }
      );
    }

    const coll = collection(db, COLLECTION);
    const constraints = [
      where('date', '>=', from),
      where('date', '<=', to),
      orderBy('date', 'desc'),
    ];
    if (jobType) {
      constraints.unshift(where('job_type', '==', jobType));
    }
    const q = query(coll, ...constraints);
    const snapshot = await getDocs(q);

    const runs: JobRun[] = snapshot.docs.map((d) => {
      const data = d.data();
      const started = data.started_at;
      return {
        id: d.id,
        job_type: data.job_type ?? '',
        date: data.date ?? '',
        started_at: typeof started?.toDate === 'function' ? started.toDate().toISOString() : String(started ?? ''),
        finished_at: data.finished_at != null
          ? (typeof data.finished_at?.toDate === 'function'
            ? data.finished_at.toDate().toISOString()
            : String(data.finished_at))
          : undefined,
        status: data.status === 'error' ? 'error' : 'success',
        execution_id: data.execution_id ?? d.id,
        entity: data.entity,
        error_message: data.error_message,
        payload: data.payload as Record<string, unknown> | undefined,
      };
    });

    runs.sort((a, b) => {
      const d = b.date.localeCompare(a.date);
      if (d !== 0) return d;
      return b.started_at.localeCompare(a.started_at);
    });

    return NextResponse.json(runs);
  } catch (error) {
    console.error('Jobs runs API error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch job runs',
      },
      { status: 500 }
    );
  }
}
