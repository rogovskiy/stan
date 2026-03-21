/**
 * Firestore persistence for position thesis drafts / published theses.
 *
 * Deploy rules so users can only read/write documents where request.auth.uid == resource.data.userId
 * (and the same on create with request.resource.data.userId).
 */

import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type {
  PositionThesisPayload,
  PositionThesisStatus,
  PositionThesisFirestoreDoc,
} from '../types/positionThesis';

const COLLECTION = 'position_theses';

export function positionThesisDocId(userId: string, ticker: string): string {
  return `${userId}_${ticker.toUpperCase()}`;
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
    baseReturnYear: '8%',
    dividendYieldAssumption: '3.5%',
    growthAssumption: '4–6%',
    upsideScenario: 'Oil shock or supply disruption drives 20–35% upside over 6–18 months.',
    baseScenario:
      'Oil remains in a healthy range, dividend remains secure, modest capital appreciation continues.',
    downsideScenario:
      'Oil falls due to demand slowdown or de-escalation, compressing earnings and multiple.',
    drivers: [
      { driver: 'Oil price', whyItMatters: 'Primary earnings driver', currentState: 'Elevated', importance: 'High' },
      { driver: 'Supply constraints', whyItMatters: 'Supports pricing', currentState: 'Moderate/High', importance: 'High' },
      { driver: 'Dividend stability', whyItMatters: 'Valuation floor', currentState: 'Strong', importance: 'Medium' },
      { driver: 'Global demand', whyItMatters: 'Supports volumes and sentiment', currentState: 'Moderate', importance: 'High' },
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
  const payload = data.payload as PositionThesisPayload | undefined;
  if (!payload) return null;

  return {
    id: snap.id,
    status: data.status === 'published' ? 'published' : 'draft',
    payload: { ...payload, ticker: (payload.ticker || ticker).toUpperCase() },
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
