/**
 * Firestore persistence for position thesis drafts / published theses.
 *
 * Deploy rules so users can only read/write documents where request.auth.uid == resource.data.userId
 * (and the same on create with request.resource.data.userId).
 */

import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  type DocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  isFailureRow,
  normalizeDriverRow,
  POSITION_THESIS_MERGE_STRING_KEYS,
} from '../positionThesisMerge';
import { scratchPositionThesisPayload } from '../positionThesisScratch';
import type {
  AuthoringContextEntry,
  DriverRow,
  PositionThesisPayload,
  PositionThesisStatus,
  PositionThesisFirestoreDoc,
} from '../types/positionThesis';

const COLLECTION = 'position_theses';

export function positionThesisDocId(userId: string, ticker: string): string {
  return `${userId}_${ticker.toUpperCase()}`;
}

/** New thesis documents use opaque ids (UUID v4). */
export function newThesisDocumentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
}

const AUTHORING_HISTORY_MAX = 25;

function normalizeAuthoringHistory(
  raw: unknown
): AuthoringContextEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: AuthoringContextEntry[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const e = r as Record<string, unknown>;
    if (typeof e.source !== 'string' || typeof e.capturedAt !== 'string') continue;
    if (!['standalone', 'portfolio_position', 'onboard_handoff'].includes(e.source)) continue;
    out.push(e as unknown as AuthoringContextEntry);
  }
  return out.length > 0 ? out : undefined;
}

/** Firestore rejects `undefined`; drop keys with undefined values in JSON-like authoring blobs. */
function stripUndefinedFromJsonNode<T>(value: T): T {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedFromJsonNode(item)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue;
    out[k] = stripUndefinedFromJsonNode(v);
  }
  return out as T;
}

export { scratchPositionThesisPayload };

export function defaultPositionThesisPayload(ticker: string): PositionThesisPayload {
  const t = ticker.toUpperCase();
  return {
    ticker: t,
    positionRole: 'Energy cashflow + inflation hedge',
    holdingHorizon: '1–10 years',
    thesisStatement:
      'Chevron is owned as a resilient energy cashflow asset that provides dividend income, moderate long-term growth, and upside in supply-constrained oil regimes. The position is intended to outperform in inflationary or geopolitical energy shocks while remaining holdable across a 1–10 year regime.',
    portfolioRole:
      'Provides non-tech cashflow exposure, inflation sensitivity, and a partial hedge against energy-driven macro shocks.',
    regimeDesignedFor:
      'Stable-to-tight oil market, geopolitical risk, moderate inflation, and persistent demand for cash-generative dividend payers.',
    entryPrice: '$150',
    upsideDividendAssumption: '',
    upsideGrowthAssumption: '',
    upsideMultipleAssumption: '',
    baseDividendAssumption: '3–4',
    baseGrowthAssumption: '4–6',
    baseMultipleBasis: 'P/E',
    baseMultipleAssumption: '11–14',
    downsideDividendAssumption: '',
    downsideGrowthAssumption: '',
    downsideMultipleAssumption: '',
    upsideScenario: 'Oil shock or supply disruption drives 20–35% upside over 6–18 months.',
    baseScenario:
      'Oil remains in a healthy range, dividend remains secure, modest capital appreciation continues.',
    downsideScenario:
      'Oil falls due to demand slowdown or de-escalation, compressing earnings and multiple.',
    drivers: [
      { driver: 'Oil price', whyItMatters: 'Primary earnings driver', importance: 'High' },
      { driver: 'Supply constraints', whyItMatters: 'Supports pricing', importance: 'High' },
      { driver: 'Dividend stability', whyItMatters: 'Valuation floor', importance: 'Medium' },
      { driver: 'Global demand', whyItMatters: 'Supports volumes and sentiment', importance: 'High' },
    ],
    failures: [
      { failurePath: 'Oil collapse', trigger: 'Oil < $60 for 3+ months', estimatedImpact: '-25%', timeframe: '3–6 months' },
      { failurePath: 'Demand slowdown', trigger: 'Global recession', estimatedImpact: '-15%', timeframe: '6–18 months' },
      { failurePath: 'Rotation out of energy', trigger: 'Lower commodity risk premium', estimatedImpact: '-10%', timeframe: 'Gradual' },
    ],
    distanceToFailure: 'Oil $90 now vs failure at $60 → 33% buffer',
    currentVolRegime: 'High',
    riskPosture: 'Elevated but thesis intact',
    trimRule:
      'If total return exceeds 30% in less than 12 months, re-underwrite forward return. If expected return compresses below target, trim 30–50%.',
    exitRule:
      'Exit if oil remains below $60 for 3+ months, dividend safety deteriorates, or thesis regime changes to structurally oversupplied oil.',
    addRule:
      'Add only when forward return improves and risk contracts, such as after de-risking without core thesis damage.',
    systemMonitoringSignals:
      'Oil price, oil IV percentile, skew, dividend coverage, geopolitical shift score, recession probability.',
  };
}

function toIso(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof (value as { toDate?: () => Date }).toDate === 'function') {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  return undefined;
}

function applyLegacyReturnAssumptions(
  out: PositionThesisPayload,
  raw: Record<string, unknown>
): void {
  if (!out.baseDividendAssumption && typeof raw.dividendYieldAssumption === 'string') {
    out.baseDividendAssumption = raw.dividendYieldAssumption;
  }
  if (!out.baseGrowthAssumption && typeof raw.growthAssumption === 'string') {
    out.baseGrowthAssumption = raw.growthAssumption;
  }
  if (!out.baseMultipleAssumption && typeof raw.baseReturnYear === 'string') {
    out.baseMultipleAssumption = `Implied headline return ~${raw.baseReturnYear}`;
  }
}

