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

export interface PromptVersionListItem {
  version: number;
  updatedAt: string;
  temperature: number | null;
  model: string | null;
  groundingEnabled: boolean;
  structuredOutput: boolean;
  schema: string | null;
}

export interface LoadPromptVersionResult {
  docExists: boolean;
  id: string;
  name: string;
  currentVersion: number;
  loadVersion: number;
  content: string;
  params: VersionParams;
  updatedAtIso: string | null;
  versions: PromptVersionListItem[];
}

export function displayNameForPromptId(id: string): string {
  return id.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function promptVersionStoragePath(id: string, version: number): string {
  return `${STORAGE_PREFIX}/${id}/v${version}.txt`;
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

function parseVersionEntry(entry: unknown): { version: number; updatedAt: string } & VersionParams {
  const o = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
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

/**
 * Load one prompt version from Firestore + Storage (same semantics as GET /api/admin/prompts/[id]).
 */
export async function loadPromptVersion(
  id: string,
  requestedVersion: number | null
): Promise<LoadPromptVersionResult> {
  const db = getAdminFirestore();
  const ref = db.collection(PROMPTS_COLLECTION).doc(id);
  const doc = await ref.get();

  if (!doc.exists) {
    return {
      docExists: false,
      id,
      name: displayNameForPromptId(id),
      currentVersion: 0,
      loadVersion: 0,
      content: '',
      params: defaultParams(),
      updatedAtIso: null,
      versions: [],
    };
  }

  const data = doc.data()!;
  const currentVersion = typeof data.currentVersion === 'number' ? data.currentVersion : 0;
  const rawVersions = Array.isArray(data.versions) ? data.versions : [];
  const parsedVersions = rawVersions.map(parseVersionEntry).filter((v) => v.version > 0);
  if (parsedVersions.length === 0 && currentVersion > 0) {
    parsedVersions.push({
      ...defaultParams(),
      version: currentVersion,
      updatedAt: (data.updatedAt?.toDate?.() ?? data.updatedAt)?.toString() ?? '',
    });
  }

  const updatedAt = data.updatedAt?.toDate?.() ?? data.updatedAt;
  const loadVersion =
    requestedVersion != null && requestedVersion > 0 ? requestedVersion : currentVersion;
  const viewingEntry = parsedVersions.find((v) => v.version === loadVersion);
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
    const blob = bucket.file(promptVersionStoragePath(id, loadVersion));
    const [exists] = await blob.exists();
    if (exists) {
      const [buf] = await blob.download();
      content = buf.toString('utf-8');
    }
  }

  return {
    docExists: true,
    id,
    name: (data.name as string) || displayNameForPromptId(id),
    currentVersion,
    loadVersion,
    content,
    params,
    updatedAtIso: updatedAt ? new Date(updatedAt).toISOString() : null,
    versions: parsedVersions.map((v) => ({
      version: v.version,
      updatedAt: v.updatedAt,
      temperature: v.temperature,
      model: v.model,
      groundingEnabled: v.groundingEnabled,
      structuredOutput: v.structuredOutput,
      schema: v.schema,
    })),
  };
}

export function applyPromptPlaceholders(template: string, values: Record<string, string>): string {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
}

export function resolveGeminiModel(params: VersionParams): string {
  const m = params.model?.trim();
  if (m) return m;
  return process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';
}

export function promptNotConfiguredMessage(id: string): string {
  return `Prompt "${id}" is not configured (missing document, no active version, or empty content).`;
}

export function isPromptExecutable(r: LoadPromptVersionResult): boolean {
  return r.docExists && r.currentVersion > 0 && r.content.trim().length > 0;
}
