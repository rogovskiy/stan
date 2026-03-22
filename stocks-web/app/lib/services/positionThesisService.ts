/**
 * Firestore persistence for position thesis drafts / published theses.
 *
 * Deploy rules so users can only read/write documents where request.auth.uid == resource.data.userId
 * (and the same on create with request.resource.data.userId).
 */

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import {
  isFailureRow,
  normalizeDriverRow,
  POSITION_THESIS_MERGE_STRING_KEYS,
} from '../positionThesisMerge';
import type {
  DriverRow,
  PositionThesisPayload,
  PositionThesisStatus,
  PositionThesisFirestoreDoc,
} from '../types/positionThesis';

const COLLECTION = 'position_theses';

export function positionThesisDocId(userId: string, ticker: string): string {
  return `${userId}_${ticker.toUpperCase()}`;
}

/** Empty template for onboarding / scratch builds (no sample copy). */
export function scratchPositionThesisPayload(initialTicker = ''): PositionThesisPayload {
  const t = initialTicker.trim().toUpperCase();
  return {
    ticker: t,
    positionRole: '',
    holdingHorizon: '',
    thesisStatement: '',
    portfolioRole: '',
    regimeDesignedFor: '',
    entryPrice: '',
    upsideDividendAssumption: '',
    upsideGrowthAssumption: '',
    upsideMultipleAssumption: '',
    baseDividendAssumption: '',
    baseGrowthAssumption: '',
    baseMultipleBasis: 'P/E',
    baseMultipleAssumption: '',
    downsideDividendAssumption: '',
    downsideGrowthAssumption: '',
    downsideMultipleAssumption: '',
    upsideScenario: '',
    baseScenario: '',
    downsideScenario: '',
    drivers: [],
    failures: [],
    distanceToFailure: '',
    currentVolRegime: '',
    riskPosture: '',
    trimRule: '',
    exitRule: '',
    addRule: '',
    systemMonitoringSignals: '',
  };
}

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
    if (typeof v === 'string') (out as Record<string, string>)[key] = v;
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
  const rawPayload = data.payload;
  if (!rawPayload || typeof rawPayload !== 'object') return null;

  const coerced = coercePositionThesisPayload(rawPayload, ticker);

  return {
    id: snap.id,
    status: data.status === 'published' ? 'published' : 'draft',
    payload: { ...coerced, ticker: (coerced.ticker || ticker).toUpperCase() },
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    publishedAt: toIso(data.publishedAt),
  };
}

export async function savePositionThesis(
  userId: string,
  ticker: string,
  payload: PositionThesisPayload,
  status: PositionThesisStatus
): Promise<void> {
  if (!db) throw new Error('Firestore not initialized');
  const upper = ticker.toUpperCase();
  const ref = doc(db, COLLECTION, positionThesisDocId(userId, ticker));
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

  if (!existing.exists()) {
    docData.createdAt = serverTimestamp();
  }

  if (status === 'published') {
    docData.publishedAt = serverTimestamp();
  }

  await setDoc(ref, docData, { merge: true });
}
