import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/app/lib/firebase-admin';
import { getAdminStorageBucket } from '@/app/lib/firebase-admin';
import {
  displayNameForPromptId,
  loadPromptVersion,
  promptVersionStoragePath,
  type VersionParams,
} from '@/app/lib/server/loadPrompt';

const PROMPTS_COLLECTION = 'prompts';

export type { VersionParams };

function defaultParams(): VersionParams {
  return {
    temperature: null,
    model: null,
    groundingEnabled: false,
    structuredOutput: false,
    schema: null,
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
    const r = await loadPromptVersion(
      id,
      requestedVersion != null && !Number.isNaN(requestedVersion) ? requestedVersion : null
    );

    if (!r.docExists) {
      return NextResponse.json(
        {
          id,
          name: displayNameForPromptId(id),
          content: '',
          currentVersion: 0,
          updatedAt: null,
          versions: [],
          params: defaultParams(),
        },
        { status: 200 }
      );
    }

    return NextResponse.json({
      id: r.id,
      name: r.name,
      content: r.content,
      currentVersion: r.currentVersion,
      viewingVersion: r.loadVersion,
      updatedAt: r.updatedAtIso,
      versions: r.versions,
      params: r.params,
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
    const blob = bucket.file(promptVersionStoragePath(id, version));
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
        name: data.name || displayNameForPromptId(id),
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

  const blob = bucket.file(promptVersionStoragePath(id, newVersion));
  await blob.save(Buffer.from(body.content, 'utf-8'), {
    contentType: 'text/plain; charset=utf-8',
  });

  await ref.set(
    {
      name: data.name || displayNameForPromptId(id),
      currentVersion: newVersion,
      updatedAt: now,
      versions,
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, currentVersion: newVersion });
}
