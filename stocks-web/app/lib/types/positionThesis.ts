/**
 * Position thesis builder — Firestore payload (see positionThesisService).
 * Collection: `position_theses`. Legacy doc id: `${userId}_${TICKER}`; new theses use opaque UUID ids.
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
  /** Which multiple the range refers to: typically P/E or P/FCF. */
  baseMultipleBasis: string;
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

/** Provenance snapshot stored on the thesis document (not inside payload). */
export interface AuthoringContextEntry {
  source: 'standalone' | 'portfolio_position' | 'onboard_handoff';
  capturedAt: string;
  portfolioId?: string;
  positionId?: string;
  portfolioName?: string;
  retroactive?: boolean;
  coachContextSummary?: string;
  positionSnapshot?: {
    quantity?: number;
    purchasePrice?: number;
    purchaseDate?: string;
    bandId?: string | null;
    bandName?: string;
    bandSummary?: string;
    buyDateMin?: string;
    buyDateMax?: string;
  };
}

export interface PositionThesisFirestoreDoc {
  userId: string;
  ticker: string;
  status: PositionThesisStatus;
  payload: PositionThesisPayload;
  createdAt?: unknown;
  updatedAt?: unknown;
  publishedAt?: unknown;
  /** Denormalized for queries / rules (optional). */
  portfolioId?: string | null;
  positionId?: string | null;
  /** Capped append-only log of save-time context (newest first). */
  authoringHistory?: AuthoringContextEntry[];
}
