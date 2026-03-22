/**
 * Position thesis builder — Firestore payload (see positionThesisService).
 * Collection: position_theses, doc id: `${userId}_${TICKER}`.
 */

export interface DriverRow {
  driver: string;
  whyItMatters: string;
  /** One of High / Medium / Low; other legacy strings may exist until re-saved. */
  importance: string;
}

export interface FailureRow {
  failurePath: string;
  trigger: string;
  estimatedImpact: string;
  timeframe: string;
}

export interface PositionThesisPayload {
  /** Display ticker (uppercase in storage) */
  ticker: string;
  positionRole: string;
  holdingHorizon: string;
  thesisStatement: string;
  portfolioRole: string;
  regimeDesignedFor: string;
  entryPrice: string;
  upsideDividendAssumption: string;
  upsideGrowthAssumption: string;
  upsideMultipleAssumption: string;
  baseDividendAssumption: string;
  baseGrowthAssumption: string;
  baseMultipleAssumption: string;
  downsideDividendAssumption: string;
  downsideGrowthAssumption: string;
  downsideMultipleAssumption: string;
  upsideScenario: string;
  baseScenario: string;
  downsideScenario: string;
  drivers: DriverRow[];
  failures: FailureRow[];
  distanceToFailure: string;
  currentVolRegime: string;
  riskPosture: string;
  trimRule: string;
  exitRule: string;
  addRule: string;
  systemMonitoringSignals: string;
}

export type PositionThesisStatus = 'draft' | 'published';

export interface PositionThesisFirestoreDoc {
  userId: string;
  ticker: string;
  status: PositionThesisStatus;
  payload: PositionThesisPayload;
  createdAt?: unknown;
  updatedAt?: unknown;
  publishedAt?: unknown;
}
