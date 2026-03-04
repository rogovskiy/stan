import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/app/lib/firebase-admin';
import { getAdminStorageBucket } from '@/app/lib/firebase-admin';

const PROMPTS_COLLECTION = 'prompts';
const STORAGE_PREFIX = 'prompts';

function displayName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function versionPath(id: string, version: number): string {
  return `${STORAGE_PREFIX}/${id}/v${version}.txt`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const versionParam = request.nextUrl.searchParams.get('version');
  const requestedVersion = versionParam ? parseInt(versionParam, 10) : null;
  try {
    const db = getAdminFirestore();
    const ref = db.collection(PROMPTS_COLLECTION).doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json(
        { id, name: displayName(id), content: '', currentVersion: 0, updatedAt: null, versions: [] },
        { status: 200 }
      );
    }
    const data = doc.data()!;
    const currentVersion = typeof data.currentVersion === 'number' ? data.currentVersion : 0;
    const versions: { version: number; updatedAt: string }[] = Array.isArray(data.versions)
      ? data.versions
      : currentVersion > 0
        ? [{ version: currentVersion, updatedAt: (data.updatedAt?.toDate?.() ?? data.updatedAt)?.toString() ?? '' }]
        : [];
    const updatedAt = data.updatedAt?.toDate?.() ?? data.updatedAt;
    const loadVersion = requestedVersion != null && requestedVersion > 0 ? requestedVersion : currentVersion;
    let content = '';
    if (loadVersion > 0) {
      const bucket = getAdminStorageBucket();
      const blob = bucket.file(versionPath(id, loadVersion));
      const [exists] = await blob.exists();
      if (exists) {
        const [buf] = await blob.download();
        content = buf.toString('utf-8');
      }
    }
    return NextResponse.json({
      id,
      name: (data.name as string) || displayName(id),
      content,
      currentVersion,
      viewingVersion: loadVersion,
      updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
      versions,
    });
  } catch (err) {
    console.error('GET /api/admin/prompts/[id]:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get prompt' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { content?: string; activateVersion?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const db = getAdminFirestore();
  const bucket = getAdminStorageBucket();
  const ref = db.collection(PROMPTS_COLLECTION).doc(id);

  if (typeof body.activateVersion === 'number') {
    const version = body.activateVersion;
    if (version < 1) {
      return NextResponse.json({ error: 'activateVersion must be >= 1' }, { status: 400 });
    }
    const blob = bucket.file(versionPath(id, version));
    const [exists] = await blob.exists();
    if (!exists) {
      return NextResponse.json({ error: `Version ${version} not found` }, { status: 404 });
    }
    const doc = await ref.get();
    const data = doc.data() || {};
    const versions: { version: number; updatedAt: string }[] = Array.isArray(data.versions) ? data.versions : [];
    const now = new Date().toISOString();
    await ref.set(
      {
        name: data.name || displayName(id),
        currentVersion: version,
        updatedAt: now,
        versions: versions.length ? versions : [{ version, updatedAt: now }],
      },
      { merge: true }
    );
    return NextResponse.json({ ok: true, currentVersion: version });
  }

  if (typeof body.content !== 'string') {
    return NextResponse.json({ error: 'Body must include { content: string } or { activateVersion: number }' }, { status: 400 });
  }

  const doc = await ref.get();
  const data = doc.data() || {};
  const currentVersion = typeof data.currentVersion === 'number' ? data.currentVersion : 0;
  const newVersion = currentVersion + 1;
  const versions: { version: number; updatedAt: string }[] = Array.isArray(data.versions) ? [...data.versions] : [];
  const now = new Date().toISOString();
  versions.push({ version: newVersion, updatedAt: now });

  const blob = bucket.file(versionPath(id, newVersion));
  await blob.save(Buffer.from(body.content, 'utf-8'), {
    contentType: 'text/plain; charset=utf-8',
  });

  await ref.set(
    {
      name: data.name || displayName(id),
      currentVersion: newVersion,
      updatedAt: now,
      versions,
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, currentVersion: newVersion });
}