/** Coerce Firestore/API JSON into `PositionThesisPayload` (handles legacy keys). */
export function coercePositionThesisPayload(
  raw: unknown,
  fallbackTicker: string
): PositionThesisPayload {
  const base = scratchPositionThesisPayload(fallbackTicker);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return base;
  const r = raw as Record<string, unknown>;

  const out: PositionThesisPayload = {
    ...base,
    ticker: (typeof r.ticker === 'string' ? r.ticker.trim() : fallbackTicker.trim()).toUpperCase() || base.ticker,
  };

  for (const key of POSITION_THESIS_MERGE_STRING_KEYS) {
    const v = r[key as string];
    if (typeof v === 'string')
      (out as unknown as Record<string, string>)[key as string] = v;
  }

  if (Array.isArray(r.drivers)) {
    out.drivers = r.drivers
      .map((d) => normalizeDriverRow(d))
      .filter((row): row is DriverRow => row !== null);
  }
  if (Array.isArray(r.failures)) {
    out.failures = r.failures.filter(isFailureRow);
  }

  applyLegacyReturnAssumptions(out, r);
  return out;
}

export interface LoadedPositionThesis {
  id: string;
  status: PositionThesisStatus;
  payload: PositionThesisPayload;
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string;
  authoringHistory?: AuthoringContextEntry[];
  portfolioId?: string | null;
  positionId?: string | null;
}

function loadedFromSnap(snap: DocumentSnapshot, tickerHint: string): LoadedPositionThesis | null {
  if (!snap.exists()) return null;
  const data = snap.data() as Partial<PositionThesisFirestoreDoc>;
  if (data.userId == null) return null;
  const rawPayload = data.payload;
  if (!rawPayload || typeof rawPayload !== 'object') return null;

  const coerced = coercePositionThesisPayload(rawPayload, tickerHint);
  const t = (coerced.ticker || tickerHint).toUpperCase();

  return {
    id: snap.id,
    status: data.status === 'published' ? 'published' : 'draft',
    payload: { ...coerced, ticker: t },
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    publishedAt: toIso(data.publishedAt),
    authoringHistory: normalizeAuthoringHistory(data.authoringHistory),
    portfolioId: data.portfolioId ?? null,
    positionId: data.positionId ?? null,
  };
}

export async function getPositionThesis(
  userId: string,
  ticker: string
): Promise<LoadedPositionThesis | null> {
  if (!db) throw new Error('Firestore not initialized');
  const ref = doc(db, COLLECTION, positionThesisDocId(userId, ticker));
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() as Partial<PositionThesisFirestoreDoc>;
  if (data.userId !== userId) return null;

  return loadedFromSnap(snap, ticker);
}

export async function getPositionThesisByDocId(
  userId: string,
  docId: string
): Promise<LoadedPositionThesis | null> {
  if (!db) throw new Error('Firestore not initialized');
  if (!docId.trim()) return null;
  const ref = doc(db, COLLECTION, docId.trim());
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;

  const data = snap.data() as Partial<PositionThesisFirestoreDoc>;
  if (data.userId !== userId) return null;

  const hint =
    typeof data.ticker === 'string' && data.ticker.trim()
      ? data.ticker.trim()
      : '';
  return loadedFromSnap(snap, hint || 'UNKNOWN');
}


export interface SavePositionThesisOptions {
  portfolioId?: string | null;
  positionId?: string | null;
  authoringEntry?: AuthoringContextEntry | null;
}

export async function savePositionThesisByDocId(
  userId: string,
  docId: string,
  ticker: string,
  payload: PositionThesisPayload,
  status: PositionThesisStatus,
  options?: SavePositionThesisOptions
): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');
  const upper = ticker.toUpperCase();
  const ref = doc(db, COLLECTION, docId);
  const existing = await getDoc(ref);

  const mergedPayload: PositionThesisPayload = {
    ...payload,
    ticker: upper,
  };

  const docData: Record<string, unknown> = {
    userId,
    ticker: upper,
    status,
    payload: mergedPayload,
    updatedAt: serverTimestamp(),
  };

  if (options?.portfolioId !== undefined) {
    docData.portfolioId = options.portfolioId ?? null;
  }
  if (options?.positionId !== undefined) {
    docData.positionId = options.positionId ?? null;
  }

  if (options?.authoringEntry) {
    const prev = normalizeAuthoringHistory(
      (existing.data() as Partial<PositionThesisFirestoreDoc>)?.authoringHistory
    );
    const next = [options.authoringEntry, ...(prev ?? [])].slice(0, AUTHORING_HISTORY_MAX);
    docData.authoringHistory = next.map((entry) =>
      stripUndefinedFromJsonNode(entry)
    ) as AuthoringContextEntry[];
  }

  if (!existing.exists()) {
    docData.createdAt = serverTimestamp();
  }

  if (status === 'published') {
    docData.publishedAt = serverTimestamp();
  }

  await setDoc(ref, docData, { merge: true });
}

/** Legacy single-doc-per-ticker save path (`userId_TICKER`). */
export async function savePositionThesis(
  userId: string,
  ticker: string,
  payload: PositionThesisPayload,
  status: PositionThesisStatus,
  options?: SavePositionThesisOptions
): Promise<void> {
  return savePositionThesisByDocId(
    userId,
    positionThesisDocId(userId, ticker),
    ticker,
    payload,
    status,
    options
  );
}
