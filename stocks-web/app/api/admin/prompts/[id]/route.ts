import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/app/lib/firebase-admin';
import { getAdminStorageBucket } from '@/app/lib/firebase-admin';

const PROMPTS_COLLECTION = 'prompts';
const STORAGE_PREFIX = 'prompts';

export interface VersionParams {
  temperature: number | null;
  model: string | null;
  groundingEnabled: boolean;
  structuredOutput: boolean;
  schema: string | null;
}

function displayName(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function versionPath(id: string, version: number): string {
  return `${STORAGE_PREFIX}/${id}/v${version}.txt`;
}

function parseVersionEntry(entry: unknown): { version: number; updatedAt: string } & VersionParams {
  const o = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
  return {
    version: typeof o.version === 'number' ? o.version : 0,
    updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : '',
    temperature: typeof o.temperature === 'number' ? o.temperature : null,
    model: typeof o.model === 'string' ? o.model : null,
    groundingEnabled: o.groundingEnabled === true,
    structuredOutput: o.structuredOutput === true,
    schema: typeof o.schema === 'string' ? o.schema : null,
  };
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
        { id, name: displayName(id), content: '', currentVersion: 0, updatedAt: null, versions: [], params: defaultParams() },
        { status: 200 }
      );
    }
    const data = doc.data()!;
    const currentVersion = typeof data.currentVersion === 'number' ? data.currentVersion : 0;
    const rawVersions = Array.isArray(data.versions) ? data.versions : [];
    const versions = rawVersions.map(parseVersionEntry).filter((v) => v.version > 0);
    if (versions.length === 0 && currentVersion > 0) {
      versions.push({
        ...defaultParams(),
        version: currentVersion,
        updatedAt: (data.updatedAt?.toDate?.() ?? data.updatedAt)?.toString() ?? '',
      });
    }
    const updatedAt = data.updatedAt?.toDate?.() ?? data.updatedAt;
    const loadVersion = requestedVersion != null && requestedVersion > 0 ? requestedVersion : currentVersion;
    const viewingEntry = versions.find((v) => v.version === loadVersion);
    const params: VersionParams = viewingEntry
      ? {
          temperature: viewingEntry.temperature,
          model: viewingEntry.model,
          groundingEnabled: viewingEntry.groundingEnabled,
          structuredOutput: viewingEntry.structuredOutput,
          schema: viewingEntry.schema,
        }
      : defaultParams();
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
      versions: versions.map((v) => ({ version: v.version, updatedAt: v.updatedAt, temperature: v.temperature, model: v.model, groundingEnabled: v.groundingEnabled, structuredOutput: v.structuredOutput, schema: v.schema })),
      params,
    });
  } catch (err) {
    console.error('GET /api/admin/prompts/[id]:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to get prompt' },
      { status: 500 }
    );
  }
}

function defaultParams(): VersionParams {
  return {
    temperature: null,
    model: null,
    groundingEnabled: false,
    structuredOutput: false,
    schema: null,
  };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: {
    content?: string;
    activateVersion?: number;
    temperature?: number | null;
    model?: string | null;
    groundingEnabled?: boolean;
    structuredOutput?: boolean;
    schema?: string | null;
  };
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
    const versions = Array.isArray(data.versions) ? [...data.versions] : [];
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
  const versions: Array<Record<string, unknown>> = Array.isArray(data.versions) ? [...data.versions] : [];
  const now = new Date().toISOString();
  const temperature = body.temperature !== undefined ? (typeof body.temperature === 'number' ? body.temperature : null) : null;
  const model = body.model !== undefined ? (typeof body.model === 'string' ? body.model : null) : null;
  const groundingEnabled = body.groundingEnabled === true;
  const structuredOutput = body.structuredOutput === true;
  const schema = body.schema !== undefined ? (typeof body.schema === 'string' ? body.schema : null) : null;
  versions.push({
    version: newVersion,
    updatedAt: now,
    temperature,
    model,
    groundingEnabled,
    structuredOutput,
    schema,
  });

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
