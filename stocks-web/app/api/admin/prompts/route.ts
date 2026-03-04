import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/app/lib/firebase-admin';

const PROMPTS_COLLECTION = 'prompts';

export interface PromptListItem {
  id: string;
  name: string;
  currentVersion: number;
  updatedAt: string;
}

function displayName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function GET() {
  try {
    const db = getAdminFirestore();
    const snapshot = await db.collection(PROMPTS_COLLECTION).get();
    const list: PromptListItem[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      const updatedAt = data.updatedAt?.toDate?.() ?? data.updatedAt;
      return {
        id: doc.id,
        name: (data.name as string) || displayName(doc.id),
        currentVersion: typeof data.currentVersion === 'number' ? data.currentVersion : 0,
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : new Date(0).toISOString(),
      };
    });
    return NextResponse.json(list);
  } catch (err) {
    console.error('GET /api/admin/prompts:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to list prompts' },
      { status: 500 }
    );
  }
}
