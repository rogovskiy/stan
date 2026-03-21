/**
 * Position thesis builder — Firestore payload (see positionThesisService).
 * Collection: position_theses, doc id: `${userId}_${TICKER}`.
 */

export interface DriverRow {
  driver: string;
  whyItMatters: string;
  currentState: string;
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
  baseReturnYear: string;
  dividendYieldAssumption: string;
  growthAssumption: string;
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
