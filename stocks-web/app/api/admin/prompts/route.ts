import { NextResponse } from 'next/server';
import { getAdminFirestore } from '@/app/lib/firebase-admin';

const PROMPTS_COLLECTION = 'prompts';

export interface PromptListItem {
  id: string;
  name: string;
  currentVersion: number;
  model: string | null;
  updatedAt: string;
}

function displayName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getVersionMeta(versions: unknown[], version: number): { model?: string | null } {
  if (!Array.isArray(versions)) return {};
  const entry = versions.find((v) => (v as { version?: number })?.version === version);
  if (!entry || typeof entry !== 'object') return {};
  return {
    model: (entry as { model?: string | null }).model ?? null,
  };
}

export async function GET() {
  try {
    const db = getAdminFirestore();
    const snapshot = await db.collection(PROMPTS_COLLECTION).get();
    const list: PromptListItem[] = snapshot.docs.map((doc) => {
      const data = doc.data();
      const updatedAt = data.updatedAt?.toDate?.() ?? data.updatedAt;
      const currentVersion = typeof data.currentVersion === 'number' ? data.currentVersion : 0;
      const meta = getVersionMeta(data.versions ?? [], currentVersion);
      return {
        id: doc.id,
        name: (data.name as string) || displayName(doc.id),
        currentVersion,
        model: meta.model ?? null,
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
