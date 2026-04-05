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

export type ThesisDriverEvaluationScore = 'working' | 'mixed' | 'failing';
export type ThesisFailureEvaluationScore = 'inactive' | 'emerging' | 'active';
export type ThesisEvaluationStatus =
  | 'healthy'
  | 'unsure'
  | 'problematic'
  | 'trim'
  | 'exit'
  | 'possible_add';
export type ThesisRuleRegime = 'none' | 'monitor' | 'add' | 'trim' | 'exit';
export type ThesisEvaluationState = 'ready' | 'blocked' | 'error';

export interface ThesisEvidenceItem {
  source: string;
  detail: string;
}

export interface ThesisDriverEvaluation {
  driver: string;
  whyItMatters: string;
  importance: string;
  score: ThesisDriverEvaluationScore;
  rationale: string;
  evidence: ThesisEvidenceItem[];
}

export interface ThesisFailureEvaluation {
  failurePath: string;
  trigger: string;
  estimatedImpact: string;
  timeframe: string;
  score: ThesisFailureEvaluationScore;
  rationale: string;
  evidence: ThesisEvidenceItem[];
}

export interface ThesisEvaluationStructuredResult {
  summary: string;
  systemRecommendation: string;
  driverAssessments: ThesisDriverEvaluation[];
  failureAssessments: ThesisFailureEvaluation[];
  ruleSignals?: {
    trimTriggered?: boolean;
    exitTriggered?: boolean;
    addTriggered?: boolean;
    rationale?: string;
  };
}

export interface ThesisEvaluationDerivedResult {
  status: ThesisEvaluationStatus;
  statusRationale: string;
  recommendationLabel: string;
  ruleRegime: ThesisRuleRegime;
  driverHealthScore: number;
  failurePressureScore: number;
  thesisConfidenceScore: number;
}

export interface ThesisEvaluationPromptMetadata {
  reportPromptId: string;
  reportPromptVersion: number | null;
  reportExecutionId?: string | null;
  structuringPromptId: string;
  structuringPromptVersion: number | null;
  structuringExecutionId?: string | null;
  model: string | null;
  groundingUsed: boolean;
}

export interface PositionThesisEvaluationDoc {
  thesisDocId: string;
  userId: string;
  ticker: string;
  state: ThesisEvaluationState;
  blockedReason?: string;
  reportMarkdown?: string;
  structuredResult?: ThesisEvaluationStructuredResult;
  derivedResult?: ThesisEvaluationDerivedResult;
  promptMetadata?: ThesisEvaluationPromptMetadata;
  createdAt?: unknown;
  updatedAt?: unknown;
  evaluatedAt?: unknown;
}

export interface LoadedPositionThesisEvaluation {
  id: string;
  thesisDocId: string;
  userId: string;
  ticker: string;
  state: ThesisEvaluationState;
  blockedReason?: string;
  reportMarkdown?: string;
  structuredResult?: ThesisEvaluationStructuredResult;
  derivedResult?: ThesisEvaluationDerivedResult;
  promptMetadata?: ThesisEvaluationPromptMetadata;
  createdAt?: string;
  updatedAt?: string;
  evaluatedAt?: string;
}

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
